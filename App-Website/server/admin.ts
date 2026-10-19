import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './store';
import { emailSchema, passwordSchema } from './validation';

export async function createBankAccount(options: { dbPath: string; email: string; password: string }): Promise<void> {
  const email = emailSchema.parse(options.email);
  const password = passwordSchema.parse(options.password);
  const passwordHash = await hash(password, 12);
  const db = openDatabase(options.dbPath);
  try { db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), email, passwordHash, 'bank', new Date().toISOString()); }
  finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'create-bank' || !process.env.GREENBIZ_BANK_EMAIL || !process.env.GREENBIZ_BANK_PASSWORD) {
    process.stderr.write('Usage: set GREENBIZ_BANK_EMAIL and GREENBIZ_BANK_PASSWORD, then npx tsx server/admin.ts create-bank\n'); process.exitCode = 1;
  } else {
    try {
      await createBankAccount({ dbPath: process.env.DATABASE_PATH ?? './data/greenbiz.sqlite', email: process.env.GREENBIZ_BANK_EMAIL, password: process.env.GREENBIZ_BANK_PASSWORD });
      process.stdout.write('Bank account created. Remove the bootstrap password from the environment.\n');
    } catch { process.stderr.write('Unable to create bank account. Check password policy, unique email and database permissions.\n'); process.exitCode = 1; }
  }
}
