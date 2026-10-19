import type { Action, Workspace } from '../../shared/types';
import { applyAction } from '../../shared/domain';
export interface SyncEnvelope {
  id: string;
  baseVersion: number;
  action: Action;
  createdAt: string;
}
export interface SyncState {
  base: Workspace;
  pending: SyncEnvelope[];
  optimistic: Workspace;
  conflict?: string;
  errorStatus?: number;
}
export function prepareAction(action: Action): Action {
  if (action.type === 'payment.create' && !action.id) return { ...action, id: crypto.randomUUID() };
  if (action.type === 'product.save' && !action.product.id)
    return { ...action, create: true, product: { ...action.product, id: crypto.randomUUID() } };
  return action;
}
export function replayPending(base: Workspace, pending: SyncEnvelope[]): Workspace {
  return pending.reduce((state, entry) => applyAction(state, entry.action, entry.createdAt), base);
}
