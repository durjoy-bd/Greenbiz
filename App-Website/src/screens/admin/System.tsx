import { useEffect, useState } from 'react';
import { CircleAlert, Mail, ServerCog, ShieldAlert, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { Button, Card, Field, PasswordInput, Toggle } from '../../components/UI';
import { adminCall, ConfirmDialog, go, Header, LoadState, RefreshButton, TZ_NOTE, useAdmin, when } from './common';

interface System {
  version: string;
  node: string;
  uptimeSeconds: number;
  memoryMb: number;
  databaseBytes: number;
  publicOrigin: string;
  transport: 'http' | 'https';
  aiConfigured: boolean;
  serverTime: string;
  trackingStartedAt: string | null;
  superAdmins: number;
  mfaExempt: { id: string; email: string }[];
  review: { id: string; kind: string; reference: string; detail: string; createdAt: string; resolvedAt: string | null }[];
}
interface Settings {
  email: {
    source: 'dashboard' | 'environment' | 'injected';
    configured: boolean;
    description: string;
    saved: { host: string; port: number; secure: boolean; user: string; from: string; passwordSet: boolean } | null;
  };
  requireEmailVerification: boolean;
  retentionDays: number;
  defaults: { requireEmailVerification: boolean; retentionDays: number };
}
type Pending = null | { kind: 'general'; body: { requireEmailVerification: boolean; retentionDays: number } } | { kind: 'email'; body: Record<string, unknown> } | { kind: 'email-reset' } | { kind: 'review'; id: string };

export function SystemPage() {
  const system = useAdmin<System>('/api/admin/system');
  const settings = useAdmin<Settings>('/api/admin/settings');
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const s = system.data;
  const uptime = s ? `${Math.floor(s.uptimeSeconds / 86400)}d ${Math.floor((s.uptimeSeconds % 86400) / 3600)}h ${Math.floor((s.uptimeSeconds % 3600) / 60)}m` : '';
  const refresh = () => {
    system.refresh();
    settings.refresh();
  };
  return (
    <>
      <Header title="Settings" subtitle={`This GreenBiz server · ${TZ_NOTE}`}>
        <RefreshButton onClick={refresh} busy={system.busy || settings.busy} loadedAt={system.loadedAt} />
      </Header>
      {notice && (
        <p className={'form-message ' + (notice.ok ? 'ok' : 'bad')} role={notice.ok ? 'status' : 'alert'}>
          {notice.ok ? <ShieldCheck size={16} /> : <CircleAlert size={16} />} {notice.text}
        </p>
      )}
      <LoadState error={settings.error ?? system.error} busy={!s && (system.busy || settings.busy)} retry={refresh} label="settings" />
      {s && s.transport === 'http' && (
        <div className="notice amber">
          <ShieldAlert size={19} />
          <span>This server runs over plain HTTP, so passwords travel unencrypted. Switch on HTTPS before inviting real shop owners. The Android app also requires HTTPS to sign in.</span>
        </div>
      )}
      {s && s.mfaExempt.length > 0 && (
        <div className="notice red">
          <ShieldAlert size={19} />
          <span>
            {s.mfaExempt.map((a) => a.email).join(', ')} sign{s.mfaExempt.length === 1 ? 's' : ''} in to the admin panel without two-step verification (demo mode). Open the account and choose
            “Require two-step” before this server holds real data.
            {s.mfaExempt.map((a) => (
              <button key={a.id} className="text-button" onClick={() => go('users/' + a.id)}>
                Open {a.email}
              </button>
            ))}
          </span>
        </div>
      )}
      {settings.data && (
        <div className="admin-two">
          <EmailSettings
            data={settings.data}
            onSave={(body) => setPending({ kind: 'email', body })}
            onReset={() => setPending({ kind: 'email-reset' })}
            onTest={() =>
              adminCall<{ to: string }>('/api/admin/settings/email/test', {}).then(
                (r) => setNotice({ ok: true, text: `Test email sent to ${r.to}. Check that inbox (and spam).` }),
                (e: unknown) => setNotice({ ok: false, text: e instanceof Error ? e.message : 'The test email could not be sent.' }),
              )
            }
          />
          <GeneralSettings data={settings.data} onSave={(body) => setPending({ kind: 'general', body })} />
        </div>
      )}
      {s && (
        <div className="admin-two">
          <Card>
            <h2>
              <ServerCog size={19} /> Server
            </h2>
            <dl className="transaction-detail">
              <dt>Address</dt>
              <dd className="break">{s.publicOrigin}</dd>
              <dt>Connection</dt>
              <dd>{s.transport === 'https' ? 'HTTPS (encrypted)' : 'HTTP (not encrypted)'}</dd>
              <dt>Version</dt>
              <dd>{s.version}</dd>
              <dt>Runtime</dt>
              <dd>Node {s.node}</dd>
              <dt>Uptime</dt>
              <dd>{uptime}</dd>
              <dt>Memory</dt>
              <dd>{s.memoryMb} MB</dd>
              <dt>Database</dt>
              <dd>{(s.databaseBytes / 1048576).toFixed(2)} MB · SQLite</dd>
              <dt>Server AI</dt>
              <dd>{s.aiConfigured ? 'Configured' : 'Not configured (the app uses GreenBiz managed AI)'}</dd>
              <dt>Activity recorded since</dt>
              <dd>{when(s.trackingStartedAt)}</dd>
              <dt>Active Super Admins</dt>
              <dd>{s.superAdmins}</dd>
              <dt>Server time</dt>
              <dd>{when(s.serverTime)}</dd>
            </dl>
          </Card>
          <Card>
            <h2>Upgrade review</h2>
            <p className="small muted">Records the 2.4 upgrade could not match to an account safely. Nothing here was assigned automatically.</p>
            {s.review.length ? (
              s.review.map((item) => (
                <div className="review-item" key={item.id}>
                  <p className="small">{item.detail}</p>
                  <small className="muted">
                    {when(item.createdAt)} · {item.resolvedAt ? `Resolved ${when(item.resolvedAt)}` : 'Open'}
                  </small>
                  {!item.resolvedAt && (
                    <Button variant="outline" onClick={() => setPending({ kind: 'review', id: item.id })}>
                      Mark resolved
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className="empty-inline">Nothing needs review.</p>
            )}
          </Card>
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'email' ? 'Save email settings' : pending.kind === 'email-reset' ? 'Use the server’s email settings' : pending.kind === 'review' ? 'Mark as resolved' : 'Save settings'}
          body={
            pending.kind === 'email'
              ? 'GreenBiz will send confirmation links, password resets and invitations through this server from now on. The password is stored only on the server and never shown again.'
              : pending.kind === 'email-reset'
                ? 'Remove the email settings saved here and go back to the ones in the server environment.'
                : pending.kind === 'review'
                  ? 'Confirm you have checked this item, for example by granting access from the server command line.'
                  : 'These settings apply immediately to everyone on this server.'
          }
          confirmLabel="Save"
          reasonRequired
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            if (pending.kind === 'general') await adminCall('/api/admin/settings', { ...pending.body, reason });
            else if (pending.kind === 'email') await adminCall('/api/admin/settings/email', { ...pending.body, reason });
            else if (pending.kind === 'email-reset') await adminCall('/api/admin/settings/email', { reason }, 'DELETE');
            else await adminCall(`/api/admin/review/${pending.id}/resolve`, { reason });
            setNotice({ ok: true, text: 'Saved.' });
            refresh();
          }}
        />
      )}
    </>
  );
}

function EmailSettings({ data, onSave, onReset, onTest }: { data: Settings; onSave: (body: Record<string, unknown>) => void; onReset: () => void; onTest: () => Promise<void> }) {
  const saved = data.email.saved;
  const [form, setForm] = useState({ host: saved?.host ?? '', port: String(saved?.port ?? 587), secure: saved?.secure ?? false, user: saved?.user ?? '', password: '', from: saved?.from ?? '' });
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (saved) setForm((f) => ({ ...f, host: saved.host, port: String(saved.port), secure: saved.secure, user: saved.user, from: saved.from, password: '' }));
  }, [saved?.host, saved?.port, saved?.user, saved?.from, saved?.secure]);
  const source = { dashboard: 'Saved in this panel', environment: 'Server environment', injected: 'Fixed by the server' }[data.email.source];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ host: form.host, port: Number(form.port), secure: form.secure, user: form.user, from: form.from, ...(form.password ? { password: form.password } : {}) });
      }}
    >
      <Card className="settings-card">
        <h2>
          <Mail size={19} /> Email delivery
        </h2>
        <p className="small">
          <span className={'pill ' + (data.email.configured ? 'good' : 'bad')}>{data.email.configured ? 'Working configuration' : 'Not set up'}</span> {data.email.description} · {source}
        </p>
        <p className="small muted">Used for email confirmation, password resets, email changes and bank invitations. Any SMTP provider works (Brevo, Mailgun, Amazon SES, Gmail with an app password…).</p>
        <div className="form-grid">
          <Field label="SMTP server" required>
            <input required value={form.host} placeholder="smtp.example.com" onChange={(e) => setForm({ ...form, host: e.target.value.trim() })} />
          </Field>
          <Field label="Port" required>
            <input required inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value, secure: e.target.value === '465' ? true : form.secure })} />
          </Field>
        </div>
        <div className="row between toggle-row">
          <span className="small">Connect with TLS from the start (usually port 465). Otherwise STARTTLS is required.</span>
          <Toggle label="Use TLS from the start" value={form.secure} onChange={(secure) => setForm({ ...form, secure })} />
        </div>
        <Field label="Username" optional>
          <input autoComplete="off" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
        </Field>
        <Field label="Password" optional hint={saved?.passwordSet ? 'A password is saved. Leave blank to keep it.' : undefined}>
          <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Send from" required hint="For example: GreenBiz <no-reply@yourdomain.com>">
          <input required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </Field>
        <div className="row wrap">
          <Button type="submit">Save email settings</Button>
          <Button
            type="button"
            variant="outline"
            disabled={!data.email.configured || testing}
            onClick={() => {
              setTesting(true);
              void onTest().finally(() => setTesting(false));
            }}
          >
            {testing ? 'Sending…' : 'Send me a test email'}
          </Button>
          {data.email.source === 'dashboard' && (
            <button type="button" className="text-button" onClick={onReset}>
              Use the server environment instead
            </button>
          )}
        </div>
      </Card>
    </form>
  );
}

