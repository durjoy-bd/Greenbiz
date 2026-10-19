import { backup, DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function backupDatabase(source: string, target: string): Promise<void> {
  const sourcePath = resolve(source); const targetPath = resolve(target);
  if (sourcePath.toLowerCase() === targetPath.toLowerCase()) throw new Error('Backup target must differ from the source');
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    // Reserve a new destination atomically. Never overwrite an existing backup.
    closeSync(openSync(targetPath, 'wx', 0o600));
    await backup(db, targetPath);
    const copy = new DatabaseSync(targetPath, { readOnly: true });
    try {
      const result = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (result.integrity_check !== 'ok') throw new Error('Backup integrity check failed');
    } finally { copy.close(); }
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) { process.stderr.write('Usage: npx tsx server/backup.ts <new-backup-path>\n'); process.exitCode = 1; }
  else {
    try { await backupDatabase(process.env.DATABASE_PATH ?? './data/greenbiz.sqlite', process.argv[2]); process.stdout.write('Consistent SQLite backup created and verified.\n'); }
    catch { process.stderr.write('Backup failed. Check source access and choose a new destination. A partial destination may need inspection.\n'); process.exitCode = 1; }
  }
}
