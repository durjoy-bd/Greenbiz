import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { FinancialTransaction, PaymentMethod } from '../../shared/types';
import { parsePaymentSms } from '../../shared/sms';
import { methodLabels } from '../../shared/finance';
import { businessTools, lastInboxImport, markInboxImport, toRecord, type PendingPayment } from '../data/business';
import { relativeTime } from '../components/PaymentPicker';
import { haptic } from '../components/Experience';
import { native } from '../data/api';
import { useStore } from '../data/store';
import { Button, Card, Empty, Field, PageHeader } from '../components/UI';
import { useTask } from '../components/useTask';
import { dateLabel, money, uid } from '../utils';
import type { Navigate } from './Dashboard';

export function Transactions({ nav }: { nav: Navigate }) {
  const { workspace: w, act } = useStore(),
    { run, busy } = useTask();
  const [filter, setFilter] = useState('all'),
    [panel, setPanel] = useState<'paste' | 'manual' | ''>(''),
    [sender, setSender] = useState('bKash'),
    [body, setBody] = useState(''),
    [review, setReview] = useState<PendingPayment[]>([]),
    [lastImport, setLastImport] = useState(lastInboxImport),
    [asBusiness, setAsBusiness] = useState(false),
    [message, setMessage] = useState(''),
    [nativeIds, setNativeIds] = useState<string[]>([]);
  const [manual, setManual] = useState({
    amount: '',
    direction: 'in' as 'in' | 'out',
    method: 'cash' as PaymentMethod,
    currency: 'BDT' as 'BDT' | 'INR',
    reference: '',
    party: '',
    note: '',
    date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    business: true,
  });
  useEffect(() => {
    if (native)
      void businessTools
        .pending()
        .then((r) => {
          setReview(r.transactions);
          setNativeIds(r.transactions.map((t) => t.id));
        })
        .catch(() => {});
  }, []);
  if (!w) return null;
  const list = (w.transactions || [])
    .filter((t) =>
      filter === 'all'
        ? true
        : filter === 'business'
          ? t.business
          : filter === 'personal'
            ? !t.business
            : t.source === filter,
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const classify = (t: FinancialTransaction, business: boolean) =>
    void run(async () => {
      await act({ type: 'transaction.classify', id: t.id, business });
      setMessage(
        business
          ? 'Marked as business. It counts toward your sales and score.'
          : 'Marked as personal. It is excluded from business totals and your score.',
      );
    });
  async function importReviewed() {
    await run(async () => {
      const fresh = review.filter((t) => {
        const previous = w?.transactions?.find(
          (p) =>
            p.id === t.id || (t.reference && p.method === t.method && p.reference === t.reference),
        );
        if (
          previous &&
          (previous.amount !== t.amount ||
            previous.direction !== t.direction ||
            (previous.currency ?? 'BDT') !== (t.currency ?? 'BDT'))
        )
          throw new Error(
            'An existing payment reference has a different amount or currency. Check it against your provider account.',
          );
        return !previous;
      });
      if (fresh.length)
        await act({
          type: 'transaction.import',
          transactions: fresh.map((t) => toRecord({ ...t, business: asBusiness })),
          requestId: uid(),
        });
      if (nativeIds.length && native) await businessTools.acknowledge({ ids: nativeIds });
      setMessage(`${review.length} payment messages processed. Existing references are kept once.`);
      setReview([]);
      setNativeIds([]);
      setBody('');
      setPanel('');
    });
  }
  return (
    <>
      <PageHeader
        title="Payment transactions"
        subtitle="Separate shop money from personal money"
        back={() => nav('payments')}
        action={
          <Button onClick={() => setPanel(panel === 'manual' ? '' : 'manual')}>
            <Plus size={18} /> Add
          </Button>
        }
      />
      <div className="notice green">
        <MessageSquare size={20} />
        <span>
          SMS imports are records for review. Confirm money in your provider account before handing
          over goods. Linked receipts count once in reports.
        </span>
      </div>
      {message && (
        <p className="notice green" role="status">
          <Check size={18} />
          {message}
        </p>
      )}
      <div className="feature-actions">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setPanel(panel === 'paste' ? '' : 'paste');
            setMessage('');
          }}
        >
          <MessageSquare size={17} /> Paste SMS
        </Button>
        {native && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await businessTools.readInbox();
                markInboxImport();
                setLastImport(lastInboxImport());
                setReview(result.transactions);
                setNativeIds(result.transactions.map((t) => t.id));
                setMessage(
                  result.transactions.length
                    ? ''
                    : 'No supported payment confirmations found in the last 90 days.',
                );
              })
            }
          >
            <RefreshCw size={17} /> Import 90 days
          </Button>
        )}
        <Button variant="outline" onClick={() => nav('finance')}>
          <ArrowUpRight size={17} /> Reports
        </Button>
      </div>
      {panel === 'paste' && (
        <Card>
          <div className="row between">
            <h2>Paste a payment message</h2>
            <button
              className="icon-button"
              aria-label="Close message entry"
              onClick={() => setPanel('')}
            >
              <X size={18} />
            </button>
          </div>
          <p className="small muted">
            Filtering happens on this device. OTPs, promotions, failed transfers and unknown senders
            are ignored. Only structured payment fields are saved; sender labels can be spoofed.
          </p>
          <Field label="Message sender">
            <select value={sender} onChange={(e) => setSender(e.target.value)}>
              {['bKash', '16247', 'NAGAD', '16167', 'ROCKET', '16216', 'Upay', '16268', 'AD-HDFCBK'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment message">
            <textarea
              maxLength={3000}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Paste a confirmation from your payment provider"
            />
          </Field>
          <Button
            disabled={!body || busy}
            onClick={() =>
              void run(async () => {
                const t = parsePaymentSms(sender, body, new Date().toISOString());
                if (!t)
                  throw new Error(
                    'This message does not match a supported payment confirmation. Add a transaction manually if needed.',
                  );
                setReview([t]);
                setNativeIds([]);
              })
            }
          >
            Review parsed payment
          </Button>
        </Card>
      )}
      {review.length > 0 && (
        <Card className="import-review">
          <div className="row between">
            <h2>Review {review.length} payment records</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setReview([]);
                setNativeIds([]);
              }}
            >
              Close
            </Button>
          </div>
          <p className="small muted">
            Choose the correct shop above before saving. Imports start as personal unless you
            explicitly mark them as business.
          </p>
          <div className="import-preview">
            {review.slice(0, 100).map((t) => (
              <div key={t.id}>
                <div className="row between">
                  <span>
                    <b>
                      {methodLabels[t.method]} · {t.direction === 'in' ? 'In' : 'Out'}
                    </b>
                    <small className="muted">
                      {t.reference} · {dateLabel(t.occurredAt)}
                      {t.party ? ' · ' + t.party : ''}
                    </small>
                  </span>
                  <b>{t.currency === 'INR' ? 'INR ' + t.amount.toFixed(2) : money(t.amount)}</b>
                </div>
                {t.message && (
                  <details>
                    <summary className="small">View message</summary>
                    <p className="sms-text">{t.message}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
          {review.length > 100 && (
            <p className="small muted">
              Showing first 100; all {review.length} records will be processed.
            </p>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={asBusiness}
              onChange={(e) => setAsBusiness(e.target.checked)}
            />{' '}
            These are business payments for {w.shop.name}
          </label>
          <Button className="full" disabled={busy} onClick={() => void importReviewed()}>
            <Upload size={18} /> Save reviewed records
          </Button>
        </Card>
      )}
      {panel === 'manual' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const occurredAt = new Date(manual.date).toISOString();
              await act({
                type: 'transaction.import',
                requestId: uid(),
                transactions: [
                  {
                    id: uid(),
                    amount: Number(manual.amount),
                    direction: manual.direction,
                    method: manual.method,
                    currency: manual.currency,
                    reference: manual.reference.trim(),
                    party: manual.party.trim(),
                    note: manual.note,
                    occurredAt,
                    business: manual.business,
                    source: 'manual',
                  },
                ],
              });
              setPanel('');
              setManual({ ...manual, amount: '', reference: '', party: '', note: '' });
              setMessage('Transaction saved.');
            });
          }}
        >
          <Card>
            <h2>Add money in or out</h2>
            <div className="form-grid">
              <Field label="Direction">
                <select
                  value={manual.direction}
                  onChange={(e) =>
                    setManual({ ...manual, direction: e.target.value as 'in' | 'out' })
                  }
                >
                  <option value="in">Money in</option>
                  <option value="out">Money out / expense</option>
                </select>
              </Field>
              <Field label="Amount">
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1000000000"
                  value={manual.amount}
                  onChange={(e) => setManual({ ...manual, amount: e.target.value })}
                />
              </Field>
              <Field label="Payment method">
                <select
                  value={manual.method}
                  onChange={(e) =>
                    setManual({
                      ...manual,
                      method: e.target.value as PaymentMethod,
                      currency: e.target.value === 'upi' ? 'INR' : 'BDT',
                    })
                  }
                >
                  {Object.entries(methodLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Currency">
                <select
                  value={manual.currency}
                  onChange={(e) =>
                    setManual({ ...manual, currency: e.target.value as 'BDT' | 'INR' })
                  }
                >
                  <option value="BDT">BDT · taka</option>
                  <option value="INR">INR · rupee (separate)</option>
                </select>
              </Field>
            </div>
            <Field label="Date and time">
              <input
                type="datetime-local"
                required
                value={manual.date}
                onChange={(e) => setManual({ ...manual, date: e.target.value })}
              />
            </Field>
            <Field label="Transaction reference (optional)">
              <input
                maxLength={80}
                value={manual.reference}
                onChange={(e) => setManual({ ...manual, reference: e.target.value })}
              />
            </Field>
            <Field label="Counterparty (optional)">
              <input
                maxLength={120}
                value={manual.party}
                onChange={(e) => setManual({ ...manual, party: e.target.value })}
              />
            </Field>
            <Field label="Note">
              <input
                maxLength={500}
                value={manual.note}
                onChange={(e) => setManual({ ...manual, note: e.target.value })}
                placeholder="e.g. Rent, stock purchase, customer payment"
              />
            </Field>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={manual.business}
                onChange={(e) => setManual({ ...manual, business: e.target.checked })}
              />{' '}
              Business transaction
            </label>
            <Button disabled={busy} className="full">
              Save transaction
            </Button>
          </Card>
        </form>
      )}
      {native && lastImport && (
        <p className="small muted">Last inbox import: {relativeTime(lastImport)}</p>
      )}
      <div className="chips" aria-label="Transaction filter">
        {['all', 'sms', 'manual', 'business', 'personal'].map((f) => (
          <button
            key={f}
            className={'chip ' + (filter === f ? 'active' : '')}
            onClick={() => setFilter(f)}
          >
            {f === 'sms' ? 'SMS' : f[0].toUpperCase() + f.slice(1)}
            <small className="muted">
              {' '}
              {(w.transactions || []).filter((t) =>
                f === 'all' ? true : f === 'business' ? t.business : f === 'personal' ? !t.business : t.source === f,
              ).length}
            </small>
          </button>
        ))}
      </div>
      <p className="small muted">
        Swipe right for business, left for personal, or use each record’s button. Tap a record for its
        details. Personal records stay visible but are left out of business totals and your score.
      </p>
      {list.length ? (
        <div>
          {list.slice(0, 200).map((t) => (
            <TransactionRow
              key={t.id}
              t={t}
              saleTotal={w.sales.find((s) => s.id === t.linkedSaleId)?.total}
              busy={busy}
              classify={(business) => classify(t, business)}
              onLink={() => nav('sale', t.id)}
              onDelete={() => {
                if (confirm('Delete this transaction record? Original messages are not deleted.'))
                  void run(() => act({ type: 'transaction.delete', id: t.id }));
              }}
            />
          ))}
          {list.length > 200 && (
            <p className="small muted">
              Showing latest 200 records. Export all records from Settings.
            </p>
          )}
        </div>
      ) : (
        <Card>
          <Empty
            title="A clearer view of your money"
            detail="Add a business expense, paste a payment confirmation, or enable optional Android message imports in Settings."
          />
        </Card>
      )}
      <Button variant="outline" className="full" onClick={() => nav('settings')}>
        Payment message & privacy settings
      </Button>
    </>
  );
}
function TransactionRow({
  t,
  saleTotal,
  busy,
  classify,
  onLink,
  onDelete,
}: {
  t: FinancialTransaction;
  saleTotal?: number;
  busy: boolean;
  classify: (business: boolean) => void;
  onLink: () => void;
  onDelete: () => void;
}) {
  const pointer = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const locked = busy || !!t.linkedSaleId;
  const reset = () => {
    pointer.current = null;
    setDrag(0);
  };
  return (
    <Card className={'transaction-card ' + (t.business ? 'business' : 'personal') + (drag ? ' dragging' : '')}>
      <span className={'swipe-reveal ' + (drag > 0 ? 'to-business' : drag < 0 ? 'to-personal' : '')} aria-hidden="true">
        <span>Business</span>
        <span>Personal</span>
      </span>
      <div
        className="transaction-swipe"
        style={{ touchAction: 'pan-y', transform: drag ? `translateX(${drag}px)` : undefined }}
        onPointerDown={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY, locked: false };
        }}
        onPointerMove={(e) => {
          const p = pointer.current;
          if (!p || locked) return;
          const dx = e.clientX - p.x,
            dy = e.clientY - p.y;
          if (!p.locked) {
            if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
              pointer.current = null;
              return;
            }
            if (Math.abs(dx) < 8) return;
            p.locked = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          // Rubber-band past the threshold so the row never flies off the card.
          const limited = Math.sign(dx) * Math.min(Math.abs(dx), 85 + Math.max(0, Math.abs(dx) - 85) * 0.25);
          if ((Math.abs(drag) > 85) !== (Math.abs(limited) > 85) && Math.abs(limited) > 85) haptic('selection');
          setDrag(limited);
        }}
        onPointerUp={(e) => {
          const p = pointer.current;
          const dx = p ? e.clientX - p.x : 0,
            dy = p ? e.clientY - p.y : 0;
          reset();
          if (!p || locked) {
            if (p && Math.abs(dx) < 8 && Math.abs(dy) < 8) setOpen(!open);
            return;
          }
          if (Math.abs(dx) > 85 && Math.abs(dy) < 60) classify(dx > 0);
          else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) setOpen(!open);
        }}
        onPointerCancel={reset}
      >
        <div className="row between">
          <span className={'icon-tile ' + (t.direction === 'in' ? 'green' : 'amber')}>
            {t.direction === 'in' ? <ArrowDownLeft /> : <ArrowUpRight />}
          </span>
          <div className="transaction-copy">
            <b>{t.note && t.source === 'manual' ? t.note : methodLabels[t.method] + ' payment'}</b>
            <small>{t.party || t.reference || 'Manual record'}</small>
            <small>
              {dateLabel(t.occurredAt, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </small>
          </div>
          <strong>
            {t.direction === 'out' ? '−' : '+'}
            {t.currency === 'INR' ? 'INR ' + t.amount.toFixed(2) : money(t.amount)}
          </strong>
        </div>
      </div>
      {open && (
        <dl className="transaction-detail">
          <dt>Recorded as</dt>
          <dd>{t.source === 'sms' ? 'Imported from SMS' : 'Manual entry'}</dd>
          <dt>Payment method</dt>
          <dd>{methodLabels[t.method]}</dd>
          <dt>Direction</dt>
          <dd>{t.direction === 'in' ? 'Money in' : 'Money out'}</dd>
          {t.reference && (
            <>
              <dt>TrxID / reference</dt>
              <dd className="mono">{t.reference}</dd>
            </>
          )}
          {t.party && (
            <>
              <dt>Counterparty</dt>
              <dd>{t.party}</dd>
            </>
          )}
          <dt>Currency</dt>
          <dd>{t.currency ?? 'BDT'}</dd>
          <dt>When</dt>
          <dd>
            {dateLabel(t.occurredAt, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </dd>
          {t.note && (
            <>
              <dt>Note</dt>
              <dd>{t.note}</dd>
            </>
          )}
          {t.linkedSaleId && (
            <>
              <dt>Linked sale</dt>
              <dd>{saleTotal === undefined ? 'Sale' : money(saleTotal)} · counted once</dd>
            </>
          )}
          <dt>Counts toward</dt>
          <dd>{t.business && (t.currency ?? 'BDT') === 'BDT' ? 'Business totals and your score' : 'Nothing — kept for your records'}</dd>
        </dl>
      )}
      <div className="transaction-footer">
        <span className={'pill ' + (t.business ? 'good' : '')}>
          {t.linkedSaleId ? 'Linked to sale' : t.business ? 'Business' : 'Personal'}
        </span>
        <div className="row">
          {!t.linkedSaleId && (
            <>
              <button disabled={busy} className="text-button" onClick={() => classify(!t.business)}>
                Mark {t.business ? 'personal' : 'business'}
              </button>
              <button
                className="icon-button"
                aria-label="Delete transaction"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>
      {t.business && !t.linkedSaleId && t.direction === 'in' && (t.currency ?? 'BDT') === 'BDT' && (
        <Button className="full" variant="ghost" onClick={onLink}>
          Create a linked sale <ArrowUpRight size={16} />
        </Button>
      )}
    </Card>
  );
}
