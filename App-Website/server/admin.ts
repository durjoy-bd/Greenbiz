import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './store';
import { emailSchema, passwordSchema } from './validation';
import { createSuperAdmin, promoteSuperAdmin, resetAdminMfa } from './admin-routes';

/**
 * Server-side account tools. Running them needs shell access to the server, which is
 * what makes them a safe way to create the first Super Admin or recover from a lockout.
 */
export async function createBankAccount(options: { dbPath: string; email: string; password: string }): Promise<void> {
  const email = emailSchema.parse(options.email);
  const password = passwordSchema.parse(options.password);
  const passwordHash = await hash(password, 12);
  const db = openDatabase(options.dbPath);
  const at = new Date().toISOString();
  try {
    db.prepare("INSERT INTO users(id,email,password_hash,role,created_at,must_verify,email_verified_at,password_changed_at) VALUES(?,?,?,'bank',?,0,?,?)").run(randomUUID(), email, passwordHash, at, at, at);
  } finally {
    db.close();
  }
}
export async function createAdminAccount(options: { dbPath: string; email: string; password: string; name?: string; demo?: boolean }): Promise<void> {
  const db = openDatabase(options.dbPath);
  try {
    await createSuperAdmin(db, options, new Date().toISOString());
  } finally {
    db.close();
  }
}

const usage = `Usage (set the variables in the environment, never on the command line):
  GREENBIZ_ADMIN_EMAIL, GREENBIZ_ADMIN_PASSWORD [, GREENBIZ_ADMIN_NAME]  admin create-super-admin [--additional] [--demo]
  GREENBIZ_ADMIN_EMAIL                                                    admin promote-super-admin [--force]
  GREENBIZ_ADMIN_EMAIL                                                    admin reset-mfa
  GREENBIZ_BANK_EMAIL, GREENBIZ_BANK_PASSWORD                             admin create-bank
"create-admin" is kept as another name for create-super-admin.
--demo allows an 8+ character shared password and skips two-step verification. Demo servers only.
`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dbPath = process.env.DATABASE_PATH ?? './data/greenbiz.sqlite';
  const command = process.argv[2];
  const email = process.env.GREENBIZ_ADMIN_EMAIL;
  const fail = (message: string) => {
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  };
  if ((command === 'create-super-admin' || command === 'create-admin') && email && process.env.GREENBIZ_ADMIN_PASSWORD) {
    const db = openDatabase(dbPath);
    try {
      const existing = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE access_role='super_admin' AND status='active'").get() as { count: number }).count;
      if (existing > 0 && !process.argv.includes('--additional')) {
        fail('A Super Admin already exists. Add administrators from the admin panel (Users → change role), or pass --additional to create another from the server.');
      } else {
        const demo = process.argv.includes('--demo');
        await createSuperAdmin(db, { email, password: process.env.GREENBIZ_ADMIN_PASSWORD, name: process.env.GREENBIZ_ADMIN_NAME, demo }, new Date().toISOString());
        process.stdout.write(
          demo
            ? 'DEMO Super Admin created: password only, no two-step verification. Anyone with this password controls the server, so use it only on a demo with no real data.\n'
            : 'Super Admin created. Sign in at /admin, set up two-step verification, then remove the password from the environment.\n',
        );
      }
    } catch (error) {
      fail(`Unable to create the Super Admin: ${error instanceof Error && !/password/i.test(error.message) ? error.message : 'check the password policy (10+ characters, three of lowercase, uppercase, numbers and symbols)'}.`);
    } finally {
      db.close();
    }
  } else if (command === 'promote-super-admin' && email) {
    const db = openDatabase(dbPath);
    try {
      promoteSuperAdmin(db, email, new Date().toISOString(), process.argv.includes('--force'));
      process.stdout.write('Account is now a Super Admin. It will set up two-step verification at its next admin sign-in.\n');
    } catch (error) {
      fail(`Unable to promote: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      db.close();
    }
  } else if (command === 'reset-mfa' && email) {
    const db = openDatabase(dbPath);
    try {
      resetAdminMfa(db, email, new Date().toISOString());
      process.stdout.write('Two-step verification cleared. The administrator sets it up again at the next admin sign-in.\n');
    } catch (error) {
      fail(`Unable to reset: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      db.close();
    }
  } else if (command === 'create-bank' && process.env.GREENBIZ_BANK_EMAIL && process.env.GREENBIZ_BANK_PASSWORD) {
    try {
      await createBankAccount({ dbPath, email: process.env.GREENBIZ_BANK_EMAIL, password: process.env.GREENBIZ_BANK_PASSWORD });
      process.stdout.write('Bank account created. Remove the bootstrap password from the environment.\n');
    } catch {
      fail('Unable to create bank account. Check password policy, unique email and database permissions.');
    }
  } else fail(usage);
}
