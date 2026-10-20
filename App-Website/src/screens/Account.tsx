import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, CircleAlert, KeyRound, LayoutDashboard, LogOut, Mail, MonitorSmartphone, RefreshCw, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { roleLabels, statusLabels, isStaff } from '../../shared/permissions';
import { Avatar, Button, Card, Empty, Field, PageHeader, PasswordInput } from '../components/UI';
import { useStore } from '../data/store';
import { api, saveSession } from '../data/api';
import type { Session } from '../../shared/types';
import { accountApi, fieldErrors, openAdminPanel, squarePhoto, type Profile, type SessionInfo } from '../data/account';
import { dateLabel } from '../utils';

const when = (iso: string | null) => (iso ? dateLabel(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never');
export const PROFILE_EVENT = 'greenbiz-profile';
/** Lets the profile menu pick up a new photo or name without a reload. */
const announce = (profile: Profile) => window.dispatchEvent(new CustomEvent<Profile>(PROFILE_EVENT, { detail: profile }));

/** One form's state: busy, a success line, a general problem and field problems. */
function useForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(work: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      const done = await work();
      if (done) setMessage({ ok: true, text: done });
    } catch (error) {
      const found = fieldErrors(error);
      setFields(found);
      setMessage({ ok: false, text: Object.keys(found).length ? 'Check the highlighted fields.' : error instanceof Error ? error.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, fields, run };
}
function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={'form-message ' + (message.ok ? 'ok' : 'bad')} role={message.ok ? 'status' : 'alert'}>
      {message.ok ? <ShieldCheck size={16} /> : <CircleAlert size={16} />} {message.text}
    </p>
  );
}

export function Account({ nav }: { nav: (page: string) => void }) {
  const { mode, user } = useStore();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failure, setFailure] = useState('');
  const load = () => {
    setFailure('');
    accountApi.profile().then(setProfile, (e: unknown) => setFailure(e instanceof Error ? e.message : 'Your account could not be loaded.'));
  };
  useEffect(() => {
    if (mode === 'server') load();
  }, [mode, user?.id]);
  const update = (next: Profile) => {
    setProfile(next);
    announce(next);
  };
  const back = () => nav(user?.role === 'bank' ? 'bank' : 'home');
  if (mode !== 'server')
    return (
      <>
        <PageHeader title="Your account" back={() => nav('home')} />
        <Card>
          <Empty title="No account on this device" detail="This shop is saved only on this device. Accounts, profiles and sign-in history are available when you use a GreenBiz server.">
            <Button onClick={() => (location.hash = '#/login')}>Sign in to a GreenBiz server</Button>
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageHeader title="Profile & account" subtitle="Your details, sign-in and security" back={back} />
      {failure && (
        <div className="notice red" role="alert">
          <CircleAlert size={18} />
          <span>{failure}</span>
          <button className="text-button" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {!profile && !failure && <p className="muted" role="status">Loading your account…</p>}
      {profile && (
        <div className="account-grid">
          <ProfileCard profile={profile} onSaved={update} />
          <div className="account-column">
            <EmailCard profile={profile} onSaved={update} />
            <DetailsCard profile={profile} />
          </div>
          <PasswordCard />
          <SessionsCard />
          {profile.role === 'merchant' && (
            <Card className="account-danger">
              <h2>Delete account</h2>
              <p className="small muted">Deleting your account permanently removes every shop and record it owns. Export your records first.</p>
              <Button variant="danger" onClick={() => nav('settings')}>
                <Trash2 size={16} /> Go to account deletion
              </Button>
            </Card>
          )}
          <p className="small muted account-tz">Times are shown in Dhaka time (GMT+6).</p>
        </div>
      )}
    </>
  );
}

function ProfileCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [form, setForm] = useState({ fullName: profile.fullName, phone: profile.phone, location: profile.location, organization: profile.organization });
  const { busy, message, fields, run } = useForm();
  const photo = useForm();
  const { refreshUser } = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          onSaved(await accountApi.saveProfile(form));
          await refreshUser();
          return 'Profile saved.';
        });
      }}
    >
      <Card className="account-card">
        <h2>
          <UserRound size={19} /> Profile
        </h2>
        <div className="photo-row">
          <Avatar name={profile.fullName} email={profile.email} src={profile.avatar} size={72} />
          <div>
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void photo.run(async () => {
                    onSaved(await accountApi.saveAvatar(await squarePhoto(file)));
                    return 'Photo updated.';
                  });
              }}
            />
            <Button type="button" variant="outline" disabled={photo.busy} onClick={() => picker.current?.click()}>
              <Camera size={16} /> {profile.avatar ? 'Change photo' : 'Add a photo'}
            </Button>
            {profile.avatar && (
              <button
                type="button"
                className="text-button"
                disabled={photo.busy}
                onClick={() =>
                  void photo.run(async () => {
                    onSaved(await accountApi.removeAvatar());
                    return 'Photo removed.';
                  })
                }
              >
                Remove photo
              </button>
            )}
            <Message message={photo.message} />
          </div>
        </div>
        <p className="small muted required-legend">
          Fields marked <span className="req">*</span> are required.
        </p>
        <Field label="Full name" required error={fields.fullName}>
          <input autoComplete="name" required maxLength={100} value={form.fullName} onChange={set('fullName')} />
        </Field>
        <Field label="Phone number" optional error={fields.phone}>
          <input type="tel" autoComplete="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Location" optional error={fields.location}>
          <input autoComplete="address-level2" maxLength={160} value={form.location} onChange={set('location')} />
        </Field>
        {profile.role === 'bank' ? (
          <Field label="Bank or organisation" optional error={fields.organization}>
            <input autoComplete="organization" maxLength={120} value={form.organization} onChange={set('organization')} />
          </Field>
        ) : (
          <div className="field">
            <span>Your shops</span>
            <p className="small">{profile.shops.map((s) => s.name).join(' · ') || 'No shop yet'}</p>
            <small>Shop names, phone and bKash numbers are edited in Shop settings.</small>
          </div>
        )}
        <Message message={message} />
        <Button type="submit" disabled={busy}>
          <Save size={16} /> {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </Card>
    </form>
  );
}

function EmailCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ newEmail: '', password: '' });
  const change = useForm();
  const verify = useForm();
  return (
    <Card className="account-card">
      <h2>
        <Mail size={19} /> Email
      </h2>
      <div className="email-line">
        <b className="break">{profile.email}</b>
        {profile.emailVerified ? <span className="pill good">Confirmed</span> : <span className="pill warn">Not confirmed</span>}
      </div>
      {!profile.emailVerified && (
        <>
          <p className="small muted">Confirm your address so you can always recover your account.</p>
          <Button
            variant="outline"
            disabled={verify.busy}
            onClick={() =>
              void verify.run(async () => {
                await accountApi.sendVerification();
                return `Confirmation link sent to ${profile.email}.`;
              })
            }
          >
            Send confirmation link
          </Button>
          <Message message={verify.message} />
        </>
      )}
      {profile.pendingEmail && (
        <div className="notice amber">
          <Mail size={17} />
          <span>
            Waiting for you to confirm <b>{profile.pendingEmail.email}</b>. Use the link we sent there before {when(profile.pendingEmail.expiresAt)}.
            <button className="text-button" onClick={() => void change.run(async () => onSaved(await accountApi.cancelEmailChange()))}>
              Cancel this change
            </button>
          </span>
        </div>
      )}
      {open ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void change.run(async () => {
              onSaved(await accountApi.changeEmail(form.newEmail, form.password));
              setForm({ newEmail: '', password: '' });
              setOpen(false);
              return `Check ${form.newEmail} for a confirmation link. Your email changes once you use it.`;
            });
          }}
        >
          <Field label="New email" required error={change.fields.newEmail}>
            <input type="email" autoComplete="email" required maxLength={254} value={form.newEmail} onChange={(e) => setForm({ ...form, newEmail: e.target.value })} />
          </Field>
          <Field label="Current password" required error={change.fields.password}>
            <PasswordInput autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Message message={change.message} />
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={change.busy}>
              {change.busy ? 'Sending…' : 'Send confirmation'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <Message message={change.message} />
          <Button variant="outline" onClick={() => setOpen(true)} disabled={!profile.emailDelivery}>
            Change email
          </Button>
          {!profile.emailDelivery && <p className="small muted">Email changes need email delivery, which is not set up on this server.</p>}
        </>
      )}
    </Card>
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
function DetailsCard({ profile }: { profile: Profile }) {
  return (
    <Card className="account-card">
      <h2>
        <ShieldCheck size={19} /> Account
      </h2>
      <dl className="transaction-detail">
        <Row label="Account type">{profile.role === 'bank' ? 'Bank user' : 'Shop owner'}</Row>
        <Row label="Role">{roleLabels[profile.accessRole]}</Row>
        <Row label="Status">
          <span className={'pill ' + (profile.status === 'active' ? 'good' : 'bad')}>{statusLabels[profile.status]}</span>
        </Row>
        <Row label="Created">{when(profile.createdAt)}</Row>
        <Row label="Last sign-in">{when(profile.lastLoginAt)}</Row>
        <Row label="Password changed">{profile.passwordChangedAt ? when(profile.passwordChangedAt) : 'Not recorded'}</Row>
        {isStaff(profile.accessRole) && <Row label="Two-step verification">{profile.mfaEnabled ? 'On (admin panel)' : 'Set up at your next admin sign-in'}</Row>}
      </dl>
      {isStaff(profile.accessRole) && (
        <Button variant="outline" onClick={openAdminPanel}>
          <LayoutDashboard size={16} /> Open the admin panel
        </Button>
      )}
    </Card>
  );
}

