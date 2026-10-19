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
    await vault.exportFile({ name, data, type });
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            String(v)
              .replace(/^[=+@-]/, "'$&")
              .replaceAll('"', '""') +
            '"',
        )
        .join(','),
    )
    .join('\r\n');
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Please try again.';
