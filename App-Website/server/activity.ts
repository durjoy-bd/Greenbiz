import type { Action, Workspace } from '../shared/types';

export interface Described {
  action: string;
  description: string;
  recordType?: string;
  recordId?: string;
}
const quote = (text: string) => `"${text.length > 60 ? text.slice(0, 57) + '…' : text}"`;
const added = <T extends { id: string }>(before: T[], after: T[]) => {
  const known = new Set(before.map((item) => item.id));
  return after.filter((item) => !known.has(item.id));
};
const taka = (amount: number) => '৳' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount);

/** A short, readable line for one applied shop action, with the record it touched. */
export function describeAction(action: Action, before: Workspace, after: Workspace): Described {
  switch (action.type) {
    case 'product.save': {
      const created = added(before.products, after.products)[0];
      const product = created ?? after.products.find((p) => p.id === action.product.id);
      return created
        ? { action: 'product.create', description: `Added product ${quote(created.name)}`, recordType: 'product', recordId: created.id }
        : { action: 'product.update', description: `Updated product ${quote(product?.name ?? action.product.name)}`, recordType: 'product', recordId: product?.id ?? action.product.id };
    }
    case 'product.delete': {
      const product = before.products.find((p) => p.id === action.id);
      return { action: 'product.delete', description: `Deleted product ${quote(product?.name ?? 'unknown')}`, recordType: 'product', recordId: action.id };
    }
    case 'sale.create': {
      const sale = added(before.sales, after.sales)[0];
      return { action: 'sale.create', description: `Recorded a sale${sale ? ' of ' + taka(sale.total) : ''}`, recordType: 'sale', recordId: sale?.id };
    }
    case 'transaction.import': {
      const count = added(before.transactions ?? [], after.transactions ?? []).length;
      return { action: 'transaction.import', description: `Imported ${count} payment record${count === 1 ? '' : 's'}`, recordType: 'transaction' };
    }
    case 'transaction.classify':
      return { action: 'transaction.classify', description: `Marked a payment record as ${action.business ? 'business' : 'personal'}`, recordType: 'transaction', recordId: action.id };
    case 'transaction.delete':
      return { action: 'transaction.delete', description: 'Deleted a payment record', recordType: 'transaction', recordId: action.id };
    case 'payment.create': {
      const payment = added(before.payments, after.payments)[0];
      return { action: 'payment.create', description: `Recorded a payment claim of ${taka(action.amount)}`, recordType: 'payment', recordId: payment?.id ?? action.id };
    }
    case 'payment.review':
      return { action: 'payment.review', description: action.decision === 'rejected' ? 'Rejected a payment claim' : 'Accepted a payment claim after manual review', recordType: 'payment', recordId: action.id };
    case 'shop.update': {
      if (action.shop.shareScore !== undefined && action.shop.shareScore !== before.shop.shareScore)
        return { action: 'shop.sharing', description: action.shop.shareScore ? 'Started sharing the business score with banks' : 'Stopped sharing the business score with banks', recordType: 'shop' };
      return { action: 'shop.update', description: `Updated shop details for ${quote(after.shop.name)}`, recordType: 'shop' };
    }
  }
}
