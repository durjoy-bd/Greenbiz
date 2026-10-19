import { useEffect, useRef, useState } from 'react';
import { ReceiptText, Wallet } from 'lucide-react';
import { methodLabels } from '../../shared/finance';
import { businessTools, toRecord, type PendingPayment } from '../data/business';
import { native } from '../data/api';
import { useStore } from '../data/store';
import { useTask } from './useTask';
import { money, uid } from '../utils';
import { relativeTime } from './PaymentPicker';
import { Button, Sheet } from './UI';

/**
 * "Payment received" prompt for a payment message that arrives while GreenBiz is
 * open, or when its notification is tapped. Creating a sale saves the payment to
 * the active shop as business income and links it, so the money counts once.
 */
export function LivePayment({ nav, page }: { nav: (page: string, id?: string) => void; page: string }) {
  const { workspace: w, act, mode, user, shopId } = useStore();
  const { run, busy } = useTask();
  const [payment, setPayment] = useState<PendingPayment | null>(null);
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (!native || !mode || user?.role === 'bank') return;
    let active = true;
    const check = (force: boolean) =>
      void businessTools
        .pending()
        .then(({ transactions }) => {
          const newest = transactions
            .filter((t) => force || !shown.current.has(t.id))
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
          // Only fresh arrivals pop up; older queued messages wait in Payments.
          const fresh = newest && (force || Date.now() - Date.parse(newest.occurredAt) < 30 * 60_000);
          if (active && fresh) {
            shown.current.add(newest.id);
            setPayment(newest);
          }
        })
        .catch(() => {});
    void businessTools
      .status()
      .then((s) => s.openPayments && check(true))
      .catch(() => {});
    const listener = businessTools.addListener('paymentReady', () => check(false));
    const open = () => check(true);
    window.addEventListener('greenbizPayment', open);
    return () => {
      active = false;
      window.removeEventListener('greenbizPayment', open);
      void listener.then((l) => l.remove());
    };
  }, [mode, user?.id, shopId]);
  // The sale screen shows its own "Payment received" banner instead.
  if (!payment || !w || page === 'sale') return null;
  const close = () => setPayment(null);
  const incoming = payment.direction === 'in' && (payment.currency ?? 'BDT') === 'BDT';
  return (
    <Sheet title={incoming ? 'Payment received' : 'Payment message'} onClose={close}>
      <div className="candidate match">
        <span className="icon-tile green">
          <Wallet size={18} />
        </span>
        <span>
          <b>
            {methodLabels[payment.method]} · {payment.direction === 'in' ? 'money in' : 'money out'}
          </b>
          <small>
            {relativeTime(payment.occurredAt)}
            {payment.party ? ' · ' + payment.party : ''}
          </small>
          {payment.reference && <small className="mono">TrxID {payment.reference}</small>}
        </span>
        <b>{payment.currency === 'INR' ? 'INR ' + payment.amount.toFixed(2) : money(payment.amount)}</b>
      </div>
      {payment.message && (
        <details>
          <summary className="small strong">The message</summary>
          <p className="sms-text">{payment.message}</p>
        </details>
      )}
      {incoming ? (
        <>
          <p className="small muted">
            Create the sale now and this payment is linked to it, so the money is counted once. It is saved to{' '}
            <b>{w.shop.name}</b> as business income. A message is not provider verification.
          </p>
          <Button
            className="full"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!w.transactions?.some((t) => t.id === payment.id))
                  await act({ type: 'transaction.import', requestId: uid(), transactions: [toRecord({ ...payment, business: true })] });
                await businessTools.acknowledge({ ids: [payment.id] }).catch(() => {});
                close();
                nav('sale', payment.id);
              })
            }
          >
            <ReceiptText size={18} /> Create a sale
          </Button>
        </>
      ) : (
        <p className="small muted">Outgoing and foreign-currency payments are reviewed in Payments.</p>
      )}
      <Button
        variant="outline"
        className="full"
        onClick={() => {
          close();
          if (!incoming) nav('transactions');
        }}
      >
        {incoming ? 'Not now, keep it in Payments' : 'Review in Payments'}
      </Button>
    </Sheet>
  );
}
