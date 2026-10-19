import { useState } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  Camera,
  Store,
  Cloud,
  ChevronLeft,
  TrendingUp,
} from 'lucide-react';
import { Logo, Button, Card, Field, IconButton } from '../components/UI';
import { useStore } from '../data/store';
import { useTask } from '../components/useTask';
import { configureServer, serverURL, native } from '../data/api';
export function Onboarding() {
  const [screen, setScreen] = useState('welcome'),
    [form, setForm] = useState({
      shopName: '',
      owner: '',
      location: '',
      phone: '',
      bkash: '',
      email: '',
      password: '',
    }),
    [server, setServer] = useState(serverURL()),
    [register, setRegister] = useState(false);
  const { start, authenticate, setError } = useStore();
  const { run, busy } = useTask();
  const change = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (screen === 'device') {
      await run(async () => {
        await start('device', {
          name: form.shopName,
          owner: form.owner,
          location: form.location,
          phone: form.phone,
          bkash: form.bkash,
        });
      });
    } else {
      await run(async () => {
        configureServer(server);
        if (native && !server) throw new Error('Enter your business server’s HTTPS address.');
        await authenticate(register, form);
      });
    }
  }
  if (screen === 'welcome')
    return (
      <main className="welcome">
        <Logo />
        <div className="welcome-art" aria-hidden="true">
          <div className="art-ring ring-one" />
          <div className="art-ring ring-two" />
          <div className="art-shop">
            <Store size={68} />
          </div>
          <span className="art-float float-one">
            <Camera size={22} /> Stock, sorted.
          </span>
          <span className="art-float float-two">
            <TrendingUp size={22} /> Room to grow.
          </span>
        </div>
        <span className="eyebrow">YOUR SHOP. YOUR NEXT CHAPTER.</span>
        <h1>
          A clearer picture.
          <br />
          <em>A growing business.</em>
        </h1>
        <p>
          Stock, sales and smarter decisions, right on your phone. No business server or technical
          setup needed.
        </p>
        <div className="welcome-actions">
          <Button onClick={() => setScreen('device')}>
            Create my shop <ArrowRight size={18} />
          </Button>
          {!native && (
            <details className="optional-cloud">
              <summary>Optional bank & cloud portal</summary>
              <Button variant="outline" onClick={() => setScreen('server')}>
                <Cloud size={18} /> Connect to business server
              </Button>
            </details>
          )}
          <Button variant="ghost" onClick={() => void run(() => start('demo'))} disabled={busy}>
            Explore sample shop <ArrowRight size={17} />
          </Button>
        </div>
        <div className="welcome-foot">
          <ShieldCheck size={17} />
          <span>Your records stay yours.</span>
        </div>
      </main>
    );
  return (
    <main className="auth-page">
      <div className="auth-heading">
        <IconButton
          label="Back to welcome"
          onClick={() => {
            setScreen('welcome');
            setError('');
          }}
        >
          <ChevronLeft />
        </IconButton>
        <Logo />
      </div>
      <h1>
        {screen === 'device' ? 'Make it your own' : register ? 'Connect your shop' : 'Welcome back'}
      </h1>
      <p className="muted">
        {screen === 'device'
          ? 'Start with the essentials. Your records save on this device.'
          : 'Use your GreenBiz server for secure accounts and shared business records.'}
      </p>
      {screen === 'server' && (
        <div className="segments">
          <button className={!register ? 'active' : ''} onClick={() => setRegister(false)}>
            Sign in
          </button>
          <button className={register ? 'active' : ''} onClick={() => setRegister(true)}>
            Register
          </button>
        </div>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <Card>
          {screen === 'server' && (
            <Field
              label="Business server"
              hint="An HTTPS server you control. Leave blank for this website’s server."
            >
              <input
                type="url"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://greenbiz.example.com"
                required={native}
              />
            </Field>
          )}
          {(screen === 'device' || register) && (
            <>
              <Field label="Shop name">
                <input
                  value={form.shopName}
                  onChange={change('shopName')}
                  required
                  maxLength={100}
                  placeholder="e.g. Shapla Store"
                />
              </Field>
              <Field label="Owner name">
                <input value={form.owner} onChange={change('owner')} maxLength={100} />
              </Field>
              <Field label="Shop location">
                <input
                  value={form.location}
                  onChange={change('location')}
                  maxLength={160}
                  placeholder="Mirpur 10, Dhaka"
                />
              </Field>
              <Field label="Phone number">
                <input type="tel" value={form.phone} onChange={change('phone')} maxLength={20} />
              </Field>
              <Field label="bKash receiving number">
                <input type="tel" value={form.bkash} onChange={change('bkash')} maxLength={20} />
              </Field>
            </>
          )}
          {screen === 'server' && (
            <>
              <Field label="Email">
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={change('email')}
                  maxLength={254}
                />
              </Field>
              <Field
                label="Password"
                hint={
                  register
                    ? 'At least 10 characters; use three of uppercase, lowercase, numbers and symbols.'
                    : ''
                }
              >
                <input
                  type="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  minLength={register ? 10 : 1}
                  maxLength={128}
                  required
                  value={form.password}
                  onChange={change('password')}
                />
              </Field>
            </>
          )}
        </Card>
        <Button className="full" disabled={busy} type="submit">
          {busy
            ? 'Opening…'
            : screen === 'device'
              ? 'Open my shop'
              : register
                ? 'Create account'
                : 'Sign in'}{' '}
          <ArrowRight size={18} />
        </Button>
      </form>
      {screen === 'server' && !register && (
        <Button
          variant="ghost"
          onClick={() =>
            void run(async () => {
              configureServer(server);
              if (!form.email) throw new Error('Enter your email address first.');
              const { api } = await import('../data/api');
              await api('/api/auth/forgot-password', { email: form.email });
              setError('If this account exists, recovery instructions will be sent.');
            })
          }
        >
          Forgot password?
        </Button>
      )}
      <p className="fineprint">
        {screen === 'device'
          ? 'Device records do not automatically sync. Export regular backups in Settings.'
          : 'Your server administrator manages hosting, backups and account recovery.'}
      </p>
    </main>
  );
}
