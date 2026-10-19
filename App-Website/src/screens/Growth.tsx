import { useState } from 'react';
import {
  Lock,
  TrendingUp,
  Check,
  ArrowUpRight,
  Sparkles,
  Send,
  Landmark,
  ChevronRight,
  Gift,
  Info,
} from 'lucide-react';
import { useStore } from '../data/store';
import { AnimatedNumber } from '../components/Experience';
import { creditScore, dashboard } from '../../shared/domain';
import { api } from '../data/api';
import { askAdvice, type AdviceIntent } from '../data/business';
import { CreditProfileCard, LoanPlans } from './Loans';
import { Card, PageHeader, Toggle, Button, Empty } from '../components/UI';
import { useTask } from '../components/useTask';
import { money } from '../utils';
import type { Navigate } from './Dashboard';
export function Growth({ nav, tab = 'score' }: { nav: Navigate; tab?: 'score' | 'loans' | 'advisor' }) {
  const { workspace: w, mode, act } = useStore();
  const { run, busy } = useTask();
  if (!w) return null;
  const score = creditScore(w);
  const fraction = ((score.value || 300) - 300) / 600;
  return (
    <>
      <PageHeader title="Growth" subtitle="Build a stronger business, one day at a time" />
      <div className="segments growth-tabs">
        <button className={tab === 'score' ? 'active' : ''} onClick={() => nav('growth')}>
          Credit score
        </button>
        <button className={tab === 'loans' ? 'active' : ''} onClick={() => nav('loans')}>
          <Landmark size={16} /> Loan plans
        </button>
        <button className={tab === 'advisor' ? 'active' : ''} onClick={() => nav('advisor')}>
          <Sparkles size={16} /> AI advisor
        </button>
      </div>
      {tab === 'advisor' ? (
        <Advisor />
      ) : tab === 'loans' ? (
        <LoanPlans nav={nav} />
      ) : (
        <>
          <CreditProfileCard nav={nav} />
          <Card className="gauge-card">
            <div className="gauge">
              <svg
                viewBox="0 0 300 180"
                aria-label={'Business score ' + (score.value ?? 'not available')}
                role="img"
              >
                <path
                  d="M 25 151 A 125 125 0 0 1 275 151"
                  fill="none"
                  stroke="#D5E6DD"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <path
                  d="M 25 151 A 125 125 0 0 1 275 151"
                  fill="none"
                  stroke="#0E5A43"
                  strokeWidth="16"
                  strokeLinecap="round"
                  className="gauge-arc"
                  pathLength="100"
                  strokeDasharray={`${fraction * 100} 100`}
                />
                <text x="20" y="178" fill="#63726B" fontSize="13">
                  300
                </text>
                <text x="255" y="178" fill="#63726B" fontSize="13">
                  900
                </text>
              </svg>
              <div className="gauge-number">
                <strong>{score.value === null ? '—' : <AnimatedNumber value={score.value} duration={900} />}</strong>
                <span className="pill good">{score.label}</span>
              </div>
            </div>
            <p className="good-text strong">
              {score.value
                ? 'Keep building your business record'
                : 'A stronger record starts with one sale'}
            </p>
            <p className="small muted">
              Business indicator (300–900) based on {score.days} days of recorded sales. This is the
              summary bank users on your server see when you share it. GreenBiz’s internal indicator,
              not an official credit bureau score.
            </p>
          </Card>
          <Card>
            <div className="row between">
              <div className="row">
                <Lock size={20} />
                <b>Share my score with banks</b>
              </div>
              <Toggle
                label="Share my score with banks"
                value={w.shop.shareScore}
                disabled={busy}
                onChange={(value) =>
                  void run(() => act({ type: 'shop.update', shop: { shareScore: value } }))
                }
              />
            </div>
            <p className="small muted">
              {mode === 'server'
                ? 'Bank users on your server see your score and monthly sales totals. Customer names and stock lists stay private. Turn off anytime.'
                : 'Sharing applies only when connected to your business server. Device records stay on this device.'}
            </p>
          </Card>
          <Card>
            <h2>What builds your score</h2>
            {score.reasons.map((r, i) => (
              <div className="score-reason" key={i}>
                <span>
                  <b>{r.title}</b>
                  <small>{r.detail}</small>
                </span>
                <span className={(r.good ? 'good-text' : 'amber-text') + ' small strong'}>
                  {r.good ? <Check size={14} /> : <ArrowUpRight size={14} />} {r.value}
                </span>
              </div>
            ))}
          </Card>
          <Button variant="outline" className="full" onClick={() => nav('advisor')}>
            <Sparkles size={18} /> Explore funding & business insights
          </Button>
        </>
      )}
    </>
  );
}
const prompts: Record<AdviceIntent, string> = {
  loan: 'How do I qualify for a bigger working capital loan?',
  insurance: 'What protection should my shop consider first?',
  general: 'Ask about your business',
};
type Message = { role: 'user' | 'assistant'; text: string; local?: boolean };
function Advisor() {
  const { workspace: w, mode } = useStore();
  const [input, setInput] = useState(''),
    [messages, setMessages] = useState<Message[]>([]),
    [selected, setSelected] = useState(''),
    [sent, setSent] = useState<string[]>([]),
    [intent, setIntent] = useState<AdviceIntent>('loan');
  const { run, busy } = useTask();
  if (!w) return null;
  const d = dashboard(w);
  const total = w.sales.reduce((n, s) => n + s.total, 0),
    profit = w.sales.reduce((n, s) => n + s.profit, 0);
  const margin = total ? Math.round((profit / total) * 100) : 0;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const message = input.trim() || prompts[intent];
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    await run(async () => {
      const answer = await askAdvice(message, w!, mode === 'server', intent);
      setMessages((prev) => [...prev, { role: 'assistant', text: answer }]);
    });
  }
  return (
    <div className="advisor">
      <div className="notice green">
        <Sparkles size={19} />
        <span>
          GreenBiz AI is ready to help online—no API key or server setup needed. Only business
          totals, your credit profile score, the borrowing estimate and your question are shared.
          Personal payments, customer names and raw SMS stay private.
        </span>
      </div>
      <div className="bubble assistant">
        <span className="assistant-label">
          <TrendingUp size={14} /> GreenBiz business insights
        </span>
        <p>
          {w.sales.length
            ? `You recorded ${money(d.monthSales)} in sales this month. Your recorded gross margin is ${margin}%, before rent, wages and other expenses.`
            : 'Start recording daily sales to see cashflow patterns and build a business history.'}
        </p>
        <p>
          {d.lowProducts.length
            ? `${d.lowProducts.length} items are at or below their low-stock level. Review those before placing your next order.`
            : 'Stock reminders and financing offers will appear as your records grow.'}
        </p>
      </div>
      {w.offers.length > 0 ? (
        <>
          <div className="section-heading">
            <h2>{mode === 'demo' ? 'Example financing offers' : 'Offers for your shop'}</h2>
          </div>
          {w.offers.map((o, i) => {
            const rate = o.annualRate / 1200;
            const payment =
              o.kind === 'loan'
                ? rate
                  ? (o.amount * rate) / (1 - Math.pow(1 + rate, -o.months))
                  : o.amount / o.months
                : 0;
            return (
              <Card className={'offer-card ' + (i === 0 ? 'best' : '')} key={o.id}>
                <button
                  className="offer-summary"
                  onClick={() => setSelected(selected === o.id ? '' : o.id)}
                >
                  <span className="icon-tile green">
                    {o.kind === 'grant' ? <Gift /> : <Landmark />}
                  </span>
                  <span>
                    <b>{o.bank}</b>
                    <small>{o.name}</small>
                  </span>
                  <ChevronRight size={20} />
                </button>
                <h2>Up to {money(o.amount)}</h2>
                <p className="small muted">
                  {o.kind === 'grant'
                    ? 'No repayment'
                    : `${o.annualRate}% a year · ${o.months} months · ≈ ${money(Math.round(payment))}/month`}
                </p>
                {selected === o.id && (
                  <div className="offer-detail">
                    <p>{o.requirements}</p>
                    <p className="small muted">
                      {o.kind === 'loan'
                        ? 'Monthly illustration uses reducing balance, excludes fees and taxes. The lender confirms final terms.'
                        : 'The funder confirms eligibility and award terms.'}
                    </p>
                    <Button
                      className="full"
                      disabled={busy || sent.includes(o.id)}
                      onClick={() =>
                        void run(async () => {
                          if (mode === 'demo')
                            throw new Error(
                              'This is a sample offer. No lender will receive a request.',
                            );
                          await api('/api/offers/' + o.id + '/interest', {});
                          setSent([...sent, o.id]);
                        })
                      }
                    >
                      {sent.includes(o.id) ? 'Interest sent' : 'Express interest'}
                      <ArrowUpRight size={17} />
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </>
      ) : (
        <Card>
          <Empty
            title="No financing offers yet"
            detail={
              mode === 'server'
                ? 'With your consent, bank users on your server can send offers. GreenBiz does not invent lender terms.'
                : 'Connect a business server to receive offers from participating bank users.'
            }
          />
        </Card>
      )}
      {messages.map((m, i) => (
        <div className={'bubble ' + (m.role === 'user' ? 'user' : 'assistant')} key={i}>
          {m.role === 'assistant' && (
            <span className="assistant-label">
              <Sparkles size={14} /> GreenBiz AI advisor
            </span>
          )}
          <p>{m.text}</p>
        </div>
      ))}
      {busy && (
        <div className="bubble assistant loading-dots" aria-live="polite">
          Looking at your records…
        </div>
      )}
      <div className="segments" role="group" aria-label="Advice topic">
        {(['loan', 'insurance', 'general'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={intent === value ? 'active' : ''}
            onClick={() => setIntent(value)}
            disabled={busy}
          >
            {value === 'loan' ? 'Loan' : value === 'insurance' ? 'Insurance' : 'My business'}
          </button>
        ))}
      </div>
      <form className="message-bar" onSubmit={(e) => void send(e)}>
        <input
          aria-label="Ask about your business"
          placeholder={prompts[intent]}
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="submit"
          className="send-button"
          aria-label="Send message"
          disabled={busy}
        >
          <Send size={20} />
        </button>
      </form>
      <p className="fineprint">
        <Info size={13} /> Insights are for planning. Lenders make their own lending decisions.
      </p>
    </div>
  );
}
