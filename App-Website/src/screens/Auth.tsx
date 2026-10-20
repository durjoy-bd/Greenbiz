import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronLeft, CircleAlert, CircleCheck, Cloud, MailCheck, ShieldCheck } from 'lucide-react';
import { Button, Card, Field, IconButton, Logo, PasswordInput } from '../components/UI';
import { useStore } from '../data/store';
import { api, ApiError, configureServer, native, serverURL } from '../data/api';
import { fieldErrors, takeReturn } from '../data/account';

/** Sign-in, sign-up and every page an emailed link opens. */
export type AuthPage = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-email' | 'confirm-email';
export const authPages: AuthPage[] = ['login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'confirm-email'];
const go = (hash: string) => {
  location.hash = hash;
};
const passwordHint = 'At least 10 characters, using three of: lowercase, uppercase, numbers, symbols.';

function Shell({ title, subtitle, children, back = '#/' }: { title: string; subtitle?: ReactNode; children: ReactNode; back?: string }) {
  return (
    <main className="auth-page">
      <div className="auth-heading">
        <IconButton label="Back" onClick={() => go(back)}>
          <ChevronLeft />
        </IconButton>
        <Logo />
      </div>
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
      {children}
    </main>
  );
}
function Problem({ children }: { children: ReactNode }) {
  return (
    <div className="notice red form-problem" role="alert">
      <CircleAlert size={18} />
      <span>{children}</span>
    </div>
  );
}
function Done({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="auth-result">
      <span className="icon-tile green">
        <CircleCheck size={22} />
      </span>
      <h2>{title}</h2>
      {children}
    </Card>
  );
}
/** Submits a form, keeping a general message and field messages apart. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; code: string; fields: Record<string, string> } | null>(null);
  async function submit(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      const fields = fieldErrors(error);
      setProblem({
        message: Object.keys(fields).length ? 'Check the highlighted fields.' : error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        code: error instanceof ApiError ? error.code : '',
        fields,
      });
    } finally {
      setBusy(false);
    }
  }
  return { busy, problem, setProblem, submit };
}
/** Native apps need to know which GreenBiz server to use; websites default to their own. */
function ServerField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <details className="server-choice" open={native && !value}>
      <summary>
        <Cloud size={15} /> Business server: {value || (native ? 'not set' : 'this website')}
      </summary>
      <Field label="Server address" hint="An HTTPS address you were given. Leave blank on the website to use its own server.">
        <input type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://greenbiz.example.com" required={native} />
      </Field>
    </details>
  );
}
function useServer() {
  const [server, setServer] = useState(serverURL());
  const apply = () => {
    configureServer(server);
    if (native && !server) throw new Error('Enter your business server’s HTTPS address.');
  };
  return { server, setServer, apply };
}

export function SignIn({ notice }: { notice?: string }) {
  const { signIn } = useStore();
  const { server, setServer, apply } = useServer();
  const [form, setForm] = useState({ email: '', password: '' });
  const [resent, setResent] = useState(false);
  const { busy, problem, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(async () => {
      apply();
      const user = await signIn(form.email, form.password);
      go(takeReturn() ?? (user.role === 'bank' ? '#/bank' : '#/home'));
    });
  };
  return (
    <Shell title="Welcome back" subtitle={notice ?? 'Sign in to your GreenBiz account.'}>
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <Field label="Email" required error={problem?.fields.email}>
            <input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" required error={problem?.fields.password}>
            <PasswordInput autoComplete="current-password" required maxLength={128} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <a className="text-button forgot-link" href="#/forgot-password">
            Forgot password?
          </a>
        </Card>
        {problem && <Problem>{problem.message}</Problem>}
        {problem?.code === 'email_unverified' && (
          <Button
            type="button"
            variant="outline"
            className="full"
            disabled={busy || resent}
            onClick={() =>
              void submit(async () => {
                await api('/api/auth/verify-email/resend', { email: form.email }, undefined, '');
                setResent(true);
              })
            }
          >
            <MailCheck size={17} /> {resent ? 'New link sent. Check your inbox.' : 'Send a new confirmation link'}
          </Button>
        )}
        <ServerField value={server} onChange={setServer} />
        <Button className="full" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} />
        </Button>
      </form>
      <p className="auth-switch">
        New to GreenBiz? <a href="#/register">Create an account</a>
      </p>
    </Shell>
  );
}

