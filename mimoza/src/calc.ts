/**
 * The bookkeeping: monthly aidat accrual (tahakkuk) per flat from the settings, extra charges,
 * payments applied to the oldest debt first (FIFO, like the usual apartment programs), the legal
 * late fee (KMK md. 20: %5 a month, per day late), account balances and period summaries.
 * All money in kuruş.
 */
import type { Charge, Expense, Income, Notice, Payment, Settings, Transfer, Unit } from './schema';

export interface Data {
  admin: boolean;
  settings: Settings;
  units: Unit[];
  charges: Charge[];
  payments: Payment[];
  expenses: Expense[];
  incomes: Income[];
  transfers: Transfer[];
  notices: Notice[];
  matches?: { sender: string; unit_id: string }[];
}

export type DebitKind = 'devir' | 'aidat' | 'ek';

export interface Debit {
  unit: string;
  kind: DebitKind;
  /** accrual date */
  date: string;
  /** last day to pay without the late fee */
  due: string;
  month: string;
  amount: number;
  label: string;
  chargeId?: string;
  /** not accrued yet (a later month); only shown when prepaid */
  future: boolean;
  paid: number;
  /** date of the payment that settled it */
  paidOn: string | null;
  /** late fee so far (informational) */
  late: number;
}

export interface Credit {
  unit: string;
  kind: 'odeme' | 'indirim' | 'devir';
  date: string;
  amount: number;
  label: string;
  paymentId?: string;
  chargeId?: string;
  /** what this payment paid off */
  covers: { label: string; amount: number }[];
  /** part of it not used yet (advance / overpayment) */
  left: number;
}

export interface UnitAccount {
  unit: Unit;
  debits: Debit[];
  credits: Credit[];
  /** accrued so far */
  owed: number;
  paid: number;
  /** owed - paid: > 0 the flat owes, < 0 it has credit */
  balance: number;
  unpaidMonths: number;
  oldestUnpaid: string | null;
  lateFee: number;
}

// ---- dates ----------------------------------------------------------------------------------------

