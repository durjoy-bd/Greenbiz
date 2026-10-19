import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './store';
import { emailSchema, passwordSchema } from './validation';
import { createAdministrator } from './admin-routes';

export async function createBankAccount(options: { dbPath: string; email: string; password: string }): Promise<void> {
  const email = emailSchema.parse(options.email);
  const password = passwordSchema.parse(options.password);
  const passwordHash = await hash(password, 12);
  const db = openDatabase(options.dbPath);
  try { db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), email, passwordHash, 'bank', new Date().toISOString()); }
  finally { db.close(); }
}
export async function createAdminAccount(options: { dbPath: string; email: string; password: string }): Promise<void> {
  const db = openDatabase(options.dbPath);
  try { await createAdministrator(db, options.email, options.password, new Date().toISOString()); }
  finally { db.close(); }
}
const usage = 'Usage: set GREENBIZ_ADMIN_EMAIL and GREENBIZ_ADMIN_PASSWORD, then run "admin create-admin";\nor set GREENBIZ_BANK_EMAIL and GREENBIZ_BANK_PASSWORD, then run "admin create-bank".\n';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.DATABASE_PATH ?? './data/greenbiz.sqlite';
  const command = process.argv[2];
  if (command === 'create-admin' && process.env.GREENBIZ_ADMIN_EMAIL && process.env.GREENBIZ_ADMIN_PASSWORD) {
    try {
      await createAdminAccount({ dbPath, email: process.env.GREENBIZ_ADMIN_EMAIL, password: process.env.GREENBIZ_ADMIN_PASSWORD });
      process.stdout.write('Administrator created. Sign in at /#/admin and remove the bootstrap password from the environment.\n');
    } catch { process.stderr.write('Unable to create administrator. Check password policy, unique email and database permissions.\n'); process.exitCode = 1; }
  } else if (command === 'create-bank' && process.env.GREENBIZ_BANK_EMAIL && process.env.GREENBIZ_BANK_PASSWORD) {
    try {
      await createBankAccount({ dbPath, email: process.env.GREENBIZ_BANK_EMAIL, password: process.env.GREENBIZ_BANK_PASSWORD });
      process.stdout.write('Bank account created. Remove the bootstrap password from the environment.\n');
    } catch { process.stderr.write('Unable to create bank account. Check password policy, unique email and database permissions.\n'); process.exitCode = 1; }
  } else {
    process.stderr.write(usage);
    process.exitCode = 1;
  }
}
