import { useState } from 'react';
import { Activity, Info, UserPlus } from 'lucide-react';
import { Card, Empty } from '../../components/UI';
import { AnimatedMoney, AnimatedNumber } from '../../components/Experience';
import { dateLabel, money, num } from '../../utils';
import { actionLabel, DateRange, go, Header, Kpi, LoadState, RefreshButton, shortDate, StatusBadge, TZ_NOTE, useAdmin, useCan, VerifiedBadge, when } from './common';
import type { AccountStatus } from '../../../shared/permissions';

interface Overview {
  generatedAt: string;
  range: { from: string; to: string };
  trackingStartedAt: string | null;
  accounts: {
    total: number;
    newInRange: number;
    verified: number;
    unverified: number;
    active: number;
    suspended: number;
    deactivated: number;
    byRole: { user: number; admin: number; super_admin: number };
    byType: { merchant: number; bank: number };
  };
  engagement: { dau: number; mau: number; activeInRange: number; signedInNow: number; definition: string };
  daily: { date: string; active: number; signups: number; sales: number; recorded: boolean }[];
  recentRegistrations: { id: string; email: string; name: string; type: string; status: AccountStatus; verified: boolean; createdAt: string }[];
  recentActivity: { id: string; userId: string | null; action: string; outcome: string; description: string; createdAt: string; userEmail: string | null; userName: string | null }[];
  business: { shops: number; products: number; stockValue: number; salesCount: number; salesInRange: number; salesCountInRange: number; paymentsToReview: number; activeShops7d: number };
}
const dhakaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() - n * 86_400_000));
const day = (date: string) => dateLabel(date + 'T06:00:00Z', { day: 'numeric', month: 'short' });

