const { mkdirSync, copyFileSync, readdirSync } = require('node:fs');
const target = process.argv[2] || 'server-dist';
mkdirSync(target, { recursive: true });
for (const file of readdirSync('server'))
  if (file.endsWith('.sql')) copyFileSync('server/' + file, target + '/' + file);
