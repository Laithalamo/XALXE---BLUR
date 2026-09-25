/** Manager pages that add / edit records: payments, expenses, income, transfers, extra charges, notices. */
import { useState } from 'preact/hooks';
import { save, remove, post } from '../api';
import { duesFor, monthRange, years } from '../calc';
import { downloadCsv } from '../csv';
import { date, money, plain } from '../format';
import type { TableName } from '../schema';
import { Dialog, Empty, Field, Money, MoneyInput, Toolbar, UnitSelect, useApp, YearSelect } from '../ui';

type FieldType = 'date' | 'money' | 'moneyNeg' | 'text' | 'textarea' | 'category' | 'incomeCategory' | 'unit' | 'account' | 'check';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
}

/** add / edit one record of a table */
export function RecordDialog({ table, title, fields, initial, onClose }: {
  table: TableName; title: string; fields: FieldDef[]; initial: Record<string, unknown>; onClose: () => void;
}) {
  const { t, data, reload, toast } = useApp();
  const [row, setRow] = useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setRow((r) => ({ ...r, [k]: v }));
  const submit = async (e: Event) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = row[f.key];
      if ((f.type === 'money' || f.type === 'moneyNeg') && (v === null || v === undefined || (f.required !== false && v === 0))) errs[f.key] = t('badAmount');
      else if (f.required && (v === '' || v === undefined || v === null)) errs[f.key] = t('required');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await save(table, row);
      await reload();
      toast(t('saved'));
      onClose();
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!confirm(t('confirmDelete'))) return;
    setBusy(true);
    try {
      await remove(table, String(row.id));
      await reload();
      toast(t('deleted'));
      onClose();
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const cats = (type: FieldType) => (type === 'category' ? data.settings.categories.expense : data.settings.categories.income);
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} class="form">
        {fields.map((f) => {
          const v = row[f.key];
          let input;
          switch (f.type) {
            case 'date':
              input = <input type="date" value={String(v ?? '')} onInput={(e) => set(f.key, e.currentTarget.value)} required />;
              break;
            case 'money':
            case 'moneyNeg':
              input = <MoneyInput value={(v as number | null) ?? null} onChange={(k) => set(f.key, k)} allowNegative={f.type === 'moneyNeg'} />;
              break;
            case 'textarea':
              input = <textarea rows={4} value={String(v ?? '')} onInput={(e) => set(f.key, e.currentTarget.value)} />;
              break;
            case 'category':
            case 'incomeCategory': {
              const list = cats(f.type);
              const cur = String(v ?? '');
              input = (
                <select value={cur} onChange={(e) => set(f.key, e.currentTarget.value)}>
                  {!list.includes(cur) && cur && <option value={cur}>{cur}</option>}
                  {list.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              );
              break;
            }
            case 'unit':
              input = <UnitSelect value={String(v ?? '')} onChange={(id) => set(f.key, id)} />;
              break;
            case 'account':
              input = (
                <select value={String(v ?? 'banka')} onChange={(e) => set(f.key, e.currentTarget.value)}>
                  <option value="banka">{t('bank')}</option>
                  <option value="kasa">{t('cash')}</option>
                </select>
              );
              break;
            case 'check':
              return (
                <label key={f.key} class="check">
                  <input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.currentTarget.checked ? 1 : 0)} />
                  <span>{f.label}</span>
                </label>
              );
            default:
              input = <input value={String(v ?? '')} onInput={(e) => set(f.key, e.currentTarget.value)} />;
          }
          return <Field key={f.key} label={f.label} help={f.help} error={errors[f.key]}>{input}</Field>;
        })}
        <div class="form-actions">
          {row.id ? <button type="button" class="danger" onClick={del} disabled={busy}>{t('delete')}</button> : <span />}
          <div>
            <button type="button" class="ghost" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" class="primary" disabled={busy}>{t('save')}</button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function useYearFilter() {
  const { today } = useApp();
  return useState(Number(today.slice(0, 4)));
}

// ---- payments (tahsilat) -----------------------------------------------------------------------------

