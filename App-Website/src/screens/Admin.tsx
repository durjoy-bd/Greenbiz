import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity as ActivityIcon,
  ArrowLeft,
  Building2,
  Copy,
  Download,
  KeyRound,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ScrollText,
  Search,
  ServerCog,
  ShieldCheck,
  Store,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import type { Dashboard, Score, Workspace } from '../../shared/types';
import type { CreditProfile } from '../../shared/credit-profile';
import { methodLabels } from '../../shared/finance';
import { api } from '../data/api';
import { useStore } from '../data/store';
import { Button, Card, Empty, FactorBar, Field, IconButton, Logo, Sheet } from '../components/UI';
import { useTask } from '../components/useTask';
import { AnimatedMoney, AnimatedNumber } from '../components/Experience';
import { csv, dateLabel, download, money, num } from '../utils';

interface AdminUser {
  id: string;
  email: string;
}
interface ShopSummary {
  id: string;
  ownerId: string;
  ownerEmail: string;
  ownerSuspended: boolean;
  updatedAt: string;
  name: string;
  owner: string;
  location: string;
  phone: string;
  createdAt: string;
  lastActivity: string;
  products: number;
  lowStock: number;
  stockValue: number;
  salesCount: number;
  totalSales: number;
  monthSales: number;
  todaySales: number;
  transactions: number;
  paymentsToReview: number;
  indicator: number | null;
  creditProfile: number;
  shareScore: boolean;
}
interface Overview {
  accounts: { merchants: number; banks: number; suspended: number; signedIn: number; administrators: number };
  totals: { shops: number; products: number; stockValue: number; salesCount: number; totalSales: number; monthSales: number; todaySales: number; transactions: number; paymentsToReview: number; activeShops7d: number };
  daily: { date: string; sales: number; signups: number }[];
}
interface Account {
  id: string;
  email: string;
  role: 'merchant' | 'bank';
  createdAt: string;
  lastLoginAt: string | null;
  suspendedAt: string | null;
  signedIn: boolean;
  shops: { id: string; name: string }[];
}
interface ShopDetail {
  shop: ShopSummary;
  workspace: Workspace;
  dashboard: Dashboard;
  indicator: Score;
  creditProfile: CreditProfile;
  orders: { createdAt: string; customer: string; total: number; paid: boolean }[];
}
type Tab = 'overview' | 'shops' | 'accounts' | 'activity' | 'audit' | 'system';
const when = (iso: string | null) =>
  iso ? dateLabel(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function AdminApp() {
  const [admin, setAdmin] = useState<AdminUser | null | undefined>(undefined);
  useEffect(() => {
    api<{ admin: AdminUser | null }>('/api/admin/me', undefined, undefined, '')
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(null));
  }, []);
  if (admin === undefined)
    return (
      <div className="launch">
        <Logo />
        <span className="loading-line" />
        <p>Opening the admin console…</p>
      </div>
    );
  return admin ? <AdminShell admin={admin} onSignOut={() => setAdmin(null)} /> : <AdminLogin onSignedIn={setAdmin} />;
}

function AdminLogin({ onSignedIn }: { onSignedIn: (admin: AdminUser) => void }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const { run, busy } = useTask();
  return (
    <main className="auth-page admin-login">
      <Logo />
      <span className="eyebrow">GREENBIZ ADMIN CONSOLE</span>
      <h1>Administrator sign-in</h1>
      <p className="muted">For the people who run this GreenBiz server. Shop owners sign in from the main app.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api<{ admin: AdminUser }>('/api/admin/login', form, undefined, '');
            onSignedIn(r.admin);
          });
        }}
      >
        <Card>
          <Field label="Administrator email">
            <input type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </Card>
        <Button className="full" type="submit" disabled={busy}>
          <ShieldCheck size={18} /> {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="fineprint">Every view of a shop’s records and every account change is recorded in the audit log.</p>
      <a className="text-button" href="#/">
        Back to GreenBiz
      </a>
    </main>
  );
}

