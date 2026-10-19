import { expect, it } from 'vitest';
import { createWorkspace, applyAction } from '../../shared/domain';
import { prepareAction, replayPending } from './sync';

it('gives an offline product a stable id so a queued sale targets the same product on replay', () => {
  const base = createWorkspace({});
  const add = prepareAction({
    type: 'product.save',
    product: {
      name: 'Rice',
      category: '',
      unit: 'kg',
      description: '',
      quantity: 3,
      cost: 50,
      price: 60,
      lowAt: 1,
      source: 'manual',
    },
  });
  if (add.type !== 'product.save') throw new Error('wrong action');
  expect(add.product.id).toBeTruthy();
  const at = '2026-10-19T04:00:00Z';
  const sale = {
    type: 'sale.create' as const,
    items: [{ productId: add.product.id!, quantity: 0.5 }],
    method: 'cash' as const,
    channel: 'shop' as const,
    customer: '',
    requestId: 'sale-request',
  };
  const pending = [
    { id: 'add', baseVersion: base.version, action: add, createdAt: at },
    { id: 'sale', baseVersion: base.version + 1, action: sale, createdAt: at },
  ];
  const local = replayPending(base, pending);
  const server = applyAction(applyAction(base, add, at), sale, at);
  expect(local.products).toEqual(server.products);
  expect(local.sales[0].total).toBe(30);
  expect(local.version).toBe(3);
});
it('keeps a queued payment review attached to the exact claim created offline', () => {
  const base = createWorkspace({});
  const create = prepareAction({
    type: 'payment.create',
    customer: 'Test',
    order: 'Test order',
    channel: 'shop',
    amount: 100,
    trxId: 'AA12345678',
    requestId: 'create',
  });
  if (create.type !== 'payment.create') throw new Error('wrong action');
  const at = '2026-10-19T04:00:00Z';
  const local = applyAction(base, create, at);
  expect(local.payments[0].id).toBe(create.id);
  const review = {
    type: 'payment.review' as const,
    id: local.payments[0].id,
    decision: 'manual' as const,
    received: 100,
    note: 'Checked',
  };
  const server = applyAction(base, create, at);
  const replayed = replayPending(server, [
    { id: 'review', baseVersion: server.version, action: review, createdAt: at },
  ]);
  expect(replayed.payments[0]).toMatchObject({ id: create.id, status: 'manual', received: 100 });
});
