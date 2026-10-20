import { expect, type APIRequestContext } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const origin = `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}`;
/** The API server writes emails here when started with MAIL_TRANSPORT=outbox (development only). */
export const outbox = resolve(process.env.E2E_OUTBOX ?? 'tmp/outbox');

/** The token from the newest email to `to` whose link opens `path`, waiting for delivery. */
export async function emailedToken(to: string, path: string): Promise<string> {
  let token = '';
  await expect
    .poll(
      () => {
        const messages = readdirSync(outbox)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse()
          .map((f) => JSON.parse(readFileSync(join(outbox, f), 'utf8')) as { to: string; text: string });
        const match = messages.find((m) => m.to === to && m.text.includes(`#/${path}/`));
        token = match ? new RegExp(`#/${path}/([a-f0-9]{64})`).exec(match.text)![1] : '';
        return token;
      },
      { message: `an email to ${to} with a ${path} link`, timeout: 10_000 },
    )
    .not.toBe('');
  return token;
}

/** Registers through the API, confirms the email from the outbox and signs in (cookie session). */
export async function registerVerified(request: APIRequestContext, data: { email: string; password: string; shopName: string; fullName?: string; location?: string }) {
  const registered = await request.post('/api/auth/register', { headers: { Origin: origin }, data: { fullName: data.fullName ?? 'Test Owner', location: '', ...data } });
  expect(registered.status(), await registered.text()).toBe(202);
  const token = await emailedToken(data.email, 'verify-email');
  expect((await request.post('/api/auth/verify-email', { headers: { Origin: origin }, data: { token } })).ok()).toBe(true);
  const login = await request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: data.email, password: data.password } });
  expect(login.ok(), await login.text()).toBe(true);
  return (await login.json()) as { user: { id: string; email: string } };
}
