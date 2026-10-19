import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Offer, Workspace } from '../shared/types';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const current = db.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number | null };
  if ((current.version ?? 0) > 4) { db.close(); throw new Error('Database schema is newer than this server'); }
  try {
    for (const migration of [{ version: 1, file: './schema.sql' }, { version: 2, file: './migration-002.sql' }, { version: 3, file: './migration-003.sql' }, { version: 4, file: './migration-004.sql' }]) {
      if ((current.version ?? 0) >= migration.version) continue;
      transaction(db, () => {
        db.exec(readFileSync(new URL(migration.file, import.meta.url), 'utf8'));
        db.prepare('INSERT INTO migrations(version,applied_at) VALUES(?,?)').run(migration.version, new Date().toISOString());
      });
    }
  } catch (error) { db.close(); throw error; }
  return db;
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function readWorkspace(db: DatabaseSync, userId: string): Workspace {
  const row = db.prepare('SELECT document FROM workspaces WHERE user_id=?').get(userId) as { document: string } | undefined;
  if (!row) throw new Error('Workspace not found');
  const state = JSON.parse(row.document) as Workspace;
  state.offers = (db.prepare('SELECT document FROM offers WHERE business_id=? ORDER BY created_at,id').all(userId) as { document: string }[]).map(row => JSON.parse(row.document) as Offer);
  return state;
}
export function writeWorkspace(db: DatabaseSync, userId: string, state: Workspace, now: string): void {
  // Offers are authoritative rows owned by bank sessions, never client workspace writes.
  const document = JSON.stringify({ ...state, offers: [] });
  db.prepare('UPDATE workspaces SET document=?,updated_at=? WHERE user_id=?').run(document, now, userId);
}
