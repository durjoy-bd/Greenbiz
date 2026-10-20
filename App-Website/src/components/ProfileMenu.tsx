import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutDashboard, LogIn, LogOut, Settings, UserPlus, UserRound } from 'lucide-react';
import { isStaff, roleLabels } from '../../shared/permissions';
import { Avatar } from './UI';
import { useStore } from '../data/store';
import { useTask } from './useTask';
import { accountApi, openAdminPanel, type Profile } from '../data/account';
import { PROFILE_EVENT } from '../screens/Account';

let photo: { userId: string; avatar: Promise<string | null> } = { userId: '', avatar: Promise.resolve(null) };

/** The signed-in person's menu: profile, settings, the admin panel when allowed, and sign out. */
export function ProfileMenu({ compact = false }: { compact?: boolean }) {
  const { mode, user, leave } = useStore();
  const [open, setOpen] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const { run, busy } = useTask();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'server' || !user) return;
    let active = true;
    // One request per signed-in account, shared by every menu on the page.
    if (photo.userId !== user.id) photo = { userId: user.id, avatar: accountApi.profile().then((p) => p.avatar, () => null) };
    void photo.avatar.then((value) => active && setAvatar(value));
    const listener = (e: Event) => {
      const next = (e as CustomEvent<Profile>).detail.avatar;
      photo = { userId: user.id, avatar: Promise.resolve(next) };
      setAvatar(next);
    };
    window.addEventListener(PROFILE_EVENT, listener);
    return () => {
      active = false;
      window.removeEventListener(PROFILE_EVENT, listener);
    };
  }, [mode, user?.id]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const go = (hash: string) => {
    setOpen(false);
    location.hash = hash;
  };
  const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
  const name = user?.name || user?.email || 'Not signed in';
  return (
    <div
      className={'profile-menu' + (compact ? ' compact' : '')}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          root.current?.querySelector<HTMLElement>('.profile-trigger')?.focus();
        }
        if (open && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          const index = items.indexOf(document.activeElement as HTMLElement);
          items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
    >
      <button className="profile-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(!open)}>
        <Avatar name={user?.name} email={user?.email} src={avatar} size={compact ? 34 : 36} />
        {!compact && (
          <span className="profile-name">
            <b>{name}</b>
            <small>{user ? roleLabels[user.accessRole ?? 'user'] : mode === 'demo' ? 'Fictional sample data' : 'Records on this device'}</small>
          </span>
        )}
        {!compact && <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="profile-popover" role="menu" aria-label="Account" ref={menu}>
          <div className="profile-head">
            <b>{name}</b>
            {user && <small>{user.email}</small>}
          </div>
          {user ? (
            <>
              <button role="menuitem" onClick={() => go('#/account')}>
                <UserRound size={17} /> Profile & account
              </button>
              {user.role === 'merchant' && (
                <button role="menuitem" onClick={() => go('#/settings')}>
                  <Settings size={17} /> Shop settings
                </button>
              )}
              {isStaff(user.accessRole) && (
                <button role="menuitem" onClick={() => {
                    setOpen(false);
                    openAdminPanel();
                  }}>
                  <LayoutDashboard size={17} /> Admin panel
                </button>
              )}
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void run(leave);
                }}
              >
                <LogOut size={17} /> Sign out
              </button>
            </>
          ) : (
            <>
              <button role="menuitem" onClick={() => go('#/settings')}>
                <Settings size={17} /> Shop settings
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void run(async () => {
                    await leave();
                    location.hash = '#/login';
                  });
                }}
              >
                <LogIn size={17} /> Sign in
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void run(async () => {
                    await leave();
                    location.hash = '#/register';
                  });
                }}
              >
                <UserPlus size={17} /> Create an account
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