function AdminShell({ admin, onSignOut }: { admin: AdminUser; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [shopId, setShopId] = useState('');
  const { run } = useTask();
  const tabs: { id: Tab; label: string; Icon: typeof Store }[] = [
    { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
    { id: 'shops', label: 'Shops', Icon: Store },
    { id: 'accounts', label: 'Accounts', Icon: Users },
    { id: 'activity', label: 'Activity', Icon: ActivityIcon },
    { id: 'audit', label: 'Audit log', Icon: ScrollText },
    { id: 'system', label: 'System', Icon: ServerCog },
  ];
  const open = (id: string) => {
    setShopId(id);
    setTab('shops');
  };
  return (
    <div className="admin-page">
      <header className="bank-top admin-top">
        <Logo invert />
        <span className="bank-label">Admin</span>
        <nav aria-label="Admin sections">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => {
                setTab(id);
                setShopId('');
              }}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
        <span className="bank-account">{admin.email}</span>
        <IconButton
          label="Sign out"
          onClick={() =>
            void run(async () => {
              await api('/api/admin/logout', {}, undefined, '');
              onSignOut();
            })
          }
        >
          <LogOut size={18} />
        </IconButton>
      </header>
      <main className="admin-content" key={tab + shopId}>
        {tab === 'overview' && <OverviewTab onOpenShop={open} goto={setTab} />}
        {tab === 'shops' && (shopId ? <ShopDetailView id={shopId} back={() => setShopId('')} /> : <ShopsTab onOpen={setShopId} />)}
        {tab === 'accounts' && <AccountsTab onOpenShop={open} />}
        {tab === 'activity' && <ActivityTab onOpenShop={open} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'system' && <SystemTab />}
      </main>
    </div>
  );
}

/** Loads one admin endpoint; refresh() reloads it. */
function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const { run, busy } = useTask();
  const load = () =>
    void run(async () => {
      setData(await api<T>(path, undefined, undefined, ''));
    });
  useEffect(load, [path]);
  return { data, busy, refresh: load };
}