export const pad = (n: number) => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** months from a to b inclusive (empty if b < a) */
export function monthRange(a: string, b: string) {
  const out: string[] = [];
  for (let m = a; m <= b && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysInMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dueDate(ym: string, day: number) {
  return `${ym}-${pad(Math.min(Math.max(1, day), daysInMonth(ym)))}`;
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

// ---- dues -----------------------------------------------------------------------------------------

/** monthly aidat of a flat for a month: its own amount if set, else the building's rate at that time */
export function duesFor(settings: Settings, unit: Unit, month: string) {
  if (!unit.pays_dues) return 0;
  if (unit.dues_amount !== null && unit.dues_amount !== undefined) return unit.dues_amount;
  let amount = 0;
  let best = '';
  for (const p of settings.dues.periods) {
    if (p.from <= month && p.from >= best) {
      best = p.from;
      amount = p.amount;
    }
  }
  return amount;
}

/** the building's aidat rate for a month */
export function rateFor(settings: Settings, month: string) {
  let amount = 0;
  let best = '';
  for (const p of settings.dues.periods) {
    if (p.from <= month && p.from >= best) {
      best = p.from;
      amount = p.amount;
    }
  }
  return amount;
}

const KIND_ORDER: Record<DebitKind, number> = { devir: 0, aidat: 1, ek: 2 };
const LATE_PER_DAY = 0.05 / 30;

export interface CalcOptions {
  today?: string;
  /** also list aidat up to this month (shown when paid in advance) */
  horizon?: string;
  monthName?: (ym: string) => string;
}

export function unitAccount(data: Data, unit: Unit, opt: CalcOptions = {}): UnitAccount {
  const s = data.settings;
  const today = opt.today ?? todayISO();
  const current = today.slice(0, 7);
  const horizon = opt.horizon && opt.horizon > current ? opt.horizon : current;
  const name = opt.monthName ?? ((m: string) => m);
  const start = s.dues.start;
  const debits: Debit[] = [];
  const credits: Credit[] = [];

  if (unit.opening > 0) {
    debits.push({ unit: unit.id, kind: 'devir', date: `${start}-01`, due: `${start}-01`, month: start, amount: unit.opening, label: 'devir', future: false, paid: 0, paidOn: null, late: 0 });
  } else if (unit.opening < 0) {
    credits.push({ unit: unit.id, kind: 'devir', date: `${start}-01`, amount: -unit.opening, label: 'devir', covers: [], left: 0 });
  }
  if (unit.pays_dues && unit.active) {
    for (const m of monthRange(start, horizon)) {
      const amount = duesFor(s, unit, m);
      if (amount <= 0) continue;
      debits.push({
        unit: unit.id, kind: 'aidat', date: `${m}-01`, due: dueDate(m, s.dues.dueDay), month: m, amount,
        label: name(m), future: m > current, paid: 0, paidOn: null, late: 0,
      });
    }
  }
  for (const c of data.charges) {
    if (c.unit_id !== unit.id || c.amount === 0) continue;
    if (c.amount > 0) {
      debits.push({
        unit: unit.id, kind: 'ek', date: c.date, due: c.date, month: c.date.slice(0, 7), amount: c.amount,
        label: c.description, chargeId: c.id, future: c.date > today, paid: 0, paidOn: null, late: 0,
      });
    } else {
      credits.push({ unit: unit.id, kind: 'indirim', date: c.date, amount: -c.amount, label: c.description, chargeId: c.id, covers: [], left: 0 });
    }
  }
  for (const p of data.payments) {
    if (p.unit_id !== unit.id || p.amount <= 0) continue;
    credits.push({ unit: unit.id, kind: 'odeme', date: p.date, amount: p.amount, label: p.description, paymentId: p.id, covers: [], left: 0 });
  }
  debits.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.due.localeCompare(b.due));
  credits.sort((a, b) => a.date.localeCompare(b.date) || (a.paymentId ?? '').localeCompare(b.paymentId ?? ''));

  // FIFO: each payment pays the oldest open debt first
  let i = 0;
  for (const c of credits) {
    let left = c.amount;
    while (left > 0 && i < debits.length) {
      const d = debits[i];
      const take = Math.min(left, d.amount - d.paid);
      if (take > 0) {
        d.paid += take;
        left -= take;
        c.covers.push({ label: d.label, amount: take });
        if (d.kind !== 'devir') {
          const lateDays = daysBetween(d.due, c.date);
          if (lateDays > 0) d.late += take * lateDays * LATE_PER_DAY;
        }
      }
      if (d.paid >= d.amount) {
        d.paidOn = c.date;
        i++;
      }
    }
    c.left = left;
  }
  let owed = 0;
  let unpaidMonths = 0;
  let oldestUnpaid: string | null = null;
  let lateFee = 0;
  for (const d of debits) {
    if (d.future) continue;
    owed += d.amount;
    const open = d.amount - d.paid;
    if (open > 0) {
      if (d.kind === 'aidat') unpaidMonths++;
      oldestUnpaid ??= d.month;
      if (d.kind !== 'devir') {
        const lateDays = daysBetween(d.due, today);
        if (lateDays > 0) d.late += open * lateDays * LATE_PER_DAY;
      }
    }
    d.late = Math.round(d.late);
    lateFee += d.late;
  }
  const paid = credits.reduce((a, c) => a + c.amount, 0);
  return { unit, debits, credits, owed, paid, balance: owed - paid, unpaidMonths, oldestUnpaid, lateFee };
}

export function allAccounts(data: Data, opt: CalcOptions = {}) {
  return data.units.filter((u) => u.active).map((u) => unitAccount(data, u, opt));
}

export type CellState = 'paid' | 'partial' | 'unpaid' | 'late' | 'future' | 'prepaid' | 'none';

/** aidat status of a flat for one month */
export function monthCell(acc: UnitAccount, month: string, today = todayISO()): { state: CellState; debit?: Debit } {
  const d = acc.debits.find((x) => x.kind === 'aidat' && x.month === month);
  if (!d) return { state: 'none' };
  if (d.future) return { state: d.paid >= d.amount ? 'prepaid' : d.paid > 0 ? 'partial' : 'future', debit: d };
  if (d.paid >= d.amount) return { state: 'paid', debit: d };
  if (d.paid > 0) return { state: 'partial', debit: d };
  return { state: today > d.due ? 'late' : 'unpaid', debit: d };
}

// ---- accounts and periods --------------------------------------------------------------------------

export function balances(data: Data, upTo?: string) {
  const s = data.settings.accounts;
  const b = { banka: s.banka, kasa: s.kasa };
  const inRange = (d: string) => !upTo || d <= upTo;
  for (const p of data.payments) if (inRange(p.date)) b[p.account] += p.amount;
  for (const x of data.incomes) if (inRange(x.date)) b[x.account] += x.amount;
  for (const x of data.expenses) if (inRange(x.date)) b[x.account] -= x.amount;
  for (const t of data.transfers) {
    if (!inRange(t.date)) continue;
    b[t.from_acc] -= t.amount;
    b[t.to_acc] += t.amount;
  }
  return { ...b, total: b.banka + b.kasa };
}

export interface MonthSummary {
  month: string;
  /** aidat + extra charges accrued this month */
  accrued: number;
  /** payments received from the flats this month */
  collected: number;
  otherIncome: number;
  expense: number;
  byCategory: Record<string, number>;
  incomeByCategory: Record<string, number>;
  net: number;
}

export function monthSummaries(data: Data, accounts: UnitAccount[], months: string[]): MonthSummary[] {
  const map = new Map<string, MonthSummary>();
  for (const m of months) map.set(m, { month: m, accrued: 0, collected: 0, otherIncome: 0, expense: 0, byCategory: {}, incomeByCategory: {}, net: 0 });
  for (const a of accounts) {
    for (const d of a.debits) {
      if (d.future || d.kind === 'devir') continue;
      const s = map.get(d.month);
      if (s) s.accrued += d.amount;
    }
  }
  for (const p of data.payments) {
    const s = map.get(p.date.slice(0, 7));
    if (s) s.collected += p.amount;
  }
  for (const x of data.incomes) {
    const s = map.get(x.date.slice(0, 7));
    if (!s) continue;
    s.otherIncome += x.amount;
    s.incomeByCategory[x.category] = (s.incomeByCategory[x.category] ?? 0) + x.amount;
  }
  for (const x of data.expenses) {
    const s = map.get(x.date.slice(0, 7));
    if (!s) continue;
    s.expense += x.amount;
    s.byCategory[x.category] = (s.byCategory[x.category] ?? 0) + x.amount;
  }
  for (const s of map.values()) s.net = s.collected + s.otherIncome - s.expense;
  return months.map((m) => map.get(m)!);
}

export function sumSummaries(list: MonthSummary[]): MonthSummary {
  const t: MonthSummary = { month: '', accrued: 0, collected: 0, otherIncome: 0, expense: 0, byCategory: {}, incomeByCategory: {}, net: 0 };
  for (const s of list) {
    t.accrued += s.accrued;
    t.collected += s.collected;
    t.otherIncome += s.otherIncome;
    t.expense += s.expense;
    t.net += s.net;
    for (const [k, v] of Object.entries(s.byCategory)) t.byCategory[k] = (t.byCategory[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.incomeByCategory)) t.incomeByCategory[k] = (t.incomeByCategory[k] ?? 0) + v;
  }
  return t;
}

/** one flat's statement: debits and credits by date with the running balance */
export interface LedgerLine {
  date: string;
  label: string;
  kind: DebitKind | Credit['kind'];
  debit: number;
  credit: number;
  balance: number;
  paymentId?: string;
  chargeId?: string;
}

export function ledger(acc: UnitAccount): LedgerLine[] {
  const lines: Omit<LedgerLine, 'balance'>[] = [];
  for (const d of acc.debits) {
    if (d.future) continue;
    lines.push({ date: d.date, label: d.label, kind: d.kind, debit: d.amount, credit: 0, chargeId: d.chargeId });
  }
  for (const c of acc.credits) lines.push({ date: c.date, label: c.label, kind: c.kind, debit: 0, credit: c.amount, paymentId: c.paymentId, chargeId: c.chargeId });
  lines.sort((a, b) => a.date.localeCompare(b.date) || (a.debit > 0 ? -1 : 1) - (b.debit > 0 ? -1 : 1));
  let bal = 0;
  return lines.map((l) => {
    bal += l.debit - l.credit;
    return { ...l, balance: bal };
  });
}

/** every money movement (for the income / expense list), newest first */
export interface Movement {
  date: string;
  type: 'aidat' | 'gelir' | 'gider' | 'virman';
  category: string;
  label: string;
  unit?: string;
  account: 'banka' | 'kasa' | 'virman';
  amount: number;
  id: string;
}

export function movements(data: Data): Movement[] {
  const out: Movement[] = [];
  for (const p of data.payments) out.push({ date: p.date, type: 'aidat', category: '', label: p.description, unit: p.unit_id, account: p.account, amount: p.amount, id: p.id });
  for (const x of data.incomes) out.push({ date: x.date, type: 'gelir', category: x.category, label: x.description, account: x.account, amount: x.amount, id: x.id });
  for (const x of data.expenses) out.push({ date: x.date, type: 'gider', category: x.category, label: x.description, account: x.account, amount: -x.amount, id: x.id });
  for (const t of data.transfers) out.push({ date: t.date, type: 'virman', category: `${t.from_acc} → ${t.to_acc}`, label: t.description, account: 'virman', amount: t.amount, id: t.id });
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/** years that have any record or accrual, newest first (always includes this year) */
export function years(data: Data, today = todayISO()) {
  const ys = new Set<number>([Number(today.slice(0, 4)), Number(data.settings.dues.start.slice(0, 4))]);
  for (const list of [data.payments, data.expenses, data.incomes, data.charges] as { date: string }[][]) for (const r of list) ys.add(Number(r.date.slice(0, 4)));
  return [...ys].filter((y) => y > 1990 && y < 2200).sort((a, b) => b - a);
}