function GeneralSettings({ data, onSave }: { data: Settings; onSave: (body: { requireEmailVerification: boolean; retentionDays: number }) => void }) {
  const [verify, setVerify] = useState(data.requireEmailVerification);
  const [days, setDays] = useState(String(data.retentionDays));
  useEffect(() => {
    setVerify(data.requireEmailVerification);
    setDays(String(data.retentionDays));
  }, [data.requireEmailVerification, data.retentionDays]);
  const changed = verify !== data.requireEmailVerification || Number(days) !== data.retentionDays;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ requireEmailVerification: verify, retentionDays: Number(days) });
      }}
    >
      <Card className="settings-card">
        <h2>
          <SlidersHorizontal size={19} /> Accounts and activity
        </h2>
        <div className="row between toggle-row">
          <span>
            <b>Require email confirmation</b>
            <small className="muted block">New accounts must open the emailed link before they can sign in. Accounts from before 2.4 are not affected.</small>
          </span>
          <Toggle label="Require email confirmation" value={verify} onChange={setVerify} />
        </div>
        {verify && !data.email.configured && <p className="form-message bad">Set up email delivery first, or nobody new will be able to sign in.</p>}
        <Field label="Keep activity events for (days)" required hint={`30 to 3650. Older events are removed automatically. Server default: ${data.defaults.retentionDays}. The audit log is always kept.`}>
          <input required inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!changed}>
          Save settings
        </Button>
      </Card>
    </form>
  );
}
