import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Session } from '../../shared/types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
interface SessionVault {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
export const vault = registerPlugin<SessionVault>('SessionVault');
let token: string | null = null;
let selectedShop = '';
export function selectApiShop(id: string) {
  selectedShop = id;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** A stable reason from the server, such as "email_unverified". */
    public code = '',
    /** Field-by-field validation messages, keyed by field name. */
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export const native = Capacitor.isNativePlatform();
/** The chosen server; a build can preset one with VITE_GREENBIZ_SERVER (blank means this website's own server). */
export function serverURL() {
  return localStorage.getItem('greenbiz-server') ?? (import.meta.env.VITE_GREENBIZ_SERVER || '');
}
export function configureServer(raw: string) {
  const value = raw.trim().replace(/\/$/, '');
  if (value) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new Error('Use only the server origin, such as https://shop.example.com');
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))
    )
      throw new Error('A secure HTTPS server address is required.');
  }
  localStorage.setItem('greenbiz-server', value);
  token = null;
}
// Synchronous SHA-256 so key derivation also works on plain-HTTP deployments without crypto.subtle.
const vaultKey = async () => bytesToHex(sha256(new TextEncoder().encode(serverURL() || 'same-origin')));
export async function restoreSession() {
  if (native) token = (await vault.get({ key: await vaultKey() })).value;
}
export async function saveSession(session: Session) {
  token = session.token || null;
  if (native && token) await vault.set({ key: await vaultKey(), value: token });
}
export async function clearSession() {
  token = null;
  if (native) await vault.remove({ key: await vaultKey() });
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  shopId = selectedShop,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(serverURL() + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      credentials: native ? 'omit' : 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(native ? { 'x-greenbiz-client': 'native' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(shopId ? { 'x-greenbiz-shop': shopId } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(path.includes('/ai/') ? 60000 : 15000),
    });
  } catch {
    throw new ApiError(
      'Could not reach your server. Your saved records are still on this device.',
      0,
    );
  }
  const json = await response
    .json()
    .catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok)
    throw new ApiError(json.error || 'Unable to complete this request.', response.status, json.code, json.fields);
  return json as T;
}
