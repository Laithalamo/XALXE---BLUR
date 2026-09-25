/**
 * Mimoza: the data model, shared by the Worker (validation, storage) and the web app.
 * Money is stored in kuruş (integer), dates as YYYY-MM-DD, months as YYYY-MM.
 */

export type Account = 'kasa' | 'banka';
export const ACCOUNTS: Account[] = ['banka', 'kasa'];

/** column type: s string, t long text, i integer, n nullable integer, b 0/1, d date, a account */
type Col = 's' | 't' | 'i' | 'n' | 'b' | 'd' | 'a';

export const TABLES = {
  units: {
    sort: 'i', label: 's', kind: 's', owner: 's', tenant: 's', phone: 's', pays_dues: 'b', dues_amount: 'n',
    opening: 'i', keywords: 's', note: 's', active: 'b',
  },
  charges: { unit_id: 's', date: 'd', amount: 'i', description: 's', batch: 's' },
  payments: { unit_id: 's', date: 'd', amount: 'i', account: 'a', description: 's', ref: 's' },
  expenses: { date: 'd', category: 's', description: 's', amount: 'i', account: 'a', vendor: 's', doc_no: 's', ref: 's' },
  incomes: { date: 'd', category: 's', description: 's', amount: 'i', account: 'a', ref: 's' },
  transfers: { date: 'd', from_acc: 'a', to_acc: 'a', amount: 'i', description: 's' },
  notices: { date: 'd', title: 's', body: 't', pinned: 'b' },
} as const satisfies Record<string, Record<string, Col>>;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

type ColType<C> = C extends 's' | 't' | 'd' ? string : C extends 'a' ? Account : C extends 'n' ? number | null : number;
export type Row<T extends TableName> = { id: string; created?: number } & { -readonly [K in keyof (typeof TABLES)[T]]: ColType<(typeof TABLES)[T][K]> };

export type Unit = Row<'units'>;
export type Charge = Row<'charges'>;
export type Payment = Row<'payments'>;
export type Expense = Row<'expenses'>;
export type Income = Row<'incomes'>;
export type Transfer = Row<'transfers'>;
export type Notice = Row<'notices'>;

export interface DuesPeriod {
  /** first month this amount applies to (YYYY-MM) */
  from: string;
  /** monthly aidat, kuruş */
  amount: number;
}

export interface Settings {
  building: {
    name: string;
    address: string;
    manager: string;
    managerPhone: string;
    bank: string;
    iban: string;
    holder: string;
    /** what residents should write in the transfer description */
    payNote: string;
  };
  dues: {
    /** first month that is charged (YYYY-MM) */
    start: string;
    /** day of the month the aidat is due */
    dueDay: number;
    periods: DuesPeriod[];
    /** show the legal late fee (KMK md. 20: %5 a month) */
    lateFee: boolean;
  };
  accounts: {
    /** opening balances (kuruş) on the opening date */
    banka: number;
    kasa: number;
    date: string;
  };
  display: {
    /** show owner / tenant names on the public page (phones never) */
    publicNames: boolean;
  };
  categories: {
    expense: string[];
    income: string[];
  };
}

export function defaultSettings(today = new Date()): Settings {
  const month = today.toISOString().slice(0, 7);
  return {
    building: {
      name: 'Mimoza Apartmanı', address: '', manager: '', managerPhone: '', bank: 'Garanti BBVA', iban: '', holder: '',
      payNote: 'MIMOZA D{no} {ay}',
    },
    dues: { start: month, dueDay: 10, periods: [{ from: month, amount: 0 }], lateFee: false },
    accounts: { banka: 0, kasa: 0, date: `${month}-01` },
    display: { publicNames: false },
    categories: {
      expense: ['Elektrik', 'Su', 'Doğalgaz', 'Temizlik', 'Asansör Bakımı', 'Bakım - Onarım', 'Yönetim Gideri', 'Sigorta', 'Banka Masrafı', 'Kırtasiye', 'Diğer'],
      income: ['Kira Geliri', 'Faiz Geliri', 'Bağış', 'Diğer Gelir'],
    },
  };
}

export function defaultUnits(): Unit[] {
  const units: Unit[] = [];
  for (let i = 1; i <= 6; i++) {
    units.push({ id: `d${i}`, sort: i, label: `Daire ${i}`, kind: 'daire', owner: '', tenant: '', phone: '', pays_dues: 1, dues_amount: null, opening: 0, keywords: '', note: '', active: 1 });
  }
  for (let i = 1; i <= 2; i++) {
    units.push({ id: `s${i}`, sort: 10 + i, label: `Dükkan ${i}`, kind: 'dukkan', owner: '', tenant: '', phone: '', pays_dues: 0, dues_amount: null, opening: 0, keywords: '', note: '', active: 1 });
  }
  return units;
}

export const SETTINGS_KEYS = ['building', 'dues', 'accounts', 'display', 'categories'] as const satisfies readonly (keyof Settings)[];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
export const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s));
export const isMonth = (s: unknown): s is string => typeof s === 'string' && MONTH.test(s);

/** checks and normalises one row for a table; returns an error message or the clean row */
export function cleanRow(table: TableName, raw: Record<string, unknown>): { row?: Record<string, unknown>; error?: string } {
  const cols = TABLES[table] as Record<string, Col>;
  const row: Record<string, unknown> = {};
  if (raw.id !== undefined) {
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id)) return { error: 'bad id' };
    row.id = raw.id;
  }
  for (const [k, t] of Object.entries(cols)) {
    const v = raw[k];
    switch (t) {
      case 's':
      case 't': {
        const s = v === undefined || v === null ? '' : String(v);
        if (s.length > (t === 't' ? 4000 : 300)) return { error: `${k} too long` };
        row[k] = s.trim();
        break;
      }
      case 'd':
        if (!isDate(v)) return { error: `${k}: date expected` };
        row[k] = v;
        break;
      case 'a':
        if (v !== 'kasa' && v !== 'banka') return { error: `${k}: kasa or banka` };
        row[k] = v;
        break;
      case 'b':
        row[k] = v ? 1 : 0;
        break;
      case 'i':
      case 'n': {
        if (t === 'n' && (v === null || v === undefined || v === '')) {
          row[k] = null;
          break;
        }
        const n = Number(v ?? 0);
        if (!Number.isSafeInteger(n) || Math.abs(n) > 1e13) return { error: `${k}: whole number expected` };
        row[k] = n;
        break;
      }
    }
  }
  return { row };
}
