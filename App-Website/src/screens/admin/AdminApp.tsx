import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ChevronDown, CircleAlert, Copy, Download, LayoutDashboard, LogOut, ScrollText, ServerCog, ShieldAlert, ShieldCheck, Store, UserRound, Users } from 'lucide-react';
import { roleLabels, type Permission } from '../../../shared/permissions';
import { api, ApiError } from '../../data/api';
import { Avatar, Button, Card, Field, Logo, PasswordInput } from '../../components/UI';
import { copyText, download } from '../../utils';
import { PermissionDenied } from '../Denied';
import { AdminContext, adminCall, go, SIGNED_OUT, useAdminMe, useCan, type AdminMe } from './common';
import { Dashboard } from './Dashboard';
import { UsersPage } from './Users';
import { UserDetail } from './UserDetail';
import { ActivityLog, AuditLog } from './Logs';
import { ShopDetail, ShopsPage } from './Shops';
import { SystemPage } from './System';

/** "#/admin/users/abc" → ["users", "abc"] */
const parts = () =>
  location.hash
    .replace(/^#\/?admin\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);

export function AdminApp() {
  const [admin, setAdmin] = useState<AdminMe | null | undefined>(undefined);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  useEffect(() => {
    api<{ admin: AdminMe | null }>('/api/admin/me', undefined, undefined, '').then(
      (r) => setAdmin(r.admin),
      () => setAdmin(null),
    );
    const expired = () => setAdmin(null);
    window.addEventListener(SIGNED_OUT, expired);
    return () => window.removeEventListener(SIGNED_OUT, expired);
  }, []);
  if (admin === undefined)
    return (
      <div className="launch">
        <Logo />
        <span className="loading-line" />
        <p>Opening the admin panel…</p>
      </div>
    );
  if (!admin)
    return (
      <AdminSignIn
        onSignedIn={(me, codes) => {
          setRecovery(codes ?? null);
          setAdmin(me);
        }}
      />
    );
  if (recovery) return <RecoveryCodes codes={recovery} email={admin.email} onDone={() => setRecovery(null)} />;
  return (
    <AdminContext.Provider value={admin}>
      <AdminShell onSignOut={() => setAdmin(null)} />
    </AdminContext.Provider>
  );
}

type Step = { kind: 'password' } | { kind: 'verify'; challenge: string } | { kind: 'setup'; challenge: string; secret: string; qr: string } | { kind: 'denied' };
function AdminSignIn({ onSignedIn }: { onSignedIn: (me: AdminMe, recovery?: string[]) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [form, setForm] = useState({ email: '', password: '' });
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setProblem('');
    try {
      await work();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_admin') setStep({ kind: 'denied' });
      else if (error instanceof ApiError && ['link_expired', 'link_used', 'link_invalid', 'mfa_locked'].includes(error.code)) {
        setStep({ kind: 'password' });
        setProblem(error.code === 'mfa_locked' ? error.message : 'Your sign-in took too long. Enter your password again.');
      } else setProblem(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }
  if (step.kind === 'denied')
    return <PermissionDenied title="This account can’t open the admin panel" detail="You signed in correctly, but your account does not have an Admin or Super Admin role. A Super Admin can grant access if you need it." />;
  const verifyCode = (challenge: string) =>
    void attempt(async () => {
      const result = await api<{ admin: AdminMe; recoveryCodes?: string[] }>('/api/admin/login/mfa', { challenge, code: code.trim() }, undefined, '');
      onSignedIn(result.admin, result.recoveryCodes);
    });
  return (
    <main className="auth-page admin-login">
      <Logo />
      <span className="eyebrow">GREENBIZ ADMIN PANEL</span>
      {step.kind === 'password' && (
        <>
          <h1>Administrator sign-in</h1>
          <p className="muted">Use your GreenBiz account. Administrators also confirm a code from an authenticator app.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                const result = await api<{ mfa: 'verify' | 'setup' | 'none'; challenge: string; secret?: string; qr?: string; admin?: AdminMe }>('/api/admin/login', form, undefined, '');
                if (result.mfa === 'none' && result.admin) return onSignedIn(result.admin);
                setCode('');
                setStep(result.mfa === 'setup' ? { kind: 'setup', challenge: result.challenge, secret: result.secret!, qr: result.qr! } : { kind: 'verify', challenge: result.challenge });
              });
            }}
          >
            <Card>
              <Field label="Email" required>
                <input type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Password" required>
                <PasswordInput autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            </Card>
            {problem && <Problem text={problem} />}
            <Button className="full" type="submit" disabled={busy}>
              <ShieldCheck size={18} /> {busy ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        </>
      )}
      {step.kind === 'verify' && (
        <>
          <h1>Two-step verification</h1>
          <p className="muted">{useRecovery ? 'Enter one of your recovery codes. Each works once.' : 'Enter the 6-digit code from your authenticator app.'}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyCode(step.challenge);
            }}
          >
            <Card>
              <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} required>
                <input
                  className="code-input"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  pattern={useRecovery ? undefined : '[0-9]{6}'}
                  maxLength={useRecovery ? 12 : 6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
            </Card>
            {problem && <Problem text={problem} />}
            <Button className="full" type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and sign in'}
            </Button>
            <button type="button" className="text-button" onClick={() => setUseRecovery(!useRecovery)}>
              {useRecovery ? 'Use my authenticator app instead' : 'Lost your phone? Use a recovery code'}
            </button>
          </form>
        </>
      )}
      {step.kind === 'setup' && (
        <>
          <h1>Set up two-step verification</h1>
          <p className="muted">Administrator accounts need a second step. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the 6-digit code it shows.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyCode(step.challenge);
            }}
          >
            <Card className="mfa-setup">
              <img src={step.qr} alt="QR code for your authenticator app" width={200} height={200} />
              <p className="small muted">Can’t scan? Enter this key manually:</p>
              <code className="mfa-secret" aria-label="Setup key">
                {step.secret.replace(/(.{4})/g, '$1 ').trim()}
              </code>
              <Field label="Code from the app" required>
                <input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            </Card>
            {problem && <Problem text={problem} />}
            <Button className="full" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Turn on and sign in'}
            </Button>
          </form>
        </>
      )}
      <p className="fineprint">Every administrator sign-in, record view and account change is recorded in the audit log.</p>
      <a className="text-button" href="#/">
        Back to GreenBiz
      </a>
    </main>
  );
}
function Problem({ text }: { text: string }) {
  return (
    <div className="notice red form-problem" role="alert">
      <CircleAlert size={18} />
      <span>{text}</span>
    </div>
  );
}

