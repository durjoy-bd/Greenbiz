import { useState } from 'react';
import {
  Save,
  Download,
  LogOut,
  Cloud,
  Database,
  Trash2,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Bell,
  Check,
  Leaf,
} from 'lucide-react';
import { useStore } from '../data/store';
import { serverURL } from '../data/api';
import { Button, Card, Field, PageHeader, Empty } from '../components/UI';
import { useTask } from '../components/useTask';
import { download, csv, dateLabel } from '../utils';
import type { Navigate } from './Dashboard';
import { FeatureSettings } from '../components/FeatureSettings';
import { AppearanceSettings } from '../components/AppearanceSettings';
export function Settings({ nav }: { nav: Navigate }) {
  const {
    workspace: w,
    mode,
    user,
    act,
    leave,
    deleteDevice,
    deleteAccount,
    setError,
    refresh,
  } = useStore();
  const [form, setForm] = useState(w?.shop),
    [password, setPassword] = useState(''),
    [deleting, setDeleting] = useState(false);
  const { run, busy } = useTask();
  if (!w || !form) return null;
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your shop, your records, your choices"
        back={() => nav('home')}
      />
      <Card>
        <div className="row">
          <span className="icon-tile green">{mode === 'server' ? <Cloud /> : <Database />}</span>
          <div>
            <h3>
              {mode === 'demo'
                ? 'Sample shop'
                : mode === 'server'
                  ? 'Connected business'
                  : 'Saved on this device'}
            </h3>
            <small className="muted">
              {mode === 'server'
                ? user?.email
                : mode === 'demo'
                  ? 'Fictional data, separate from your own shop'
                  : 'Export a backup regularly. No automatic sync.'}
            </small>
          </div>
        </div>
        {mode === 'server' && <p className="small break muted">{serverURL() || location.origin}</p>}
      </Card>
      <FeatureSettings />
      <AppearanceSettings />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const { name, owner, location, phone, bkash, language } = form;
            await act({
              type: 'shop.update',
              shop: { name, owner, location, phone, bkash, language },
            });
            setError('Shop details saved.');
          });
        }}
      >
        <Card>
          <h2>Shop details</h2>
          <Field label="Shop name">
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Owner name">
            <input
              maxLength={100}
              value={form.owner}
              onChange={(e) => set('owner', e.target.value)}
            />
          </Field>
          <Field label="Shop location">
            <input
              maxLength={160}
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
            />
          </Field>
          <Field label="Phone number">
            <input
              type="tel"
              maxLength={20}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label="bKash receiving number">
            <input
              type="tel"
              maxLength={20}
              value={form.bkash}
              onChange={(e) => set('bkash', e.target.value)}
            />
          </Field>
          <p className="small muted">
            Always check the receiving account before sharing payment instructions.
          </p>
          <Button className="full" type="submit" disabled={busy}>
            <Save size={17} /> Save details
          </Button>
        </Card>
      </form>
      <Card>
        <h2>Your records</h2>
        <button
          className="settings-row"
          onClick={() =>
            void run(() =>
              download(
                'greenbiz-backup-' + new Date().toISOString().slice(0, 10) + '.json',
                JSON.stringify(
                  {
                    application: 'GreenBiz',
                    exportedAt: new Date().toISOString(),
                    mode,
                    workspace: w,
                  },
                  null,
                  2,
                ),
              ),
            )
          }
        >
          <Download size={20} />
          <span>
            <b>Export all records</b>
            <small>Complete JSON backup of this shop</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <button
          className="settings-row"
          onClick={() =>
            void run(() =>
              download(
                'greenbiz-stock.csv',
                csv([
                  ['Name', 'Category', 'Quantity', 'Buy price (BDT)', 'Sell price (BDT)'],
                  ...w.products.map((p) => [p.name, p.category, p.quantity, p.cost, p.price]),
                ]),
                'text/csv',
              ),
            )
          }
        >
          <Download size={20} />
          <span>
            <b>Export stock</b>
            <small>A spreadsheet-friendly CSV</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <button
          className="settings-row"
          onClick={() =>
            void run(() =>
              download(
                'greenbiz-sales.csv',
                csv([
                  ['Date', 'Total (BDT)', 'Profit (BDT)', 'Method', 'Channel'],
                  ...w.sales.map((s) => [s.createdAt, s.total, s.profit, s.method, s.channel]),
                ]),
                'text/csv',
              ),
            )
          }
        >
          <Download size={20} />
          <span>
            <b>Export sales</b>
            <small>Every recorded sale and its gross profit</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <button className="settings-row" onClick={() => nav('activity')}>
          <Bell size={20} />
          <span>
            <b>Activity history</b>
            <small>Changes recorded by your shop</small>
          </span>
          <ChevronRight size={18} />
        </button>
        {mode === 'server' && (
          <button className="settings-row" onClick={() => void run(refresh)}>
            <RefreshCw size={20} />
            <span>
              <b>Refresh from server</b>
              <small>Load the latest business records</small>
            </span>
            <ChevronRight size={18} />
          </button>
        )}
      </Card>
      <Card>
        <div className="row">
          <ShieldCheck size={21} />
          <h2>Privacy, in plain language</h2>
        </div>
        <p className="small muted">
          Device records stay in this app’s private storage. Server records belong to your account.
          Sharing your business indicator only reveals aggregate sales and score to bank users on
          your server.
        </p>
        <p className="small muted">
          GreenBiz AI receives only the selected photo, sale sentence and product names, or business
          totals when you request help. Raw SMS and personal transactions are excluded from advice.
          A personal AI key, if you choose to add one in advanced settings, stays on your device.
        </p>
        <button className="card-link" onClick={() => nav('growth')}>
          Manage score sharing <ChevronRight size={18} />
        </button>
      </Card>
      <Button variant="outline" className="full" disabled={busy} onClick={() => void run(leave)}>
        <LogOut size={18} />
        {mode === 'server' ? 'Sign out' : 'Switch shop'}
      </Button>
      <Button variant="danger" className="full" onClick={() => setDeleting(!deleting)}>
        <Trash2 size={17} />
        {mode === 'server'
          ? 'Delete account'
          : 'Delete this ' + (mode === 'demo' ? 'sample ' : '') + 'shop'}
      </Button>
      {deleting && (
        <Card>
          <h3>This permanently removes your records</h3>
          <p className="small muted">Export your records first. This cannot be undone.</p>
          {mode === 'server' && (
            <Field label="Confirm password">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          <Button
            className="full"
            variant="danger"
            disabled={busy || (mode === 'server' && !password)}
            onClick={() => {
              if (confirm('Permanently delete this shop and its records?'))
                void run(async () => {
                  if (mode === 'server') {
                    await deleteAccount(password);
                  } else await deleteDevice();
                });
            }}
          >
            Permanently delete
          </Button>
        </Card>
      )}
      <div className="about-greenbiz">
        <Leaf size={18} />
        <b>GreenBiz</b>
        <span>2.2.0 · Built for your next chapter</span>
      </div>
    </>
  );
}
export function Activity({ nav }: { nav: Navigate }) {
  const { workspace: w } = useStore();
  if (!w) return null;
  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="A clear record of what changed"
        back={() => nav('home')}
      />
      <Card>
        {w.activity.length ? (
          w.activity
            .slice()
            .reverse()
            .map((a) => (
              <div className="history-row" key={a.id}>
                <span className="icon-tile green">
                  <Check size={19} />
                </span>
                <span>
                  <b>{a.title}</b>
                  <small>{a.detail}</small>
                  <small>
                    {dateLabel(a.createdAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </small>
                </span>
              </div>
            ))
        ) : (
          <Empty
            title="A fresh start"
            detail="Your stock, sale and payment updates will appear here."
          />
        )}
      </Card>
    </>
  );
}