export function Payments() {
  const { data, t, today, accounts, unitName } = useApp();
  const [year, setYear] = useYearFilter();
  const [unit, setUnit] = useState('');
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const ys = years(data, today);
  const list = data.payments.filter((p) => p.date.startsWith(`${year}-`) && (!unit || p.unit_id === unit)).sort((a, b) => b.date.localeCompare(a.date));
  const fields: FieldDef[] = [
    { key: 'unit_id', label: t('unit'), type: 'unit', required: true },
    { key: 'date', label: t('date'), type: 'date', required: true },
    { key: 'amount', label: t('amount'), type: 'money' },
    { key: 'account', label: t('account'), type: 'account' },
    { key: 'description', label: t('description'), type: 'text' },
  ];
  const month = today.slice(0, 7);
  const quick = (unitId: string) => {
    const acc = accounts.find((a) => a.unit.id === unitId);
    const due = acc && acc.balance > 0 ? acc.balance : acc ? duesFor(data.settings, acc.unit, month) : 0;
    setEdit({ unit_id: unitId, date: today, amount: due || null, account: 'banka', description: t('aidatPayment') });
  };
  const csv = () => downloadCsv(`tahsilat-${year}`, [[t('date'), t('unit'), t('account'), t('description'), t('amount')], ...list.map((p) => [date(p.date), unitName(p.unit_id), p.account, p.description, plain(p.amount)])]);
  return (
    <div class="page">
      <section class="card">
        <h2>{t('quickPay')}</h2>
        <div class="quick">
          {accounts.filter((a) => a.unit.pays_dues).map((a) => (
            <button key={a.unit.id} class={`quick-btn ${a.balance > 0 ? 'owes' : ''}`} onClick={() => quick(a.unit.id)}>
              <strong>{a.unit.label}</strong>
              <span>{a.balance > 0 ? money(a.balance) : t('settled')}</span>
            </button>
          ))}
        </div>
      </section>
      <Toolbar onCsv={csv}>
        <button class="primary" onClick={() => setEdit({ unit_id: '', date: today, amount: null, account: 'banka', description: '' })}>+ {t('newPayment')}</button>
        <YearSelect value={year} years={ys} onChange={setYear} />
        <UnitSelect value={unit} onChange={setUnit} withAll />
      </Toolbar>
      <section class="card">
        {list.length ? (
          <div class="table-scroll">
            <table class="list clickable">
              <thead><tr><th>{t('date')}</th><th>{t('unit')}</th><th>{t('description')}</th><th>{t('account')}</th><th class="num">{t('amount')}</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} onClick={() => setEdit({ ...p })}>
                    <td class="nowrap">{date(p.date)}</td>
                    <td>{unitName(p.unit_id)}</td>
                    <td>{p.description}{p.ref && <span class="tag">bank</span>}</td>
                    <td>{p.account === 'banka' ? t('bank') : t('cash')}</td>
                    <td class="num"><Money k={p.amount} /></td>
                    <td><a class="link small" href={`#/makbuz/${p.id}`} onClick={(e) => e.stopPropagation()}>{t('receipt')}</a></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={4}>{t('total')}</th><th class="num"><Money k={list.reduce((s, p) => s + p.amount, 0)} /></th><th /></tr></tfoot>
            </table>
          </div>
        ) : <Empty />}
      </section>
      {edit && <RecordDialog table="payments" title={edit.id ? t('edit') : t('newPayment')} fields={fields} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ---- expenses / income / transfers -------------------------------------------------------------------

export function Expenses() {
  const { data, t, today } = useApp();
  const [year, setYear] = useYearFilter();
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const ys = years(data, today);
  const list = data.expenses.filter((e) => e.date.startsWith(`${year}-`) && (!cat || e.category === cat)).sort((a, b) => b.date.localeCompare(a.date));
  const fields: FieldDef[] = [
    { key: 'date', label: t('date'), type: 'date', required: true },
    { key: 'category', label: t('category'), type: 'category', required: true },
    { key: 'amount', label: t('amount'), type: 'money' },
    { key: 'account', label: t('account'), type: 'account' },
    { key: 'description', label: t('description'), type: 'text' },
    { key: 'vendor', label: t('vendor'), type: 'text' },
    { key: 'doc_no', label: t('docNo'), type: 'text' },
  ];
  const csv = () => downloadCsv(`giderler-${year}`, [[t('date'), t('category'), t('description'), t('vendor'), t('docNo'), t('account'), t('amount')], ...list.map((e) => [date(e.date), e.category, e.description, e.vendor, e.doc_no, e.account, plain(e.amount)])]);
  return (
    <div class="page">
      <Toolbar onCsv={csv}>
        <button class="primary" onClick={() => setEdit({ date: today, category: data.settings.categories.expense[0] ?? '', amount: null, account: 'banka', description: '', vendor: '', doc_no: '' })}>+ {t('newExpense')}</button>
        <YearSelect value={year} years={ys} onChange={setYear} />
        <select value={cat} onChange={(e) => setCat(e.currentTarget.value)}>
          <option value="">{t('all')}</option>
          {data.settings.categories.expense.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Toolbar>
      <section class="card">
        {list.length ? (
          <div class="table-scroll">
            <table class="list clickable">
              <thead><tr><th>{t('date')}</th><th>{t('category')}</th><th>{t('description')}</th><th>{t('account')}</th><th class="num">{t('amount')}</th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} onClick={() => setEdit({ ...e })}>
                    <td class="nowrap">{date(e.date)}</td>
                    <td>{e.category}</td>
                    <td>{e.description}{e.vendor && <span class="muted"> · {e.vendor}</span>}{e.ref && <span class="tag">bank</span>}</td>
                    <td>{e.account === 'banka' ? t('bank') : t('cash')}</td>
                    <td class="num"><Money k={e.amount} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={4}>{t('total')}</th><th class="num"><Money k={list.reduce((s, e) => s + e.amount, 0)} /></th></tr></tfoot>
            </table>
          </div>
        ) : <Empty />}
      </section>
      {edit && <RecordDialog table="expenses" title={edit.id ? t('edit') : t('newExpense')} fields={fields} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function Incomes() {
  const { data, t, today } = useApp();
  const [year, setYear] = useYearFilter();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [editT, setEditT] = useState<Record<string, unknown> | null>(null);
  const ys = years(data, today);
  const list = data.incomes.filter((e) => e.date.startsWith(`${year}-`)).sort((a, b) => b.date.localeCompare(a.date));
  const tlist = data.transfers.filter((e) => e.date.startsWith(`${year}-`)).sort((a, b) => b.date.localeCompare(a.date));
  const fields: FieldDef[] = [
    { key: 'date', label: t('date'), type: 'date', required: true },
    { key: 'category', label: t('category'), type: 'incomeCategory', required: true },
    { key: 'amount', label: t('amount'), type: 'money' },
    { key: 'account', label: t('account'), type: 'account' },
    { key: 'description', label: t('description'), type: 'text' },
  ];
  const tfields: FieldDef[] = [
    { key: 'date', label: t('date'), type: 'date', required: true },
    { key: 'from_acc', label: t('fromAcc'), type: 'account' },
    { key: 'to_acc', label: t('toAcc'), type: 'account' },
    { key: 'amount', label: t('amount'), type: 'money' },
    { key: 'description', label: t('description'), type: 'text' },
  ];
  const accName = (a: string) => (a === 'banka' ? t('bank') : t('cash'));
  return (
    <div class="page">
      <Toolbar>
        <button class="primary" onClick={() => setEdit({ date: today, category: data.settings.categories.income[0] ?? '', amount: null, account: 'banka', description: '' })}>+ {t('newIncome')}</button>
        <button onClick={() => setEditT({ date: today, from_acc: 'kasa', to_acc: 'banka', amount: null, description: '' })}>⇄ {t('newTransfer')}</button>
        <YearSelect value={year} years={ys} onChange={setYear} />
      </Toolbar>
      <section class="card">
        <h2>{t('incomes')}</h2>
        {list.length ? (
          <table class="list clickable">
            <thead><tr><th>{t('date')}</th><th>{t('category')}</th><th>{t('description')}</th><th>{t('account')}</th><th class="num">{t('amount')}</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} onClick={() => setEdit({ ...e })}>
                  <td class="nowrap">{date(e.date)}</td><td>{e.category}</td><td>{e.description}</td><td>{accName(e.account)}</td><td class="num"><Money k={e.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty />}
      </section>
      <section class="card">
        <h2>{t('transfer')}</h2>
        {tlist.length ? (
          <table class="list clickable">
            <thead><tr><th>{t('date')}</th><th>{t('fromAcc')} → {t('toAcc')}</th><th>{t('description')}</th><th class="num">{t('amount')}</th></tr></thead>
            <tbody>
              {tlist.map((e) => (
                <tr key={e.id} onClick={() => setEditT({ ...e })}>
                  <td class="nowrap">{date(e.date)}</td><td>{accName(e.from_acc)} → {accName(e.to_acc)}</td><td>{e.description}</td><td class="num"><Money k={e.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty />}
      </section>
      {edit && <RecordDialog table="incomes" title={edit.id ? t('edit') : t('newIncome')} fields={fields} initial={edit} onClose={() => setEdit(null)} />}
      {editT && <RecordDialog table="transfers" title={editT.id ? t('edit') : t('newTransfer')} fields={tfields} initial={editT} onClose={() => setEditT(null)} />}
    </div>
  );
}

// ---- extra charges (ek borçlandırma) -------------------------------------------------------------------

export function Charges() {
  const { data, t, today, unitName, reload, toast } = useApp();
  const units = data.units.filter((u) => u.active);
  const [desc, setDesc] = useState('');
  const [day, setDay] = useState(today);
  const [mode, setMode] = useState<'each' | 'split'>('each');
  const [amount, setAmount] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>(units.filter((u) => u.pays_dues).map((u) => u.id));
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const per = amount === null || !picked.length ? null : mode === 'each' ? amount : Math.round(amount / picked.length);
  const add = async (e: Event) => {
    e.preventDefault();
    if (!desc.trim() || per === null || per === 0 || !picked.length) {
      toast(t('required'), true);
      return;
    }
    setBusy(true);
    try {
      const batch = `g${Date.now().toString(36)}`;
      // splitting: the last flat takes the rounding remainder so the total is exact
      const rows = picked.map((id, i) => ({
        unit_id: id, date: day, description: desc.trim(), batch,
        amount: mode === 'split' && amount !== null && i === picked.length - 1 ? amount - per * (picked.length - 1) : per,
      }));
      await post('bulk', { table: 'charges', rows });
      await reload();
      toast(t('chargeAdded', { n: picked.length }));
      setDesc('');
      setAmount(null);
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const list = [...data.charges].sort((a, b) => b.date.localeCompare(a.date));
  const fields: FieldDef[] = [
    { key: 'unit_id', label: t('unit'), type: 'unit', required: true },
    { key: 'date', label: t('date'), type: 'date', required: true },
    { key: 'amount', label: t('amount'), type: 'moneyNeg' },
    { key: 'description', label: t('description'), type: 'text', required: true },
  ];
  return (
    <div class="page">
      <section class="card">
        <h2>{t('newCharge')}</h2>
        <p class="muted">{t('chargeHelp')}</p>
        <form class="form grid2" onSubmit={add}>
          <Field label={t('description')}><input value={desc} onInput={(e) => setDesc(e.currentTarget.value)} placeholder="Çatı tamiri" /></Field>
          <Field label={t('date')}><input type="date" value={day} onInput={(e) => setDay(e.currentTarget.value)} /></Field>
          <Field label={t('amount')}>
            <div class="row">
              <MoneyInput value={amount} onChange={setAmount} allowNegative />
              <select value={mode} onChange={(e) => setMode(e.currentTarget.value as 'each' | 'split')}>
                <option value="each">{t('perUnit')}</option>
                <option value="split">{t('splitTotal')}</option>
              </select>
            </div>
          </Field>
          <Field label={t('selectUnits')}>
            <div class="checks">
              {units.map((u) => (
                <label key={u.id} class="check">
                  <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => (e.currentTarget.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} />
                  <span>{u.label}</span>
                </label>
              ))}
            </div>
          </Field>
          <div class="form-actions span2">
            <span class="muted">{per !== null ? `${t('perUnit')}: ${money(per)} × ${picked.length}` : ''}</span>
            <button class="primary" type="submit" disabled={busy}>{t('add')}</button>
          </div>
        </form>
      </section>
      <section class="card">
        <h2>{t('charges')}</h2>
        {list.length ? (
          <table class="list clickable">
            <thead><tr><th>{t('date')}</th><th>{t('unit')}</th><th>{t('description')}</th><th class="num">{t('amount')}</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} onClick={() => setEdit({ ...c })}>
                  <td class="nowrap">{date(c.date)}</td><td>{unitName(c.unit_id)}</td><td>{c.description}</td><td class="num"><Money k={c.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty />}
      </section>
      {edit && <RecordDialog table="charges" title={t('edit')} fields={fields} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ---- notices (duyurular) -----------------------------------------------------------------------------

export function NoticesAdmin() {
  const { data, t, today } = useApp();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const list = [...data.notices].sort((x, y) => y.pinned - x.pinned || y.date.localeCompare(x.date));
  const fields: FieldDef[] = [
    { key: 'date', label: t('date'), type: 'date', required: true },
    { key: 'title', label: t('noticeTitle'), type: 'text', required: true },
    { key: 'body', label: t('noticeBody'), type: 'textarea' },
    { key: 'pinned', label: t('pinned'), type: 'check' },
  ];
  return (
    <div class="page">
      <Toolbar><button class="primary" onClick={() => setEdit({ date: today, title: '', body: '', pinned: 0 })}>+ {t('newNotice')}</button></Toolbar>
      <section class="card">
        {list.length ? list.map((n) => (
          <article key={n.id} class="notice clickable" onClick={() => setEdit({ ...n })}>
            <div class="notice-head"><strong>{n.pinned ? '📌 ' : ''}{n.title}</strong><span class="muted">{date(n.date)}</span></div>
            {n.body && <p>{n.body}</p>}
          </article>
        )) : <Empty />}
      </section>
      {edit && <RecordDialog table="notices" title={edit.id ? t('edit') : t('newNotice')} fields={fields} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** months covered by the building's history, newest first (for pickers) */
export function historyMonths(start: string, today: string) {
  return monthRange(start, today.slice(0, 7)).reverse();
}
