/** Turkish-style formatting: 1.500,00 ₺, 25.09.2026, Eylül 2026, amounts in words for receipts. */
import type { Lang } from './i18n';

const tl = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tl0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** kuruş -> "1.500,00 ₺" */
export function money(k: number, opts: { sign?: boolean; short?: boolean } = {}) {
  const v = k / 100;
  const s = opts.short && Number.isInteger(v) ? tl0.format(Math.abs(v)) : tl.format(Math.abs(v));
  const sign = k < 0 ? '−' : opts.sign && k > 0 ? '+' : '';
  return `${sign}${s} ₺`;
}

/** kuruş -> "1500,00" (for CSV / inputs) */
export function plain(k: number) {
  return (k / 100).toFixed(2).replace('.', ',');
}

/**
 * user input -> kuruş. Accepts "1.500", "1.500,50", "1500,5", "1500.50", "1,500.50", "-250".
 * Returns null when it isn't a number.
 */
export function parseMoney(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = input.replace(/[\s₺TLtl]/g, '').replace('−', '-');
  if (!s) return null;
  const neg = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[-()+]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // the later separator is the decimal one
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,5" / "1500,50" decimal; "1,500" thousands only if exactly 3 digits follow and more than one group
    const after = s.length - lastComma - 1;
    s = after === 3 && (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if (lastDot > -1) {
    // Turkish thousands: "1.500" or "1.500.000"; English decimal: "1500.5"
    const groups = s.split('.');
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
    if (thousands) s = s.replace(/\./g, '');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.' || s === '') return null;
  const v = Math.round(Number(s) * 100);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const MONTHS: Record<Lang, string[]> = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

export function monthName(ym: string, lang: Lang, short = false) {
  const [y, m] = ym.split('-').map(Number);
  const n = MONTHS[lang][m - 1] ?? ym;
  return short ? `${n.slice(0, 3)}` : `${n} ${y}`;
}

export function monthShort(m: number, lang: Lang) {
  return MONTHS[lang][m - 1].slice(0, 3);
}

/** YYYY-MM-DD -> 25.09.2026 */
export function date(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export function dateTime(ts: number) {
  const d = new Date(ts);
  return `${date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- amount in words (receipts: "Yalnız bin beş yüz Türk Lirası") ------------------------------------

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALE = ['', 'bin', 'milyon', 'milyar', 'trilyon'];

function under1000(n: number) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  const parts: string[] = [];
  if (h) parts.push(h === 1 ? 'yüz' : `${ONES[h]} yüz`);
  if (t) parts.push(TENS[t]);
  if (o) parts.push(ONES[o]);
  return parts.join(' ');
}

export function wordsTr(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'sıfır';
  const parts: string[] = [];
  for (let i = 0; n > 0 && i < SCALE.length; i++) {
    const chunk = n % 1000;
    n = Math.floor(n / 1000);
    if (!chunk) continue;
    // "bin", not "bir bin"
    const w = i === 1 && chunk === 1 ? '' : under1000(chunk);
    parts.unshift([w, SCALE[i]].filter(Boolean).join(' '));
  }
  return parts.join(' ');
}

export function amountWords(k: number) {
  const lira = Math.floor(Math.abs(k) / 100);
  const kurus = Math.abs(k) % 100;
  const w = `${wordsTr(lira)} Türk Lirası${kurus ? ` ${wordsTr(kurus)} kuruş` : ''}`;
  return `Yalnız ${w}`;
}

/** "Daire 3" -> 3 (for payment notes like "MIMOZA D3") */
export function unitNo(label: string) {
  const m = label.match(/(\d+)/);
  return m ? m[1] : '';
}

/** Turkish-aware upper case without accents, for matching bank text: "Ayşe Yılmaz" -> "AYSE YILMAZ" */
export function norm(s: string) {
  return s
    .toLocaleUpperCase('tr-TR')
    .replace(/[İI]/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/Â/g, 'A')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
