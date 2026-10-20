import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, Camera, Store, Cloud, ChevronLeft, TrendingUp, LogIn, UserPlus } from 'lucide-react';
import { Logo, Button, Card, Field, IconButton } from '../components/UI';
import { useStore } from '../data/store';
import { useTask } from '../components/useTask';
import { serverURL, native } from '../data/api';
export function Onboarding() {
  const [screen, setScreen] = useState<'welcome' | 'device'>('welcome'),
    [form, setForm] = useState({ shopName: '', owner: '', location: '', phone: '', bkash: '' });
  const { start, setError } = useStore();
  // Accounts are the main path when there is a GreenBiz server: always in an app built or set up
  // with one, and on a website when its own server answers. null while the website checks, so
  // the buttons appear once, in their final order, and a tap never lands on a moving button.
  const [hosted, setHosted] = useState<boolean | null>(native ? !!serverURL() : null);
  useEffect(() => {
    if (hosted !== null) return;
    let active = true;
    // Phones on slow networks can take a few seconds; a static host without a server answers at once.
    fetch(serverURL() + '/api/health', { credentials: 'omit', signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((r: { status?: string }) => active && setHosted(r.status === 'ok'))
      .catch(() => active && setHosted(false));
    return () => {
      active = false;
    };
  }, []);
  const { run, busy } = useTask();
  const change = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
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
        <p>Stock, sales and smarter decisions, right on your phone. No business server or technical setup needed.</p>
        <div className="welcome-actions" aria-busy={hosted === null}>
          {hosted === null ? (
            <span className="loading-line" aria-label="Checking for a GreenBiz server" />
          ) : hosted ? (
            <>
              <Button onClick={() => (location.hash = '#/register')}>
                <UserPlus size={18} /> Create an account
              </Button>
              <Button variant="outline" onClick={() => (location.hash = '#/login')}>
                <LogIn size={18} /> Sign in
              </Button>
              <Button variant="ghost" onClick={() => setScreen('device')}>
                Create my shop on this device only <ArrowRight size={17} />
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setScreen('device')}>
                Create my shop <ArrowRight size={18} />
              </Button>
              <details className="optional-cloud">
                <summary>Optional bank & cloud portal</summary>
                <Button variant="outline" onClick={() => (location.hash = '#/login')}>
                  <Cloud size={18} /> Sign in to a business server
                </Button>
              </details>
            </>
          )}
          {hosted !== null && (
            <Button variant="ghost" onClick={() => void run(() => start('demo'))} disabled={busy}>
              Explore sample shop <ArrowRight size={17} />
            </Button>
          )}
        </div>
        <div className="welcome-foot">
          <ShieldCheck size={17} />
          <span>Your records stay yours.</span>
        </div>
        {hosted && !native && (
          <div className="welcome-links">
            <a href="#/admin">Admin panel</a>
          </div>
        )}
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
      <h1>Make it your own</h1>
      <p className="muted">Start with the essentials. Your records save on this device.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => start('device', { name: form.shopName, owner: form.owner, location: form.location, phone: form.phone, bkash: form.bkash }));
        }}
      >
        <Card>
          <Field label="Shop name" required>
            <input value={form.shopName} onChange={change('shopName')} required maxLength={100} placeholder="e.g. Shapla Store" />
          </Field>
          <Field label="Owner name" optional>
            <input value={form.owner} onChange={change('owner')} maxLength={100} />
          </Field>
          <Field label="Shop location" optional>
            <input value={form.location} onChange={change('location')} maxLength={160} placeholder="Mirpur 10, Dhaka" />
          </Field>
          <Field label="Phone number" optional>
            <input type="tel" value={form.phone} onChange={change('phone')} maxLength={20} />
          </Field>
          <Field label="bKash receiving number" optional>
            <input type="tel" value={form.bkash} onChange={change('bkash')} maxLength={20} />
          </Field>
        </Card>
        <Button className="full" disabled={busy} type="submit">
          {busy ? 'Opening…' : 'Open my shop'} <ArrowRight size={18} />
        </Button>
      </form>
      <p className="fineprint">Device records do not automatically sync. Export regular backups in Settings.</p>
    </main>
  );
}
