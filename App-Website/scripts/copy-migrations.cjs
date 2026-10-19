const { mkdirSync, copyFileSync, readdirSync } = require('node:fs');
mkdirSync('server-dist', { recursive: true });
for (const file of readdirSync('server'))
  if (file.endsWith('.sql')) copyFileSync('server/' + file, 'server-dist/' + file);
