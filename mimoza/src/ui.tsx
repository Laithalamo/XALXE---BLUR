/** Small shared pieces: app context, money, status marks, dialog, form fields, toast. */
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { CellState, Data, UnitAccount } from './calc';
import { money, parseMoney, plain } from './format';
import type { Key, Lang, T } from './i18n';

export interface Ctx {
  data: Data;
  t: T;
  lang: Lang;
  today: string;
  accounts: UnitAccount[];
  admin: boolean;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
  go: (hash: string) => void;
  monthLabel: (ym: string) => string;
  unitName: (id: string) => string;
}

export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function Money({ k, sign, className }: { k: number; sign?: boolean; className?: string }) {
  return <span class={`money ${k < 0 ? 'neg' : ''} ${className ?? ''}`}>{money(k, { sign })}</span>;
}

const STATE_ICON: Record<CellState, string> = {
  paid: '✓', prepaid: '✓', partial: '◐', unpaid: '○', late: '!', future: '·', none: '—',
};
const STATE_KEY: Record<CellState, Key> = {
  paid: 'paid', prepaid: 'prepaid', partial: 'partial', unpaid: 'unpaid', late: 'late', future: 'future', none: 'notCharged',
};

/** status = icon + label (+ colour), never colour alone */
export function StateMark({ state, label = false }: { state: CellState; label?: boolean }) {
  const { t } = useApp();
  return (
    <span class={`state st-${state}`} title={t(STATE_KEY[state])}>
      <i aria-hidden="true">{STATE_ICON[state]}</i>
      {label && <span>{t(STATE_KEY[state])}</span>}
    </span>
  );
}

export function Legend() {
  const states: CellState[] = ['paid', 'partial', 'unpaid', 'late', 'prepaid', 'future'];
  return (
    <div class="legend">
      {states.map((s) => <StateMark key={s} state={s} label />)}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => removeEventListener('keydown', key);
  }, []);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="dialog-head">
          <h2>{title}</h2>
          <button class="icon" onClick={onClose} aria-label="×">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, help, children, error }: { label: string; help?: string; error?: string; children: ComponentChildren }) {
  return (
    <label class={`field ${error ? 'has-error' : ''}`}>
      <span class="field-label">{label}</span>
      {children}
      {help && !error && <span class="field-help">{help}</span>}
      {error && <span class="field-error">{error}</span>}
    </label>
  );
}

/** money input in TL ("1.500,50"); value in kuruş, null while not a number */
export function MoneyInput({ value, onChange, allowNegative, placeholder }: { value: number | null; onChange: (k: number | null) => void; allowNegative?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value === null ? '' : plain(value));
  useEffect(() => {
    const cur = parseMoney(text);
    if (cur !== value) setText(value === null ? '' : plain(value));
  }, [value]);
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? '0,00'}
      onInput={(e) => {
        const s = e.currentTarget.value;
        setText(s);
        const k = parseMoney(s);
        onChange(k !== null && !allowNegative && k < 0 ? null : k);
      }}
    />
  );
}

export function Toast({ text, bad }: { text: string; bad?: boolean }) {
  return <div class={`toast ${bad ? 'bad' : ''}`} role="status">{text}</div>;
}

export function Tile({ label, value, sub, tone }: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: 'good' | 'bad' }) {
  return (
    <div class={`tile ${tone ?? ''}`}>
      <div class="tile-label">{label}</div>
      <div class="tile-value">{value}</div>
      {sub && <div class="tile-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useApp();
  return <p class="empty">{text ?? t('empty')}</p>;
}

export function Toolbar({ children, onPrint, onCsv }: { children?: ComponentChildren; onPrint?: boolean; onCsv?: () => void }) {
  const { t } = useApp();
  return (
    <div class="toolbar no-print">
      <div class="toolbar-left">{children}</div>
      <div class="toolbar-right">
        {onCsv && <button class="ghost" onClick={onCsv}>⤓ {t('exportCsv')}</button>}
        {onPrint && <button class="ghost" onClick={() => print()}>⎙ {t('print')}</button>}
      </div>
    </div>
  );
}

export function YearSelect({ value, years, onChange }: { value: number; years: number[]; onChange: (y: number) => void }) {
  const { t } = useApp();
  return (
    <label class="inline">
      <span>{t('year')}</span>
      <select value={value} onChange={(e) => onChange(Number(e.currentTarget.value))}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  );
}

export function UnitSelect({ value, onChange, withAll, onlyPaying }: { value: string; onChange: (id: string) => void; withAll?: boolean; onlyPaying?: boolean }) {
  const { data, t } = useApp();
  return (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {withAll && <option value="">{t('all')}</option>}
      {!withAll && !value && <option value="">{t('chooseUnit')}</option>}
      {data.units.filter((u) => u.active && (!onlyPaying || u.pays_dues)).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
    </select>
  );
}

/** printed header (only on paper): building, report title, date */
export function PrintHead({ title, sub }: { title: string; sub?: string }) {
  const { data, t, today } = useApp();
  const b = data.settings.building;
  return (
    <div class="print-only print-head">
      <div>
        <strong>{b.name}</strong>
        {b.address && <div class="muted">{b.address}</div>}
      </div>
      <div class="print-title">
        <strong>{title}</strong>
        {sub && <div>{sub}</div>}
        <div class="muted">{t('printedOn')}: {today.split('-').reverse().join('.')}</div>
      </div>
    </div>
  );
}
