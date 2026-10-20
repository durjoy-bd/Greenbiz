import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './store';
import { backupDatabase } from './backup';

describe('versioned SQLite recovery', () => {
  it('backs up a live WAL database into a standalone consistent file and refuses overwrite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'greenbiz-backup-'));
    const path = join(dir, 'source.sqlite'); const target = join(dir, 'backup.sqlite');
    const db = openDatabase(path);
    try {
      db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run('merchant', 'user@example.com', 'hashed', 'merchant', new Date().toISOString());
      await backupDatabase(path, target);
      const copy = new DatabaseSync(target, { readOnly: true });
      try {
        expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
        expect(copy.prepare('SELECT email FROM users').get()).toEqual({ email: 'user@example.com' });
        expect(copy.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
      } finally { copy.close(); }
      await expect(backupDatabase(path, target)).rejects.toThrow(/exist/i);
      await expect(backupDatabase(path, path)).rejects.toThrow();
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