function RecoveryCodes({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <main className="auth-page admin-login">
      <Logo />
      <h1>Save your recovery codes</h1>
      <p className="muted">If you lose your phone, each of these codes lets you sign in once. This is the only time they are shown.</p>
      <Card>
        <ol className="recovery-codes">
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ol>
        <div className="row">
          {/* copyText also works on plain-HTTP servers, where the browser clipboard API is missing. */}
          <Button
            variant="outline"
            onClick={() =>
              copyText(codes.join('\n')).then(
                () => setCopy({ ok: true, text: 'Copied' }),
                (error: unknown) => setCopy({ ok: false, text: error instanceof Error ? error.message : 'Copying failed.' }),
              )
            }
          >
            <Copy size={16} /> {copy?.ok ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" onClick={() => void download('greenbiz-recovery-codes.txt', `GreenBiz admin recovery codes for ${email}\n\n${codes.join('\n')}\n`, 'text/plain')}>
            <Download size={16} /> Download
          </Button>
        </div>
        {copy && !copy.ok && (
          <p className="form-message bad" role="alert">
            {copy.text}
          </p>
        )}
      </Card>
      <label className="check-row">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have stored these codes somewhere safe
      </label>
      <Button className="full" disabled={!saved} onClick={onDone}>
        Continue to the admin panel
      </Button>
    </main>
  );
}

function AdminShell({ onSignOut }: { onSignOut: () => void }) {
  const [route, setRoute] = useState(parts);
  const allowed = useCan();
  const me = useAdminMe();
  useEffect(() => {
    const listener = () => {
      setRoute(parts());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  const [section = 'dashboard', id] = route;
  const tabs: { id: string; label: string; Icon: typeof Users; permission: Permission }[] = [
    { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard, permission: 'admin.access' },
    { id: 'users', label: 'Users', Icon: Users, permission: 'users.view' },
    { id: 'shops', label: 'Shops', Icon: Store, permission: 'shops.view' },
    { id: 'activity', label: 'Activity log', Icon: Activity, permission: 'activity.view' },
    { id: 'audit', label: 'Audit log', Icon: ScrollText, permission: 'audit.view' },
    { id: 'system', label: 'Settings', Icon: ServerCog, permission: 'system.view' },
  ];
  const tab = tabs.find((t) => t.id === section);
  let content;
  if (!tab || !allowed(tab.permission)) content = <AdminDenied known={!!tab} />;
  else if (section === 'users') content = id ? <UserDetail id={id} /> : <UsersPage />;
  else if (section === 'shops') content = id ? <ShopDetail id={id} /> : <ShopsPage />;
  else if (section === 'activity') content = <ActivityLog />;
  else if (section === 'audit') content = <AuditLog />;
  else if (section === 'system') content = <SystemPage />;
  else content = <Dashboard />;
  return (
    <div className="admin-page">
      <a className="skip-link" href="#admin-main" onClick={(e) => (e.preventDefault(), document.getElementById('admin-main')?.focus())}>
        Skip to content
      </a>
      <header className="bank-top admin-top">
        <Logo invert />
        <span className="bank-label">Admin</span>
        <nav aria-label="Admin sections">
          {tabs
            .filter((t) => allowed(t.permission))
            .map(({ id: key, label, Icon }) => (
              <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => go(key === 'dashboard' ? '' : key)}>
                <Icon size={17} /> {label}
              </button>
            ))}
        </nav>
        <AdminMenu onSignOut={onSignOut} />
      </header>
      <main className="admin-content" id="admin-main" tabIndex={-1} key={section + (id ?? '')}>
        {me.mfaExempt && (
          <div className="notice red demo-warning" role="note">
            <ShieldAlert size={18} />
            <span>
              <b>Demo account.</b> This administrator signs in with a password only, without two-step verification. Anyone who knows the password controls this server. Keep only demo data here.
            </span>
          </div>
        )}
        {content}
      </main>
    </div>
  );
}
function AdminDenied({ known }: { known: boolean }) {
  return (
    <Card className="admin-denied">
      <h1>{known ? 'You don’t have permission to view this' : 'Page not found'}</h1>
      <p className="muted">{known ? 'Your role does not include this part of the admin panel.' : 'This admin page does not exist.'}</p>
      <Button variant="outline" onClick={() => go('')}>
        <ArrowLeft size={16} /> Back to the dashboard
      </Button>
    </Card>
  );
}

function AdminMenu({ onSignOut }: { onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const me = useAdminMe();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const signOut = async () => {
    await adminCall('/api/admin/logout', {});
    onSignOut();
  };
  return (
    <div className="profile-menu admin-menu" ref={root} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button className="profile-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Administrator menu" onClick={() => setOpen(!open)}>
        <Avatar name={me.name} email={me.email} size={32} />
        <span className="profile-name">
          <b>{me.name || me.email}</b>
          <small>{roleLabels[me.accessRole]}</small>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="profile-popover" role="menu" aria-label="Administrator">
          <div className="profile-head">
            <b>{me.name || me.email}</b>
            <small>{me.email}</small>
          </div>
          <button role="menuitem" onClick={() => (location.hash = '#/account')}>
            <UserRound size={17} /> My account
          </button>
          <button role="menuitem" onClick={() => (location.hash = '#/home')}>
            <ArrowLeft size={17} /> Back to GreenBiz
          </button>
          <button role="menuitem" onClick={() => void signOut().catch(onSignOut)}>
            <LogOut size={17} /> Sign out of the admin panel
          </button>
        </div>
      )}
    </div>
  );
}
