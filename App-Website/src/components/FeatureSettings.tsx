import { useEffect, useState } from 'react';
import {
  Bell,
  Cloud,
  Download,
  KeyRound,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
} from 'lucide-react';
import { useStore } from '../data/store';
import { native } from '../data/api';
import { aiConfig, saveAiConfig, businessTools, type AiConfig } from '../data/business';
import { Button, Card, Field } from './UI';
import { useTask } from './useTask';
import { download } from '../utils';
import { managedAiStatus } from '../data/managed';

export function FeatureSettings() {
  const {
      shops,
      shopId,
      switchShop,
      createShop,
      deleteShop,
      pendingCount,
      syncConflict,
      refresh,
      pendingExport,
      discardPending,
      mode,
      workspace,
      reconnect,
    } = useStore(),
    { run, busy } = useTask();
  const [name, setName] = useState(''),
    [config, setConfig] = useState<AiConfig>({ provider: 'gemini', model: '', hasKey: false }),
    [key, setKey] = useState(''),
    [saved, setSaved] = useState(''),
    [reconnectPassword, setReconnectPassword] = useState(''),
    [managedReady, setManagedReady] = useState<boolean | null>(null),
    [sms, setSms] = useState<{ enabled: boolean; sms: string; notifications: string } | null>(null);
  const loadPermissions = async () => {
    if (native) setSms(await businessTools.status());
  };
  useEffect(() => {
    let active = true;
    void managedAiStatus()
      .then((s) => {
        if (active) setManagedReady(s.ai);
      })
      .catch(() => {
        if (active) setManagedReady(false);
      });
    void aiConfig().then((c) => {
      if (active) setConfig(c);
    });
    if (native)
      void businessTools.status().then((s) => {
        if (active) setSms(s);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <Card>
        <div className="row">
          <Store size={22} />
          <h2>Your shops</h2>
        </div>
        <Field label="Active shop">
          <select
            value={shopId}
            disabled={busy}
            onChange={(e) => void run(() => switchShop(e.target.value))}
          >
            {shops.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <form
          className="shop-create"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => createShop(name));
          }}
        >
          <Field label="New shop name">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GreenBiz market branch"
            />
          </Field>
          <Button type="submit" disabled={busy || !name.trim()}>
            <Plus size={18} /> Add shop
          </Button>
        </form>
        <p className="small muted">
          Each shop has separate stock, sales, transactions and sharing settings.{' '}
          {mode === 'server'
            ? 'Shop changes sync to your account.'
            : 'These shops are saved on this device.'}
        </p>
        {shops.length > 1 && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  `Permanently delete ${workspace?.shop.name} and all of this shop’s records? Export them first.`,
                )
              )
                void run(deleteShop);
            }}
          >
            <Trash2 size={16} /> Delete this shop
          </Button>
        )}
      </Card>
      {mode === 'server' && (
        <Card>
          <div className="row">
            <Cloud size={21} />
            <h2>Offline & sync</h2>
          </div>
          <p className="small muted">
            Stock, sales, transactions and shop edits save on this device before syncing. Invoices,
            bank requests and account changes require a connection.
          </p>
          <p className="strong">
            {pendingCount ? `${pendingCount} pending changes` : 'No pending changes'}
          </p>
          {syncConflict && (
            <p className="notice amber" role="alert">
              {syncConflict}
            </p>
          )}
          <div className="feature-actions">
            <Button disabled={busy} onClick={() => void run(refresh)}>
              <RefreshCw size={17} /> Sync now
            </Button>
            {pendingCount > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(() =>
                      download(
                        'greenbiz-pending-changes.json',
                        JSON.stringify(
                          {
                            application: 'GreenBiz',
                            shop: workspace?.shop.name,
                            exportedAt: new Date().toISOString(),
                            pending: pendingExport(),
                          },
                          null,
                          2,
                        ),
                      ),
                    )
                  }
                >
                  <Download size={17} /> Export pending
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        'Discard all pending changes for this shop and load server records? Export them first. This cannot be undone.',
                      )
                    )
                      void run(discardPending);
                  }}
                >
                  Discard pending
                </Button>
              </>
            )}
          </div>
          {syncConflict.includes('Session expired') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await reconnect(reconnectPassword);
                  setReconnectPassword('');
                });
              }}
            >
              <Field label="Sign in again · account password">
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={reconnectPassword}
                  onChange={(e) => setReconnectPassword(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={busy || !reconnectPassword}>
                Sign in & sync
              </Button>
            </form>
          )}
        </Card>
      )}
      <Card>
        <div className="row">
          <MessageSquare size={21} />
          <h2>Payment messages</h2>
        </div>
        <p className="small muted">
          Optional Android access imports supported bKash, Nagad, Rocket, Upay and UPI confirmations from
          the last 90 days and can alert you to new receipts. Personal messages, OTPs and promotions
          are filtered on the phone. Only structured records you review and save enter your shop; no
          raw messages go to the server or AI.
        </p>
        {native ? (
          <>
            <p className="small strong">
              {sms?.enabled && sms.sms === 'granted'
                ? 'Message access enabled'
                : 'Message access off'}{' '}
              · {sms?.notifications === 'granted' ? 'Notifications allowed' : 'Notifications off'}
            </p>
            <div className="feature-actions">
              <Button
                disabled={busy}
                variant={sms?.enabled ? 'outline' : 'primary'}
                onClick={() =>
                  void run(async () => {
                    await businessTools.enableSms({ enabled: !sms?.enabled });
                    await loadPermissions();
                  })
                }
              >
                {sms?.enabled ? 'Turn off access' : 'Enable message access'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await businessTools.requestNotifications();
                    await loadPermissions();
                  })
                }
              >
                <Bell size={17} /> Allow alerts
              </Button>
              <Button variant="ghost" onClick={() => void businessTools.openSettings()}>
                Android settings
              </Button>
            </div>
            <p className="small muted">
              Disabling message access stops new-message capture. Previously reviewed records stay
              until you delete them. Import messages from Payments → Transactions.
            </p>
          </>
        ) : (
          <p className="small strong">
            Available in the Android app. You can paste a payment confirmation from Payments →
            Transactions in this browser.
          </p>
        )}
      </Card>
      <Card>
        <div className="row">
          <KeyRound size={21} />
          <h2>GreenBiz AI</h2>
        </div>
        <p className="small good-text strong">
          {managedReady === null
            ? 'AI works online · no setup required'
            : managedReady
              ? 'AI service reachable · managed for you'
              : 'AI connection unavailable right now'}
        </p>
        <p className="small muted">
          Photo recognition, smart checkout and business advice are included through GreenBiz’s
          managed AI. You do not need a business server or API key. Stock, sales, payment records
          and reports stay on this device unless you choose the optional cloud portal. Only the
          selected photo, sale sentence and product names, or business totals are sent when you use
          AI. Daily usage limits apply.
        </p>
        <details className="personal-ai">
          <summary>Advanced: use a personal AI account</summary>
          <p className="small muted">
            Use your own Gemini or OpenRouter account for photos, sale matching and business advice.
            Requests go directly to the selected provider and may use paid credit. Your key is never
            sent to the GreenBiz server.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await saveAiConfig(config, key);
                setConfig(await aiConfig());
                setKey('');
                setSaved('AI settings saved.');
              });
            }}
          >
            <Field label="AI provider">
              <select
                value={config.provider}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    provider: e.target.value as AiConfig['provider'],
                    model: '',
                    hasKey: false,
                  });
                  setKey('');
                  setSaved('');
                }}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </Field>
            <Field
              label="Model (optional)"
              hint={
                config.provider === 'gemini'
                  ? 'Default: gemini-2.5-flash. Use a model available in your account.'
                  : 'Default: google/gemini-2.5-flash. Photos need a vision model.'
              }
            >
              <input
                maxLength={160}
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
              />
            </Field>
            <Field label={config.hasKey ? 'Replace API key (optional)' : 'API key'}>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                maxLength={1000}
                onChange={(e) => setKey(e.target.value)}
                placeholder={config.hasKey ? 'Key saved · hidden' : 'Paste your provider key'}
              />
            </Field>
            <p className="small muted">
              {native
                ? 'The key is encrypted with Android Keystore on this phone, scoped to this account.'
                : 'In the browser, keys stay in memory for this open session only. The Android app stores them encrypted.'}
            </p>
            <div className="feature-actions">
              <Button disabled={busy} type="submit">
                Save AI settings
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                type="button"
                onClick={() =>
                  void run(async () => {
                    await saveAiConfig(config, '', true);
                    setConfig(await aiConfig());
                    setKey('');
                    setSaved('Selected provider key removed.');
                  })
                }
              >
                Remove key
              </Button>
            </div>
            {saved && (
              <p role="status" className="small good-text">
                <ShieldCheck size={15} /> {saved}
              </p>
            )}
          </form>
        </details>
      </Card>
    </>
  );
}
