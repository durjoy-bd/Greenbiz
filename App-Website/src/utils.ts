const moneyFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const money = (n: number) => '৳' + moneyFormatter.format(n || 0);
export const num = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
export const uid = () => crypto.randomUUID();
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
export const dateLabel = (
  s: string,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', ...opts }).format(new Date(s));
// Excel reads a CSV as UTF-8 (Bengali names, ৳) only when it starts with a byte-order mark.
const BOM = String.fromCharCode(0xfeff);
const withBom = (data: string, type: string) => (type.startsWith('text/csv') && !data.startsWith(BOM) ? BOM + data : data);
export async function download(
  name: string,
  data: string,
  type = 'application/json',
): Promise<void> {
  const { Capacitor, registerPlugin } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const vault = registerPlugin<{
      exportFile(options: { name: string; data: string; type: string }): Promise<void>;
    }>('SessionVault');
    await vault.exportFile({ name, data: withBom(data, type), type });
    return;
  }
  const url = URL.createObjectURL(new Blob([withBom(data, type)], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// =, +, -, @, tab or carriage return at the start make a spreadsheet treat text as a formula.
const FORMULA_START = /^[=+@\t\r-]/;
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            // Text that a spreadsheet would run as a formula is neutralised; numbers stay numbers.
            (typeof v === 'number' ? String(v) : String(v).replace(FORMULA_START, "'$&")).replaceAll('"', '""') +
            '"',
        )
        .join(','),
    )
    .join('\r\n');
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Please try again.';

/** Copies text. Falls back to a hidden text field where the Clipboard API is missing (plain HTTP). */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy refused');
  } catch {
    throw new Error('Copying is not available in this browser. Select and copy the text instead.');
  } finally {
    field.remove();
  }
}
