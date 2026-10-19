import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aiConfig, askAdvice, saveAiConfig, setAiScope, suggestSale } from './business';
import { createWorkspace } from '../../shared/domain';
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  setAiScope('test-' + crypto.randomUUID());
});
afterEach(() => vi.unstubAllGlobals());
it('keeps browser credentials out of persistent metadata and never reuses a key across providers or owners', async () => {
  await saveAiConfig({ provider: 'gemini', model: '' }, 'private-test-key-1234');
  expect((await aiConfig()).hasKey).toBe(true);
  expect(JSON.stringify([...storage])).not.toContain('private-test-key');
  await saveAiConfig({ provider: 'openrouter', model: '' }, '');
  expect((await aiConfig()).hasKey).toBe(false);
  setAiScope('different-account');
  expect((await aiConfig()).hasKey).toBe(false);
});
it('sends only selected business aggregates directly to the provider and excludes raw personal fields', async () => {
  await saveAiConfig({ provider: 'gemini', model: '' }, 'private-test-key-1234');
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Record expenses daily.' }] } }],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const w = createWorkspace({ name: 'PRIVATE_SHOP_NAME', phone: '01712345678' });
  w.transactions = [
    {
      id: 'p',
      amount: 99999,
      direction: 'in',
      method: 'bkash',
      reference: 'PRIVATE_REFERENCE',
      party: 'PRIVATE_CUSTOMER',
      occurredAt: new Date().toISOString(),
      business: false,
      source: 'sms',
      note: 'PRIVATE_SMS_BODY',
    },
  ];
  expect(await askAdvice('How can I improve stock?', w, false)).toBe('Record expenses daily.');
  expect(fetch.mock.calls[0][0]).toMatch(/^https:\/\/generativelanguage.googleapis.com\//);
  const body = fetch.mock.calls[0][1].body;
  expect(JSON.parse(body).contents[0].parts[0].text).toContain('"income":0');
  expect(body).not.toMatch(/PRIVATE_|99999|01712345678/);
});
it('rejects unavailable product IDs suggested by AI before they reach checkout', async () => {
  await saveAiConfig({ provider: 'openrouter', model: '' }, 'private-test-key-1234');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"items":[{"productId":"invented","quantity":1}]}' } }],
        }),
        { status: 200 },
      ),
    ),
  );
  await expect(suggestSale('one rice', [], true)).rejects.toThrow('unavailable stock');
});
it('stops an advice request if the account changes during credential loading', async () => {
  await saveAiConfig({ provider: 'gemini', model: '' }, 'private-test-key-1234');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const pending = askAdvice('Review my stock', createWorkspace({}), false);
  setAiScope('a-different-owner');
  await expect(pending).rejects.toThrow('active account changed');
  expect(fetch).not.toHaveBeenCalled();
});