export function Register() {
  const { register } = useStore();
  const { server, setServer, apply } = useServer();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '', shopName: '', location: '', website: '' });
  const [sentTo, setSentTo] = useState('');
  const [mismatch, setMismatch] = useState('');
  const { busy, problem, submit } = useSubmit();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  if (sentTo) return <CheckEmail email={sentTo} />;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setMismatch('Passwords do not match');
      return;
    }
    setMismatch('');
    void submit(async () => {
      apply();
      const { website, ...rest } = form;
      const result = await register(website ? form : rest);
      if (result.verificationRequired) setSentTo(result.email);
      else go(takeReturn() ?? '#/home');
    });
  };
  const errors = problem?.fields ?? {};
  return (
    <Shell title="Create your account" subtitle="Your records sync securely to your GreenBiz server.">
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <p className="small muted required-legend">
            Fields marked <span className="req">*</span> are required.
          </p>
          <Field label="Full name" required error={errors.fullName}>
            <input autoComplete="name" required maxLength={100} value={form.fullName} onChange={set('fullName')} />
          </Field>
          <Field label="Email" required error={errors.email} hint="We’ll send a link to confirm it’s yours.">
            <input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Password" required error={errors.password} hint={passwordHint}>
            <PasswordInput autoComplete="new-password" required minLength={10} maxLength={72} value={form.password} onChange={set('password')} />
          </Field>
          <Field label="Confirm password" required error={mismatch || errors.confirmPassword}>
            <PasswordInput autoComplete="new-password" required maxLength={72} value={form.confirmPassword} onChange={set('confirmPassword')} />
          </Field>
          <Field label="Shop or business name" required error={errors.shopName}>
            <input required maxLength={100} placeholder="e.g. Shapla Store" value={form.shopName} onChange={set('shopName')} />
          </Field>
          <Field label="Location" optional error={errors.location}>
            <input autoComplete="address-level2" maxLength={160} placeholder="Mirpur 10, Dhaka" value={form.location} onChange={set('location')} />
          </Field>
          {/* Left empty by people; automated sign-ups fill it in. */}
          <div className="trap" aria-hidden="true">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
            </label>
          </div>
        </Card>
        {problem && <Problem>{problem.message}</Problem>}
        <ServerField value={server} onChange={setServer} />
        <Button className="full" type="submit" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'} <ArrowRight size={18} />
        </Button>
      </form>
      <p className="fineprint">
        The administrators of this GreenBiz server can view your shop records to provide support and keep the service safe. Every administrator view is
        recorded in an audit log.
      </p>
      <p className="auth-switch">
        Already have an account? <a href="#/login">Sign in</a>
      </p>
    </Shell>
  );
}

function CheckEmail({ email }: { email: string }) {
  const { busy, problem, submit } = useSubmit();
  const [sent, setSent] = useState(false);
  return (
    <Shell title="Check your email" back="#/login">
      <Card className="auth-result">
        <span className="icon-tile green">
          <MailCheck size={22} />
        </span>
        <p>
          We sent a confirmation link to <b>{email}</b>. Open it to finish creating your account. The link works for 24 hours.
        </p>
        <p className="small muted">Can’t find it? Check your spam folder, or send a new link.</p>
      </Card>
      {problem && <Problem>{problem.message}</Problem>}
      <Button
        variant="outline"
        className="full"
        disabled={busy || sent}
        onClick={() =>
          void submit(async () => {
            await api('/api/auth/verify-email/resend', { email }, undefined, '');
            setSent(true);
          })
        }
      >
        {sent ? 'New link sent' : 'Send a new link'}
      </Button>
      <Button className="full" onClick={() => go('#/login')}>
        Go to sign in
      </Button>
    </Shell>
  );
}

export function ForgotPassword() {
  const { server, setServer, apply } = useServer();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, problem, submit } = useSubmit();
  return (
    <Shell title="Reset your password" subtitle="Enter your account email and we’ll send you a link to choose a new password." back="#/login">
      {sent ? (
        <Done title="Check your email">
          <p>
            If <b>{email}</b> has a GreenBiz account, a reset link is on its way. It works once, for 30 minutes.
          </p>
          <Button className="full" onClick={() => go('#/login')}>
            Back to sign in
          </Button>
        </Done>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit(async () => {
              apply();
              await api('/api/auth/forgot-password', { email }, undefined, '');
              setSent(true);
            });
          }}
        >
          <Card>
            <Field label="Email" required error={problem?.fields.email}>
              <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </Card>
          {problem && <Problem>{problem.message}</Problem>}
          <ServerField value={server} onChange={setServer} />
          <Button className="full" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </Shell>
  );
}

/** Runs a link's request once, even under React's development double-render. */
function useLink<T>(token: string | undefined, request: (token: string) => Promise<T>) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'done'; value: T } | { status: 'error'; message: string; code: string }>({ status: 'loading' });
  const started = useRef('');
  useEffect(() => {
    if (!token || started.current === token) return;
    started.current = token;
    request(token).then(
      (value) => setState({ status: 'done', value }),
      (error: unknown) => setState({ status: 'error', message: error instanceof Error ? error.message : 'This link could not be used.', code: error instanceof ApiError ? error.code : '' }),
    );
  }, [token, request]);
  if (!token) return { status: 'error' as const, message: 'This link is incomplete. Copy the whole address from the email.', code: 'link_invalid' };
  return state;
}
const checkReset = (token: string) => api<{ email: string; expiresAt: string }>('/api/auth/reset-password/check', { token }, undefined, '');
const verify = (token: string) => api<{ email: string }>('/api/auth/verify-email', { token }, undefined, '');
const confirmEmail = (token: string) => api<{ email: string }>('/api/auth/email/confirm', { token }, undefined, '');

