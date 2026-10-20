import { useState, type ReactNode } from 'react';
import { ArrowLeft, Ban, KeyRound, LogOut, Mail, PencilLine, ShieldCheck, ShieldOff, Store, Trash2, UserCheck, UserX } from 'lucide-react';
import { accessRoles, roleLabels, type AccessRole, type AccountStatus } from '../../../shared/permissions';
import { Button, Card, Empty, Field, Sheet } from '../../components/UI';
import { money } from '../../utils';
import { actionLabel, adminCall, ConfirmDialog, go, Header, LoadState, RefreshButton, RoleBadge, StatusBadge, TZ_NOTE, useAdmin, UserAvatar, VerifiedBadge, when } from './common';
import { ACTIVITY_FILTER_KEY } from './Logs';

interface Detail {
  user: {
    id: string;
    email: string;
    name: string;
    phone: string;
    location: string;
    organization: string;
    type: 'merchant' | 'bank';
    accessRole: AccessRole;
    status: AccountStatus;
    statusReason: string;
    statusChangedAt: string | null;
    verified: boolean;
    verifiedAt: string | null;
    mustVerify: boolean;
    pendingEmail: string | null;
    createdAt: string;
    lastLoginAt: string | null;
    lastActivityAt: string | null;
    passwordChangedAt: string | null;
    mfaEnabled: boolean;
    mfaExempt: boolean;
    avatarVersion: string | null;
  };
  shops: { id: string; name: string; location: string; products: number; salesCount: number; monthSales: number; totalSales: number; lastActivity: string; createdAt: string }[];
  related: {
    invoices: number;
    invoicesWithClaims: number;
    interests: number;
    offersReceived: { id: string; createdAt: string; bank: string; name: string; kind: string; amount: number }[];
    offersSent: { id: string; business: string; createdAt: string; name: string; kind: string; amount: number }[];
  };
  sessions: { id: string; kind: 'app' | 'admin'; device: string; network: string; createdAt: string; lastSeenAt: string }[];
  activity: {
    events: { id: string; action: string; outcome: string; description: string; recordType: string | null; recordId: string | null; device: string; network: string; createdAt: string; actorId: string | null; actorEmail: string | null }[];
    total: number;
    trackingStartedAt: string | null;
    retentionDays: number;
  };
  adminHistory: { id: string; adminEmail: string; action: string; detail: string; reason: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; outcome: string; createdAt: string }[];
  allowed: { edit: boolean; status: boolean; reactivateDeactivated: boolean; email: boolean; role: boolean; resetMfa: boolean; delete: boolean; viewShops: boolean };
}
type Section = 'profile' | 'account' | 'activity' | 'records' | 'history';
type Dialog = null | 'mfaRequire' | 'edit' | 'verify' | 'reset' | 'signout' | 'suspend' | 'reactivate' | 'deactivate' | 'role' | 'mfa' | 'delete';

