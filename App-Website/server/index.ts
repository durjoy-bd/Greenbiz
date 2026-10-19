import { pathToFileURL } from 'node:url';
import { buildApp } from './app';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
  process.stdout.write(`GreenBiz API listening on port ${port}.\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => { process.exitCode = 0; }); });
}
