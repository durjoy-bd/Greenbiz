import { useEffect, useState } from 'react';
import { Landmark, Lock, Search, Send, ArrowUpRight, FileText } from 'lucide-react';
import { useStore } from '../data/store';
import { ProfileMenu } from '../components/ProfileMenu';
import { api } from '../data/api';
import { Card, Button, Empty, Field, Logo, Meter } from '../components/UI';
import { useTask } from '../components/useTask';
import { money, dateLabel } from '../utils';
import type { BusinessProfile } from '../../shared/types';
import type { Navigate } from './Dashboard';
interface Interest {
  id: string;
  offerId: string;
  businessId: string;
  businessName: string;
  offerName: string;
  message: string;
  createdAt: string;
}
export function Bank({ nav }: { nav: Navigate }) {
  const { user } = useStore();
  const [businesses, setBusinesses] = useState<BusinessProfile[]>([]),
    [interests, setInterests] = useState<Interest[]>([]),
    [selected, setSelected] = useState(''),
    [query, setQuery] = useState(''),
    [minScore, setMinScore] = useState(0),
    [tab, setTab] = useState('discover'),
    [offering, setOffering] = useState(false),
    [form, setForm] = useState({
      bank: '',
      name: 'SME loan',
      kind: 'loan',
      amount: '',
      annualRate: '',
      months: '24',
      requirements: '',
    });
  const { run, busy } = useTask();
  const [documentMessage, setDocumentMessage] = useState('');
  const [requestingDocuments, setRequestingDocuments] = useState(false);
  const [documentSent, setDocumentSent] = useState(false);
  useEffect(() => {
    if (user?.role === 'bank')
      void run(async () => {
        const [r, i] = await Promise.all([
          api<{ businesses: BusinessProfile[] }>('/api/bank/businesses'),
          api<{ interests: Interest[] }>('/api/bank/interests'),
        ]);
        setBusinesses(r.businesses);
        setSelected(r.businesses[0]?.id || '');
        setInterests(i.interests);
      });
  }, [user?.id]);
  const business = businesses.find((b) => b.id === selected);
  const shown = businesses
    .filter(
      (b) => b.name.toLowerCase().includes(query.toLowerCase()) && (b.score.value || 0) >= minScore,
    )
    .sort((a, b) => (b.score.value || 0) - (a.score.value || 0));
  const field = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  return (
    <main className="bank-page">
      <header className="bank-top">
        <Logo invert />
        <span className="bank-label">for Banks</span>
        <nav>
          <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>
            Discover
          </button>
          <button
            className={tab === 'interests' ? 'active' : ''}
            onClick={() => setTab('interests')}
          >
            Expressions of interest{' '}
            {interests.length > 0 && <span className="pill gold">{interests.length}</span>}
          </button>
        </nav>
        <span className="bank-account">{user?.email || 'Secure lending desk'}</span>
        {user && <ProfileMenu compact />}
      </header>
      {user?.role !== 'bank' ? (
        <div className="bank-unauthorized">
          <Card>
            <Empty
              title="A private view for bank partners"
              detail="Sign in using a bank account provisioned by your GreenBiz server administrator. Merchants choose which aggregate records to share."
            >
              <Button onClick={() => nav('settings')}>
                {user ? 'Return to shop' : 'Open GreenBiz'}
              </Button>
            </Empty>
          </Card>
        </div>
      ) : (
        <div className="bank-content">
          <h1>{tab === 'discover' ? 'Discover businesses' : 'Expressions of interest'}</h1>
          <p className="muted">
            {tab === 'discover'
              ? 'Small shops that chose to share their GreenBiz indicator with your lending desk. Customer names and stock lists remain private.'
              : 'Merchants interested in offers from your bank. These are requests for a conversation, not approved loans.'}
          </p>
          {tab === 'interests' ? (
            <Card>
              {interests.length ? (
                interests.map((i) => (
                  <div className="interest-row" key={i.id}>
                    <span className="avatar green">
                      <Landmark size={22} />
                    </span>
                    <span>
                      <h3>{i.businessName}</h3>
                      <p>{i.offerName}</p>
                      {i.message && <p className="muted small">{i.message}</p>}
                      <small>{dateLabel(i.createdAt)}</small>
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(i.businessId);
                        setTab('discover');
                      }}
                    >
                      View business
                    </Button>
                  </div>
                ))
              ) : (
                <Empty
                  title="No expressions of interest yet"
                  detail="Merchants can respond to your offers from the Growth tab."
                />
              )}
            </Card>
          ) : (
            <>
              <div className="bank-filters">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Find business"
                    placeholder="Find business"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <label className="filter-select">
                  Score{' '}
                  <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
                    <option value="0">All scores</option>
                    <option value="650">650+</option>
                    <option value="700">700+</option>
                    <option value="750">750+</option>
                  </select>
                </label>
                <span className="small muted">{shown.length} shops match · sorted by score</span>
              </div>
              <div className="bank-grid">
                <Card className="bank-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>BUSINESS</th>
                        <th>SCORE</th>
                        <th>SALES THIS MONTH</th>
                        <th>PAID DIGITALLY</th>
                        <th>ON GREENBIZ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((b) => (
                        <tr key={b.id} className={selected === b.id ? 'selected' : ''}>
                          <td>
                            <b>{b.name}</b>
                            <small>{b.location}</small>
                          </td>
                          <td>
                            <b>{b.score.value ?? '—'}</b>
                            <Meter value={b.score.value} />
                          </td>
                          <td>{money(b.monthlySales)}</td>
                          <td>{b.digital}%</td>
                          <td>{b.months} mo</td>
                          <td>
                            <Button
                              variant={selected === b.id ? 'primary' : 'outline'}
                              onClick={() => setSelected(b.id)}
                            >
                              {selected === b.id ? 'Viewing' : 'View'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!shown.length && (
                    <Empty
                      title="No shared businesses yet"
                      detail="Merchants appear after enabling score sharing in their Growth settings."
                    />
                  )}
                </Card>
                {business && (
                  <Card className="bank-profile">
                    <div className="row">
                      <span className="avatar amber">
                        {business.name
                          .split(' ')
                          .map((x) => x[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <span>
                        <h2>{business.name}</h2>
                        <small className="muted">{business.location}</small>
                        <small className="muted">Owner: {business.owner}</small>
                      </span>
                    </div>
                    <div className="score-value">
                      <strong>{business.score.value ?? '—'}</strong>
                      <span>of 900</span>
                      <span className="pill good">{business.score.label}</span>
                    </div>
                    <Meter value={business.score.value} />
                    <div className="profile-stats">
                      {[
                        ['Sales this month', money(business.monthlySales)],
                        ['Paid digitally', business.digital + '%'],
                        ['Records on GreenBiz', business.months + ' months'],
                        ['Stock value', money(business.stockValue)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <small>{label}</small>
                          <b>{value}</b>
                        </div>
                      ))}
                    </div>
                    <h3>Daily sales � last 7 days</h3>
                    <div className="mini-history">
                      {business.history.slice(-7).map((h) => (
                        <div key={h.date}>
                          <span>{dateLabel(h.date, { day: 'numeric', month: 'short' })}</span>
                          <b>{money(h.value)}</b>
                        </div>
                      ))}
                    </div>
                    <div className="notice green">
                      <Lock size={18} />
                      <span>
                        Shared by the owner. Consent can be withdrawn at any time. Customer names
                        and stock lists are never shown.
                      </span>
                    </div>
                    <p className="fineprint">
                      GreenBiz’s internal indicator is not a credit bureau score. Complete your own
                      lending assessment.
                    </p>
                    <Button className="full" onClick={() => setOffering(!offering)}>
                      <Send size={17} /> Send financing offer
                    </Button>
                    <Button
                      className="full"
                      variant="outline"
                      onClick={() => {
                        setRequestingDocuments(!requestingDocuments);
                        setDocumentSent(false);
                      }}
                      style={{ marginTop: 10 }}
                    >
                      <FileText size={17} /> Ask for documents
                    </Button>
                    {requestingDocuments && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            await api('/api/bank/document-requests', {
                              businessId: business.id,
                              message: documentMessage,
                            });
                            setDocumentMessage('');
                            setDocumentSent(true);
                          });
                        }}
                      >
                        <Field
                          label="Documents requested"
                          hint="The merchant sees this request in GreenBiz activity. No email is sent."
                        >
                          <textarea
                            required
                            maxLength={1000}
                            value={documentMessage}
                            onChange={(e) => setDocumentMessage(e.target.value)}
                            placeholder="Please provide your current trade licence…"
                          />
                        </Field>
                        <Button
                          className="full"
                          type="submit"
                          disabled={busy || !documentMessage.trim()}
                          style={{ marginTop: 12 }}
                        >
                          Send request
                        </Button>
                        {documentSent && (
                          <p role="status" className="small good-text" style={{ marginTop: 10 }}>
                            Request recorded in the merchant’s activity.
                          </p>
                        )}
                      </form>
                    )}
                    {offering && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            await api('/api/bank/offers', {
                              businessId: business.id,
                              ...form,
                              amount: Number(form.amount),
                              annualRate: Number(form.annualRate),
                              months: Number(form.months),
                            });
                            setOffering(false);
                          });
                        }}
                      >
                        <Field label="Bank name">
                          <input
                            required
                            maxLength={100}
                            value={form.bank}
                            onChange={(e) => field('bank', e.target.value)}
                          />
                        </Field>
                        <Field label="Offer name">
                          <input
                            required
                            maxLength={120}
                            value={form.name}
                            onChange={(e) => field('name', e.target.value)}
                          />
                        </Field>
                        <Field label="Offer type">
                          <select value={form.kind} onChange={(e) => field('kind', e.target.value)}>
                            <option value="loan">Loan</option>
                            <option value="grant">Grant</option>
                          </select>
                        </Field>
                        <Field label="Maximum amount">
                          <input
                            type="number"
                            required
                            min="1"
                            step=".01"
                            value={form.amount}
                            onChange={(e) => field('amount', e.target.value)}
                          />
                        </Field>
                        {form.kind === 'loan' && (
                          <div className="form-grid">
                            <Field label="Annual interest %">
                              <input
                                required
                                type="number"
                                min="0"
                                max="100"
                                step=".01"
                                value={form.annualRate}
                                onChange={(e) => field('annualRate', e.target.value)}
                              />
                            </Field>
                            <Field label="Term in months">
                              <input
                                required
                                type="number"
                                min="1"
                                max="360"
                                step="1"
                                value={form.months}
                                onChange={(e) => field('months', e.target.value)}
                              />
                            </Field>
                          </div>
                        )}
                        <Field label="Terms and requirements">
                          <textarea
                            required
                            maxLength={2000}
                            value={form.requirements}
                            onChange={(e) => field('requirements', e.target.value)}
                          />
                        </Field>
                        <Button className="full" type="submit" disabled={busy}>
                          Send offer <ArrowUpRight size={16} />
                        </Button>
                      </form>
                    )}
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
