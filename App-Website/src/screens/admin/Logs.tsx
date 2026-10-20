import { useEffect, useState } from 'react';
import { Info, Search, X } from 'lucide-react';
import { Card, Empty, Field } from '../../components/UI';
import { actionLabel, go, Header, LoadState, Pagination, query, RefreshButton, TZ_NOTE, useAdmin, when } from './common';

export const ACTIVITY_FILTER_KEY = 'greenbiz-admin-activity-filters';
const AUDIT_FILTER_KEY = 'greenbiz-admin-audit-filters';
function restore<T extends object>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(sessionStorage.getItem(key) ?? '{}'), page: 1 };
  } catch {
    return fallback;
  }
}
function remember(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* filters simply reset next time */
  }
}
/** Text inputs wait for a pause in typing before filtering. */
function useDebounced(value: string, apply: (v: string) => void) {
  useEffect(() => {
    const timer = setTimeout(() => apply(value), 300);
    return () => clearTimeout(timer);
  }, [value]); // apply is recreated each render; only typing should trigger it
}

interface Event {
  id: string;
  userId: string | null;
  actorId: string | null;
  action: string;
  outcome: 'success' | 'failure';
  description: string;
  recordType: string | null;
  recordId: string | null;
  device: string;
  network: string;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
  actorEmail: string | null;
}

export function ActivityLog() {
  const [filters, setFilters] = useState(() => restore(ACTIVITY_FILTER_KEY, { q: '', user: '', action: '', outcome: '', from: '', to: '', page: 1, pageSize: 50 }));
  const [text, setText] = useState({ q: filters.q, user: filters.user });
  useDebounced(text.q, (q) => q !== filters.q && setFilters({ ...filters, q, page: 1 }));
  useDebounced(text.user, (user) => user !== filters.user && setFilters({ ...filters, user, page: 1 }));
  useEffect(() => remember(ACTIVITY_FILTER_KEY, filters), [filters]);
  const { data, error, busy, loadedAt, refresh } = useAdmin<{ total: number; page: number; pageSize: number; events: Event[]; actions: string[]; trackingStartedAt: string | null; retentionDays: number }>(
    '/api/admin/activity?' + query(filters),
  );
  const set = (key: 'action' | 'outcome' | 'from' | 'to') => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFilters({ ...filters, [key]: e.target.value, page: 1 });
  const active = !!(filters.q || filters.user || filters.action || filters.outcome || filters.from || filters.to);
  return (
    <>
      <Header title="Activity log" subtitle={`What accounts did on GreenBiz · ${TZ_NOTE}`}>
        <RefreshButton onClick={refresh} busy={busy} loadedAt={loadedAt} />
      </Header>
      {data && (
        <div className="notice green">
          <Info size={18} />
          <span>
            Recording began {when(data.trackingStartedAt)}; earlier activity is not available. Events are kept for {data.retentionDays} days. Passwords, links and request contents are never
            logged, and only the network (not the exact address) of a device is kept.
          </span>
        </div>
      )}
      <Card className="filters">
        <label className="search">
          <Search size={18} />
          <input aria-label="Search activity" placeholder="Search descriptions, event types or record IDs" value={text.q} onChange={(e) => setText({ ...text, q: e.target.value })} />
        </label>
        <div className="filter-grid">
          <Field label="User (email, name or ID)">
            <input value={text.user} onChange={(e) => setText({ ...text, user: e.target.value })} />
          </Field>
          <Field label="Event type">
            <select value={filters.action} onChange={set('action')}>
              <option value="">All events</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Result">
            <select value={filters.outcome} onChange={set('outcome')}>
              <option value="">Any result</option>
              <option value="success">Success</option>
              <option value="failure">Failed</option>
            </select>
          </Field>
          <Field label="From">
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={set('from')} />
          </Field>
          <Field label="To">
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
          </Field>
        </div>
        {active && (
          <button
            className="text-button"
            onClick={() => {
              setText({ q: '', user: '' });
              setFilters({ ...filters, q: '', user: '', action: '', outcome: '', from: '', to: '', page: 1 });
            }}
          >
            <X size={14} /> Clear filters
          </button>
        )}
      </Card>
      <LoadState error={error} busy={busy && !data} retry={refresh} label="activity" />
      {data && (
        <Card className="admin-table-wrap">
          <table className="admin-table responsive-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Event</th>
                <th>Description</th>
                <th>Result</th>
                <th>Event ID</th>
              </tr>
            </thead>
            <tbody aria-busy={busy}>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">{when(e.createdAt)}</td>
                  <td data-label="User">
                    {e.userId ? (
                      <button className="text-button" onClick={() => go('users/' + e.userId)}>
                        {e.userName || e.userEmail || 'Deleted account'}
                      </button>
                    ) : (
                      '—'
                    )}
                    {e.actorEmail && e.actorId !== e.userId && <small>by {e.actorEmail}</small>}
                    {!e.actorId && <small>by a customer or the system</small>}
                  </td>
                  <td data-label="Event">
                    <span className="pill">{actionLabel(e.action)}</span>
                  </td>
                  <td data-label="Description">
                    {e.description}
                    {e.recordId && (
                      <small className="mono">
                        {e.recordType ?? 'record'} {e.recordId}
                      </small>
                    )}
                    {e.device && (
                      <small>
                        {e.device}
                        {e.network ? ' · ' + e.network : ''}
                      </small>
                    )}
                  </td>
                  <td data-label="Result">{e.outcome === 'failure' ? <span className="pill bad">Failed</span> : <span className="pill good">Success</span>}</td>
                  <td data-label="Event ID" className="mono id-text">
                    {e.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.events.length && <Empty title="No matching activity" detail={active ? 'Try a wider date range or clear the filters.' : 'Activity appears as people use GreenBiz.'} />}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setFilters({ ...filters, page })} />
        </Card>
      )}
    </>
  );
}