const changes = (before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
  Object.keys({ ...before, ...after })
    .map((key) => `${key}: ${String(before?.[key] ?? '—') || '(blank)'} → ${String(after?.[key] ?? '—') || '(blank)'}`)
    .join('; ');

export function UserDetail({ id }: { id: string }) {
  const { data, error, busy, loadedAt, refresh } = useAdmin<Detail>('/api/admin/users/' + encodeURIComponent(id));
  const [section, setSection] = useState<Section>('profile');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState('');
  const close = () => setDialog(null);
  const act = (path: string, body: unknown, done: string, method?: string) => async () => {
    await adminCall(`/api/admin/users/${encodeURIComponent(id)}${path}`, body, method);
    setNotice(done);
    if (method === 'DELETE') go('users');
    else refresh();
  };
  if (!data)
    return (
      <>
        <BackLink />
        <LoadState error={error} busy={busy} retry={refresh} label="this account" />
      </>
    );
  const { user, allowed } = data;
  const label = user.name || user.email;
  return (
    <>
      <BackLink />
      <div className="user-hero">
        <UserAvatar id={user.id} name={user.name} email={user.email} version={user.avatarVersion} size={64} />
        <Header
          title={label}
          subtitle={
            <span className="badges">
              <span className="break">{user.email}</span>
              <RoleBadge role={user.accessRole} />
              <StatusBadge status={user.status} />
              <VerifiedBadge verified={user.verified} />
            </span>
          }
        >
          <RefreshButton onClick={refresh} busy={busy} loadedAt={loadedAt} />
        </Header>
      </div>
      {notice && (
        <p className="form-message ok" role="status">
          <ShieldCheck size={16} /> {notice}
        </p>
      )}
      {user.status !== 'active' && (
        <div className="notice red">
          <Ban size={18} />
          <span>
            {user.status === 'suspended' ? 'Suspended' : 'Deactivated'} {when(user.statusChangedAt)}
            {user.statusReason && <> — “{user.statusReason}”</>}. This account cannot sign in and all its sessions were ended.
          </span>
        </div>
      )}
      <div className="action-bar" role="toolbar" aria-label="Account actions">
        {allowed.edit && (
          <Button variant="outline" onClick={() => setDialog('edit')}>
            <PencilLine size={16} /> Edit profile
          </Button>
        )}
        {allowed.email && !user.verified && (
          <Button variant="outline" onClick={() => setDialog('verify')}>
            <Mail size={16} /> Resend confirmation
          </Button>
        )}
        {allowed.email && (
          <Button variant="outline" onClick={() => setDialog('reset')}>
            <KeyRound size={16} /> Send password reset
          </Button>
        )}
        {allowed.status && (
          <Button variant="outline" onClick={() => setDialog('signout')}>
            <LogOut size={16} /> Sign out everywhere
          </Button>
        )}
        {allowed.role && (
          <Button variant="outline" onClick={() => setDialog('role')}>
            <ShieldCheck size={16} /> Change role
          </Button>
        )}
        {allowed.resetMfa && user.mfaEnabled && (
          <Button variant="outline" onClick={() => setDialog('mfa')}>
            <ShieldOff size={16} /> Reset two-step
          </Button>
        )}
        {allowed.role && user.mfaExempt && (
          <Button variant="outline" onClick={() => setDialog('mfaRequire')}>
            <ShieldCheck size={16} /> Require two-step
          </Button>
        )}
        {allowed.status && user.status === 'active' && (
          <Button variant="outline" onClick={() => setDialog('suspend')}>
            <UserX size={16} /> Suspend
          </Button>
        )}
        {allowed.status && (user.status === 'suspended' || (user.status === 'deactivated' && allowed.reactivateDeactivated)) && (
          <Button variant="outline" onClick={() => setDialog('reactivate')}>
            <UserCheck size={16} /> Reactivate
          </Button>
        )}
        {allowed.status && user.status !== 'deactivated' && (
          <Button variant="danger" onClick={() => setDialog('deactivate')}>
            <Ban size={16} /> Deactivate
          </Button>
        )}
        {allowed.delete && (
          <Button variant="danger" onClick={() => setDialog('delete')}>
            <Trash2 size={16} /> Delete
          </Button>
        )}
      </div>
      <div className="segments admin-sections" role="tablist" aria-label="Account sections">
        {(
          [
            ['profile', 'Profile'],
            ['account', 'Account'],
            ['activity', `Activity · ${data.activity.total}`],
            ['records', 'Related records'],
            ['history', `Admin history · ${data.adminHistory.length}`],
          ] as const
        ).map(([key, text]) => (
          <button key={key} role="tab" aria-selected={section === key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>
            {text}
          </button>
        ))}
      </div>
      {section === 'profile' && (
        <Card>
          <h2>Profile</h2>
          <dl className="transaction-detail">
            <Row label="Full name">{user.name || 'Not provided'}</Row>
            <Row label="Email">
              {user.email} {user.pendingEmail && <span className="pill warn">Changing to {user.pendingEmail}</span>}
            </Row>
            <Row label="Phone">{user.phone || 'Not provided'}</Row>
            <Row label="Location">{user.location || 'Not provided'}</Row>
            <Row label={user.type === 'bank' ? 'Bank or organisation' : 'Organisation'}>{user.organization || 'Not provided'}</Row>
            {user.type === 'merchant' && <Row label="Shops">{data.shops.map((s) => s.name).join(' · ') || 'No shop yet'}</Row>}
          </dl>
        </Card>
      )}
      {section === 'account' && (
        <div className="admin-two">
          <Card>
            <h2>Account</h2>
            <dl className="transaction-detail">
              <Row label="User ID">
                <span className="mono break">{user.id}</span>
              </Row>
              <Row label="Account type">{user.type === 'bank' ? 'Bank user' : 'Shop owner'}</Row>
              <Row label="Role">
                <RoleBadge role={user.accessRole} />
              </Row>
              <Row label="Status">
                <StatusBadge status={user.status} />
              </Row>
              <Row label="Email">{user.verified ? `Confirmed ${when(user.verifiedAt)}` : user.mustVerify ? 'Not confirmed (required to sign in)' : 'Not confirmed (account predates confirmation)'}</Row>
              <Row label="Created">{when(user.createdAt)}</Row>
              <Row label="Last sign-in">{user.lastLoginAt ? when(user.lastLoginAt) : 'Never'}</Row>
              <Row label="Last activity">{user.lastActivityAt ? when(user.lastActivityAt) : 'None recorded'}</Row>
              <Row label="Password changed">{user.passwordChangedAt ? when(user.passwordChangedAt) : 'Not recorded'}</Row>
              {user.accessRole !== 'user' && <Row label="Two-step verification">{user.mfaExempt ? 'Off (demo account)' : user.mfaEnabled ? 'On' : 'Not set up yet'}</Row>}
            </dl>
          </Card>
          <Card>
            <h2>Active sessions · {data.sessions.length}</h2>
            {data.sessions.length ? (
              data.sessions.map((s) => (
                <div className="session-row" key={s.id}>
                  <span>
                    <b>
                      {s.device} {s.kind === 'admin' && <span className="pill">Admin panel</span>}
                    </b>
                    <small>
                      {s.network ? `Network ${s.network} · ` : ''}since {when(s.createdAt)} · last active {when(s.lastSeenAt)}
                    </small>
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-inline">Not signed in anywhere.</p>
            )}
          </Card>
        </div>
      )}
      {section === 'activity' && (
        <Card className="admin-table-wrap">
          <div className="row between">
            <h2>Activity</h2>
            <button
              className="text-button"
              onClick={() => {
                try {
                  sessionStorage.setItem(ACTIVITY_FILTER_KEY, JSON.stringify({ user: user.id }));
                } catch {
                  /* the log opens unfiltered */
                }
                go('activity');
              }}
            >
              Search all {data.activity.total} events
            </button>
          </div>
          <p className="small muted">
            Latest 50 events. Recording began {when(data.activity.trackingStartedAt)}; events older than {data.activity.retentionDays} days are removed. {TZ_NOTE}.
          </p>
          <EventTable events={data.activity.events} />
        </Card>
      )}
      {section === 'records' && (
        <>
          {user.type === 'merchant' && (
            <Card className="admin-table-wrap">
              <h2>Shops</h2>
              {data.shops.length ? (
                <table className="admin-table responsive-table">
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th>Products</th>
                      <th>Sales</th>
                      <th>This month</th>
                      <th>All time</th>
                      <th>Last change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.shops.map((s) => (
                      <tr key={s.id} tabIndex={allowed.viewShops ? 0 : undefined} onClick={() => allowed.viewShops && go('shops/' + s.id)} onKeyDown={(e) => e.key === 'Enter' && allowed.viewShops && go('shops/' + s.id)}>
                        <td data-label="Shop">
                          <b>
                            <Store size={14} /> {s.name}
                          </b>
                          <small>{s.location || 'No location'}</small>
                        </td>
                        <td data-label="Products">{s.products}</td>
                        <td data-label="Sales">{s.salesCount}</td>
                        <td data-label="This month">{money(s.monthSales)}</td>
                        <td data-label="All time">{money(s.totalSales)}</td>
                        <td data-label="Last change">{when(s.lastActivity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty-inline">No shops.</p>
              )}
              <p className="small muted">
                {data.related.invoices} invoice link{data.related.invoices === 1 ? '' : 's'} ({data.related.invoicesWithClaims} with a payment claim) · {data.related.interests} expression
                {data.related.interests === 1 ? '' : 's'} of interest in bank offers
              </p>
            </Card>
          )}
          <OfferTable title={user.type === 'bank' ? 'Offers sent' : 'Offers received'} offers={user.type === 'bank' ? data.related.offersSent.map((o) => ({ ...o, party: o.business })) : data.related.offersReceived.map((o) => ({ ...o, party: o.bank }))} party={user.type === 'bank' ? 'Business' : 'Bank'} />
        </>
      )}
      {section === 'history' && (
        <Card className="admin-table-wrap">
          <h2>Administrative history</h2>
          {data.adminHistory.length ? (
            <table className="admin-table responsive-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Administrator</th>
                  <th>Action</th>
                  <th>Reason</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {data.adminHistory.map((h) => (
                  <tr key={h.id}>
                    <td data-label="When">{when(h.createdAt)}</td>
                    <td data-label="Administrator" className="break">
                      {h.adminEmail}
                    </td>
                    <td data-label="Action">
                      <b>{h.detail}</b>
                      {h.outcome === 'failure' && <span className="pill bad">Refused</span>}
                    </td>
                    <td data-label="Reason">{h.reason || '—'}</td>
                    <td data-label="Change">{h.before || h.after ? changes(h.before, h.after) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No administrative actions" detail="Changes and views by administrators will be listed here." />
          )}
        </Card>
      )}

      {dialog === 'edit' && <EditProfile detail={data} onClose={close} onSaved={(done) => (setNotice(done), refresh())} />}
      {dialog === 'verify' && (
        <ConfirmDialog title="Resend email confirmation" body={<>Send a new confirmation link to <b>{user.email}</b>? It works for 24 hours.</>} confirmLabel="Send link" onClose={close} onConfirm={act('/verification-email', {}, 'Confirmation link sent.')} />
      )}
      {dialog === 'reset' && (
        <ConfirmDialog
          title="Send a password reset email"
          body={
            <>
              Send <b>{user.email}</b> a link to choose a new password. It works once, for 30 minutes. You will not see or set the password, and their current password keeps working until they use the link.
            </>
          }
          confirmLabel="Send reset email"
          onClose={close}
          onConfirm={act('/password-reset-email', {}, 'Password reset email sent.')}
        />
      )}
      {dialog === 'signout' && (
        <ConfirmDialog title="Sign out everywhere" body={<>End every session for {label}, including the app and the admin panel? They can sign in again straight away.</>} confirmLabel="Sign out everywhere" onClose={close} onConfirm={(reason) => act('/sign-out', { reason }, 'Signed out of every device.')()} />
      )}
      {dialog === 'suspend' && (
        <ConfirmDialog
          title="Suspend this account"
          body={<>{label} will be signed out everywhere and blocked from signing in until reactivated. Their records are kept.</>}
          confirmLabel="Suspend account"
          danger
          reasonRequired
          onClose={close}
          onConfirm={(reason) => act('/status', { status: 'suspended', reason }, 'Account suspended.')()}
        />
      )}
      {dialog === 'reactivate' && (
        <ConfirmDialog title="Reactivate this account" body={<>Let {label} sign in again?</>} confirmLabel="Reactivate" reasonRequired onClose={close} onConfirm={(reason) => act('/status', { status: 'active', reason }, 'Account reactivated.')()} />
      )}
      {dialog === 'deactivate' && (
        <ConfirmDialog
          title="Deactivate this account"
          body={<>Deactivation closes the account: {label} is signed out everywhere and cannot sign in. Records are kept. Only a Super Admin can reactivate it.</>}
          confirmLabel="Deactivate account"
          danger
          reasonRequired
          onClose={close}
          onConfirm={(reason) => act('/status', { status: 'deactivated', reason }, 'Account deactivated.')()}
        />
      )}
      {dialog === 'role' && <RoleDialog current={user.accessRole} label={label} onClose={close} onConfirm={(role, reason) => act('/role', { accessRole: role, reason }, `Role changed to ${roleLabels[role]}.`)()} />}
      {dialog === 'mfa' && (
        <ConfirmDialog
          title="Reset two-step verification"
          body={<>{label} will be signed out of the admin panel and must set up a new authenticator at their next admin sign-in.</>}
          confirmLabel="Reset two-step"
          danger
          reasonRequired
          onClose={close}
          onConfirm={(reason) => act('/reset-mfa', { reason }, 'Two-step verification reset.')()}
        />
      )}
      {dialog === 'mfaRequire' && (
        <ConfirmDialog
          title="Require two-step verification"
          body={<>{label} currently signs in to the admin panel with a password only (demo mode). From now on they must set up an authenticator. This cannot be undone from the panel.</>}
          confirmLabel="Require two-step"
          reasonRequired
          onClose={close}
          onConfirm={(reason) => act('/mfa-exemption', { reason }, 'Two-step verification is now required.')()}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this account permanently"
          body={<>This deletes {label} and every shop, record and invoice it owns. It cannot be undone. Consider deactivating instead.</>}
          confirmLabel="Delete permanently"
          danger
          reasonRequired
          typeToConfirm={user.email}
          onClose={close}
          onConfirm={(reason) => act('', { email: user.email, reason }, 'Account deleted.', 'DELETE')()}
        />
      )}
    </>
  );
}

function BackLink() {
  return (
    <button className="text-button admin-back" onClick={() => go('users')}>
      <ArrowLeft size={16} /> All users
    </button>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
export function EventTable({ events }: { events: Detail['activity']['events'] }) {
  if (!events.length) return <Empty title="No activity recorded" detail="Activity appears once this account signs in or changes something." />;
  return (
    <table className="admin-table responsive-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Event</th>
          <th>Description</th>
          <th>Result</th>
          <th>Device</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td data-label="When">{when(e.createdAt)}</td>
            <td data-label="Event">
              <span className="pill">{actionLabel(e.action)}</span>
            </td>
            <td data-label="Description">
              {e.description}
              {e.actorEmail && e.actorId && <small>by {e.actorEmail}</small>}
              {e.recordId && <small className="mono">Record {e.recordId}</small>}
            </td>
            <td data-label="Result">{e.outcome === 'failure' ? <span className="pill bad">Failed</span> : <span className="pill good">Success</span>}</td>
            <td data-label="Device">
              {e.device || '—'}
              {e.network && <small>{e.network}</small>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function OfferTable({ title, offers, party }: { title: string; offers: { id: string; party: string; name: string; kind: string; amount: number; createdAt: string }[]; party: string }) {
  return (
    <Card className="admin-table-wrap">
      <h2>
        {title} · {offers.length}
      </h2>
      {offers.length ? (
        <table className="admin-table responsive-table">
          <thead>
            <tr>
              <th>When</th>
              <th>{party}</th>
              <th>Offer</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td data-label="When">{when(o.createdAt)}</td>
                <td data-label={party}>{o.party}</td>
                <td data-label="Offer">
                  {o.name}
                  <small>{o.kind === 'grant' ? 'Grant' : 'Loan'}</small>
                </td>
                <td data-label="Amount">{money(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-inline">None.</p>
      )}
    </Card>
  );
}

function EditProfile({ detail, onClose, onSaved }: { detail: Detail; onClose: () => void; onSaved: (message: string) => void }) {
  const { user } = detail;
  const [form, setForm] = useState({ fullName: user.name, phone: user.phone, location: user.location, organization: user.organization, reason: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; fields: Record<string, string> } | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setProblem(null);
          adminCall<{ changed: string[] }>(`/api/admin/users/${encodeURIComponent(user.id)}/profile`, form)
            .then((r) => {
              onSaved(r.changed.length ? `Saved: ${r.changed.join(', ')}.` : 'Nothing changed.');
              onClose();
            })
            .catch((error: unknown) => {
              const fields = (error as { fields?: Record<string, string> }).fields ?? {};
              setProblem({ text: Object.keys(fields).length ? 'Check the highlighted fields.' : error instanceof Error ? error.message : 'Not saved.', fields });
              setBusy(false);
            });
        }}
      >
        <p className="small muted">You can correct the name and contact details. The email address and password can only be changed by the account owner.</p>
        <Field label="Full name" required error={problem?.fields.fullName}>
          <input required maxLength={100} value={form.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="Phone" optional error={problem?.fields.phone}>
          <input type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Location" optional>
          <input maxLength={160} value={form.location} onChange={set('location')} />
        </Field>
        <Field label="Organisation" optional>
          <input maxLength={120} value={form.organization} onChange={set('organization')} />
        </Field>
        <Field label="Reason" optional hint="Saved in the audit log with the before-and-after values.">
          <textarea rows={2} maxLength={500} value={form.reason} onChange={set('reason')} />
        </Field>
        {problem && (
          <p className="form-message bad" role="alert">
            {problem.text}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function RoleDialog({ current, label, onClose, onConfirm }: { current: AccessRole; label: string; onClose: () => void; onConfirm: (role: AccessRole, reason: string) => Promise<void> }) {
  const [role, setRole] = useState<AccessRole>(current === 'user' ? 'admin' : 'user');
  return (
    <ConfirmDialog
      title="Change role"
      body={
        <>
          {label} is currently <b>{roleLabels[current]}</b>. Admins manage regular users; Super Admins also manage administrators, roles and deletions. Any open admin panel session ends, and new
          administrators set up two-step verification at their first admin sign-in.
        </>
      }
      confirmLabel={`Make ${roleLabels[role]}`}
      reasonRequired
      onClose={onClose}
      onConfirm={(reason) => onConfirm(role, reason)}
    >
      <Field label="New role" required>
        <select value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
          {accessRoles
            .filter((r) => r !== current)
            .map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
        </select>
      </Field>
    </ConfirmDialog>
  );
}
