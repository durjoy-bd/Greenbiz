// Capacitor 6's tar default import is incompatible with patched node-tar 7.
// Keep the secure tar override and adapt only that module interop boundary.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../node_modules/@capacitor/cli/dist/util/template.js');
if (fs.existsSync(file)) {
  const source = fs.readFileSync(file, 'utf8');
  const before = 'const tar_1 = tslib_1.__importDefault(require("tar"));';
  const after = 'const tar_1 = { default: require("tar") };';
  if (source.includes(before)) fs.writeFileSync(file, source.replace(before, after));
  else if (!source.includes(after))
    throw new Error('Review Capacitor tar compatibility patch for this CLI version.');
}
