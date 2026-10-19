import { useEffect, useState } from 'react';
import {
  Plus,
  ShieldCheck,
  Copy,
  ArrowRight,
  FileText,
  ChevronRight,
  Lock,
  RefreshCw,
  X,
  Link,
  Info,
} from 'lucide-react';
import { useStore } from '../data/store';
import { api } from '../data/api';
import { Button, Card, Empty, Field, PageHeader, Status, IconButton } from '../components/UI';
import { useTask } from '../components/useTask';
import { money, uid, errorText } from '../utils';
import type { Navigate } from './Dashboard';
import type { Payment } from '../../shared/types';
export function Payments({ nav }: { nav: Navigate }) {
  const { workspace: w, mode, act, setError } = useStore();
  const [tab, setTab] = useState('all'),
    [add, setAdd] = useState(false),
    [selected, setSelected] = useState(''),
    [amount, setAmount] = useState(''),
    [note, setNote] = useState('');
  const { run, busy } = useTask();
  if (!w) return null;
  const review = w.payments.filter((p) =>
    ['waiting', 'wrong_amount', 'duplicate'].includes(p.status),
  );
  const verified = w.payments.filter((p) => p.status === 'verified');
  const list = tab === 'review' ? review : tab === 'verified' ? verified : w.payments;
  async function decide(id: string, decision: 'manual' | 'rejected') {
    await run(async () => {
      await act({
        type: 'payment.review',
        id,
        decision,
        ...(decision === 'manual' ? { received: Number(amount) } : {}),
        note,
      });
      setSelected('');
    });
  }
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={
          w.shop.bkash
            ? `bKash Personal · ending ${w.shop.bkash.slice(-3)}`
            : 'Payment claims and received amounts'
        }
        action={
          <IconButton
            label="Add payment claim"
            className="brand-button"
            onClick={() => setAdd(!add)}
          >
            <Plus />
          </IconButton>
        }
      />
      <Button variant="outline" className="full" onClick={() => nav('transactions')}>
        <FileText size={18} /> Transactions, SMS & business expenses <ChevronRight size={18} />
      </Button>
      <div className="notice green">
        <ShieldCheck size={22} />
        <span>
          {mode === 'demo'
            ? 'Sample transactions show the review states. No real bKash payment was checked.'
            : 'A TrxID is a claim until receipt is checked. Automatic bKash verification needs an approved provider connection.'}
        </span>
      </div>
      <div className="segments">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          All {w.payments.length}
        </button>
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          To review {review.length}
        </button>
        <button className={tab === 'verified' ? 'active' : ''} onClick={() => setTab('verified')}>
          Verified {verified.length}
        </button>
      </div>
      {add && <ClaimForm onClose={() => setAdd(false)} />}
      <div className="payment-list">
        {list.map((p) => (
          <Card key={p.id} className="payment-card">
            <div className="row between align-start">
              <span>
                <h3>{p.customer}</h3>
                <small className="muted">
                  {p.channel} · {p.order}
                </small>
              </span>
              <Status status={p.status} />
            </div>
            <p className="mono trxid">TrxID {p.trxId}</p>
            <p className="small">
              Customer says <b>{money(p.amount)}</b>
              {p.received !== null && (
                <>
                  {' '}
                  · Recorded receipt{' '}
                  <b className={p.received === p.amount ? 'good-text' : 'bad-text'}>
                    {money(p.received)}
                  </b>
                </>
              )}
            </p>
            {p.note && <p className="small muted">{p.note}</p>}
            {['waiting', 'wrong_amount', 'duplicate'].includes(p.status) && (
              <>
                <div className="row payment-buttons">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(
                          `Hello ${p.customer}, please check payment ${p.trxId} for order ${p.order}. The claimed amount is ${money(p.amount)}. Please send the receipt for review.`,
                        );
                        setError('Request copied. You can share it with the customer.');
                      })
                    }
                  >
                    <Copy size={15} /> Copy request
                  </Button>
                  <Button
                    onClick={() => {
                      setSelected(selected === p.id ? '' : p.id);
                      setAmount(String(p.received ?? p.amount));
                      setNote('');
                    }}
                  >
                    Review <ChevronRight size={16} />
                  </Button>
                </div>
                {selected === p.id && (
                  <div className="review-form">
                    <div className="notice amber">
                      <Info size={17} />
                      <span>
                        Check your actual account before recording receipt. Manual records do not
                        become provider-verified.
                      </span>
                    </div>
                    <Field label="Received amount">
                      <input
                        type="number"
                        min="0"
                        step=".01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Review note">
                      <input
                        value={note}
                        maxLength={500}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="How did you check this payment?"
                      />
                    </Field>
                    <div className="row">
                      <Button
                        variant="danger"
                        disabled={busy || !note.trim()}
                        onClick={() => void decide(p.id, 'rejected')}
                      >
                        Reject
                      </Button>
                      <Button
                        disabled={busy || !note.trim() || !amount || Number(amount) < 0}
                        onClick={() => void decide(p.id, 'manual')}
                      >
                        Record receipt
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        ))}
        {!list.length && (
          <Card>
            <Empty
              title={tab === 'verified' ? 'No provider-verified payments' : 'No payments here yet'}
              detail={
                tab === 'verified'
                  ? 'Only authoritative provider confirmations count as verified. Manual checks stay labelled manual.'
                  : 'Add a payment claim or create a customer payment link.'
              }
            >
              <Button onClick={() => setAdd(true)}>Add payment claim</Button>
            </Empty>
          </Card>
        )}
      </div>
      <Button className="full" variant="outline" onClick={() => nav('orders')}>
        <FileText size={18} /> Customer orders & payment links
      </Button>
    </>
  );
}
function ClaimForm({ onClose }: { onClose: () => void }) {
  const { act } = useStore();
  const [form, setForm] = useState({
      customer: '',
      order: '',
      channel: 'In shop',
      amount: '',
      trxId: '',
    }),
    [requestId] = useState(uid);
  const { run, busy } = useTask();
  const field = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await act({ type: 'payment.create', ...form, amount: Number(form.amount), requestId });
          onClose();
        });
      }}
    >
      <Card>
        <div className="row between">
          <h2>Add payment claim</h2>
          <IconButton label="Close payment form" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        <Field label="Customer name">
          <input
            required
            maxLength={100}
            value={form.customer}
            onChange={(e) => field('customer', e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Order reference">
            <input
              required
              maxLength={80}
              value={form.order}
              onChange={(e) => field('order', e.target.value)}
              placeholder="#1042"
            />
          </Field>
          <Field label="Channel">
            <select value={form.channel} onChange={(e) => field('channel', e.target.value)}>
              {['In shop', 'Facebook', 'Website'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Claimed amount">
          <input
            type="number"
            required
            min=".01"
            max="100000000"
            step=".01"
            value={form.amount}
            onChange={(e) => field('amount', e.target.value)}
          />
        </Field>
        <Field label="TrxID" hint="The 10-character code in the customer’s bKash SMS.">
          <input
            className="mono"
            required
            pattern="[A-Z0-9]{10}"
            maxLength={10}
            value={form.trxId}
            onChange={(e) => field('trxId', e.target.value.toUpperCase())}
          />
        </Field>
        <Button className="full" type="submit" disabled={busy}>
          Save claim
        </Button>
      </Card>
    </form>
  );
}
interface PublicOrder {
  id: string;
  customer: string;
  shop: { name: string; location: string; bkash: string };
  items: { name: string; quantity: number; price: number }[];
  delivery: number;
  total: number;
  payment: Payment | null;
}
export function CustomerPage({ token, nav }: { token?: string; nav: Navigate }) {
  const { mode, setError } = useStore();
  const [order, setOrder] = useState<PublicOrder | null>(null),
    [trxId, setTrxId] = useState(''),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState('');
  const { run, busy } = useTask();
  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (token)
        setOrder(await api<PublicOrder>('/api/public/orders/' + encodeURIComponent(token)));
      else if (mode === 'demo')
        setOrder({
          id: '#1042',
          customer: 'Sample customer',
          shop: { name: 'Shapla Store', location: 'Mirpur 10, Dhaka', bkash: '01XXX-XXXXXX' },
          items: [
            { name: 'Soybean oil 1 L', quantity: 2, price: 190 },
            { name: 'Miniket rice 5 kg', quantity: 2, price: 380 },
          ],
          delivery: 110,
          total: 1250,
          payment: null,
        });
      else throw new Error('Open a payment link shared by a shop.');
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [token]);
  return (
    <main className="customer-page">
      <header className="customer-header">
        <span className="avatar amber">
          {order?.shop.name
            .split(' ')
            .map((x) => x[0])
            .slice(0, 2)
            .join('') || 'GB'}
        </span>
        <span>
          <h2>{order?.shop.name || 'GreenBiz payment'}</h2>
          <small>{order?.shop.location || 'A clear record for every payment'}</small>
        </span>
        <span className="pill good">GreenBiz</span>
      </header>
      {loading ? (
        <div className="loading-panel">Opening order…</div>
      ) : loadError ? (
        <Card>
          <Empty title="Order unavailable" detail={loadError}>
            <Button onClick={() => void load()}>
              <RefreshCw size={16} /> Try again
            </Button>
          </Empty>
        </Card>
      ) : (
        order && (
          <>
            <Card>
              <h2>Your order {order.id}</h2>
              {order.items.map((p, i) => (
                <div className="invoice-row" key={i}>
                  <span>
                    {p.name} × {p.quantity}
                  </span>
                  <b>{money(p.price * p.quantity)}</b>
                </div>
              ))}
              <div className="invoice-row">
                <span>Delivery</span>
                <b>{money(order.delivery)}</b>
              </div>
              <div className="total-row">
                <b>Total</b>
                <strong>{money(order.total)}</strong>
              </div>
            </Card>
            <Card>
              <div className="payment-step">
                <span className="step-number">1</span>
                <span>
                  <h3>Send {money(order.total)} by bKash</h3>
                  <p className="small muted">
                    Use Send Money to the shop’s personal number. Verify the recipient name in
                    bKash.
                  </p>
                  <div className="row between">
                    <b className="mono">{order.shop.bkash || 'Shop has not provided a number'}</b>
                    <Button
                      variant="outline"
                      disabled={!order.shop.bkash}
                      onClick={() =>
                        void run(async () => {
                          await navigator.clipboard.writeText(order.shop.bkash);
                          setError('Number copied');
                        })
                      }
                    >
                      <Copy size={15} /> Copy
                    </Button>
                  </div>
                </span>
              </div>
              <div className="payment-step">
                <span className="step-number">2</span>
                <span>
                  <h3>Enter your TrxID</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        if (!token)
                          throw new Error('This is a sample invoice. No payment was submitted.');
                        setOrder(
                          await api<PublicOrder>(
                            '/api/public/orders/' + encodeURIComponent(token) + '/claim',
                            { trxId },
                          ),
                        );
                        setError('Reference submitted for shop review.');
                      });
                    }}
                  >
                    <Field label="bKash TrxID" hint="The 10-character code in your bKash SMS.">
                      <input
                        required
                        pattern="[A-Z0-9]{10}"
                        maxLength={10}
                        className="mono"
                        value={trxId}
                        onChange={(e) => setTrxId(e.target.value.toUpperCase())}
                        placeholder="e.g. 9KX4QT7B2M"
                      />
                    </Field>
                    <Button
                      className="full"
                      disabled={busy || (!!order.payment && order.payment.status !== 'rejected')}
                      type="submit"
                    >
                      {order.payment?.status === 'rejected'
                        ? 'Submit corrected reference'
                        : order.payment
                          ? 'Reference submitted'
                          : 'Submit for review'}{' '}
                      <ArrowRight size={17} />
                    </Button>
                  </form>
                </span>
              </div>
            </Card>
            {order.payment && (
              <Card className="payment-result">
                <Status status={order.payment.status} />
                <h2>
                  {order.payment.status === 'verified'
                    ? 'Payment verified'
                    : order.payment.status === 'manual'
                      ? 'Receipt recorded by shop'
                      : order.payment.status === 'rejected'
                        ? 'Please check your reference'
                        : 'Your reference is with the shop'}
                </h2>
                <p className="muted">
                  {order.payment.status === 'verified'
                    ? `${order.shop.name} received ${money(order.payment.received || order.total)}.`
                    : order.payment.status === 'manual'
                      ? 'The shop manually recorded receipt. This is not a provider verification.'
                      : order.payment.status === 'rejected'
                        ? 'The shop rejected this reference. Check the details and submit a corrected TrxID.'
                        : 'The shop needs to check the received amount. Submission alone does not verify payment.'}
                </p>
                <Button variant="outline" onClick={() => void load()}>
                  <RefreshCw size={16} /> Refresh status
                </Button>
              </Card>
            )}
          </>
        )
      )}
      <footer className="customer-footer">
        <Lock size={14} /> Powered by GreenBiz
        {mode === 'demo' && (
          <Button variant="ghost" onClick={() => nav('orders')}>
            Back to shop
          </Button>
        )}
      </footer>
    </main>
  );
}
export function Orders({ nav }: { nav: Navigate }) {
  const { workspace: w, mode, setError } = useStore();
  const [customer, setCustomer] = useState(''),
    [delivery, setDelivery] = useState('0'),
    [cart, setCart] = useState<Record<string, number>>({}),
    [link, setLink] = useState(''),
    [orders, setOrders] = useState<
      { token: string; total: number; customer: string; createdAt: string }[]
    >([]);
  const { run, busy } = useTask();
  useEffect(() => {
    if (mode === 'server')
      void run(async () => {
        const result = await api<{ orders: typeof orders }>('/api/orders');
        setOrders(result.orders);
      });
  }, [mode]);
  if (!w) return null;
  const selected = w.products.filter((p) => cart[p.id] > 0);
  return (
    <>
      <PageHeader
        title="Customer orders"
        subtitle="An invoice and a clear place to submit payment"
        back={() => nav('payments')}
      />
      {mode !== 'server' && (
        <div className="notice amber">
          <Info size={18} />
          <span>
            Public payment links need a reachable business server. Device records are private to
            this phone.
          </span>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (mode !== 'server')
              throw new Error('Connect to a business server to publish a customer payment link.');
            const r = await api<{ token: string; url: string }>('/api/orders', {
              customer,
              delivery: Number(delivery),
              items: selected.map((p) => ({ name: p.name, quantity: cart[p.id], price: p.price })),
            });
            setLink(r.url);
            const list = await api<{ orders: typeof orders }>('/api/orders');
            setOrders(list.orders);
          });
        }}
      >
        <Card>
          <h2>Create a payment link</h2>
          <Field label="Customer name">
            <input
              required
              maxLength={100}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </Field>
          <div className="order-products">
            {w.products.map((p) => (
              <div className="invoice-row" key={p.id}>
                <label htmlFor={'order-' + p.id}>
                  {p.name}
                  <small className="muted"> {money(p.price)}</small>
                </label>
                <input
                  id={'order-' + p.id}
                  aria-label={'Order quantity ' + p.name}
                  className="small-quantity"
                  type="number"
                  min="0"
                  max="9999"
                  step="1"
                  value={cart[p.id] || 0}
                  onChange={(e) => setCart({ ...cart, [p.id]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <Field label="Delivery charge">
            <input
              required
              type="number"
              min="0"
              max="100000"
              step=".01"
              value={delivery}
              onChange={(e) => setDelivery(e.target.value)}
            />
          </Field>
          <div className="total-row">
            <b>Total</b>
            <strong>
              {money(selected.reduce((n, p) => n + p.price * cart[p.id], 0) + Number(delivery))}
            </strong>
          </div>
          <Button
            className="full"
            disabled={busy || !selected.length || mode !== 'server'}
            type="submit"
          >
            <Link size={18} /> Create payment link
          </Button>
          {link && (
            <div className="created-link">
              <p className="small break">{link}</p>
              <Button
                variant="outline"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(link);
                    setError('Payment link copied');
                  })
                }
              >
                <Copy size={16} /> Copy link
              </Button>
            </div>
          )}
        </Card>
      </form>
      {orders.length > 0 && (
        <Card>
          <h2>Recent orders</h2>
          {orders.map((o) => (
            <button className="card-link" key={o.token} onClick={() => nav('pay', o.token)}>
              <span>
                {o.customer} · {money(o.total)}
              </span>
              <ChevronRight size={19} />
            </button>
          ))}
        </Card>
      )}
      {mode === 'demo' && (
        <Button variant="outline" className="full" onClick={() => nav('customer')}>
          Preview sample customer page <ChevronRight size={18} />
        </Button>
      )}
    </>
  );
}
