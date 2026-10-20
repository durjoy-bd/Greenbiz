import { useState } from 'react';
import { Activity as ActivityIcon, ArrowLeft, Download, Search } from 'lucide-react';
import type { Dashboard, Score, Workspace } from '../../../shared/types';
import type { CreditProfile } from '../../../shared/credit-profile';
import { methodLabels } from '../../../shared/finance';
import { Button, Card, FactorBar } from '../../components/UI';
import { useTask } from '../../components/useTask';
import { AnimatedMoney, AnimatedNumber } from '../../components/Experience';
import { csv, download, money, num } from '../../utils';
import { adminCall, go, Header, Kpi, LoadState, RefreshButton, TZ_NOTE, useAdmin, when } from './common';

/** Every shop on the server and its full business records. Each view and export is audited. */
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

interface ShopDetailData {
  shop: ShopSummary;
  workspace: Workspace;
  dashboard: Dashboard;
  indicator: Score;
  creditProfile: CreditProfile;
  orders: { createdAt: string; customer: string; total: number; paid: boolean }[];
}

export function ShopsPage() {
  const onOpen = (id: string) => go('shops/' + id);
  const [query, setQuery] = useState('');
  const { data, error, busy, loadedAt, refresh } = useAdmin<{ shops: ShopSummary[] }>('/api/admin/shops');
  const shops = (data?.shops ?? []).filter((s) =>
    [s.name, s.owner, s.ownerEmail, s.location, s.phone].some((v) => v.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <>
      <Header title="Shops" subtitle={`${data?.shops.length ?? 0} shops on this server · ${TZ_NOTE}`}>
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
        <RefreshButton onClick={refresh} busy={busy} loadedAt={loadedAt} />
      </Header>
      <LoadState error={error} busy={false} retry={refresh} label="shops" />
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
                    {s.ownerSuspended && <span className="pill bad">Owner not active</span>}
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

export function ShopDetail({ id }: { id: string }) {
  const back = () => go('shops');
  const { data, error, busy, refresh } = useAdmin<ShopDetailData>('/api/admin/shops/' + encodeURIComponent(id));
  const [section, setSection] = useState<'summary' | 'stock' | 'sales' | 'money' | 'activity'>('summary');
  const { run } = useTask();
  if (!data) return <LoadState error={error} busy={busy} retry={refresh} label="shop records" />;
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
              const data = await adminCall<unknown>(`/api/admin/shops/${encodeURIComponent(id)}/export`);
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
                <button className="text-button" onClick={() => go('users/' + shop.ownerId)}>{shop.ownerEmail}</button> {shop.ownerSuspended && <span className="pill bad">Not active</span>}
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
