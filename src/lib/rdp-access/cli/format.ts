// Small output helpers shared by the CLI commands and the interactive watch screen.

export const shortId = (id: string) => id.slice(0, 8);

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', hour12: false });
}
