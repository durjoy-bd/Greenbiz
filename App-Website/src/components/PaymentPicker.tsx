import { useEffect, useState } from 'react';
import { ChevronRight, History, RefreshCw, Wallet } from 'lucide-react';
import type { FinancialTransaction, PaymentMethod } from '../../shared/types';
import { methodLabels } from '../../shared/finance';
import {
  HISTORY_WINDOW_DAYS,
  SUGGESTION_WINDOW_MINUTES,
  matchAmount,
  paymentTolerance,
} from '../../shared/tolerance';
import { businessTools, markInboxImport, type PendingPayment } from '../data/business';
import { native } from '../data/api';
import { useStore } from '../data/store';
import { money } from '../utils';
import { Button, Sheet } from './UI';

/** A message the sale can attach: already in this shop, or still in the phone's review queue. */
export interface Candidate {
  record: Omit<FinancialTransaction, 'linkedSaleId'> & { message?: string };
  pending: boolean;
}
export interface PaymentChoice {
  method: PaymentMethod;
  candidate?: Candidate;
}
const mobileMethods: PaymentMethod[] = ['bkash', 'nagad', 'rocket', 'upay', 'upi', 'bank', 'other'];

export function relativeTime(iso: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Inbound, unlinked BDT receipts from this shop plus any queued on the phone, newest first. */
export function usePaymentCandidates() {
  const { workspace: w } = useStore();
  const [queued, setQueued] = useState<PendingPayment[]>([]);
  const load = async (scan: boolean) => {
    if (!native) return;
    if (scan) {
      // Re-scan the inbox so a payment that just landed can be attached without leaving the sale.
      try {
        const scanned = await businessTools.readInbox();
        markInboxImport();
        setQueued((await businessTools.pending()).transactions.concat(scanned.transactions));
        return;
      } catch {
        /* Inbox access is off; the live queue still works. */
      }
    }
    setQueued((await businessTools.pending()).transactions);
  };
  useEffect(() => {
    void load(false).catch(() => {});
    if (!native) return;
    const listener = businessTools.addListener('paymentReady', () => void load(false).catch(() => {}));
    return () => void listener.then((l) => l.remove());
  }, []);
  const existing = w?.transactions ?? [];
  const known = (p: PendingPayment) =>
    existing.some((t) => t.id === p.id || (p.reference && t.method === p.method && t.reference === p.reference));
  const all: Candidate[] = [
    ...existing.filter((t) => !t.linkedSaleId).map((record) => ({ record, pending: false })),
    ...queued.filter((p, i, list) => !known(p) && list.findIndex((q) => q.id === p.id) === i).map((record) => ({ record, pending: true })),
  ]
    .filter(({ record }) => record.direction === 'in' && (record.currency ?? 'BDT') === 'BDT')
    .filter(({ record }) => Date.now() - Date.parse(record.occurredAt) <= HISTORY_WINDOW_DAYS * 86_400_000)
    .sort((a, b) => b.record.occurredAt.localeCompare(a.record.occurredAt));
  return { candidates: all, refresh: () => load(true) };
}

function CandidateRow({ candidate, total, onPick }: { candidate: Candidate; total: number; onPick: () => void }) {
  const { record } = candidate;
  const match = matchAmount(record.amount, total);
  return (
    <button type="button" className={'candidate ' + (match.fit === 'exact' ? 'match' : '')} onClick={onPick}>
      <span className="icon-tile green">
        <Wallet size={18} />
      </span>
      <span>
        <b>
          {methodLabels[record.method]}{' '}
          {match.fit === 'exact' && <span className="pill good">Matches total</span>}
        </b>
        <small>
          {relativeTime(record.occurredAt)}
          {record.reference ? ' · ' + record.reference : ''}
          {record.party ? ' · ' + record.party : ''}
          {!record.business && !candidate.pending ? ' · personal' : ''}
        </small>
        {match.fit === 'cashOut' && <span className="pill warn">{match.label}</span>}
      </span>
      <b>{money(record.amount)}</b>
      <ChevronRight size={16} />
    </button>
  );
}

export function PaymentPicker({
  total,
  onChoose,
  onClose,
}: {
  total: number;
  onChoose: (choice: PaymentChoice) => void;
  onClose: () => void;
}) {
  const { candidates, refresh } = usePaymentCandidates();
  const [browse, setBrowse] = useState<'' | 'all' | PaymentMethod>('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const rank = { exact: 0, cashOut: 1, outside: 2 } as const;
  const recent = candidates
    .filter(({ record }) => Date.now() - Date.parse(record.occurredAt) <= SUGGESTION_WINDOW_MINUTES * 60_000)
    .sort((a, b) => rank[matchAmount(a.record.amount, total).fit] - rank[matchAmount(b.record.amount, total).fit]);
  const pick = (candidate: Candidate) => onChoose({ method: candidate.record.method, candidate });
  const refreshButton = (
    <Button
      variant="ghost"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true);
        setError('');
        void refresh()
          .catch(() => setError('Could not read new messages. Check payment message access in Settings.'))
          .finally(() => setRefreshing(false));
      }}
    >
      <RefreshCw size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  );
  if (browse) {
    const list = candidates.filter(({ record }) => browse === 'all' || record.method === browse);
    const label = browse === 'all' ? 'payment' : methodLabels[browse];
    return (
      <Sheet title={browse === 'all' ? 'Payment messages' : `Attach a ${label} payment`} onClose={onClose} back={() => setBrowse('')}>
        <p className="small muted">
          {browse === 'all'
            ? `Every incoming payment from the last ${HISTORY_WINDOW_DAYS} days, newest first. Tap the one that paid ${money(total)}.`
            : `Tap the message that confirms this ${label} payment of ${money(total)}, or record it without one.`}
        </p>
        <div className="row between">
          <b className="small">Payment messages</b>
          {native && refreshButton}
        </div>
        {error && <p className="notice amber">{error}</p>}
        <div>
          {list.map((c) => (
            <CandidateRow key={c.record.id} candidate={c} total={total} onPick={() => pick(c)} />
          ))}
          {!list.length && <p className="empty-inline">No incoming {label} payment in the last {HISTORY_WINDOW_DAYS} days.</p>}
        </div>
        {browse !== 'all' && (
          <Button variant="outline" className="full" onClick={() => onChoose({ method: browse })}>
            Use {label} without a message
          </Button>
        )}
      </Sheet>
    );
  }
  return (
    <Sheet title="Mobile money payment" onClose={onClose}>
      <p className="small muted">
        Looking for {money(total)} in payment messages from the last {SUGGESTION_WINDOW_MINUTES} minutes. Cash-out
        charges vary by around {money(paymentTolerance(total))}, so a payment inside that difference still counts.
      </p>
      <div className="row between">
        <b className="small">Payment messages</b>
        {native && refreshButton}
      </div>
      {error && <p className="notice amber">{error}</p>}
      {recent.length ? (
        <div>
          {recent.map((c) => (
            <CandidateRow key={c.record.id} candidate={c} total={total} onPick={() => pick(c)} />
          ))}
        </div>
      ) : (
        <div className="card">
          <b>No payment in the last {SUGGESTION_WINDOW_MINUTES} minutes.</b>
          <p className="small muted">
            The customer may have paid a little earlier, or the confirmation has not landed yet.
            {native ? ' Tap Refresh, look further back, or pick the method below.' : ' Look further back, or pick the method below.'}
          </p>
        </div>
      )}
      <Button variant="ghost" onClick={() => setBrowse('all')}>
        <History size={16} /> Look further back
      </Button>
      <div className="or-divider">or choose the method</div>
      <div className="chips">
        {mobileMethods.map((method) => (
          <button type="button" key={method} className="chip" onClick={() => setBrowse(method)}>
            {methodLabels[method]}
          </button>
        ))}
      </div>
      <p className="small muted">
        Picking a method shows recent payment messages so you can attach the one that matches this sale. Cash is the
        other side of the confirm bar: close this and swipe right.
      </p>
    </Sheet>
  );
}
