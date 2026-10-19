import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../shared/domain';
import { openDatabase, readWorkspace } from './store';

describe('shop ownership migration', () => {
  it('preserves legacy workspaces, order routing, offers, interest and request identities', () => {
    const dir = mkdtempSync(join(tmpdir(), 'greenbiz-migration-')); const path = join(dir, 'db.sqlite');
    const legacy = new DatabaseSync(path);
    const timestamp = new Date().toISOString();
    legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const [index, file] of ['schema.sql', 'migration-002.sql', 'migration-003.sql'].entries()) {
      legacy.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
      legacy.prepare('INSERT INTO migrations VALUES(?,?)').run(index + 1, timestamp);
    }
    for (const [id, role] of [['owner', 'merchant'], ['bank', 'bank']]) legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id, `${id}@example.com`, 'hash', role, timestamp);
    const state = createWorkspace({ name: 'Legacy shop', shareScore: true });
    state.payments.push({ id: 'payment', customer: 'Buyer', order: 'invoice', channel: 'website', amount: 100, received: null, trxId: 'AAA1234567', status: 'waiting', createdAt: timestamp, note: '' });
    legacy.prepare('INSERT INTO workspaces VALUES(?,?,?)').run('owner', JSON.stringify(state), timestamp);
    legacy.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run('token', 'owner', '{"id":"invoice"}', 'payment', timestamp);
    legacy.prepare('INSERT INTO offers VALUES(?,?,?,?,?)').run('offer', 'owner', 'bank', '{"id":"offer"}', timestamp);
    legacy.prepare('INSERT INTO interests VALUES(?,?,?,?,?)').run('interest', 'offer', 'owner', 'Please contact me', timestamp);
    legacy.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run('owner', 'request', 'fingerprint', timestamp, 'payment');
    legacy.prepare('INSERT INTO payment_claims VALUES(?,?,?,?)').run('payment', 'owner', 'AAA1234567', timestamp);
    legacy.close();
    const db = openDatabase(path);
    try {
      expect(db.prepare('SELECT id,owner_id FROM shops').all()).toEqual([{ id: 'owner', owner_id: 'owner' }]);
      expect(readWorkspace(db, 'owner').shop).toEqual(state.shop);
      expect(readWorkspace(db, 'owner').payments).toEqual(state.payments);
      expect(readWorkspace(db, 'owner').offers).toEqual([{ id: 'offer' }]);
      expect(db.prepare('SELECT user_id,payment_id FROM orders').get()).toEqual({ user_id: 'owner', payment_id: 'payment' });
      expect(db.prepare('SELECT result_id FROM idempotency').get()).toEqual({ result_id: 'payment' });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      db.prepare('DELETE FROM users WHERE id=?').run('owner');
      for (const table of ['shops', 'workspaces', 'orders', 'offers', 'interests', 'idempotency', 'payment_claims']) expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
