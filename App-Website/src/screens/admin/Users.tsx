import { useEffect, useState } from 'react';
import { Building2, Search, X } from 'lucide-react';
import type { AccessRole, AccountStatus } from '../../../shared/permissions';
import { Button, Card, Empty, Field, Sheet } from '../../components/UI';
import { adminCall, go, Header, LoadState, Pagination, query, RefreshButton, RoleBadge, SortHeader, StatusBadge, TZ_NOTE, useAdmin, useCan, UserAvatar, VerifiedBadge, when } from './common';

interface Row {
  id: string;
  name: string;
  email: string;
  organization: string;
  type: 'merchant' | 'bank';
  accessRole: AccessRole;
  verified: boolean;
  status: AccountStatus;
  createdAt: string;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  avatarVersion: string | null;
}
type Sort = 'name' | 'email' | 'created' | 'lastLogin' | 'lastActivity' | 'status' | 'role';
const blank = { q: '', role: '', type: '', status: '', verified: '', from: '', to: '' };
const FILTER_KEY = 'greenbiz-admin-user-filters';
function saved() {
  try {
    return { ...blank, sort: 'created' as Sort, dir: 'desc' as 'asc' | 'desc', page: 1, pageSize: 25, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') };
  } catch {
    return { ...blank, sort: 'created' as Sort, dir: 'desc' as 'asc' | 'desc', page: 1, pageSize: 25 };
  }
}

export function UsersPage() {
  const [state, setState] = useState(saved);
  const [typed, setTyped] = useState(state.q);
  const [inviting, setInviting] = useState(false);
  const allowed = useCan();
  // Search waits for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setState((s: typeof state) => (s.q === typed ? s : { ...s, q: typed, page: 1 })), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(state));
    } catch {
      /* filters simply reset next time */
    }
  }, [state]);
  const { data, error, busy, loadedAt, refresh } = useAdmin<{ total: number; page: number; pageSize: number; users: Row[] }>('/api/admin/users?' + query(state));
  const filter = (key: keyof typeof blank) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setState({ ...state, [key]: e.target.value, page: 1 });
  const sortBy = (column: Sort) => setState({ ...state, sort: column, dir: state.sort === column && state.dir === 'desc' ? 'asc' : 'desc', page: 1 });
  const filtered = Object.keys(blank).some((key) => state[key as keyof typeof blank]);
  return (
    <>
      <Header title="Users" subtitle={`${data ? data.total : '…'} matching account${data?.total === 1 ? '' : 's'} · ${TZ_NOTE}`}>
        {allowed('banks.invite') && (
          <Button variant="outline" onClick={() => setInviting(true)}>
            <Building2 size={16} /> Invite a bank user
          </Button>
        )}
        <RefreshButton onClick={refresh} busy={busy} loadedAt={loadedAt} />
      </Header>
      <Card className="filters">
        <label className="search">
          <Search size={18} />
          <input aria-label="Search users" placeholder="Search name, email, shop, organisation or user ID" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        <div className="filter-grid">
          <Field label="Role">
            <select value={state.role} onChange={filter('role')}>
              <option value="">All roles</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </Field>
          <Field label="Account type">
            <select value={state.type} onChange={filter('type')}>
              <option value="">All types</option>
              <option value="merchant">Shop owners</option>
              <option value="bank">Bank users</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={state.status} onChange={filter('status')}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </Field>
          <Field label="Email">
            <select value={state.verified} onChange={filter('verified')}>
              <option value="">Confirmed or not</option>
              <option value="yes">Confirmed</option>
              <option value="no">Not confirmed</option>
            </select>
          </Field>
          <Field label="Registered from">
            <input type="date" value={state.from} max={state.to || undefined} onChange={filter('from')} />
          </Field>
          <Field label="Registered to">
            <input type="date" value={state.to} min={state.from || undefined} onChange={filter('to')} />
          </Field>
        </div>
        {filtered && (
          <button
            className="text-button"
            onClick={() => {
              setTyped('');
              setState({ ...state, ...blank, page: 1 });
            }}
          >
            <X size={14} /> Clear filters
          </button>
        )}
      </Card>
      <LoadState error={error} busy={busy && !data} retry={refresh} label="users" />
      {data && (
        <Card className="admin-table-wrap">
          <table className="admin-table responsive-table">
            <caption className="visually-hidden">Users, sorted by {state.sort}</caption>
            <thead>
              <tr>
                <SortHeader label="User" column="name" sort={state.sort} dir={state.dir} onSort={sortBy} />
                <th>Business / organisation</th>
                <SortHeader label="Role" column="role" sort={state.sort} dir={state.dir} onSort={sortBy} />
                <th>Email</th>
                <SortHeader label="Status" column="status" sort={state.sort} dir={state.dir} onSort={sortBy} />
                <SortHeader label="Registered" column="created" sort={state.sort} dir={state.dir} onSort={sortBy} />
                <SortHeader label="Last sign-in" column="lastLogin" sort={state.sort} dir={state.dir} onSort={sortBy} />
                <SortHeader label="Last activity" column="lastActivity" sort={state.sort} dir={state.dir} onSort={sortBy} />
              </tr>
            </thead>
            <tbody aria-busy={busy}>
              {data.users.map((u) => (
                <tr key={u.id} tabIndex={0} onClick={() => go('users/' + u.id)} onKeyDown={(e) => e.key === 'Enter' && go('users/' + u.id)} aria-label={`Open ${u.name || u.email}`}>
                  <td data-label="User">
                    <span className="user-cell">
                      <UserAvatar id={u.id} name={u.name} email={u.email} version={u.avatarVersion} />
                      <span>
                        <b>{u.name || 'No name yet'}</b>
                        <small className="break">{u.email}</small>
                        <small className="mono id-text">ID {u.id}</small>
                      </span>
                    </span>
                  </td>
                  <td data-label="Business">
                    {u.organization || '—'}
                    <small>{u.type === 'bank' ? 'Bank user' : 'Shop owner'}</small>
                  </td>
                  <td data-label="Role">
                    <RoleBadge role={u.accessRole} />
                  </td>
                  <td data-label="Email">
                    <VerifiedBadge verified={u.verified} />
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={u.status} />
                  </td>
                  <td data-label="Registered">{when(u.createdAt)}</td>
                  <td data-label="Last sign-in">{u.lastLoginAt ? when(u.lastLoginAt) : 'Never'}</td>
                  <td data-label="Last activity">{u.lastActivityAt ? when(u.lastActivityAt) : 'None recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.users.length && <Empty title={filtered ? 'No users match' : 'No users yet'} detail={filtered ? 'Try a different search or clear the filters.' : 'Accounts appear here when people register.'} />}
          <div className="table-foot">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setState({ ...state, page })} />
            <label className="page-size">
              Rows
              <select value={state.pageSize} onChange={(e) => setState({ ...state, pageSize: Number(e.target.value), page: 1 })}>
                {[10, 25, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        </Card>
      )}
      <p className="small muted">“Last sign-in” is the last time the person entered their password. “Last activity” is the last time they used GreenBiz while signed in.</p>
      {inviting && <InviteBank onClose={() => setInviting(false)} onDone={refresh} />}
    </>
  );
}

function InviteBank({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ email: '', fullName: '', organization: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Sheet title="Invite a bank user" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setMessage(null);
          adminCall('/api/admin/banks', form)
            .then(() => {
              setMessage({ ok: true, text: `Invitation sent to ${form.email}. They choose their own password from the email.` });
              setForm({ email: '', fullName: '', organization: '' });
              onDone();
            })
            .catch((error: unknown) => setMessage({ ok: false, text: error instanceof Error ? error.message : 'The invitation could not be sent.' }))
            .finally(() => setBusy(false));
        }}
      >
        <p className="small muted">Bank users see only shops that chose to share their score, and can send offers. You never set or see their password.</p>
        <Field label="Email" required>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Full name" optional>
          <input maxLength={100} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Bank or organisation" optional>
          <input maxLength={120} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
        </Field>
        {message && (
          <p className={'form-message ' + (message.ok ? 'ok' : 'bad')} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