function Header({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="admin-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
function Kpi({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <Card className="admin-kpi">
      <span className="muted small">{label}</span>
      <strong>{children}</strong>
      {note && <small className="muted">{note}</small>}
    </Card>
  );
}
function Bars({ values, label, format }: { values: { date: string; value: number }[]; label: string; format: (n: number) => string }) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <div className="cash-chart admin-chart" role="img" aria-label={label}>
      {values.map((v) => (
        <div className="cash-column" key={v.date} title={`${dateLabel(v.date + 'T06:00:00Z')}: ${format(v.value)}`}>
          <div className="cash-bars">
            <i style={{ height: Math.max(v.value ? 3 : 0, (v.value / max) * 100) + '%' }} />
          </div>
          <small>{Number(v.date.slice(8))}</small>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ onOpenShop, goto }: { onOpenShop: (id: string) => void; goto: (tab: Tab) => void }) {
  const { data, busy, refresh } = useAdmin<Overview>('/api/admin/overview');
  const shops = useAdmin<{ shops: ShopSummary[] }>('/api/admin/shops');
  if (!data) return <p className="muted">{busy ? 'Loading the platform overview…' : 'Overview unavailable.'}</p>;
  const { totals, accounts } = data;
  const top = [...(shops.data?.shops ?? [])].sort((a, b) => b.monthSales - a.monthSales).slice(0, 6);
  return (
    <>
      <Header title="Platform overview" subtitle="Every shop on this GreenBiz server, at a glance">
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </Header>
      <div className="admin-kpis">
        <Kpi label="Shops" note={`${totals.activeShops7d} active in the last 7 days`}>
          <AnimatedNumber value={totals.shops} />
        </Kpi>
        <Kpi label="Shop owners" note={`${accounts.signedIn} signed in · ${accounts.suspended} suspended`}>
          <AnimatedNumber value={accounts.merchants} />
        </Kpi>
        <Kpi label="Sales today" note="All shops, Dhaka time">
          <AnimatedMoney value={totals.todaySales} />
        </Kpi>
        <Kpi label="Sales this month" note={`${num(totals.salesCount)} sales recorded in total`}>
          <AnimatedMoney value={totals.monthSales} />
        </Kpi>
        <Kpi label="All-time recorded sales">
          <AnimatedMoney value={totals.totalSales} />
        </Kpi>
        <Kpi label="Stock value" note={`${num(totals.products)} products tracked`}>
          <AnimatedMoney value={totals.stockValue} />
        </Kpi>
        <Kpi label="Payment records" note={`${totals.paymentsToReview} invoice claims awaiting review`}>
          <AnimatedNumber value={totals.transactions} />
        </Kpi>
        <Kpi label="Bank users · admins">
          {accounts.banks} · {accounts.administrators}
        </Kpi>
      </div>
      <div className="admin-two">
        <Card>
          <h2>Sales across all shops</h2>
          <p className="small muted">Last 30 days, recorded sales in BDT</p>
          <Bars values={data.daily.map((d) => ({ date: d.date, value: d.sales }))} label="Daily sales across all shops" format={money} />
        </Card>
        <Card>
          <h2>New accounts</h2>
          <p className="small muted">Sign-ups per day, last 30 days</p>
          <Bars values={data.daily.map((d) => ({ date: d.date, value: d.signups }))} label="Daily sign-ups" format={(n) => `${n} sign-ups`} />
        </Card>
      </div>
      <Card>
        <div className="row between">
          <h2>Top shops this month</h2>
          <button className="text-button" onClick={() => goto('shops')}>
            All shops
          </button>
        </div>
        {top.length ? (
          top.map((shop) => (
            <button className="admin-row" key={shop.id} onClick={() => onOpenShop(shop.id)}>
              <span className="icon-tile green">
                <Store size={18} />
              </span>
              <span>
                <b>{shop.name}</b>
                <small className="muted">
                  {shop.ownerEmail} · {shop.location || 'No location'}
                </small>
              </span>
              <strong>{money(shop.monthSales)}</strong>
            </button>
          ))
        ) : (
          <Empty title="No shops yet" detail="Shops appear here when owners create an account on this server." />
        )}
      </Card>
    </>
  );
}

function ShopsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const { data, busy, refresh } = useAdmin<{ shops: ShopSummary[] }>('/api/admin/shops');
  const shops = (data?.shops ?? []).filter((s) =>
    [s.name, s.owner, s.ownerEmail, s.location, s.phone].some((v) => v.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <>
      <Header title="Shops" subtitle={`${data?.shops.length ?? 0} shops on this server`}>
        <Button
          variant="outline"
          disabled={!shops.length}
          onClick={() =>
            void download(
              'greenbiz-shops.csv',
              csv([
                ['Shop', 'Owner', 'Owner email', 'Location', 'Phone', 'Products', 'Stock value', 'Sales', 'Month sales', 'All sales', 'Indicator', 'Credit profile', 'Last activity'],
                ...shops.map((s) => [s.name, s.owner, s.ownerEmail, s.location, s.phone, s.products, s.stockValue, s.salesCount, s.monthSales, s.totalSales, s.indicator ?? '', s.creditProfile, s.lastActivity]),
              ]),
              'text/csv',
            )
          }
        >
          <Download size={16} /> Export CSV
        </Button>
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} />
        </Button>
      </Header>
      <label className="search">
        <Search size={18} />
        <input aria-label="Search shops" placeholder="Search by shop, owner, email, phone or location" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Card className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Products</th>
              <th>Sales</th>
              <th>This month</th>
              <th>All time</th>
              <th>Scores</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {shops.map((s) => (
              <tr key={s.id} onClick={() => onOpen(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(s.id)}>
                <td>
                  <b>{s.name}</b>
                  <small>
                    {s.ownerEmail}
                    {s.ownerSuspended && <span className="pill bad">Suspended</span>}
                  </small>
                </td>
                <td>
                  {s.products}
                  {s.lowStock > 0 && <small className="bad-text">{s.lowStock} low</small>}
                </td>
                <td>{num(s.salesCount)}</td>
                <td>{money(s.monthSales)}</td>
                <td>{money(s.totalSales)}</td>
                <td>
                  {s.creditProfile}/100
                  <small>{s.indicator ?? '—'} / 900</small>
                </td>
                <td>{when(s.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shops.length && <p className="empty-inline">{busy ? 'Loading shops…' : 'No shops match.'}</p>}
      </Card>
    </>
  );
}

function ShopDetailView({ id, back }: { id: string; back: () => void }) {
  const { data } = useAdmin<ShopDetail>('/api/admin/shops/' + encodeURIComponent(id));
  const [section, setSection] = useState<'summary' | 'stock' | 'sales' | 'money' | 'activity'>('summary');
  const { run } = useTask();
  if (!data) return <p className="muted">Loading shop records…</p>;
  const { shop, workspace: w, dashboard: d, creditProfile: p } = data;
  return (
    <>
      <button className="text-button admin-back" onClick={back}>
        <ArrowLeft size={16} /> All shops
      </button>
      <Header title={shop.name} subtitle={`${shop.owner || 'Owner not set'} · ${shop.ownerEmail} · ${shop.location || 'No location'}${shop.phone ? ' · ' + shop.phone : ''}`}>
        <Button
          variant="outline"
          onClick={() =>
            void run(async () => {
              const data = await api<unknown>(`/api/admin/shops/${encodeURIComponent(id)}/export`, undefined, undefined, '');
              await download(`greenbiz-${shop.name.replace(/\W+/g, '-').toLowerCase()}.json`, JSON.stringify(data, null, 2));
            })
          }
        >
          <Download size={16} /> Export records
        </Button>
      </Header>
      <div className="admin-kpis">
        <Kpi label="Sales today" note={`${d.todayCount} sales`}>
          <AnimatedMoney value={d.todaySales} />
        </Kpi>
        <Kpi label="This month" note={`${d.monthCount} sales · ${money(d.profit)} gross profit`}>
          <AnimatedMoney value={d.monthSales} />
        </Kpi>
        <Kpi label="Stock value" note={`${d.totalProducts} products · ${d.lowProducts.length} low`}>
          <AnimatedMoney value={d.stockValue} />
        </Kpi>
        <Kpi label="Credit profile" note={`${p.band} · indicator ${data.indicator.value ?? '—'}/900`}>
          <AnimatedNumber value={p.score} />
        </Kpi>
      </div>
      <div className="segments admin-sections">
        {(
          [
            ['summary', 'Summary'],
            ['stock', `Stock · ${w.products.length}`],
            ['sales', `Sales · ${w.sales.length}`],
            ['money', `Payments · ${(w.transactions ?? []).length + w.payments.length}`],
            ['activity', 'Activity'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
      </div>
      {section === 'summary' && (
        <div className="admin-two">
          <Card>
            <h2>Credit profile · {p.score}/100</h2>
            {p.factors.map((f) => (
              <FactorBar key={f.name} title={f.title} score={f.score} weight={f.weight} label={f.label} />
            ))}
            {p.risks.length > 0 && (
              <ul className="tip-list">
                {p.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2>Shop details</h2>
            <dl className="transaction-detail">
              <dt>Owner account</dt>
              <dd>
                {shop.ownerEmail} {shop.ownerSuspended && <span className="pill bad">Suspended</span>}
              </dd>
              <dt>Created</dt>
              <dd>{when(shop.createdAt)}</dd>
              <dt>Last change</dt>
              <dd>{when(shop.updatedAt)}</dd>
              <dt>bKash number</dt>
              <dd>{w.shop.bkash || '—'}</dd>
              <dt>Bank sharing</dt>
              <dd>{shop.shareScore ? 'Consented' : 'Off'}</dd>
              <dt>Invoices</dt>
              <dd>
                {data.orders.length} ({data.orders.filter((o) => o.paid).length} with payment claims)
              </dd>
              <dt>Offers received</dt>
              <dd>{w.offers.length}</dd>
              <dt>Payments to review</dt>
              <dd>{d.reviewPayments.length}</dd>
            </dl>
          </Card>
        </div>
      )}
      {section === 'stock' && (
        <Card className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>In stock</th>
                <th>Buy</th>
                <th>Sell</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {w.products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <b>{product.name}</b>
                    {product.quantity <= product.lowAt && <small className="bad-text">Low · reminder at {product.lowAt}</small>}
                  </td>
                  <td>{product.category}</td>
                  <td>
                    {product.quantity} {product.unit}
                  </td>
                  <td>{money(product.cost)}</td>
                  <td>{money(product.price)}</td>
                  <td>{when(product.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!w.products.length && <p className="empty-inline">No products recorded.</p>}
        </Card>
      )}
      {section === 'sales' && (
        <Card className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Items</th>
                <th>Customer</th>
                <th>Paid by</th>
                <th>Total</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {[...w.sales]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 300)
                .map((sale) => (
                  <tr key={sale.id}>
                    <td>{when(sale.createdAt)}</td>
                    <td>{sale.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}</td>
                    <td>{sale.customer || 'Walk-in customer'}</td>
                    <td>
                      {methodLabels[sale.method]}
                      {sale.transactionId && <small>linked payment</small>}
                    </td>
                    <td>{money(sale.total)}</td>
                    <td>{money(sale.profit)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!w.sales.length && <p className="empty-inline">No sales recorded.</p>}
          {w.sales.length > 300 && <p className="small muted">Showing the latest 300. Export records for everything.</p>}
        </Card>
      )}
      {section === 'money' && (
        <>
          <Card className="admin-table-wrap">
            <h2>Payment records</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Direction</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Counterparty</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...(w.transactions ?? [])]
                  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                  .slice(0, 300)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{when(t.occurredAt)}</td>
                      <td>{t.direction === 'in' ? 'Money in' : 'Money out'}</td>
                      <td>
                        {methodLabels[t.method]}
                        <small>{t.source === 'sms' ? 'SMS import' : 'Manual'}</small>
                      </td>
                      <td className="mono">{t.reference || '—'}</td>
                      <td>{t.party || '—'}</td>
                      <td>{t.currency === 'INR' ? 'INR ' + t.amount.toFixed(2) : money(t.amount)}</td>
                      <td>{t.linkedSaleId ? 'Linked to sale' : t.business ? 'Business' : 'Personal'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!(w.transactions ?? []).length && <p className="empty-inline">No payment records.</p>}
          </Card>
          <Card className="admin-table-wrap">
            <h2>Invoice payment claims</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>TrxID</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {w.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{when(payment.createdAt)}</td>
                    <td>{payment.customer}</td>
                    <td className="mono">{payment.trxId}</td>
                    <td>{money(payment.amount)}</td>
                    <td>{payment.status.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!w.payments.length && <p className="empty-inline">No invoice claims.</p>}
          </Card>
        </>
      )}
      {section === 'activity' && (
        <Card>
          {[...w.activity].reverse().map((a) => (
            <div className="history-row" key={a.id}>
              <span className="icon-tile green">
                <ActivityIcon size={17} />
              </span>
              <span>
                <b>{a.title}</b>
                <small>{a.detail}</small>
                <small>{when(a.createdAt)}</small>
              </span>
            </div>
          ))}
          {!w.activity.length && <p className="empty-inline">No activity yet.</p>}
        </Card>
      )}
    </>
  );
}

function AccountsTab({ onOpenShop }: { onOpenShop: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const { data, busy, refresh } = useAdmin<{ users: Account[] }>('/api/admin/users');
  const admins = useAdmin<{ administrators: { id: string; email: string; createdAt: string; lastLoginAt: string | null }[] }>('/api/admin/administrators');
  const { run, busy: working } = useTask();
  const { setError } = useStore();
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [bank, setBank] = useState({ email: '', password: '' });
  const [newAdmin, setNewAdmin] = useState({ email: '', password: '' });
  const users = (data?.users ?? []).filter((u) => u.email.toLowerCase().includes(query.toLowerCase()) || u.shops.some((s) => s.name.toLowerCase().includes(query.toLowerCase())));
  const act = (work: () => Promise<void>, done: string) =>
    void run(async () => {
      await work();
      setError(done);
      refresh();
    });
  return (
    <>
      <Header title="Accounts" subtitle="Shop owners and bank users on this server">
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </Header>
      <label className="search">
        <Search size={18} />
        <input aria-label="Search accounts" placeholder="Search by email or shop name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Card className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Shops</th>
              <th>Joined</th>
              <th>Last sign-in</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <b>{user.email}</b>
                  <small>{user.role === 'bank' ? 'Bank user' : 'Shop owner'}</small>
                </td>
                <td>
                  {user.shops.map((shop) => (
                    <button key={shop.id} className="text-button" onClick={() => onOpenShop(shop.id)}>
                      {shop.name}
                    </button>
                  ))}
                  {!user.shops.length && '—'}
                </td>
                <td>{when(user.createdAt)}</td>
                <td>{when(user.lastLoginAt)}</td>
                <td>{user.suspendedAt ? <span className="pill bad">Suspended</span> : user.signedIn ? <span className="pill good">Signed in</span> : <span className="pill">Active</span>}</td>
                <td>
                  <div className="admin-actions">
                    <IconButton
                      label={user.suspendedAt ? 'Restore account' : 'Suspend account'}
                      disabled={working}
                      onClick={() => {
                        if (user.suspendedAt || confirm(`Suspend ${user.email}? They are signed out and cannot sign in until restored.`))
                          act(() => api(`/api/admin/users/${user.id}/suspend`, { suspended: !user.suspendedAt }, undefined, ''), user.suspendedAt ? 'Account restored.' : 'Account suspended.');
                      }}
                    >
                      {user.suspendedAt ? <UserCheck size={17} /> : <UserX size={17} />}
                    </IconButton>
                    <IconButton label="Sign out everywhere" disabled={working} onClick={() => act(() => api(`/api/admin/users/${user.id}/sign-out`, {}, undefined, ''), 'Signed out on every device.')}>
                      <LogOut size={17} />
                    </IconButton>
                    <IconButton
                      label="Reset password"
                      disabled={working}
                      onClick={() => {
                        if (confirm(`Reset the password for ${user.email}? Their current password stops working immediately.`))
                          void run(async () => {
                            const r = await api<{ temporaryPassword: string }>(`/api/admin/users/${user.id}/reset-password`, {}, undefined, '');
                            setSecret({ email: user.email, password: r.temporaryPassword });
                          });
                      }}
                    >
                      <KeyRound size={17} />
                    </IconButton>
                    <IconButton
                      label="Delete account"
                      disabled={working}
                      onClick={() => {
                        const typed = prompt(`Permanently delete ${user.email} and all of its shops? Type the email to confirm.`);
                        if (typed) act(() => api(`/api/admin/users/${user.id}`, { email: typed.trim() }, 'DELETE', ''), 'Account deleted.');
                      }}
                    >
                      <Trash2 size={17} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && <p className="empty-inline">{busy ? 'Loading accounts…' : 'No accounts match.'}</p>}
      </Card>
      <div className="admin-two">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api('/api/admin/banks', bank, undefined, '');
              setBank({ email: '', password: '' });
            }, 'Bank user created.');
          }}
        >
          <Card>
            <div className="row">
              <Building2 size={20} />
              <h2>Add a bank user</h2>
            </div>
            <p className="small muted">Bank users see only shops that chose to share their score, and can send offers.</p>
            <Field label="Bank user email">
              <input type="email" required value={bank.email} onChange={(e) => setBank({ ...bank, email: e.target.value })} />
            </Field>
            <Field label="Initial password" hint="10+ characters with three of: lowercase, uppercase, numbers, symbols.">
              <input type="password" autoComplete="new-password" required value={bank.password} onChange={(e) => setBank({ ...bank, password: e.target.value })} />
            </Field>
            <Button type="submit" disabled={working}>
              Create bank user
            </Button>
          </Card>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api('/api/admin/administrators', newAdmin, undefined, '');
              setNewAdmin({ email: '', password: '' });
              admins.refresh();
            }, 'Administrator added.');
          }}
        >
          <Card>
            <div className="row">
              <ShieldCheck size={20} />
              <h2>Administrators</h2>
            </div>
            {(admins.data?.administrators ?? []).map((a) => (
              <div className="payer-row" key={a.id}>
                <span>{a.email}</span>
                <small className="muted">last sign-in {when(a.lastLoginAt)}</small>
              </div>
            ))}
            <Field label="New administrator email">
              <input type="email" required value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} />
            </Field>
            <Field label="Initial password">
              <input type="password" autoComplete="new-password" required value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} />
            </Field>
            <Button type="submit" variant="outline" disabled={working}>
              Add administrator
            </Button>
          </Card>
        </form>
      </div>
      {secret && (
        <Sheet title="Temporary password" onClose={() => setSecret(null)}>
          <p className="small muted">
            Give this to <b>{secret.email}</b> privately. It is shown only once; ask them to change it in Settings after
            signing in. All their devices have been signed out.
          </p>
          <div className="secret-box">
            <code>{secret.password}</code>
            <IconButton label="Copy password" onClick={() => void navigator.clipboard?.writeText(secret.password)}>
              <Copy size={17} />
            </IconButton>
          </div>
          <Button className="full" onClick={() => setSecret(null)}>
            Done
          </Button>
        </Sheet>
      )}
    </>
  );
}

function ActivityTab({ onOpenShop }: { onOpenShop: (id: string) => void }) {
  const { data, busy, refresh } = useAdmin<{ activity: { id: string; title: string; detail: string; createdAt: string; shopId: string; shopName: string; ownerEmail: string }[] }>('/api/admin/activity');
  return (
    <>
      <Header title="Activity" subtitle="The latest changes recorded by every shop">
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </Header>
      <Card>
        {(data?.activity ?? []).map((a) => (
          <button className="admin-row" key={a.shopId + a.id} onClick={() => onOpenShop(a.shopId)}>
            <span className="icon-tile green">
              <ActivityIcon size={17} />
            </span>
            <span>
              <b>
                {a.title} · {a.shopName}
              </b>
              <small className="muted">{a.detail}</small>
            </span>
            <small className="muted">{when(a.createdAt)}</small>
          </button>
        ))}
        {!data?.activity.length && <p className="empty-inline">{busy ? 'Loading…' : 'No activity yet.'}</p>}
      </Card>
    </>
  );
}

function AuditTab() {
  const { data, busy, refresh } = useAdmin<{ audit: { id: string; adminEmail: string; action: string; target: string; detail: string; createdAt: string }[] }>('/api/admin/audit');
  return (
    <>
      <Header title="Audit log" subtitle="Every administrator sign-in, record view and account change">
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </Header>
      <Card className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Administrator</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {(data?.audit ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{when(entry.createdAt)}</td>
                <td>{entry.adminEmail}</td>
                <td>
                  <span className="pill">{entry.action}</span>
                </td>
                <td>{entry.detail || entry.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function SystemTab() {
  const { data, busy, refresh } = useAdmin<{ version: string; node: string; uptimeSeconds: number; memoryMb: number; databaseBytes: number; publicOrigin: string; transport: string; aiConfigured: boolean; serverTime: string }>('/api/admin/system');
  const [form, setForm] = useState({ current: '', password: '' });
  const { run, busy: saving } = useTask();
  const { setError } = useStore();
  const uptime = data ? `${Math.floor(data.uptimeSeconds / 86400)}d ${Math.floor((data.uptimeSeconds % 86400) / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m` : '';
  return (
    <>
      <Header title="System" subtitle="This GreenBiz server">
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </Header>
      {data && data.transport === 'http' && (
        <div className="notice amber">
          <ShieldCheck size={19} />
          <span>
            This server runs over plain HTTP, so passwords travel unencrypted. Point a domain at the server and switch on
            HTTPS before inviting real shop owners. The Android app also requires HTTPS to sign in.
          </span>
        </div>
      )}
      <div className="admin-two">
        <Card>
          <h2>Server</h2>
          {data ? (
            <dl className="transaction-detail">
              <dt>Address</dt>
              <dd>{data.publicOrigin}</dd>
              <dt>Connection</dt>
              <dd>{data.transport === 'https' ? 'HTTPS (encrypted)' : 'HTTP (not encrypted)'}</dd>
              <dt>Version</dt>
              <dd>{data.version}</dd>
              <dt>Runtime</dt>
              <dd>Node {data.node}</dd>
              <dt>Uptime</dt>
              <dd>{uptime}</dd>
              <dt>Memory</dt>
              <dd>{data.memoryMb} MB</dd>
              <dt>Database</dt>
              <dd>{(data.databaseBytes / 1048576).toFixed(2)} MB · SQLite</dd>
              <dt>Server AI</dt>
              <dd>{data.aiConfigured ? 'Configured' : 'Not configured (the app uses GreenBiz managed AI)'}</dd>
              <dt>Server time</dt>
              <dd>{when(data.serverTime)}</dd>
            </dl>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/api/admin/password', form, undefined, '');
              setForm({ current: '', password: '' });
              setError('Password changed. Other administrator sessions were signed out.');
            });
          }}
        >
          <Card>
            <div className="row">
              <KeyRound size={20} />
              <h2>Change your password</h2>
            </div>
            <Field label="Current password">
              <input type="password" autoComplete="current-password" required value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </Field>
            <Field label="New password" hint="10+ characters with three of: lowercase, uppercase, numbers, symbols.">
              <input type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Button type="submit" disabled={saving}>
              Change password
            </Button>
          </Card>
        </form>
      </div>
    </>
  );
}