/** The app's existing bar chart; days with no recorded data are drawn hollow, never estimated. */
function Bars({ values, label, format }: { values: { date: string; value: number; recorded?: boolean }[]; label: string; format: (n: number) => string }) {
  const max = Math.max(1, ...values.map((v) => v.value));
  const step = Math.ceil(values.length / 15);
  return (
    <div className="cash-chart admin-chart" role="img" aria-label={`${label}: ${values.map((v) => `${day(v.date)} ${v.recorded === false ? 'not recorded' : format(v.value)}`).join(', ')}`}>
      {values.map((v, i) => (
        <div className={'cash-column' + (v.recorded === false ? ' unrecorded' : '')} key={v.date} title={`${day(v.date)}: ${v.recorded === false ? 'not recorded' : format(v.value)}`}>
          <div className="cash-bars">
            <i style={{ height: Math.max(v.value ? 3 : 0, (v.value / max) * 100) + '%' }} />
          </div>
          <small>{i % step === 0 ? Number(v.date.slice(8)) : ''}</small>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [range, setRange] = useState({ from: daysAgo(29), to: dhakaToday() });
  const valid = range.from && range.to && range.from <= range.to;
  const { data, error, busy, refresh } = useAdmin<Overview>(valid ? `/api/admin/overview?from=${range.from}&to=${range.to}` : null);
  const allowed = useCan();
  const a = data?.accounts;
  const started = data?.trackingStartedAt?.slice(0, 10);
  return (
    <>
      <Header title="Dashboard" subtitle={`Accounts and activity on this GreenBiz server · ${TZ_NOTE}`}>
        {data && <small className="muted updated-at">Last updated {when(data.generatedAt)}</small>}
        <RefreshButton onClick={refresh} busy={busy} />
      </Header>
      <DateRange from={range.from} to={range.to} onChange={setRange} />
      {!valid && <p className="form-message bad">Choose a start date on or before the end date.</p>}
      <LoadState error={error} busy={busy && !data} retry={refresh} label="the dashboard" />
      {data && a && (
        <>
          <h2 className="admin-section-title">Accounts</h2>
          <div className="admin-kpis">
            <Kpi label="Registered users" note={`${a.byType.merchant} shop owners · ${a.byType.bank} bank users · ${a.byRole.admin + a.byRole.super_admin} admins`}>
              <AnimatedNumber value={a.total} />
            </Kpi>
            <Kpi label="New registrations" note={`${shortDate(data.range.from + 'T06:00:00Z')} – ${shortDate(data.range.to + 'T06:00:00Z')}`}>
              <AnimatedNumber value={a.newInRange} />
            </Kpi>
            <Kpi label="Email confirmed" note={`${num(a.unverified)} not confirmed yet`}>
              <AnimatedNumber value={a.verified} />
            </Kpi>
            <Kpi label="Active accounts" note={`${a.suspended} suspended · ${a.deactivated} deactivated`}>
              <AnimatedNumber value={a.active} />
            </Kpi>
          </div>
          <h2 className="admin-section-title">Engagement</h2>
          <div className="admin-kpis">
            <Kpi label="Daily active users" note={`On ${shortDate(data.range.to + 'T06:00:00Z')}`}>
              <AnimatedNumber value={data.engagement.dau} />
            </Kpi>
            <Kpi label="Monthly active users" note="30 days ending on the last day of the range">
              <AnimatedNumber value={data.engagement.mau} />
            </Kpi>
            <Kpi label="Active during the range" note="Distinct accounts">
              <AnimatedNumber value={data.engagement.activeInRange} />
            </Kpi>
            <Kpi label="Signed in now" note="Accounts with an unexpired session">
              <AnimatedNumber value={data.engagement.signedInNow} />
            </Kpi>
          </div>
          <details className="definition">
            <summary>
              <Info size={15} /> How active users are counted
            </summary>
            <p className="small muted">{data.engagement.definition}</p>
          </details>
          {started && started > data.range.from && (
            <div className="notice amber">
              <Info size={18} />
              <span>
                Activity recording began on {shortDate(data.trackingStartedAt)}. Earlier days show as hollow bars because no activity was recorded then; nothing is
                estimated. Registration dates are known for every account.
              </span>
            </div>
          )}
          <div className="admin-two">
            <Card>
              <h2>Daily active users</h2>
              <p className="small muted">Accounts with signed-in use each day</p>
              <Bars values={data.daily.map((d) => ({ date: d.date, value: d.active, recorded: d.recorded }))} label="Daily active users" format={(n) => `${n} active`} />
            </Card>
            <Card>
              <h2>New registrations</h2>
              <p className="small muted">Accounts created each day</p>
              <Bars values={data.daily.map((d) => ({ date: d.date, value: d.signups }))} label="New registrations per day" format={(n) => `${n} new`} />
            </Card>
          </div>
          <div className="admin-two">
            <Card>
              <div className="row between">
                <h2>
                  <UserPlus size={18} /> Recent registrations
                </h2>
                {allowed('users.view') && (
                  <button className="text-button" onClick={() => go('users')}>
                    All users
                  </button>
                )}
              </div>
              {data.recentRegistrations.length ? (
                data.recentRegistrations.map((u) => (
                  <button className="admin-row" key={u.id} onClick={() => go('users/' + u.id)}>
                    <span>
                      <b>{u.name || u.email}</b>
                      <small className="muted">
                        {u.email} · {u.type === 'bank' ? 'Bank user' : 'Shop owner'}
                      </small>
                    </span>
                    <span className="admin-row-meta">
                      <VerifiedBadge verified={u.verified} />
                      {u.status !== 'active' && <StatusBadge status={u.status} />}
                      <small className="muted">{when(u.createdAt)}</small>
                    </span>
                  </button>
                ))
              ) : (
                <Empty title="No accounts yet" detail="People appear here when they register on this server." />
              )}
            </Card>
            <Card>
              <div className="row between">
                <h2>
                  <Activity size={18} /> Recent significant activity
                </h2>
                {allowed('activity.view') && (
                  <button className="text-button" onClick={() => go('activity')}>
                    Activity log
                  </button>
                )}
              </div>
              {data.recentActivity.length ? (
                data.recentActivity.map((e) => (
                  <button className="admin-row" key={e.id} disabled={!e.userId} onClick={() => e.userId && go('users/' + e.userId)}>
                    <span>
                      <b>
                        {actionLabel(e.action)}
                        {e.outcome === 'failure' && <span className="pill bad">Failed</span>}
                      </b>
                      <small className="muted">
                        {e.userName || e.userEmail || 'Deleted account'} · {e.description}
                      </small>
                    </span>
                    <small className="muted">{when(e.createdAt)}</small>
                  </button>
                ))
              ) : (
                <Empty title="Nothing recorded yet" detail="Registrations, confirmations, account changes and failed sign-ins appear here." />
              )}
            </Card>
          </div>
          <h2 className="admin-section-title">Shops and sales</h2>
          <div className="admin-kpis">
            <Kpi label="Shops" note={`${data.business.activeShops7d} changed in the last 7 days`}>
              <AnimatedNumber value={data.business.shops} />
            </Kpi>
            <Kpi label="Sales in range" note={`${num(data.business.salesCountInRange)} sales recorded`}>
              <AnimatedMoney value={data.business.salesInRange} />
            </Kpi>
            <Kpi label="Stock value" note={`${num(data.business.products)} products tracked`}>
              <AnimatedMoney value={data.business.stockValue} />
            </Kpi>
            <Kpi label="Payment claims to review" note={`${num(data.business.salesCount)} sales recorded in total`}>
              <AnimatedNumber value={data.business.paymentsToReview} />
            </Kpi>
          </div>
          <Card>
            <h2>Recorded sales across all shops</h2>
            <p className="small muted">Self-recorded by shop owners, in BDT</p>
            <Bars values={data.daily.map((d) => ({ date: d.date, value: d.sales }))} label="Daily sales across all shops" format={money} />
          </Card>
        </>
      )}
    </>
  );
}
