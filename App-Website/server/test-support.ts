import { expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app';
import type { MailMessage } from './mailer';
import { totpCode, totpStep } from './totp';

export const origin = 'http://127.0.0.1:8787';
export const web = { origin };
export const native = { 'x-greenbiz-client': 'native' };
export const password = 'A-strong-password-456!';

/** A server with a capturing mailer and a clock the test can move forward. */
export async function testServer(options: AppOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'greenbiz-accounts-'));
  const dbPath = join(dir, 'test.sqlite');
  const sent: MailMessage[] = [];
  const clock = { now: new Date('2026-10-20T06:00:00.000Z') };
  const make = () =>
    buildApp({
      dbPath,
      publicOrigin: origin,
      now: () => clock.now,
      mailer: { configured: true, description: 'test', send: async (message) => void sent.push(message) },
      ...options,
    });
  const app = await make();
  await app.ready();
  return {
    app,
    dbPath,
    sent,
    clock,
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type TestServer = Awaited<ReturnType<typeof testServer>>;

/** The token from the newest email whose link goes to `path` (e.g. "verify-email"). */
export function linkToken(sent: MailMessage[], path: string, to?: string): string {
  const message = [...sent].reverse().find((m) => m.text.includes(`#/${path}/`) && (!to || m.to === to));
  expect(message, `an email with a ${path} link`).toBeTruthy();
  return new RegExp(`#/${path}/([a-f0-9]{64})`).exec(message!.text)![1];
}

/** Registers, confirms the email and signs in; returns bearer headers for a native client. */
export async function verifiedUser(server: TestServer, email = 'owner@example.com', extra: Record<string, unknown> = {}) {
  const registered = await server.app.inject({ method: 'POST', url: '/api/auth/register', headers: native, payload: { fullName: 'Rahim Uddin', email, password, confirmPassword: password, shopName: 'Rahim Store', location: 'Dhaka', ...extra } });
  expect(registered.statusCode).toBe(202);
  const verified = await server.app.inject({ method: 'POST', url: '/api/auth/verify-email', headers: web, payload: { token: linkToken(server.sent, 'verify-email', email) } });
  expect(verified.statusCode).toBe(200);
  return signIn(server.app, email);
}
export async function signIn(app: FastifyInstance, email: string, pass = password) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: native, payload: { email, password: pass } });
  expect(response.statusCode, response.body).toBe(200);
  const session = response.json();
  return { id: session.user.id as string, token: session.token as string, headers: { ...native, authorization: `Bearer ${session.token}` } };
}

/**
 * Signs in to the admin panel, enrolling an authenticator on first use. Returns the cookie
 * headers and the TOTP secret. Moves the clock a step so each code is fresh.
 */
export async function adminSignIn(server: TestServer, email: string, pass = password, secrets: Map<string, string> = adminSecrets) {
  server.advance(31_000);
  const login = await server.app.inject({ method: 'POST', url: '/api/admin/login', headers: web, payload: { email, password: pass } });
  expect(login.statusCode, login.body).toBe(200);
  const body = login.json();
  if (body.mfa === 'setup') secrets.set(email, body.secret);
  const secret = secrets.get(email)!;
  const verified = await server.app.inject({ method: 'POST', url: '/api/admin/login/mfa', headers: web, payload: { challenge: body.challenge, code: totpCode(secret, totpStep(server.clock.now)) } });
  expect(verified.statusCode, verified.body).toBe(200);
  const cookie = verified.cookies.find((c) => c.name === 'greenbiz_admin')!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/admin' });
  return { headers: { ...web, cookie: `greenbiz_admin=${cookie.value}` }, secret, body: verified.json() };
}
export const adminSecrets = new Map<string, string>();
