import {
  Camera,
  ReceiptText,
  ShieldCheck,
  ChevronRight,
  TriangleAlert,
  Package,
  ArrowUpRight,
  Settings,
  Bell,
  Download,
  CalendarDays,
  Lock,
  Leaf,
  ChartNoAxesCombined,
} from 'lucide-react';
import { useStore } from '../data/store';
import { dashboard, creditScore } from '../../shared/domain';
import { Card, IconButton, Button, Meter, Status } from '../components/UI';
import { money, num, dateLabel, csv, download } from '../utils';
import { AnimatedMoney, AnimatedNumber } from '../components/Experience';
export type Navigate = (page: string, id?: string) => void;
export function SalesChart({ daily }: { daily: { date: string; value: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.value));
  return (
    <div
      className="chart"
      role="img"
      aria-label={
        'Daily sales: ' + daily.map((x) => dateLabel(x.date) + ' ' + money(x.value)).join(', ')
      }
    >
      <div className="chart-labels">
        <span>{money(max)}</span>
        <span>{money(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="chart-bars">
        {daily.map((x, i) => (
          <div className="chart-column" key={x.date}>
            <div
              className={'chart-bar ' + (i === daily.length - 1 ? 'current' : '')}
              style={{ height: Math.max(1, (x.value / max) * 176) + 'px' }}
              title={dateLabel(x.date) + ': ' + money(x.value)}
            />
            <span>{new Date(x.date).getUTCDate()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
export function ScoreCard({ nav }: { nav: Navigate }) {
  const { workspace: w } = useStore();
  if (!w) return null;
  const s = creditScore(w);
  return (
    <Card className="score-card">
      <div className="row between">
        <span className="muted">Credit score</span>
        <span className="good-text small">Internal business indicator</span>
      </div>
      <div className="score-value">
        <strong>{s.value === null ? '—' : <AnimatedNumber value={s.value} duration={900} />}</strong>
        <span>of 900</span>
        <span className="pill good">{s.label}</span>
      </div>
      <Meter value={s.value} />
      <button className="card-link" onClick={() => nav('growth')}>
        {w.offers.length
          ? `${w.offers.length} financing offers to explore`
          : 'See what builds your score'}
        <ChevronRight size={20} />
      </button>
    </Card>
  );
}
export function Home({ nav }: { nav: Navigate }) {
  const { workspace: w, mode } = useStore();
  if (!w) return null;
  const d = dashboard(w);
  return (
    <>
      <header className="home-header">
        <button className="shop-brand" aria-label="Settings" onClick={() => nav('settings')}>
          <span className="brand-symbol">
            <Leaf size={27} />
          </span>
          <span>
            <h1>{w.shop.name}</h1>
            <small>{w.shop.location || 'Your business, in one place'}</small>
          </span>
        </button>
        <div className="row">
          <IconButton label="Activity and notifications" onClick={() => nav('activity')}>
            <Bell size={21} />
            {w.activity.length > 0 && <i className="notification-dot" />}
          </IconButton>
          <IconButton label="Settings" onClick={() => nav('settings')}>
            <Settings size={20} />
          </IconButton>
        </div>
      </header>
      <div className="sales-hero">
        <div className="row between">
          <span>
            Today’s sales ·{' '}
            {dateLabel(new Date().toISOString(), {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <span className="pill gold">
            <ArrowUpRight size={14} />
            {mode === 'demo' ? 'Sample records' : 'Live records'}
          </span>
        </div>
        <strong>
          <AnimatedMoney value={d.todaySales} />
        </strong>
        <p>
          {/* Every non-cash method (bKash, Nagad, Rocket, bank…) so the two parts add up to the total. */}
          {num(d.todayCount)} sales · Cash {money(d.cash)} · Digital{' '}
          {money(Math.round((d.todaySales - d.cash) * 100) / 100)}
        </p>
      </div>
      <div className="quick-actions">
        <button onClick={() => nav('camera')}>
          <span className="icon-tile amber">
            <Camera />
          </span>
          <b>Snap stock</b>
        </button>
        <button onClick={() => nav('sale')}>
          <span className="icon-tile green">
            <ReceiptText />
          </span>
          <b>Record sale</b>
        </button>
        <button onClick={() => nav('payments')}>
          <span className="icon-tile green">
            <ShieldCheck />
          </span>
          <b>Check TrxID</b>
        </button>
      </div>
      <div className="section-heading">
        <h2>Needs attention</h2>
      </div>
      <Button className="full" variant="outline" onClick={() => nav('finance')}>
        <ChartNoAxesCombined size={19} /> Money, reports & borrowing planner{' '}
        <ChevronRight size={18} />
      </Button>
      <Card className="attention-card">
        <button className="attention-row" onClick={() => nav('payments')}>
          <span className={'icon-tile ' + (d.reviewPayments.length ? 'red' : 'green')}>
            {d.reviewPayments.length ? <TriangleAlert /> : <ShieldCheck />}
          </span>
          <span>
            <b>
              {d.reviewPayments.length
                ? `${d.reviewPayments.length} payments need review`
                : 'Your payments, in order'}
            </b>
            <small>
              {d.reviewPayments.length
                ? 'Check amounts and repeated TrxIDs'
                : 'Record and review incoming payments'}
            </small>
          </span>
          <ChevronRight size={20} />
        </button>
        <button className="attention-row" onClick={() => nav('stock', 'low')}>
          <span className="icon-tile amber">
            <Package />
          </span>
          <span>
            <b>
              {d.lowProducts.length
                ? `${d.lowProducts.length} items running low`
                : w.products.length
                  ? 'Stock levels look healthy'
                  : 'Add your first stock'}
            </b>
            <small>
              {d.lowProducts.length
                ? d.lowProducts
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join(', ')
                : 'Keep a clear view of what’s on your shelves'}
            </small>
          </span>
          <ChevronRight size={20} />
        </button>
      </Card>
      <ScoreCard nav={nav} />
      {w.products.length === 0 && (
        <Button className="full" onClick={() => nav('product')}>
          Add your first item <ChevronRight size={18} />
        </Button>
      )}
      <div className="mobile-only muted center small home-caption">
        GreenBiz · A little clarity. A lot of possibility.
      </div>
    </>
  );
}
export function WebDashboard({ nav }: { nav: Navigate }) {
  const { workspace: w, mode } = useStore();
  if (!w) return null;
  const d = dashboard(w);
  const exportSales = () =>
    download(
      'greenbiz-sales.csv',
      csv([
        ['Date', 'Total (BDT)', 'Profit (BDT)', 'Method', 'Channel'],
        ...w.sales.map((x) => [x.createdAt, x.total, x.profit, x.method, x.channel]),
      ]),
      'text/csv;charset=utf-8',
    );
  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1>Overview</h1>
          <p>
            {dateLabel(new Date().toISOString(), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <div className="row">
          <span className="date-chip">
            <CalendarDays size={18} /> This month
          </span>
          <Button variant="outline" onClick={exportSales}>
            <Download size={18} /> Export
          </Button>
        </div>
      </header>
      <div className="kpi-grid">
        {[
          ['Sales this month', <AnimatedMoney key="m" value={d.monthSales} />, 'From recorded sales'],
          ['Number of sales', <AnimatedNumber key="n" value={d.monthCount} />, 'Every sale, accounted for'],
          ['Digital share', d.digital + '%', 'Non-cash sales this month, as recorded'],
          [
            'Stock value',
            <AnimatedMoney key="s" value={d.stockValue} />,
            `${d.totalProducts} items · ${d.lowProducts.length} running low`,
          ],
        ].map(([title, value, caption]) => (
          <Card key={String(title)}>
            <p className="muted">{title}</p>
            <strong className="kpi-number">{value}</strong>
            <small className="good-text">{caption}</small>
          </Card>
        ))}
      </div>
      <div className="dashboard-middle">
        <Card>
          <h2>Daily sales</h2>
          <p className="muted small">Last {d.daily.length} days · today in dark green</p>
          <SalesChart daily={d.daily} />
        </Card>
        <Card>
          <div className="row between">
            <h2>Payments to check</h2>
            <span className="pill warn">{d.reviewPayments.length} to review</span>
          </div>
          <p className="small muted">
            {mode === 'demo'
              ? 'Fictional sample transactions'
              : 'Manual review · provider integration required for auto-check'}
          </p>
          {w.payments.slice(0, 3).map((p) => (
            <button className="payment-mini" key={p.id} onClick={() => nav('payments')}>
              <span>
                <b>
                  {p.customer} · {p.order}
                </b>
                <small className="mono">
                  {p.trxId} · {money(p.amount)}
                </small>
              </span>
              <Status status={p.status} />
            </button>
          ))}
          {!w.payments.length && <p className="empty-inline">Payment claims appear here.</p>}
          <button className="card-link" onClick={() => nav('payments')}>
            See all payments <ChevronRight size={18} />
          </button>
        </Card>
      </div>
      <div className="dashboard-bottom">
        <Card>
          <h2>Where sales come from</h2>
          <p className="muted small">All recorded channels</p>
          {(['shop', 'facebook', 'website'] as const).map((channel) => {
            const total = w.sales
              .filter((s) => s.channel === channel)
              .reduce((sum, s) => sum + s.total, 0);
            const all = w.sales.reduce((sum, s) => sum + s.total, 0);
            const share = all ? Math.round((total / all) * 100) : 0;
            return (
              <div className="channel" key={channel}>
                <div className="row between">
                  <b>
                    {channel === 'shop'
                      ? 'In the shop'
                      : channel === 'facebook'
                        ? 'Facebook page'
                        : 'Website'}
                  </b>
                  <span>
                    {money(total)} · {share}%
                  </span>
                </div>
                <div className="meter">
                  <span style={{ width: share + '%' }} />
                </div>
              </div>
            );
          })}
        </Card>
        <Card>
          <div className="row between">
            <h2>Running low</h2>
            <span className="pill warn">{d.lowProducts.length} items</span>
          </div>
          {d.lowProducts.slice(0, 5).map((p) => (
            <div className="low-row" key={p.id}>
              <span>{p.name}</span>
              <b className="bad-text">{p.quantity} left</b>
              <Button variant="outline" onClick={() => nav('product', p.id)}>
                Restock
              </Button>
            </div>
          ))}
          {!d.lowProducts.length && <p className="empty-inline">Your stock levels look healthy.</p>}
        </Card>
        <div>
          <ScoreCard nav={nav} />
          <div className="privacy-note">
            <Lock size={16} />{' '}
            {w.shop.shareScore
              ? 'Aggregate sharing is enabled. Manage it in Growth.'
              : 'Your business records are private.'}
          </div>
        </div>
      </div>
    </>
  );
}