interface AuditEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  target: string;
  targetType: string;
  detail: string;
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: 'success' | 'failure';
  network: string;
  createdAt: string;
}
export function AuditLog() {
  const [filters, setFilters] = useState(() => restore(AUDIT_FILTER_KEY, { q: '', admin: '', action: '', outcome: '', from: '', to: '', page: 1, pageSize: 50 }));
  const [text, setText] = useState({ q: filters.q, admin: filters.admin });
  useDebounced(text.q, (q) => q !== filters.q && setFilters({ ...filters, q, page: 1 }));
  useDebounced(text.admin, (admin) => admin !== filters.admin && setFilters({ ...filters, admin, page: 1 }));
  useEffect(() => remember(AUDIT_FILTER_KEY, filters), [filters]);
  const { data, error, busy, loadedAt, refresh } = useAdmin<{ total: number; page: number; pageSize: number; entries: AuditEntry[]; actions: string[] }>('/api/admin/audit?' + query(filters));
  const set = (key: 'action' | 'outcome' | 'from' | 'to') => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFilters({ ...filters, [key]: e.target.value, page: 1 });
  return (
    <>
      <Header title="Audit log" subtitle={`Every privileged action, including refused ones · ${TZ_NOTE}`}>
        <RefreshButton onClick={refresh} busy={busy} loadedAt={loadedAt} />
      </Header>
      <p className="small muted">Audit records are append-only: the database rejects any change or deletion, for every role. They are kept indefinitely.</p>
      <Card className="filters">
        <label className="search">
          <Search size={18} />
          <input aria-label="Search the audit log" placeholder="Search details, reasons or a user ID" value={text.q} onChange={(e) => setText({ ...text, q: e.target.value })} />
        </label>
        <div className="filter-grid">
          <Field label="Administrator">
            <input value={text.admin} onChange={(e) => setText({ ...text, admin: e.target.value })} />
          </Field>
          <Field label="Action">
            <select value={filters.action} onChange={set('action')}>
              <option value="">All actions</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Result">
            <select value={filters.outcome} onChange={set('outcome')}>
              <option value="">Any result</option>
              <option value="success">Succeeded</option>
              <option value="failure">Refused or failed</option>
            </select>
          </Field>
          <Field label="From">
            <input type="date" value={filters.from} onChange={set('from')} />
          </Field>
          <Field label="To">
            <input type="date" value={filters.to} onChange={set('to')} />
          </Field>
        </div>
      </Card>
      <LoadState error={error} busy={busy && !data} retry={refresh} label="the audit log" />
      {data && (
        <Card className="admin-table-wrap">
          <table className="admin-table responsive-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Administrator</th>
                <th>Action</th>
                <th>Affected</th>
                <th>Reason</th>
                <th>Before → after</th>
              </tr>
            </thead>
            <tbody aria-busy={busy}>
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="When">
                    {when(entry.createdAt)}
                    {entry.network && <small>{entry.network}</small>}
                  </td>
                  <td data-label="Administrator" className="break">
                    {entry.adminEmail}
                  </td>
                  <td data-label="Action">
                    <b>{entry.detail}</b>
                    <small>
                      <span className="pill">{entry.action}</span>
                      {entry.outcome === 'failure' && <span className="pill bad">Refused</span>}
                    </small>
                  </td>
                  <td data-label="Affected">
                    {entry.targetType === 'user' ? (
                      <button className="text-button mono" onClick={() => go('users/' + entry.target)}>
                        {entry.target}
                      </button>
                    ) : entry.targetType === 'shop' ? (
                      <button className="text-button mono" onClick={() => go('shops/' + entry.target)}>
                        Shop {entry.target}
                      </button>
                    ) : (
                      <span className="mono">{entry.target}</span>
                    )}
                  </td>
                  <td data-label="Reason">{entry.reason || '—'}</td>
                  <td data-label="Before → after">
                    {entry.before || entry.after ? (
                      <dl className="diff">
                        {Object.keys({ ...entry.before, ...entry.after }).map((key) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>
                              <del>{String(entry.before?.[key] ?? '—') || '(blank)'}</del> → <ins>{String(entry.after?.[key] ?? '—') || '(blank)'}</ins>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.entries.length && <Empty title="No matching entries" detail="Try different filters." />}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setFilters({ ...filters, page })} />
        </Card>
      )}
    </>
  );
}
