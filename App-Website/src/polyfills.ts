// Browsers expose crypto.randomUUID only on HTTPS or localhost. A plain-HTTP
// test deployment still has getRandomValues, so build an RFC 4122 v4 UUID from it.
if (typeof globalThis.crypto?.randomUUID !== 'function' && typeof globalThis.crypto?.getRandomValues === 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}
export {};
