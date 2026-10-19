import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  SlidersHorizontal,
  Package,
  TriangleAlert,
  ChevronRight,
  Camera,
  Trash2,
  Check,
  ReceiptText,
  ArrowUpRight,
  Wallet,
  X,
  TrendingUp,
  ShoppingCart,
} from 'lucide-react';
import type { Product, Sale } from '../../shared/types';
import { useStore } from '../data/store';
import { Card, PageHeader, Button, IconButton, Empty, Field, Stepper } from '../components/UI';
import { useTask } from '../components/useTask';
import { money, num, uid, dateLabel } from '../utils';
import type { Navigate } from './Dashboard';
import { methodLabels } from '../../shared/finance';
import { multiplyMoney } from '../../shared/domain';
import { SaleAssist, SwipeCheckout } from '../components/CheckoutTools';
import {
  PaymentPicker,
  relativeTime,
  usePaymentCandidates,
  type Candidate,
} from '../components/PaymentPicker';
import { SUGGESTION_WINDOW_MINUTES, isAttachable, matchAmount } from '../../shared/tolerance';
import { creditProfile } from '../../shared/credit-profile';
import { AnimatedMoney, haptic } from '../components/Experience';
import { businessTools, toRecord } from '../data/business';
import { native } from '../data/api';
const categories = [
  'Cooking oil',
  'Rice & lentils',
  'Snacks',
  'Drinks',
  'Personal care',
  'Household',
  'Other',
];
export function Stock({ nav, initialFilter }: { nav: Navigate; initialFilter?: string }) {
  const { workspace: w } = useStore();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState(initialFilter === 'low' ? 'low' : 'all'),
    [sort, setSort] = useState(false);
  if (!w) return null;
  const low = w.products.filter((p) => p.quantity <= p.lowAt).length;
  const out = w.products.filter((p) => p.quantity <= 0).length;
  const value = w.products.reduce((n, p) => n + p.cost * p.quantity, 0);
  const products = w.products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) &&
        (filter === 'all' || (filter === 'low' && p.quantity <= p.lowAt) || p.category === filter),
    )
    .sort((a, b) =>
      sort
        ? a.name.localeCompare(b.name)
        : Number(a.quantity > a.lowAt) - Number(b.quantity > b.lowAt) ||
          a.name.localeCompare(b.name),
    );
  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={`${num(w.products.length)} items · worth ${money(value)}`}
        action={
          <div className="row">
            <IconButton
              label="Sort by name"
              onClick={() => setSort(!sort)}
              className={sort ? 'selected' : ''}
            >
              <SlidersHorizontal size={20} />
            </IconButton>
            <IconButton label="Add item" onClick={() => nav('product')} className="brand-button">
              <Plus />
            </IconButton>
          </div>
        }
      />
      <Card>
        <div className="row between">
          <h2>Stock at a glance</h2>
          <Button variant="primary" onClick={() => nav('sale')} disabled={!w.products.some((p) => p.quantity > 0)}>
            <ShoppingCart size={17} /> Sell
          </Button>
        </div>
        <div className="glance-grid">
          <div>
            <small>Stock value</small>
            <b>{money(value)}</b>
          </div>
          <div>
            <small>Products tracked</small>
            <b>{num(w.products.length)}</b>
          </div>
          <div>
            <small>{out ? 'Out of stock' : 'Running low'}</small>
            <b className={out || low ? 'bad-text' : ''}>{num(out || low)}</b>
          </div>
        </div>
        {out > 0 && low > out && (
          <p className="small muted">{num(low - out)} more running low.</p>
        )}
        <p className="small muted">Your inventory value feeds into your stock turnover and credit picture.</p>
      </Card>
      <label className="search">
        <Search size={20} />
        <input
          aria-label="Search by name"
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="chips" aria-label="Stock categories">
        {[
          ['all', `All ${w.products.length}`],
          ['low', `Low first · ${low}`],
          ...categories.map((x) => [x, x]),
        ].map(([id, label]) => (
          <button
            key={id}
            className={'chip ' + (filter === id ? 'active' : '')}
            onClick={() => setFilter(id)}
          >
            {id === 'low' && <TriangleAlert size={15} />} {label}
          </button>
        ))}
      </div>
      {products.length ? (
        <Card className="product-list">
          {products.map((p) => (
            <button className="product-row" key={p.id} onClick={() => nav('product', p.id)}>
              <span className={'icon-tile ' + (p.quantity <= p.lowAt ? 'amber' : 'green')}>
                <Package size={23} />
              </span>
              <span className="product-copy">
                <b>{p.name}</b>
                <small>
                  {p.category} · {money(p.price)} / {p.unit.toLowerCase()}
                </small>
                {p.source === 'photo' && (
                  <span className="photo-caption">
                    <Camera size={11} /> added by photo
                  </span>
                )}
              </span>
              <span className="stock-count">
                <b>
                  {p.quantity} <small>{p.quantity <= p.lowAt ? 'left' : 'in stock'}</small>
                </b>
                {p.quantity <= p.lowAt && (
                  <small className="bad-text">
                    <TriangleAlert size={12} /> {p.quantity <= 0 ? 'Out of stock' : 'Low'}
                  </small>
                )}
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </Card>
      ) : (
        <Card>
          <Empty
            title={w.products.length ? 'No matching items' : 'Your shelves start here'}
            detail={
              w.products.length
                ? 'Try a different name or category.'
                : 'Add your first product or take a photo of your stock.'
            }
          >
            <Button onClick={() => nav('product')}>
              {w.products.length ? 'Add item' : 'Add your first item'}
              <Plus size={18} />
            </Button>
          </Empty>
        </Card>
      )}
      <Button variant="outline" className="full" onClick={() => nav('camera')}>
        <Camera size={18} /> Add stock from a photo
      </Button>
    </>
  );
}
export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export function ProductEditor({
  nav,
  id,
  draft,
  onSaveNext,
}: {
  nav: Navigate;
  id?: string;
  draft?: ProductDraft;
  onSaveNext?: () => void;
}) {
  const { workspace: w, act } = useStore();
  const existing = w?.products.find((p) => p.id === id);
  const [form, setForm] = useState<ProductDraft>(
    draft ||
      existing || {
        name: '',
        category: 'Other',
        unit: 'Piece',
        description: '',
        quantity: 0,
        cost: 0,
        price: 0,
        lowAt: 5,
        source: 'manual',
      },
  );
  const { run, busy } = useTask();
  const field = (key: keyof ProductDraft, value: string | number) =>
    setForm({ ...form, [key]: value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const { name, category, unit, description, quantity, cost, price, lowAt, source } = form;
      await act({
        type: 'product.save',
        product: {
          ...(existing ? { id: existing.id } : {}),
          name,
          category,
          unit,
          description,
          quantity,
          cost,
          price,
          lowAt,
          source,
        },
      });
      if (onSaveNext) onSaveNext();
      else nav('stock');
    });
  }
  return (
    <>
      <PageHeader
        title={draft ? 'Check what AI found' : existing ? 'Edit stock' : 'Add stock'}
        subtitle={draft ? 'Review every field before saving' : 'A little detail goes a long way'}
        back={() => nav('stock')}
      />
      {draft && (
        <div className="notice amber">
          <Camera size={18} /> AI suggestions can be wrong. Check names, counts and prices.
        </div>
      )}
      {existing && (
        <QuickRestock
          product={existing}
          onSaved={(quantity) => setForm((previous) => ({ ...previous, quantity }))}
        />
      )}
      <form onSubmit={(e) => void submit(e)}>
        <Card className={draft ? 'ai-form' : ''}>
          <Field label="Product name">
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => field('name', e.target.value)}
              placeholder="e.g. Soybean oil 1 L"
            />
          </Field>
          <div className="form-grid">
            <Field label="Category">
              <select value={form.category} onChange={(e) => field('category', e.target.value)}>
                {[...new Set([...categories, form.category])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Sold as">
              <input
                required
                maxLength={40}
                value={form.unit}
                onChange={(e) => field('unit', e.target.value)}
                placeholder="Bottle"
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              rows={2}
            />
          </Field>
          <div className="field">
            <label htmlFor="product-qty">How many do you have?</label>
            <Stepper
              label="Quantity"
              value={form.quantity}
              onChange={(v) => field('quantity', v)}
            />
            <small className="muted">Decimals are supported for weight, e.g. 2.5 kg.</small>
            {existing && (
              <div className="chips">
                {[1, 5, 10].map((n) => (
                  <button
                    className="chip"
                    type="button"
                    key={n}
                    onClick={() =>
                      field(
                        'quantity',
                        Math.min(1000000, Math.round((form.quantity + n) * 1000) / 1000),
                      )
                    }
                  >
                    Restock +{n}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="form-grid">
            <Field label="You buy at">
              <div className="currency-input">
                <span>৳</span>
                <input
                  type="number"
                  required
                  min="0"
                  max="100000000"
                  step="0.01"
                  value={form.cost}
                  onChange={(e) => field('cost', Number(e.target.value))}
                />
              </div>
            </Field>
            <Field label="You sell at">
              <div className="currency-input">
                <span>৳</span>
                <input
                  type="number"
                  required
                  min="0"
                  max="100000000"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => field('price', Number(e.target.value))}
                />
              </div>
            </Field>
          </div>
          <p className={(form.price >= form.cost ? 'good-text' : 'bad-text') + ' small strong'}>
            You {form.price >= form.cost ? 'earn' : 'lose'}{' '}
            {money(Math.abs(form.price - form.cost))} on each {form.unit.toLowerCase() || 'item'}
          </p>
          <Field
            label="Low-stock reminder"
            hint="An item is low when its quantity reaches this number."
          >
            <input
              type="number"
              required
              min="0"
              max="999999"
              step="0.001"
              value={form.lowAt}
              onChange={(e) => field('lowAt', Number(e.target.value))}
            />
          </Field>
        </Card>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => nav('stock')}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : onSaveNext ? 'Save & next' : 'Save item'}
            <Check size={18} />
          </Button>
        </div>
      </form>
      {existing && (
        <Button
          variant="danger"
          className="full"
          disabled={busy}
          onClick={() => {
            if (confirm('Delete this stock item? Past sales will stay in your records.'))
              void run(async () => {
                await act({ type: 'product.delete', id: existing.id });
                nav('stock');
              });
          }}
        >
          <Trash2 size={17} /> Delete item
        </Button>
      )}
    </>
  );
}
/** Adjust the count without opening the full form. */
function QuickRestock({ product, onSaved }: { product: Product; onSaved: (quantity: number) => void }) {
  const { act } = useStore();
  const { run, busy } = useTask();
  const [count, setCount] = useState(product.quantity);
  const [saved, setSaved] = useState('');
  const status = product.quantity <= 0 ? 'Out of stock' : product.quantity <= product.lowAt ? 'Running low' : 'In stock';
  const adjust = (delta: number) => setCount(Math.max(0, Math.round((count + delta) * 1000) / 1000));
  return (
    <Card>
      <div className="row between">
        <h2>Quick restock</h2>
        <span className={'pill ' + (status === 'In stock' ? 'good' : status === 'Running low' ? 'warn' : 'bad')}>{status}</span>
      </div>
      <div className="glance-grid">
        <div>
          <small>In stock</small>
          <b>
            {product.quantity} {product.unit}
          </b>
        </div>
        <div>
          <small>Unit price</small>
          <b>{money(product.price)}</b>
        </div>
        <div>
          <small>Stock value</small>
          <b>{money(multiplyMoney(product.cost, product.quantity))}</b>
        </div>
      </div>
      <p className="small muted">Adjust the count without opening the full form.</p>
      <Stepper label={'stock of ' + product.name} value={count} onChange={(v) => setCount(Math.max(0, v))} />
      <div className="chips">
        {[-1, 1, 5, 10].map((n) => (
          <button className="chip" type="button" key={n} disabled={count + n < 0} onClick={() => adjust(n)}>
            {n > 0 ? '+' + n : '−' + Math.abs(n)}
          </button>
        ))}
      </div>
      {saved && <p className="small good-text" role="status">{saved}</p>}
      <Button
        className="full"
        disabled={busy || count === product.quantity || !Number.isFinite(count)}
        onClick={() =>
          void run(async () => {
            if (count < 0) throw new Error('Stock cannot go below zero.');
            const { id, name, category, unit, description, cost, price, lowAt, source } = product;
            await act({ type: 'product.save', product: { id, name, category, unit, description, quantity: count, cost, price, lowAt, source } });
            onSaved(count);
            setSaved(`Stock updated to ${count} ${unit}.`);
          })
        }
      >
        <Check size={17} /> Update stock
      </Button>
    </Card>
  );
}
export function RecordSale({ nav, paymentId }: { nav: Navigate; paymentId?: string }) {
  const { workspace: w, act } = useStore();
  const preset = w?.transactions?.find((t) => t.id === paymentId && !t.linkedSaleId);
  const [cart, setCart] = useState<Record<string, number>>({}),
    [query, setQuery] = useState(''),
    [method, setMethod] = useState<Sale['method']>(preset?.method || 'cash'),
    [attached, setAttached] = useState<Candidate | undefined>(
      preset ? { record: preset, pending: false } : undefined,
    ),
    [channel, setChannel] = useState<Sale['channel']>('shop'),
    [customer, setCustomer] = useState(''),
    [requestId, setRequestId] = useState(uid),
    [picker, setPicker] = useState(false),
    [receipt, setReceipt] = useState(''),
    [dismissedLive, setDismissedLive] = useState<string[]>([]);
  const { candidates } = usePaymentCandidates();
  const { run, busy } = useTask();
  if (!w) return null;
  const done = receipt ? w.sales.find((s) => s.requestId === receipt) : undefined;
  if (done)
    return (
      <SaleReceipt
        sale={done}
        nav={nav}
        onNext={() => {
          setCart({});
          setCustomer('');
          setAttached(undefined);
          setMethod('cash');
          setRequestId(uid());
          setReceipt('');
        }}
      />
    );
  const chosen = w.products.filter((p) => cart[p.id] > 0),
    total =
      chosen.reduce((n, p) => n + Math.round(multiplyMoney(p.price, cart[p.id]) * 100), 0) / 100;
  const add = (p: Product) =>
    setCart({ ...cart, [p.id]: Math.min(p.quantity, (cart[p.id] || 0) + 1) });
  const matching = w.products.filter(
    (p) => p.quantity > 0 && p.name.toLowerCase().includes(query.toLowerCase()),
  );
  // A payment message that landed in the last few minutes and fits this receipt.
  const live =
    !attached && total > 0
      ? candidates.find(
          (c) =>
            c.pending &&
            !dismissedLive.includes(c.record.id) &&
            Date.now() - Date.parse(c.record.occurredAt) <= SUGGESTION_WINDOW_MINUTES * 60_000 &&
            isAttachable(c.record.amount, total),
        )
      : undefined;
  async function save(paidBy: Sale['method'], candidate = attached) {
    let link = candidate;
    if (link && !isAttachable(link.record.amount, total)) {
      const away = matchAmount(link.record.amount, total).label;
      if (
        !confirm(
          `The totals do not match. This payment is ${away} from the receipt, outside the cash-out band.\n\nIf you continue, the payment and the sale are recorded as two separate records. Record separately?`,
        )
      )
        return;
      link = undefined;
    }
    await run(async () => {
      const message = link ?? candidate;
      if (message?.pending) {
        // Payments waiting on the phone become business records of this shop first.
        await act({
          type: 'transaction.import',
          requestId: uid(),
          transactions: [toRecord({ ...message.record, business: true })],
        });
        if (native) await businessTools.acknowledge({ ids: [message.record.id] }).catch(() => {});
      } else if (link && !link.record.business)
        await act({ type: 'transaction.classify', id: link.record.id, business: true });
      await act({
        type: 'sale.create',
        items: chosen.map((p) => ({ productId: p.id, quantity: cart[p.id] })),
        method: link ? link.record.method : paidBy,
        channel,
        customer,
        requestId,
        ...(link ? { transactionId: link.record.id } : {}),
      });
      setReceipt(requestId);
    });
  }
  const attachedMatch = attached ? matchAmount(attached.record.amount, total) : undefined;
  return (
    <>
      <PageHeader
        title="New sale"
        subtitle="Stock updates as soon as you save"
        back={() => nav('home')}
      />
      {live && (
        <div className="live-banner" role="status">
          <Wallet size={18} />
          <span>
            <b>Payment received · {methodLabels[live.record.method]}</b>{' '}
            <small>
              {money(live.record.amount)} · {matchAmount(live.record.amount, total).label}
            </small>
          </span>
          <Button
            variant="outline"
            onClick={() => {
              setAttached(live);
              setMethod(live.record.method);
            }}
          >
            Attach
          </Button>
          <IconButton
            label="Not this sale"
            onClick={() => setDismissedLive([...dismissedLive, live.record.id])}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
      <SaleAssist
        products={w.products}
        onItems={(items) =>
          setCart((previous) => {
            const next = { ...previous };
            for (const item of items) next[item.productId] = item.quantity;
            return next;
          })
        }
      />
      <label className="search">
        <Search size={18} />
        <input
          aria-label="Search your inventory"
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <Card className="sale-picker">
        {matching.slice(0, 30).map((p) => (
          <button
            key={p.id}
            className="sale-pick"
            onClick={() => add(p)}
            disabled={cart[p.id] >= p.quantity}
          >
            <span className="icon-tile green">
              <Package size={20} />
            </span>
            <span>
              <b>{p.name}</b>
              <small>
                In stock: {p.quantity} {p.unit}
              </small>
            </span>
            <b>{money(p.price)}</b>
            <Plus size={18} />
          </button>
        ))}
        {matching.length > 30 && (
          <p className="small muted">Showing the first 30. Keep typing to narrow it down.</p>
        )}
        {query && !matching.length && (
          <p className="small muted">Nothing in your inventory matches “{query}”.</p>
        )}
        {!w.products.some((p) => p.quantity > 0) && (
          <Empty title="Nothing to sell yet" detail="Add stock before recording a sale.">
            <Button onClick={() => nav('product')}>Add item</Button>
          </Empty>
        )}
      </Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(method);
        }}
      >
        <Card>
          <div className="row between">
            <h2>
              Receipt <span className="muted">· {chosen.length} items</span>
            </h2>
            {chosen.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (confirm('Clear this receipt? The items are removed. Nothing has been sold yet.'))
                    setCart({});
                }}
              >
                Clear receipt
              </button>
            )}
          </div>
          {chosen.length > 0 && (
            <p className="small muted">
              {chosen.length} items · stock will be reduced when you confirm
            </p>
          )}
          {chosen.map((p) => (
            <div className="cart-row" key={p.id}>
              <div className="row between">
                <b>{p.name}</b>
                <strong>{money(multiplyMoney(p.price, cart[p.id]))}</strong>
              </div>
              <Stepper
                value={cart[p.id]}
                max={p.quantity}
                label={'quantity of ' + p.name}
                onChange={(v) => setCart({ ...cart, [p.id]: v })}
              />
              <small className="muted">
                {money(p.price)} per {p.unit.toLowerCase()} · {p.quantity} in stock
              </small>
            </div>
          ))}
          {!chosen.length && (
            <p className="muted small">Tap a product above, or dictate the sale.</p>
          )}
          <div className="total-row">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <Field label="Paid by">
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as Sale['method']);
                if (attached && attached.record.method !== e.target.value) setAttached(undefined);
              }}
            >
              {Object.entries(methodLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {attached ? (
            <div className="candidate match">
              <span className="icon-tile green">
                <Wallet size={18} />
              </span>
              <span>
                <b>Payment message · {methodLabels[attached.record.method]}</b>
                <small>
                  {relativeTime(attached.record.occurredAt)}
                  {attached.record.reference ? ' · TrxID ' + attached.record.reference : ''}
                </small>
                {attachedMatch && total > 0 && (
                  <span
                    className={
                      'pill ' +
                      (attachedMatch.fit === 'outside'
                        ? 'bad'
                        : attachedMatch.fit === 'exact'
                          ? 'good'
                          : 'warn')
                    }
                  >
                    {attachedMatch.label}
                  </span>
                )}
              </span>
              <b>{money(attached.record.amount)}</b>
              <IconButton label="Remove payment message" onClick={() => setAttached(undefined)}>
                <X size={16} />
              </IconButton>
            </div>
          ) : (
            method !== 'cash' && (
              <Button
                type="button"
                variant="outline"
                className="full"
                disabled={!chosen.length}
                onClick={() => setPicker(true)}
              >
                <Wallet size={17} /> Attach a payment message
              </Button>
            )
          )}
          {method !== 'cash' && (
            <p className="small muted">
              Attaching a message links this sale to that payment, so the money is counted once. A
              message is not provider verification: confirm receipt in your {methodLabels[method]}{' '}
              account.
            </p>
          )}
          <div className="form-grid">
            <Field label="Sales channel">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as Sale['channel'])}
              >
                <option value="shop">In the shop</option>
                <option value="facebook">Facebook</option>
                <option value="website">Website</option>
              </select>
            </Field>
            <Field label="Customer name (optional)">
              <input
                maxLength={100}
                value={customer}
                placeholder="Walk-in customer"
                onChange={(e) => setCustomer(e.target.value)}
              />
            </Field>
          </div>
        </Card>
        <Button disabled={!chosen.length || busy} className="full" type="submit">
          {busy ? 'Recording sale…' : 'Save sale'} <ReceiptText size={18} />
        </Button>
        <SwipeCheckout
          disabled={!chosen.length || busy}
          onCash={() => {
            if (confirm(`Save this ${money(total)} sale as cash?`)) void save('cash', undefined);
          }}
          onMobile={() => {
            if (attached) void save(attached.record.method, attached);
            else setPicker(true);
          }}
        />
      </form>
      {picker && (
        <PaymentPicker
          total={total}
          onClose={() => setPicker(false)}
          onChoose={(choice) => {
            setPicker(false);
            setMethod(choice.method);
            setAttached(choice.candidate);
            void save(choice.method, choice.candidate);
          }}
        />
      )}
    </>
  );
}
function SaleReceipt({ sale, nav, onNext }: { sale: Sale; nav: Navigate; onNext: () => void }) {
  const { workspace: w } = useStore();
  useEffect(() => haptic('success'), []);
  if (!w) return null;
  const linked = sale.transactionId
    ? w.transactions?.find((t) => t.id === sale.transactionId)
    : undefined;
  const profile = creditProfile(w);
  return (
    <>
      <PageHeader title="Sale recorded" subtitle="Stock has been reduced" back={() => nav('home')} />
      <Card className="receipt-card">
        <span className="receipt-mark">
          <Check size={28} />
        </span>
        <h2 className="center receipt-amount">
          <AnimatedMoney value={sale.total} />
        </h2>
        <p className="center small muted">
          {dateLabel(sale.createdAt, {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · {sale.customer || 'Walk-in customer'}
        </p>
        {sale.items.map((item) => (
          <div className="receipt-line" key={item.productId}>
            <span>
              {item.name} × {item.quantity}
            </span>
            <span>{money(multiplyMoney(item.price, item.quantity))}</span>
          </div>
        ))}
        <div className="receipt-line receipt-total">
          <span>Total</span>
          <span>{money(sale.total)}</span>
        </div>
        <div className="receipt-line">
          <span>Paid by</span>
          <b>{methodLabels[sale.method]}</b>
        </div>
        {linked && (
          <div className="receipt-line">
            <span>Payment message</span>
            <b>
              {money(linked.amount)} · {matchAmount(linked.amount, sale.total).label}
            </b>
          </div>
        )}
        {linked?.reference && (
          <div className="receipt-line">
            <span>TrxID</span>
            <b className="mono">{linked.reference}</b>
          </div>
        )}
        <p className="notice green">
          <TrendingUp size={18} />
          Your credit profile is now {profile.score}/100 ({profile.band}).
        </p>
      </Card>
      <div className="form-actions">
        <Button variant="outline" onClick={() => nav('home')}>
          Done
        </Button>
        <Button onClick={onNext}>
          New sale <Plus size={18} />
        </Button>
      </div>
    </>
  );
}
export function SalesHistory({ nav }: { nav: Navigate }) {
  const { workspace: w } = useStore();
  if (!w) return null;
  return (
    <>
      <PageHeader
        title="Sales"
        subtitle={`${num(w.sales.length)} recorded sales`}
        action={
          <Button onClick={() => nav('sale')}>
            <Plus size={17} /> Record sale
          </Button>
        }
      />
      {w.sales.length ? (
        <Card className="sales-history">
          {w.sales
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 100)
            .map((s) => (
              <div className="history-row" key={s.id}>
                <span className="icon-tile green">
                  <ArrowUpRight />
                </span>
                <span>
                  <b>{s.items.map((i) => i.name + ' ×' + i.quantity).join(', ')}</b>
                  <small>
                    {dateLabel(s.createdAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    · {methodLabels[s.method]} · {s.channel} · {s.customer || 'Walk-in customer'}
                  </small>
                </span>
                <strong>{money(s.total)}</strong>
              </div>
            ))}
          {w.sales.length > 100 && (
            <p className="small muted">Showing the latest 100. Export all sales from Settings.</p>
          )}
        </Card>
      ) : (
        <Card>
          <Empty
            title="Your first sale is next"
            detail="Every recorded sale helps you understand your business."
          >
            <Button onClick={() => nav('sale')}>Record sale</Button>
          </Empty>
        </Card>
      )}
    </>
  );
}
