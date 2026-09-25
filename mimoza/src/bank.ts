/**
 * Bank statement lines -> suggested records. Finds the date / description / amount columns
 * (Garanti BBVA and other Turkish banks: Tarih, Açıklama, Tutar, Bakiye, or Borç / Alacak),
 * then guesses: money in from a flat = aidat payment (matched by the flat's names or keywords,
 * "D3" / "Daire 3" in the text, or a sender remembered earlier); money out = expense with a
 * category guessed from the text. Lines already imported are recognised by their fingerprint.
 */
import type { Data } from './calc';
import { norm, parseMoney, unitNo } from './format';
import { excelDate, type Cell } from './xlsx';

export interface BankLine {
  date: string;
  /** kuruş, + money in, - money out */
  amount: number;
  description: string;
  balance: number | null;
  ref: string;
}

export type LineKind = 'payment' | 'income' | 'expense' | 'skip';

export interface Suggestion {
  line: BankLine;
  kind: LineKind;
  unitId: string;
  category: string;
  /** why this flat was chosen */
  reason: string;
  duplicate: boolean;
}

const H = {
  date: ['TARIH', 'ISLEM TARIHI', 'DATE', 'VALOR', 'VALOR TARIHI', 'TRANSACTION DATE'],
  desc: ['ACIKLAMA', 'ISLEM ACIKLAMASI', 'DESCRIPTION', 'DETAY', 'ACIKLAMALAR'],
  amount: ['TUTAR', 'ISLEM TUTARI', 'AMOUNT', 'TUTAR TL', 'TUTAR TRY'],
  balance: ['BAKIYE', 'BALANCE', 'BAKIYE TL', 'KALAN BAKIYE'],
  debit: ['BORC', 'DEBIT', 'GIDEN', 'CEKILEN'],
  credit: ['ALACAK', 'CREDIT', 'GELEN', 'YATAN'],
};

