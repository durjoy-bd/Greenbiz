import { useState } from 'react';
import { ExternalLink, Landmark, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react';
import { creditProfile } from '../../shared/credit-profile';
import { monthlyBusinessRevenue } from '../../shared/finance';
import {
  catalogueCheckedAt,
  facilityLabels,
  institutions,
  matchPlans,
  priorityLabels,
  type PlanMatch,
} from '../../shared/loans';
import { useStore } from '../data/store';
import { AnimatedMoney, AnimatedNumber } from '../components/Experience';
import { Button, Card, FactorBar, Field } from '../components/UI';
import { dateLabel, money } from '../utils';
import type { Navigate } from './Dashboard';

/** Behavioural 0–100 profile from the last 90 days of business records. */
export function CreditProfileCard({ nav }: { nav?: Navigate }) {
  const { workspace: w } = useStore();
  if (!w) return null;
  const p = creditProfile(w);
  const tone = p.score >= 70 ? 'good' : p.score >= 40 ? 'warn' : 'bad';
  return (
    <Card>
      <div className="row between">
        <h2>Credit profile</h2>
        <span className="small muted">Last 90 days</span>
      </div>
      <div className="profile-score">
        <strong>
          <AnimatedNumber value={p.score} />
        </strong>
        <span className="muted">out of 100</span>
        <span className={'pill ' + tone}>{p.band}</span>
      </div>
      <p className="small muted">
        A behavioural score built from your own business records: {p.transactionCount} records, about{' '}
        {money(p.monthlyRevenue)} a month coming in. It is not a credit bureau score, and it is not a lending
        decision.
      </p>
      <h3>What shapes your score</h3>
      {p.factors.map((f) => (
        <FactorBar key={f.name} title={f.title} score={f.score} weight={f.weight} label={f.label} />
      ))}
      {(p.risks.length > 0 || p.improvements.length > 0) && (
        <>
          <h3>What to work on</h3>
          <ul className="tip-list">
            {[...p.risks, ...p.improvements].map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </>
      )}
      {nav && (
        <button className="card-link" onClick={() => nav('loans')}>
          See loan plans for your revenue <TrendingUp size={18} />
        </button>
      )}
    </Card>
  );
}

function PlanCard({ match, headline }: { match: PlanMatch; headline: boolean }) {
  const tone = match.priority === 'high' ? 'good' : match.priority === 'medium' ? 'gold' : match.priority === 'low' ? 'warn' : '';
  return (
    <Card className="plan-card">
      <div className="plan-head">
        <span>
          <b>{match.plan.planName}</b>
          <small className="muted">
            {match.institution} · {facilityLabels[match.facility]}
          </small>
        </span>
        <span className={'pill ' + tone}>{priorityLabels[match.priority]}</span>
      </div>
      {headline && <span className="pill good">Basis of your borrowing estimate</span>}
      <div className="plan-figures">
        <span>
          <small>Interest</small>
          <b>{match.interestRate === null ? 'On request' : match.interestRate.toFixed(2) + '%'}</b>
        </span>
        <span>
          <small>{match.facility === 'term' ? 'Instalment' : 'Monthly interest'}</small>
          <b>{match.emi === null ? '—' : money(Math.round(match.emi))}</b>
        </span>
        <span>
          <small>{match.suggestedAmount === null ? 'Tenor' : 'Suggested'}</small>
          <b>
            {match.suggestedAmount === null
              ? match.tenorMonths
                ? match.tenorMonths + ' months'
                : '—'
              : money(match.suggestedAmount)}
          </b>
        </span>
      </div>
      {match.affordabilityRatio !== null && (
        <small className="muted">
          Revenue covers the instalment {match.affordabilityRatio.toFixed(1)}× · {match.tenorMonths} months
        </small>
      )}
      {match.requirements.length > 0 && (
        <small className="muted">Needs: {match.requirements.slice(0, 2).join(' · ')}</small>
      )}
      {match.warnings.map((warning) => (
        <small key={warning} className="amber-text">
          <ShieldAlert size={13} /> {warning}
        </small>
      ))}
      <details>
        <summary>Why this plan, and what the bank asks for</summary>
        <p className="small">{match.plan.description}</p>
        <ul>
          {match.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {match.requirements.length > 0 && (
          <>
            <b className="small">Requirements</b>
            <ul>
              {match.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
        {match.plan.feesDetails.rateNote && <p className="small muted">{match.plan.feesDetails.rateNote}</p>}
        {match.plan.sourceUrl && (
          <a className="text-button" href={match.plan.sourceUrl} target="_blank" rel="noreferrer noopener">
            Published terms <ExternalLink size={13} />
          </a>
        )}
      </details>
    </Card>
  );
}

export function LoanPlans({ nav }: { nav: Navigate }) {
  const { workspace: w } = useStore();
  const [requested, setRequested] = useState('');
  const [bank, setBank] = useState('');
  const [showAll, setShowAll] = useState(false);
  if (!w) return null;
  const { monthlyRevenue, observedDays } = monthlyBusinessRevenue(w);
  const shopAgeMonths = Math.max(0, (Date.now() - Date.parse(w.shop.createdAt)) / (30 * 86_400_000));
  const amount = Number(requested);
  const result = matchPlans({
    monthlyRevenue,
    shopAgeMonths,
    requestedAmount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
  });
  const c = result.capacity;
  const list = (showAll || bank ? result.ranked : result.matches).filter((m) => !bank || m.plan.institutionId === bank);
  return (
    <>
      <Card className="capacity-card">
        <div className="row">
          <span className="icon-tile amber">
            <Landmark />
          </span>
          <div>
            <h2>How much you can borrow</h2>
            <small className="muted">Bangladeshi SME products, matched to your recorded revenue</small>
          </div>
        </div>
        {c.basis === 'insufficient_revenue' ? (
          <>
            <strong>Not enough recorded revenue yet</strong>
            <p className="small muted">
              Record business sales for at least a month, then check again. The products below are still listed so
              you can see what each bank asks for.
            </p>
            <Button variant="outline" onClick={() => nav('sale')}>
              Record a sale
            </Button>
          </>
        ) : (
          <>
            <strong>
              <AnimatedMoney value={c.suggestedAmount} />
            </strong>
            <p className="small">
              About {money(Math.round(c.maxAffordableEmi))} a month at most · {c.interestRate}% a year over {c.tenorMonths} months
            </p>
            <p className="small muted">
              Based on {money(c.monthlyRevenue)} average monthly business revenue across {observedDays} days.
            </p>
            <ul className="tip-list small muted">
              {c.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card>
        <div className="form-grid">
          <Field label="How much do you need? (optional)" hint="Leave blank to size each plan from your revenue.">
            <div className="currency-input">
              <span>৳</span>
              <input
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                value={requested}
                onChange={(e) => setRequested(e.target.value)}
                placeholder="e.g. 200000"
              />
            </div>
          </Field>
          <Field label="Bank">
            <select value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">All 8 banks</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <div className="section-heading">
        <h2>{showAll || bank ? 'In the directory now' : 'Ranked for your revenue'}</h2>
        <span className="small muted">{list.length} plans</span>
      </div>
      <p className="small muted">
        High priority means your revenue covers the instalment at least twice; Good fit 1.3–2×; Stretch below 1.3×.
        Published terms last checked {dateLabel(catalogueCheckedAt, { day: 'numeric', month: 'long', year: 'numeric' })}.
      </p>
      {list.map((m) => (
        <PlanCard key={m.plan.id} match={m} headline={m.plan.id === c.planId} />
      ))}
      {!bank && (
        <Button variant="outline" className="full" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show the top matches' : `Browse all ${result.ranked.length} products`}
        </Button>
      )}
      <div className="notice amber">
        <ShieldAlert size={19} />
        <span>
          Estimates only, before fees. GreenBiz is not a lender and has not contacted these banks. Lenders also check
          collateral, CIB history and documents; confirm current rates and terms with the bank.
        </span>
      </div>
      <Button variant="outline" className="full" onClick={() => nav('advisor')}>
        <Sparkles size={18} /> Ask AI how to qualify
      </Button>
    </>
  );
}
