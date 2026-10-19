import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { get, set, update, del, keys, delMany, setMany } from 'idb-keyval';
import type { Action, Mode, Workspace, Shop, Session, User } from '../../shared/types';
import { applyAction, createWorkspace } from '../../shared/domain';
import { demoWorkspace } from './demo';
import {
  api,
  ApiError,
  clearSession,
  restoreSession,
  saveSession,
  serverURL,
  selectApiShop,
} from './api';
import { prepareAction, replayPending, type SyncState } from './sync';
import { setAiScope, clearAiCredentials } from './business';
export class StaleShopError extends Error {
  constructor() {
    super('The active shop changed while the request was in progress.');
  }
}
export interface ShopSummary {
  id: string;
  name: string;
}
interface Store {
  workspace: Workspace | null;
  mode: Mode | null;
  user: User | null;
  loading: boolean;
  offline: boolean;
  error: string;
  shops: ShopSummary[];
  shopId: string;
  pendingCount: number;
  syncConflict: string;
  setError: (e: string) => void;
  start: (mode: 'device' | 'demo', shop?: Partial<Shop>) => Promise<void>;
  authenticate: (register: boolean, form: Record<string, string>) => Promise<void>;
  reconnect: (password: string) => Promise<void>;
  act: (a: Action) => Promise<void>;
  refresh: () => Promise<void>;
  leave: () => Promise<void>;
  deleteDevice: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  switchShop: (id: string) => Promise<void>;
  createShop: (name: string) => Promise<void>;
  deleteShop: () => Promise<void>;
  discardPending: () => Promise<void>;
  pendingExport: () => unknown;
  taskIdentity: () => number;
}
const Context = createContext<Store | null>(null);
export const useStore = () => useContext(Context)!;
const localKey = (mode: Mode, id: string) =>
  'greenbiz-' + mode + (id === mode + '-main' ? '' : ':' + id);
const cacheKey = (origin: string, owner: string, id: string) =>
  `greenbiz-cache:${origin}:${owner}` + (id === owner ? '' : ':' + id);
const syncKey = (origin: string, owner: string, id: string) =>
  `greenbiz-sync:${origin}:${owner}:${id}`;
