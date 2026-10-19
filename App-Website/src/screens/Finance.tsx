import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Landmark,
  ReceiptText,
  Shield,
  TrendingUp,
} from 'lucide-react';
import {
  financeReport,
  periodDates,
  presetDates,
  periodLabels,
  borrowingEstimate,
  methodLabels,
  monthlyBusinessRevenue,
  shiftDate,
  type PeriodPreset,
} from '../../shared/finance';
import { businessDate } from '../../shared/domain';
import { useStore } from '../data/store';
import { Button, Card, Field, PageHeader } from '../components/UI';
import { useTask } from '../components/useTask';
import { money, csv, download, dateLabel } from '../utils';
import type { Navigate } from './Dashboard';
import { AnimatedMoney } from '../components/Experience';

const presets: PeriodPreset[] = ['7', '30', 'week', 'month', 'lastMonth', '90', 'year', 'pickMonth', 'custom'];
const changeText = (change: number | null) =>
  change === null ? 'no previous data' : `${change >= 0 ? '+' : ''}${change}%`;

export function Finance({ nav }: { nav: Navigate }) {
  const { workspace: w } = useStore(),
    { run, busy } = useTask();
  const [period, setPeriod] = useState<PeriodPreset>('month'),
    [custom, setCustom] = useState(periodDates(30)),
    [month, setMonth] = useState(businessDate(new Date()).slice(0, 7)),
    [rate, setRate] = useState(12),
    [months, setMonths] = useState(36),
    [share, setShare] = useState(15);
  if (!w) return null;
  const dates =
    period === 'custom' ? { ...custom, label: 'Custom range' } : presetDates(period, new Date(), month);
  let r: ReturnType<typeof financeReport>;
  try {
    r = financeReport(w, dates.from, dates.to);
  } catch (e) {
    return (
      <>
        <PageHeader title="Business reports" back={() => nav('home')} />
        <p role="alert">{e instanceof Error ? e.message : 'Choose valid dates.'}</p>
        <Button
          onClick={() => {
            setPeriod('month');
            setCustom(periodDates(30));
          }}
        >
          Reset dates
        </Button>
      </>
    );
  }
  const { monthlyRevenue, observedDays } = monthlyBusinessRevenue(w);
  const estimate = borrowingEstimate(monthlyRevenue, rate, months, share);
  const bucketLabel = (b: (typeof r.buckets)[number]) =>
    r.bucket === 'month'
      ? dateLabel(b.from + 'T06:00:00Z', { month: 'short' })
      : dateLabel(b.from + 'T06:00:00Z');
  const chart = r.buckets.map((b) => ({ label: bucketLabel(b), income: b.income, expenses: b.expenses }));
  const max = Math.max(1, ...chart.flatMap((d) => [d.income, d.expenses]));
  const bestName = r.bucket === 'day' ? 'Best day' : r.bucket === 'week' ? 'Best week' : 'Best month';
  return (
    <>
      <PageHeader
        title="Business reports"
        subtitle="Your money, with a little more perspective"
        back={() => nav('home')}
        action={
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() =>
                download(
                  'greenbiz-cashflow.csv',
                  csv([
                    ['Date', 'Direction', 'Amount (BDT)', 'Method', 'Source', 'Payer / payee', 'Reference'],
                    ...r.rows.map((row) => [
                      row.date,
                      row.direction,
                      row.amount,
                      methodLabels[row.method],
                      row.source,
                      row.party,
                      row.reference,
                    ]),
                  ]),
                  'text/csv',
                ),
              )
            }
          >
            <Download size={18} />
            <span className="desktop-label">Export</span>
          </Button>
        }
      />
      <div className="chips" aria-label="Report period">
        {presets.map((id) => (
          <button
            key={id}
            className={'chip ' + (period === id ? 'active' : '')}
            onClick={() => setPeriod(id)}
          >
            {periodLabels[id]}
          </button>
        ))}
      </div>
      {period === 'pickMonth' && (
        <Card>
          <Field label="Month">
            <input
              type="month"
              value={month}
              max={businessDate(new Date()).slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </Field>
        </Card>
      )}
      {period === 'custom' && (
        <Card>
          <div className="form-grid">
            <Field label="From date">
              <input
                type="date"
                value={custom.from}
                max={custom.to}
                min={shiftDate(custom.to, -365)}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
              />
            </Field>
            <Field label="To date">
              <input
                type="date"
                value={custom.to}
                min={custom.from}
                max={businessDate(new Date())}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
              />
            </Field>
          </div>
        </Card>
      )}
      <p className="small muted">
        {dates.label} · {r.from} — {r.to} · business records in BDT
      </p>
      <Card className="finance-hero">
        <span className="eyebrow">NET CASHFLOW</span>
        <strong className="finance-total">
          <AnimatedMoney value={r.net} />
        </strong>
        <div className="finance-split">
          <span>
            <ArrowDownLeft size={17} /> Money in <b>{money(r.income)}</b>
          </span>
          <span>
            <ArrowUpRight size={17} /> Money out <b>{money(r.expenses)}</b>
          </span>
        </div>
        <p className="small">
          {r.change === null
            ? 'No incoming money recorded in the previous period.'
            : `${r.change >= 0 ? '+' : ''}${r.change}% incoming money versus the previous ${r.days} days.`}
        </p>
      </Card>
      <Card>
        <h2>Business overview</h2>
        <p className="small muted">Business payments only · {dates.label}</p>
        <div className="overview-grid">
          <div>
            <small>Average sale</small>
            <b>{money(r.averageInflow)}</b>
            <small>{r.inflowCount} payments in</small>
          </div>
          <div>
            <small>{bestName}</small>
            <b>{r.best ? money(r.best.income) : 'No data'}</b>
            <small>{r.best ? bucketLabel(r.best) : '—'}</small>
          </div>
          <div>
            <small>Top method</small>
            <b>{r.topMethod ? methodLabels[r.topMethod.method] : 'No data'}</b>
            <small>{r.topMethod ? money(r.topMethod.value) : '—'}</small>
          </div>
          <div>
            <small>Top payer</small>
            <b>{r.payers[0]?.name ?? 'No data'}</b>
            <small>{r.payers[0] ? money(r.payers[0].value) : '—'}</small>
          </div>
        </div>
        <p className="small muted">
          Compared with the previous period ({r.previousFrom} — {r.previousTo}): money in{' '}
          {money(r.previousIncome)} ({changeText(r.change)}), money out {money(r.previousExpenses)} (
          {changeText(r.expenseChange)}).
        </p>
      </Card>
      <Card>
        <div className="row between">
          <h2>Cash flow</h2>
          <span className="small muted">
            {r.bucket === 'day' ? 'Day by day' : r.bucket === 'week' ? 'Week by week' : 'Month by month'}
          </span>
        </div>
        <div
          className="cash-chart"
          role="img"
          aria-label={`Cashflow: ${money(r.income)} in, ${money(r.expenses)} out. Detailed values in table below.`}
        >
          {chart.map((d, i) => (
            <div
              className="cash-column"
              key={i}
              title={`${d.label}: ${money(d.income)} in, ${money(d.expenses)} out`}
            >
              <div className="cash-bars">
                <i style={{ height: Math.max(d.income ? 3 : 0, (d.income / max) * 100) + '%' }} />
                <i
                  className="expense"
                  style={{ height: Math.max(d.expenses ? 3 : 0, (d.expenses / max) * 100) + '%' }}
                />
              </div>
              <small>{d.label}</small>
            </div>
          ))}
        </div>
        <div className="chart-legend">
          <span>
            <i /> Money in
          </span>
          <span>
            <i className="expense" /> Money out
          </span>
        </div>
        <details>
          <summary>Read chart values</summary>
          <div className="report-table">
            <table>
              <thead>
                <tr>
                  <th>{r.bucket === 'day' ? 'Date' : 'From'}</th>
                  <th>In (BDT)</th>
                  <th>Out (BDT)</th>
                </tr>
              </thead>
              <tbody>
                {r.buckets.map((d) => (
                  <tr key={d.key}>
                    <td>{d.from}</td>
                    <td>{d.income.toFixed(2)}</td>
                    <td>{d.expenses.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
      <div className="finance-grid">
        <Card>
          <h2>Where the money came in</h2>
          {r.methods.length ? (
            r.methods.map((m) => (
              <div className="method-line" key={m.method}>
                <span>
                  {methodLabels[m.method]} <small className="muted">· {m.count}</small>
                </span>
                <b>{money(m.value)}</b>
                <div>
                  <i style={{ width: (m.value / r.income) * 100 + '%' }} />
                </div>
              </div>
            ))
          ) : (
            <p className="small muted">
              Record a sale or classify an incoming payment as business to see your payment mix.
            </p>
          )}
        </Card>
        <Card>
          <h2>Top payers</h2>
          {r.payers.length ? (
            r.payers.map((p) => (
              <div className="payer-row" key={p.name}>
                <span>
                  {p.name} <small className="muted">· {p.count}</small>
                </span>
                <b>{money(p.value)}</b>
              </div>
            ))
          ) : (
            <p className="small muted">No incoming business payments in this period.</p>
          )}
          <p className="small muted">Phone numbers stay masked. Add a customer name to sales to see them here.</p>
        </Card>
        <Card>
          <h2>A steadier business</h2>
          <div className="report-stat">
            <span>Days with money in</span>
            <b>
              {r.activeDays} / {r.days}
            </b>
          </div>
          <div className="report-stat">
            <span>Digital share</span>
            <b>{r.digitalShare}%</b>
          </div>
          <div className="report-stat">
            <span>Largest day’s share</span>
            <b>{r.largestDayShare}%</b>
          </div>
          <p className="small muted">
            A large share on one day can make income less predictable. These patterns describe your
            records.
          </p>
        </Card>
      </div>
      <Card>
        <div className="row between">
          <h2>Payments in this period</h2>
          <span className="small muted">{r.count}</span>
        </div>
        {r.rows.slice(0, 20).map((row) => (
          <div className="history-row" key={row.source + row.id}>
            <span className={'icon-tile ' + (row.direction === 'in' ? 'green' : 'amber')}>
              {row.direction === 'in' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            </span>
            <span>
              <b>
                {methodLabels[row.method]} ·{' '}
                {row.source === 'sale' ? 'Sale' : row.source === 'sms' ? 'SMS' : 'Manual'}
              </b>
              <small>
                {dateLabel(row.date + 'T06:00:00Z')}
                {row.party ? ' · ' + row.party : ''}
              </small>
            </span>
            <strong>
              {row.direction === 'out' ? '−' : '+'}
              {money(row.amount)}
            </strong>
          </div>
        ))}
        {r.count > 20 && <p className="small muted">Showing the newest 20 of {r.count}.</p>}
        {!r.count && (
          <p className="small muted">
            Nothing in {dates.label.toLowerCase()}. Record a sale or sync payment messages, then choose
            another period.
          </p>
        )}
        <button className="card-link" onClick={() => nav('transactions')}>
          Open all payments <ArrowUpRight size={18} />
        </button>
      </Card>
      <div className="notice green">
        <ReceiptText size={20} />
        <span>
          Totals include business payments only. Linked payment messages count once with their sale.{' '}
          {r.personalCount} personal records and {r.foreignCount} foreign currency records are
          excluded. Cashflow is not profit: stock purchases, rent and other expenses need recording.
        </span>
      </div>
      <Card className="borrowing-card">
        <div className="row">
          <span className="icon-tile amber">
            <Landmark />
          </span>
          <div>
            <h2>Plan your borrowing</h2>
            <small className="muted">An adjustable repayment benchmark</small>
          </div>
        </div>
        <p className="small muted">
          Recorded incoming business money averages {money(monthlyRevenue)} per 30 days across{' '}
          {observedDays} days. This can include transfers, so check that it reflects actual revenue.
        </p>
        <div className="form-grid">
          <Field label="Annual interest">
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {[0, 5, 7, 8, 9, 10, 12, 15, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </Field>
          <Field label="Repayment term">
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[6, 12, 24, 36, 48, 60].map((n) => (
                <option key={n} value={n}>
                  {n} months
                </option>
              ))}
            </select>
          </Field>
          <Field label="Revenue for repayments">
            <select value={share} onChange={(e) => setShare(Number(e.target.value))}>
              {[5, 10, 15, 20, 25, 30, 40, 50].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="borrowing-result">
          <small>Illustrative loan amount</small>
          <strong>{money(estimate.principal)}</strong>
          <span>{money(estimate.monthlyBudget)} monthly budget</span>
        </div>
        <p className="small muted">
          Estimate only, before fees. 50% of revenue is the most a lender usually allows; a lower
          share leaves a cash buffer. No bank has assessed affordability, collateral, CIB history or
          documents.
        </p>
        <Button className="full" onClick={() => nav('loans')}>
          See matched bank loan plans <TrendingUp size={18} />
        </Button>
        <Button variant="outline" className="full" onClick={() => nav('advisor')}>
          View actual offers <TrendingUp size={18} />
        </Button>
      </Card>
      <Card>
        <h2>Funding & protection planner</h2>
        <p className="small muted">
          Illustrative categories ranked by your records. Bank loan products are matched in Loan
          plans; insurance products are not listed.
        </p>
        {[
          {
            title: monthlyRevenue > 0 ? 'Working capital' : 'Build your business record',
            detail:
              monthlyRevenue > 0
                ? 'Compare matched bank plans and the repayment benchmark above.'
                : 'Record daily sales and expenses before sizing a loan.',
            icon: Landmark,
          },
          {
            title: w.products.length ? 'Stock & premises insurance' : 'Business protection',
            detail:
              'Ask a licensed insurer about fire, flood, theft, exclusions and claims requirements.',
            icon: Shield,
          },
          {
            title: 'Equipment & growth funding',
            detail:
              'Compare repayment terms, total costs and any grant eligibility with the provider.',
            icon: TrendingUp,
          },
        ].map(({ title, detail, icon: Icon }, i) => (
          <div className="planner-row" key={title}>
            <span className="plan-number">0{i + 1}</span>
            <Icon size={20} />
            <span>
              <b>{title}</b>
              <small>{detail}</small>
            </span>
          </div>
        ))}
      </Card>
      <Button className="full" variant="outline" onClick={() => nav('transactions')}>
        Review payment transactions <ArrowUpRight size={18} />
      </Button>
    </>
  );
}