function parseDate(v: Cell): string | null {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelDate(v) : null;
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseAmount(v: Cell): number | null {
  if (typeof v === 'number') return Math.round(v * 100);
  if (!v) return null;
  const s = v.trim();
  if (!/\d/.test(s) || /[a-zA-Z]{3,}/.test(s.replace(/TL|TRY/gi, ''))) return null;
  return parseMoney(s);
}

/** stable fingerprint of a bank line (FNV-1a), so a second import of the same file adds nothing */
export function fingerprint(l: Omit<BankLine, 'ref'>) {
  const s = `${l.date}|${l.amount}|${norm(l.description)}|${l.balance ?? ''}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `b${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function toBankLines(rows: Cell[][]): BankLine[] | null {
  const text = (c: Cell) => (typeof c === 'string' ? norm(c) : '');
  // 1. a header row with at least a date and an amount (or borç / alacak) column
  let head = -1;
  const col = { date: -1, desc: -1, amount: -1, balance: -1, debit: -1, credit: -1 };
  for (let r = 0; r < Math.min(rows.length, 40) && head < 0; r++) {
    const cells = rows[r].map(text);
    // "İşlem Tutarı (TL)" -> "ISLEM TUTARI TL" still counts as "ISLEM TUTARI"
    const find = (names: string[]) => cells.findIndex((c) => names.some((n) => c === n || c.startsWith(n + ' ')));
    const d = find(H.date);
    const a = find(H.amount);
    const dr = find(H.debit), cr = find(H.credit);
    if (d >= 0 && (a >= 0 || (dr >= 0 && cr >= 0))) {
      head = r;
      Object.assign(col, { date: d, desc: find(H.desc), amount: a, balance: find(H.balance), debit: dr, credit: cr });
    }
  }
  // 2. no header: guess columns from the contents
  if (head < 0) {
    const sample = rows.slice(0, 60).filter((r) => r.length >= 2);
    const width = Math.max(0, ...sample.map((r) => r.length));
    const score = (fn: (c: Cell) => boolean) => Array.from({ length: width }, (_, i) => sample.filter((r) => fn(r[i] ?? null)).length);
    const dates = score((c) => parseDate(c) !== null);
    const nums = score((c) => parseAmount(c) !== null && parseDate(c) === null);
    const texts = Array.from({ length: width }, (_, i) => sample.reduce((a, r) => a + (typeof r[i] === 'string' && parseAmount(r[i]) === null ? String(r[i]).length : 0), 0));
    col.date = dates.indexOf(Math.max(...dates));
    if (col.date < 0 || dates[col.date] < 1) return null;
    const numCols = nums.map((n, i) => ({ n, i })).filter((x) => x.n >= Math.max(1, dates[col.date] * 0.6) && x.i !== col.date).map((x) => x.i);
    if (!numCols.length) return null;
    col.amount = numCols[0];
    col.balance = numCols.length > 1 ? numCols[numCols.length - 1] : -1;
    col.desc = texts.indexOf(Math.max(...texts));
  }
  const out: BankLine[] = [];
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[col.date] ?? null);
    if (!date) continue;
    let amount: number | null = null;
    if (col.amount >= 0) amount = parseAmount(row[col.amount] ?? null);
    if ((amount === null || amount === 0) && col.debit >= 0 && col.credit >= 0) {
      const dr = parseAmount(row[col.debit] ?? null) ?? 0;
      const cr = parseAmount(row[col.credit] ?? null) ?? 0;
      amount = cr !== 0 ? Math.abs(cr) : -Math.abs(dr);
    }
    if (!amount) continue;
    const description = col.desc >= 0 ? String(row[col.desc] ?? '').trim() : row.filter((c) => typeof c === 'string' && parseDate(c) === null && parseAmount(c) === null).join(' ');
    const balance = col.balance >= 0 ? parseAmount(row[col.balance] ?? null) : null;
    const line = { date, amount, description, balance };
    out.push({ ...line, ref: fingerprint(line) });
  }
  return out.length ? out : null;
}

// ---- matching -----------------------------------------------------------------------------------

const STOP = new Set(
  ('EFT FAST HAVALE GELEN GIDEN GONDEREN GONDERICI ALICI ACIKLAMA AIDAT AIDATI ODEME ODEMESI MIMOZA APT APARTMAN APARTMANI SITE ' +
    'YONETIM YONETIMI BANKA BANKASI TRANSFER TL TRY SUBE MOBIL INTERNET ISLEM NO NOLU REF DAIRE D DUKKAN KIRA OCAK SUBAT MART NISAN ' +
    'MAYIS HAZIRAN TEMMUZ AGUSTOS EYLUL EKIM KASIM ARALIK GARANTI BBVA ZIRAAT IS YKB YAPI KREDI AKBANK VAKIF VAKIFBANK HALK HALKBANK ' +
    'QNB DENIZ DENIZBANK ING TEB KUVEYT TURK ENPARA PAPARA HESAP HESABI HESABINA HESAPTAN ICIN AYI A S AS LTD STI SAN TIC VE ILE').split(' '),
);

/** "FAST GELEN AHMET YILMAZ MIMOZA D3 AIDAT" -> "AHMET YILMAZ": the likely sender, to remember */
export function senderKey(description: string) {
  const words = norm(description).split(' ').filter((w) => w.length >= 2 && !/\d/.test(w) && !STOP.has(w));
  return words.slice(0, 2).join(' ');
}

const EXPENSE_HINTS: [RegExp, string][] = [
  [/ENERJISA|BOGAZICI ELEKTRIK|AYEDAS|BEDAS|ELEKTRIK|CK ENERJI|UEDAS|TOROSLAR/, 'Elektrik'],
  [/ISKI|ASKI|IZSU|BUSKI|SU FATURA|\bSU\b/, 'Su'],
  [/IGDAS|DOGALGAZ|DOGAL GAZ|BASKENTGAZ|AKSA|ENERYA|IZMIRGAZ/, 'Doğalgaz'],
  [/ASANSOR/, 'Asansör Bakımı'],
  [/TEMIZLIK/, 'Temizlik'],
  [/SIGORTA|DASK/, 'Sigorta'],
  [/MASRAF|KOMISYON|BSMV|UCRET|ISLETIM/, 'Banka Masrafı'],
  [/TAMIR|ONARIM|BAKIM|TESISAT|BOYA|CATI/, 'Bakım - Onarım'],
];

export function suggest(lines: BankLine[], data: Data): Suggestion[] {
  const known = new Set<string>();
  for (const list of [data.payments, data.expenses, data.incomes] as { ref: string }[][]) for (const r of list) if (r.ref) known.add(r.ref);
  const units = data.units.filter((u) => u.active);
  // words that point to each flat, strongest first
  const strong = units.map((u) => {
    const words = new Set<string>();
    for (const k of u.keywords.split(/[,;\n]/)) if (norm(k).length >= 3) words.add(norm(k));
    for (const n of [u.owner, u.tenant]) if (norm(n).split(' ').length >= 2) words.add(norm(n));
    for (const m of data.matches ?? []) if (m.unit_id === u.id && m.sender) words.add(norm(m.sender));
    return { unit: u, words: [...words] };
  });
  const numbered = units.map((u) => {
    const n = unitNo(u.label);
    const w = u.kind === 'dukkan' ? [`DUKKAN ${n}`, `DUKKAN${n}`, `DK ${n}`] : [`D${n}`, `D ${n}`, `DAIRE ${n}`, `DAIRE${n}`, `NO ${n}`, `${n} NOLU`, `${n} NO LU`];
    return { unit: u, words: n ? w : [] };
  });
  const has = (text: string, w: string) => ` ${text} `.includes(` ${w} `);
  const cats = data.settings.categories.expense;
  return lines.map((line) => {
    const duplicate = known.has(line.ref);
    const text = norm(line.description);
    const s: Suggestion = { line, kind: 'skip', unitId: '', category: '', reason: '', duplicate };
    if (line.amount > 0) {
      let hits = strong.filter((x) => x.words.some((w) => has(text, w)));
      let reason = hits.length === 1 ? hits[0].words.find((w) => has(text, w))! : '';
      if (hits.length !== 1) {
        const byNo = numbered.filter((x) => x.words.some((w) => has(text, w)));
        if (byNo.length === 1) {
          hits = byNo;
          reason = byNo[0].words.find((w) => has(text, w))!;
        }
      }
      s.kind = 'payment';
      if (hits.length === 1) {
        s.unitId = hits[0].unit.id;
        s.reason = reason;
      }
      s.category = data.settings.categories.income[0] ?? '';
    } else {
      s.kind = 'expense';
      const hint = EXPENSE_HINTS.find(([re]) => re.test(text));
      s.category = hint && cats.includes(hint[1]) ? hint[1] : cats.includes('Diğer') ? 'Diğer' : cats[cats.length - 1] ?? '';
    }
    if (duplicate) s.kind = 'skip';
    return s;
  });
}
