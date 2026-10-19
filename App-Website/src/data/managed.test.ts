import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('enrolls once and calls the fixed managed service without a provider key or business account', async () => {
  vi.resetModules();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    .mockResolvedValueOnce(new Response('{"text":"A useful answer"}', { status: 200 }))
    .mockResolvedValueOnce(new Response('{"text":"Another answer"}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const { managedAi } = await import('./managed');
  expect(await managedAi('advice', { question: 'How?', aggregates: {} })).toBe('A useful answer');
  expect(await managedAi('advice', { question: 'Why?', aggregates: {} })).toBe('Another answer');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[0][0]).toBe(
    'https://greenbiz-ai-service.dearjelly6.chatgpt.site/api/mobile/enroll',
  );
  const enroll = JSON.parse(fetch.mock.calls[0][1].body);
  expect(enroll.secret).toMatch(/^[a-f0-9]{64}$/);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer ' + enroll.secret);
  expect(fetch.mock.calls[1][1].headers['x-greenbiz-installation']).toBe(enroll.installationId);
  expect(fetch.mock.calls[1][1].body).not.toMatch(/secret|apiKey|model|provider/);
});