function BrokenLink({ message, retry }: { message: string; retry: { label: string; hash: string } }) {
  return (
    <>
      <Problem>{message}</Problem>
      <Button className="full" onClick={() => go(retry.hash)}>
        {retry.label}
      </Button>
    </>
  );
}

export function ResetPassword({ token }: { token?: string }) {
  const link = useLink(token, checkReset);
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [mismatch, setMismatch] = useState('');
  const [done, setDone] = useState(false);
  const { busy, problem, submit } = useSubmit();
  return (
    <Shell title="Choose a new password" back="#/login" subtitle={link.status === 'done' && !done ? <>For {link.value.email}. Every device will be signed out.</> : undefined}>
      {link.status === 'loading' && <p className="muted">Checking your link…</p>}
      {link.status === 'error' && <BrokenLink message={link.message} retry={{ label: 'Request a new link', hash: '#/forgot-password' }} />}
      {link.status === 'done' &&
        (done ? (
          <Done title="Password updated">
            <p>Sign in with your new password.</p>
            <Button className="full" onClick={() => go('#/login')}>
              Sign in
            </Button>
          </Done>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (form.password !== form.confirmPassword) return setMismatch('Passwords do not match');
              setMismatch('');
              void submit(async () => {
                await api('/api/auth/reset-password', { token, ...form }, undefined, '');
                setDone(true);
              });
            }}
          >
            <Card>
              <Field label="New password" required hint={passwordHint} error={problem?.fields.password}>
                <PasswordInput autoComplete="new-password" required minLength={10} maxLength={72} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
              <Field label="Confirm new password" required error={mismatch || problem?.fields.confirmPassword}>
                <PasswordInput autoComplete="new-password" required maxLength={72} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
              </Field>
            </Card>
            {problem && <Problem>{problem.message}</Problem>}
            {problem && ['link_used', 'link_expired', 'link_invalid'].includes(problem.code) && (
              <Button type="button" variant="outline" className="full" onClick={() => go('#/forgot-password')}>
                Request a new link
              </Button>
            )}
            <Button className="full" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        ))}
    </Shell>
  );
}

export function VerifyEmail({ token }: { token?: string }) {
  const link = useLink(token, verify);
  const { mode, refreshUser } = useStore();
  useEffect(() => {
    if (link.status === 'done' && mode === 'server') void refreshUser().catch(() => {});
  }, [link.status]);
  return (
    <Shell title="Confirm your email">
      {link.status === 'loading' && <p className="muted">Confirming…</p>}
      {link.status === 'error' && <BrokenLink message={link.message} retry={{ label: 'Go to sign in to get a new link', hash: '#/login' }} />}
      {link.status === 'done' && (
        <Done title="Email confirmed">
          <p>
            <b>{link.value.email}</b> is confirmed. {mode === 'server' ? 'You can carry on where you left off.' : 'You can sign in now.'}
          </p>
          <Button className="full" onClick={() => go(mode === 'server' ? '#/account' : '#/login')}>
            {mode === 'server' ? 'Continue' : 'Sign in'}
          </Button>
        </Done>
      )}
    </Shell>
  );
}

export function ConfirmEmailChange({ token }: { token?: string }) {
  const link = useLink(token, confirmEmail);
  return (
    <Shell title="Confirm your new email">
      {link.status === 'loading' && <p className="muted">Updating your email…</p>}
      {link.status === 'error' && <BrokenLink message={link.message} retry={{ label: 'Back to GreenBiz', hash: '#/' }} />}
      {link.status === 'done' && (
        <Done title="Email updated">
          <p>
            Your sign-in email is now <b>{link.value.email}</b>. For your security every device was signed out, so sign in again with the new address.
          </p>
          <Button
            className="full"
            onClick={() => {
              localStorage.removeItem('greenbiz-mode');
              location.hash = '#/login';
              location.reload();
            }}
          >
            <ShieldCheck size={17} /> Sign in again
          </Button>
        </Done>
      )}
    </Shell>
  );
}

export function AuthRoute({ page, token, notice }: { page: AuthPage; token?: string; notice?: string }) {
  switch (page) {
    case 'register':
      return <Register />;
    case 'forgot-password':
      return <ForgotPassword />;
    case 'reset-password':
      return <ResetPassword token={token} />;
    case 'verify-email':
      return <VerifyEmail token={token} />;
    case 'confirm-email':
      return <ConfirmEmailChange token={token} />;
    default:
      return <SignIn notice={notice} />;
  }
}
