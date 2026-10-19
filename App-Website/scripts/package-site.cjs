// Copies the static website build next to the server bundle for the VPS stack.
const { cpSync, rmSync } = require('node:fs');
rmSync('deploy/vps/build/site', { recursive: true, force: true });
cpSync('dist', 'deploy/vps/build/site', { recursive: true });
console.log('VPS package ready in deploy/vps/build (site + server).');