const metaKey = () => 'greenbiz-session-meta:' + serverURL();
interface SessionMeta {
  user: User;
  shops: ShopSummary[];
  shopId: string;
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [mode, setMode] = useState<Mode | null>(null),
    [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [offline, setOffline] = useState(false),
    [error, setError] = useState(''),
    [shops, setShops] = useState<ShopSummary[]>([]),
    [shopId, setShopId] = useState(''),
    [pendingCount, setPendingCount] = useState(0),
    [syncConflict, setSyncConflict] = useState('');
  const generation = useRef(0),
    current = useRef<Workspace | null>(null),
    sync = useRef<SyncState | null>(null),
    chain = useRef<Promise<unknown>>(Promise.resolve());
  const assertCurrent = (epoch: number) => {
    if (epoch !== generation.current) throw new StaleShopError();
  };
  function activate() {
    current.current = null;
    setWorkspace(null);
    sync.current = null;
    chain.current = Promise.resolve();
    setPendingCount(0);
    setSyncConflict('');
    return ++generation.current;
  }
  function serial(work: () => Promise<void>) {
    const epoch = generation.current;
    const task = chain.current
      .catch(() => {})
      .then(() => {
        assertCurrent(epoch);
        return work();
      });
    chain.current = task;
    return task;
  }
  async function publish(next: Workspace, epoch: number, key?: string, force = false) {
    assertCurrent(epoch);
    const selected =
      !force && current.current && current.current.version > next.version ? current.current : next;
    current.current = selected;
    setWorkspace(selected);
    if (key)
      await update<Workspace>(key, () => {
        assertCurrent(epoch);
        return current.current ?? selected;
      });
    assertCurrent(epoch);
  }
  async function persistSync(
    value: SyncState,
    epoch: number,
    origin: string,
    owner: string,
    id: string,
  ) {
    assertCurrent(epoch);
    // A single IndexedDB transaction keeps pending operations and their projection together.
    await setMany([
      [syncKey(origin, owner, id), value],
      [cacheKey(origin, owner, id), value.optimistic],
    ]);
    assertCurrent(epoch);
    sync.current = value;
    setShops((list) =>
      list.map((s) => (s.id === id ? { ...s, name: value.optimistic.shop.name } : s)),
    );
    setPendingCount(value.pending.length);
    setSyncConflict(value.conflict || '');
    await publish(value.optimistic, epoch, undefined, true);
  }
  async function flush(epoch: number, origin: string, owner: string, id: string) {
    assertCurrent(epoch);
    let value = sync.current;
    if (!value) return;
    if (value.conflict) throw new Error(value.conflict);
    while (value.pending.length) {
      let base: Workspace;
      try {
        base = await api<Workspace>('/api/sync', value.pending[0], undefined, id);
      } catch (e) {
        assertCurrent(epoch);
        if (e instanceof ApiError && e.status === 0) {
          setOffline(true);
          return;
        }
        const conflict =
          e instanceof ApiError && e.status === 401
            ? 'Session expired. Sign in again in Settings to sync these saved changes.'
            : e instanceof ApiError && e.status === 409
              ? 'Sync paused: this shop changed on the server. Export your pending changes, then discard them to load the latest records.'
              : e instanceof Error
                ? e.message
                : 'Sync needs attention.';
        await persistSync(
          { ...value, conflict, errorStatus: e instanceof ApiError ? e.status : undefined },
          epoch,
          origin,
          owner,
          id,
        );
        throw e;
      }
      assertCurrent(epoch);
      const pending = value.pending.slice(1);
      try {
        value = { base, pending, optimistic: replayPending(base, pending) };
      } catch {
        value = {
          ...value,
          base,
          pending,
          conflict:
            'Sync paused: a pending change no longer matches the latest stock. Export pending changes before discarding them.',
        };
      }
      await persistSync(value, epoch, origin, owner, id);
      if (value.conflict) throw new Error(value.conflict);
    }
    setOffline(false);
  }
  async function openServerShop(id: string, owner: User, list: ShopSummary[], epoch: number) {
    const origin = serverURL();
    setAiScope(origin + ':' + owner.id);
    selectApiShop(id);
    setShopId(id);
    setUser(owner);
    setMode('server');
    setShops(list);
    localStorage.setItem('greenbiz-mode', 'server');
    const stored = await get<SyncState>(syncKey(origin, owner.id, id));
    assertCurrent(epoch);
    const cached = stored?.optimistic ?? (await get<Workspace>(cacheKey(origin, owner.id, id)));
    assertCurrent(epoch);
    if (stored) {
      sync.current = stored;
      setPendingCount(stored.pending.length);
      setSyncConflict(stored.conflict || '');
    }
    if (cached) await publish(cached, epoch);
    await set(metaKey(), { user: owner, shops: list, shopId: id } satisfies SessionMeta);
    assertCurrent(epoch);
    try {
      if (stored?.pending.length) await flush(epoch, origin, owner.id, id);
      else {
        const base = await api<Workspace>('/api/workspace', undefined, undefined, id);
        assertCurrent(epoch);
        await persistSync({ base, pending: [], optimistic: base }, epoch, origin, owner.id, id);
      }
      if (!sync.current?.pending.length) setOffline(false);
    } catch (e) {
      assertCurrent(epoch);
      if (cached && e instanceof ApiError && e.status === 0) setOffline(true);
      else throw e;
    }
  }
  async function start(next: 'device' | 'demo', shop?: Partial<Shop>) {
    const epoch = activate();
    selectApiShop('');
    setAiScope(next);
    let list = await get<ShopSummary[]>('greenbiz-shops-' + next);
    assertCurrent(epoch);
    const selected = await get<string>('greenbiz-active-' + next);
    assertCurrent(epoch);
    const id = list?.some((s) => s.id === selected) ? selected! : list?.[0]?.id || next + '-main';
    let value = await get<Workspace>(localKey(next, id));
    assertCurrent(epoch);
    if (!value) {
      value = next === 'demo' ? demoWorkspace() : createWorkspace(shop || { name: 'My shop' });
      await set(localKey(next, id), value);
      assertCurrent(epoch);
    }
    if (!list?.length) {
      list = [{ id, name: value.shop.name }];
      await set('greenbiz-shops-' + next, list);
      assertCurrent(epoch);
    }
    localStorage.setItem('greenbiz-mode', next);
    setMode(next);
    setUser(null);
    setShops(list);
    setShopId(id);
    setOffline(false);
    setError('');
    await publish(value, epoch);
  }
  async function authenticate(register: boolean, form: Record<string, string>) {
    const epoch = activate();
    selectApiShop('');
    const session = await api<Session>(
      '/api/auth/' + (register ? 'register' : 'login'),
      register ? form : { email: form.email, password: form.password },
    );
    assertCurrent(epoch);
    await saveSession(session);
    assertCurrent(epoch);
    if (session.user.role === 'bank') {
      setUser(session.user);
      setMode('server');
      setWorkspace(null);
      localStorage.setItem('greenbiz-mode', 'server');
      location.hash = '/bank';
      return;
    }
    const listed = await api<{ shops: ShopSummary[]; activeDefault: string }>(
      '/api/shops',
      undefined,
      undefined,
      '',
    );
    assertCurrent(epoch);
    await openServerShop(listed.activeDefault, session.user, listed.shops, epoch);
  }
  async function act(action: Action) {
    if (!mode || !current.current) throw new Error('Open a shop first.');
    const epoch = generation.current,
      id = shopId,
      owner = user?.id || '',
      origin = serverURL(),
      activeMode = mode;
    return serial(async () => {
      assertCurrent(epoch);
      if (activeMode === 'server') {
        if (!sync.current) throw new Error('Load your shop before saving changes.');
        if (sync.current.conflict) throw new Error(sync.current.conflict);
        if (sync.current.pending.length >= 1000)
          throw new Error('Sync your pending changes before adding more.');
        const prepared = prepareAction(action),
          createdAt = new Date().toISOString();
        const optimistic = applyAction(sync.current.optimistic, prepared, createdAt);
        const entry = {
          id: crypto.randomUUID(),
          baseVersion: sync.current.optimistic.version,
          action: prepared,
          createdAt,
        };
        await persistSync(
          { ...sync.current, pending: [...sync.current.pending, entry], optimistic },
          epoch,
          origin,
          owner,
          id,
        );
        await flush(epoch, origin, owner, id);
      } else {
        let next: Workspace | undefined;
        await update<Workspace>(localKey(activeMode, id), (value) => {
          assertCurrent(epoch);
          if (!value) throw new Error('This shop could not be found.');
          next = applyAction(value, action);
          return next;
        });
        assertCurrent(epoch);
        if (next) await publish(next, epoch);
      }
      if (action.type === 'shop.update' && action.shop.name) {
        setShops((list) => list.map((s) => (s.id === id ? { ...s, name: action.shop.name! } : s)));
        if (activeMode !== 'server')
          await update<ShopSummary[]>('greenbiz-shops-' + activeMode, (list) =>
            (list || []).map((s) => (s.id === id ? { ...s, name: action.shop.name! } : s)),
          );
      }
    });
  }
  async function refresh() {
    const epoch = generation.current,
      id = shopId,
      origin = serverURL(),
      owner = user?.id || '';
    return serial(async () => {
      if (mode === 'server' && user?.role === 'merchant') {
        await flush(epoch, origin, owner, id);
        if (sync.current?.pending.length) return;
        try {
          const base = await api<Workspace>('/api/workspace', undefined, undefined, id);
          assertCurrent(epoch);
          if (current.current && current.current.version > base.version) return;
          await persistSync({ base, pending: [], optimistic: base }, epoch, origin, owner, id);
          setOffline(false);
        } catch (e) {
          assertCurrent(epoch);
          if (e instanceof ApiError && e.status === 0) setOffline(true);
          throw e;
        }
      } else if (mode && mode !== 'server') {
        const value = await get<Workspace>(localKey(mode, id));
        assertCurrent(epoch);
        if (value) await publish(value, epoch);
      }
    });
  }
  async function loadLocal(id: string, activeMode: Mode, epoch: number) {
    const value = await get<Workspace>(localKey(activeMode, id));
    assertCurrent(epoch);
    if (!value) throw new Error('This shop could not be opened.');
    await set('greenbiz-active-' + activeMode, id);
    assertCurrent(epoch);
    setShopId(id);
    await publish(value, epoch);
    setOffline(false);
  }
  async function switchShop(id: string) {
    if (id === shopId) return;
    if (!shops.some((s) => s.id === id)) throw new Error('Choose one of your shops.');
    const epoch = activate();
    setError('');
    if (mode === 'server' && user) await openServerShop(id, user, shops, epoch);
    else if (mode) await loadLocal(id, mode, epoch);
    location.hash = '/home';
  }
  async function createShop(raw: string) {
    const name = raw.trim();
    if (!name || name.length > 100) throw new Error('Enter a shop name of 1–100 characters.');
    const epoch = generation.current;
    let id: string;
    if (mode === 'server') {
      const result = await api<{ id: string; workspace: Workspace }>(
        '/api/shops',
        { name },
        undefined,
        '',
      );
      assertCurrent(epoch);
      id = result.id;
    } else if (mode) {
      id = crypto.randomUUID();
      await set(localKey(mode, id), createWorkspace({ name }));
      assertCurrent(epoch);
    } else throw new Error('Open a shop first.');
    const list = [...shops, { id, name }];
    setShops(list);
    if (mode !== 'server') await set('greenbiz-shops-' + mode, list);
    assertCurrent(epoch);
    const activated = activate();
    if (mode === 'server' && user) await openServerShop(id, user, list, activated);
    else if (mode) await loadLocal(id, mode, activated);
    location.hash = '/home';
  }
  async function deleteShop() {
    if (!workspace || !mode) return;
    if (shops.length <= 1)
      throw new Error(
        'Keep at least one shop. Use account or device-shop deletion to remove your last shop.',
      );
    const epoch = generation.current,
      id = shopId;
    if (mode === 'server') {
      if (pendingCount) throw new Error('Resolve pending changes first.');
      await api(
        '/api/shops/' + encodeURIComponent(id),
        { name: workspace.shop.name },
        'DELETE',
        id,
      );
      assertCurrent(epoch);
      if (user)
        await delMany([cacheKey(serverURL(), user.id, id), syncKey(serverURL(), user.id, id)]);
    } else await del(localKey(mode, id));
    assertCurrent(epoch);
    const remaining = shops.filter((s) => s.id !== id);
    setShops(remaining);
    if (mode !== 'server') await set('greenbiz-shops-' + mode, remaining);
    assertCurrent(epoch);
    const activated = activate();
    if (mode === 'server' && user)
      await openServerShop(remaining[0].id, user, remaining, activated);
    else await loadLocal(remaining[0].id, mode, activated);
    location.hash = '/home';
  }
  async function discardPending() {
    if (mode !== 'server' || !user) return;
    const epoch = generation.current;
    return serial(async () => {
      const base = await api<Workspace>('/api/workspace', undefined, undefined, shopId);
      assertCurrent(epoch);
      await persistSync(
        { base, pending: [], optimistic: base },
        epoch,
        serverURL(),
        user.id,
        shopId,
      );
      setOffline(false);
    });
  }
  async function reconnect(password: string) {
    if (mode !== 'server' || !user || user.role !== 'merchant')
      throw new Error('Open your server shop first.');
    const epoch = generation.current,
      origin = serverURL(),
      owner = user.id,
      id = shopId;
    return serial(async () => {
      const session = await api<Session>(
        '/api/auth/login',
        { email: user.email, password },
        undefined,
        '',
      );
      assertCurrent(epoch);
      if (session.user.id !== owner)
        throw new Error('Sign in to the account that owns these records.');
      await saveSession(session);
      assertCurrent(epoch);
      if (sync.current?.errorStatus === 401)
        await persistSync(
          { ...sync.current, conflict: undefined, errorStatus: undefined },
          epoch,
          origin,
          owner,
          id,
        );
      await flush(epoch, origin, owner, id);
    });
  }
  function reset(warning = '') {
    selectApiShop('');
    setAiScope('signedout');
    localStorage.removeItem('greenbiz-mode');
    current.current = null;
    setMode(null);
    setWorkspace(null);
    setUser(null);
    setShops([]);
    setShopId('');
    setOffline(false);
    setError(warning);
    location.hash = '';
  }
  async function clearOwnedCache(owner: string, origin: string) {
    const found = (await keys()).filter(
      (k) =>
        typeof k === 'string' &&
        (k === `greenbiz-cache:${origin}:${owner}` ||
          k.startsWith(`greenbiz-cache:${origin}:${owner}:`) ||
          k.startsWith(`greenbiz-sync:${origin}:${owner}:`)),
    );
    await delMany(found);
    await del(metaKey());
  }
  async function leave() {
    const startingEpoch = generation.current;
    if (mode === 'server' && user) {
      const queueKeys = (await keys()).filter(
        (k) => typeof k === 'string' && k.startsWith(`greenbiz-sync:${serverURL()}:${user.id}:`),
      );
      for (const key of queueKeys)
        if ((await get<SyncState>(key))?.pending.length)
          throw new Error(
            'A shop has pending changes. Sync them or export and discard them before signing out.',
          );
    }
    assertCurrent(startingEpoch);
    const epoch = activate();
    let warning = '';
    if (mode === 'server') {
      try {
        await api('/api/auth/logout', {});
      } catch {
        warning = 'Signed out on this device. Remote session revocation could not be confirmed.';
      }
      assertCurrent(epoch);
      await clearSession();
      if (user) await clearOwnedCache(user.id, serverURL());
      assertCurrent(epoch);
    }
    reset(warning);
  }
  async function deleteDevice() {
    if (mode === 'server') throw new Error('Use account deletion for a server account.');
    if (shops.length > 1) return deleteShop();
    if (mode) {
      await del(localKey(mode, shopId));
      await del('greenbiz-shops-' + mode);
      await del('greenbiz-active-' + mode);
    }
    await leave();
  }
  async function deleteAccount(password: string) {
    if (mode !== 'server' || !user) throw new Error('Open a server account first.');
    const epoch = activate();
    await api('/api/auth/account', { password }, 'DELETE');
    assertCurrent(epoch);
    await clearOwnedCache(user.id, serverURL());
    assertCurrent(epoch);
    await clearAiCredentials();
    assertCurrent(epoch);
    await clearSession();
    assertCurrent(epoch);
    reset();
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const selected = localStorage.getItem('greenbiz-mode') as Mode | null;
        if (new URLSearchParams(location.search).get('demo') === '1') {
          await start('demo');
          return;
        }
        if (selected === 'device' || selected === 'demo') await start(selected);
        else if (selected === 'server') {
          const epoch = activate();
          selectApiShop('');
          await restoreSession();
          assertCurrent(epoch);
          let owner: User;
          try {
            owner = (await api<{ user: User }>('/api/auth/me')).user;
          } catch (e) {
            assertCurrent(epoch);
            const cached = await get<SessionMeta>(metaKey());
            assertCurrent(epoch);
            if (
              !(e instanceof ApiError) ||
              e.status !== 0 ||
              !cached ||
              cached.user.role !== 'merchant'
            )
              throw e;
            await openServerShop(cached.shopId, cached.user, cached.shops, epoch);
            setOffline(true);
            return;
          }
          assertCurrent(epoch);
          if (!active) return;
          if (owner.role === 'bank') {
            setUser(owner);
            setMode('server');
            location.hash = '/bank';
          } else {
            const listed = await api<{ shops: ShopSummary[]; activeDefault: string }>(
              '/api/shops',
              undefined,
              undefined,
              '',
            );
            assertCurrent(epoch);
            const previous = await get<SessionMeta>(metaKey());
            assertCurrent(epoch);
            const id = listed.shops.some((s) => s.id === previous?.shopId)
              ? previous!.shopId
              : listed.activeDefault;
            await openServerShop(id, owner, listed.shops, epoch);
          }
        }
      } catch (e) {
        if (active && !(e instanceof StaleShopError))
          setError(e instanceof Error ? e.message : 'Unable to open shop.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const listener = () => {
      if (mode === 'server')
        void refresh().catch((e) => {
          if (!(e instanceof StaleShopError))
            setError(e instanceof Error ? e.message : 'Sync needs attention.');
        });
    };
    window.addEventListener('online', listener);
    return () => window.removeEventListener('online', listener);
  }, [mode, user?.id, shopId]);
  return (
    <Context.Provider
      value={{
        workspace,
        mode,
        user,
        loading,
        offline,
        error,
        setError,
        start,
        authenticate,
        reconnect,
        act,
        refresh,
        leave,
        deleteDevice,
        deleteAccount,
        shops,
        shopId,
        switchShop,
        createShop,
        deleteShop,
        pendingCount,
        syncConflict,
        discardPending,
        pendingExport: () => sync.current?.pending || [],
        taskIdentity: () => generation.current,
      }}
    >
      {children}
    </Context.Provider>
  );
}