function PasswordCard() {
  const [form, setForm] = useState({ current: '', password: '', confirmPassword: '' });
  const { busy, message, fields, run } = useForm();
  const [mismatch, setMismatch] = useState('');
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (form.password !== form.confirmPassword) return setMismatch('Passwords do not match');
        setMismatch('');
        void run(async () => {
          const session = await api<Session>('/api/auth/password', form, undefined, '');
          await saveSession(session);
          setForm({ current: '', password: '', confirmPassword: '' });
          return 'Password changed. Your other devices were signed out.';
        });
      }}
    >
      <Card className="account-card">
        <h2>
          <KeyRound size={19} /> Password
        </h2>
        <Field label="Current password" required error={fields.current}>
          <PasswordInput autoComplete="current-password" required value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        <Field label="New password" required hint="At least 10 characters, using three of: lowercase, uppercase, numbers, symbols." error={fields.password}>
          <PasswordInput autoComplete="new-password" required minLength={10} maxLength={72} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Confirm new password" required error={mismatch || fields.confirmPassword}>
          <PasswordInput autoComplete="new-password" required maxLength={72} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
        </Field>
        <Message message={message} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </Card>
    </form>
  );
}

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const { busy, message, run } = useForm();
  const load = () => void run(async () => setSessions(await accountApi.sessions()));
  useEffect(load, []);
  const others = (sessions ?? []).filter((s) => !s.current);
  return (
    <Card className="account-card account-wide">
      <div className="row between">
        <h2>
          <MonitorSmartphone size={19} /> Where you’re signed in
        </h2>
        <button className="icon-button" aria-label="Refresh sessions" onClick={load} disabled={busy}>
          <RefreshCw size={17} />
        </button>
      </div>
      {!sessions && <p className="muted">Loading…</p>}
      {sessions?.map((s) => (
        <div className="session-row" key={s.id}>
          <span className="icon-tile green">
            <MonitorSmartphone size={18} />
          </span>
          <span>
            <b>
              {s.device}
              {s.kind === 'admin' && <span className="pill">Admin panel</span>}
              {s.current && <span className="pill good">This device</span>}
            </b>
            <small>
              {s.network ? `Network ${s.network} · ` : ''}Signed in {when(s.createdAt)} · Last active {when(s.lastSeenAt)}
            </small>
          </span>
          {!s.current && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await accountApi.endSession(s.id);
                  setSessions(await accountApi.sessions());
                  return 'That session was signed out.';
                })
              }
            >
              Sign out
            </Button>
          )}
        </div>
      ))}
      <Message message={message} />
      {others.length > 0 && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (confirm(`Sign out of ${others.length} other session${others.length === 1 ? '' : 's'}? This device stays signed in.`))
              void run(async () => {
                const { signedOut } = await accountApi.endOtherSessions();
                setSessions(await accountApi.sessions());
                return `Signed out of ${signedOut} other session${signedOut === 1 ? '' : 's'}.`;
              });
          }}
        >
          <LogOut size={16} /> Sign out of all other sessions
        </Button>
      )}
      <p className="small muted">Only the network (for example 203.0.113.x) is kept, never your exact address.</p>
    </Card>
  );
}
