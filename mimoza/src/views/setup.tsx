/** Manager set-up: the flats and shops, and the settings (aidat amounts, building, accounts, backup). */
import { useState } from 'preact/hooks';
import { post, save } from '../api';
import { rateFor } from '../calc';
import { downloadJson } from '../csv';
import { money, monthName } from '../format';
import type { Settings, Unit } from '../schema';
import { Dialog, Field, Money, MoneyInput, useApp } from '../ui';

// ---- flats ------------------------------------------------------------------------------------------

export function Units() {
  const { data, t, accounts, today } = useApp();
  const [edit, setEdit] = useState<Unit | null>(null);
  return (
    <div class="page">
      <section class="card">
        <div class="table-scroll">
          <table class="list clickable">
            <thead>
              <tr><th>{t('label')}</th><th>{t('kind')}</th><th>{t('owner')}</th><th>{t('tenant')}</th><th>{t('phone')}</th><th>{t('monthlyDues')}</th><th class="num">{t('balance')}</th></tr>
            </thead>
            <tbody>
              {data.units.map((u) => {
                const acc = accounts.find((a) => a.unit.id === u.id);
                return (
                  <tr key={u.id} onClick={() => setEdit({ ...u })} class={u.active ? '' : 'muted'}>
                    <td><strong>{u.label}</strong></td>
                    <td>{u.kind === 'dukkan' ? t('shop') : t('flat')}</td>
                    <td>{u.owner}</td>
                    <td>{u.tenant}</td>
                    <td class="nowrap">{u.phone}</td>
                    <td>{u.pays_dues ? <Money k={u.dues_amount ?? rateFor(data.settings, today.slice(0, 7))} /> : '—'}</td>
                    <td class="num">{acc ? <Money k={acc.balance} /> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button class="primary" onClick={() => setEdit({ id: '', sort: data.units.length + 1, label: '', kind: 'daire', owner: '', tenant: '', phone: '', pays_dues: 1, dues_amount: null, opening: 0, keywords: '', note: '', active: 1 })}>+ {t('add')}</button>
      </section>
      {edit && <UnitDialog unit={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function UnitDialog({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const { t, reload, toast } = useApp();
  const [u, setU] = useState<Unit>(unit);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Unit>(k: K, v: Unit[K]) => setU((x) => ({ ...x, [k]: v }));
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!u.label.trim()) return toast(t('required'), true);
    setBusy(true);
    try {
      const row: Record<string, unknown> = { ...u };
      if (!row.id) delete row.id;
      await save('units', row);
      await reload();
      toast(t('saved'));
      onClose();
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={u.label || t('new')} onClose={onClose}>
      <form class="form grid2" onSubmit={submit}>
        <Field label={t('label')}><input value={u.label} onInput={(e) => set('label', e.currentTarget.value)} /></Field>
        <Field label={t('kind')}>
          <select value={u.kind} onChange={(e) => set('kind', e.currentTarget.value)}>
            <option value="daire">{t('flat')}</option>
            <option value="dukkan">{t('shop')}</option>
          </select>
        </Field>
        <Field label={t('owner')}><input value={u.owner} onInput={(e) => set('owner', e.currentTarget.value)} /></Field>
        <Field label={t('tenant')}><input value={u.tenant} onInput={(e) => set('tenant', e.currentTarget.value)} /></Field>
        <Field label={t('phone')}><input type="tel" value={u.phone} onInput={(e) => set('phone', e.currentTarget.value)} placeholder="05xx xxx xx xx" /></Field>
        <Field label={t('ownDues')}><MoneyInput value={u.dues_amount} onChange={(k) => set('dues_amount', k)} placeholder="" /></Field>
        <Field label={t('opening')} help="+ borç / − alacak"><MoneyInput value={u.opening} onChange={(k) => set('opening', k ?? 0)} allowNegative /></Field>
        <Field label={t('keywords')} help={t('keywordsHelp')}><input value={u.keywords} onInput={(e) => set('keywords', e.currentTarget.value)} /></Field>
        <Field label={t('note')}><input value={u.note} onInput={(e) => set('note', e.currentTarget.value)} /></Field>
        <div class="checks span2">
          <label class="check"><input type="checkbox" checked={!!u.pays_dues} onChange={(e) => set('pays_dues', e.currentTarget.checked ? 1 : 0)} /><span>{t('paysDues')}</span></label>
          <label class="check"><input type="checkbox" checked={!!u.active} onChange={(e) => set('active', e.currentTarget.checked ? 1 : 0)} /><span>{t('active')}</span></label>
        </div>
        <div class="form-actions span2">
          <span />
          <div>
            <button type="button" class="ghost" onClick={onClose}>{t('cancel')}</button>
            <button class="primary" type="submit" disabled={busy}>{t('save')}</button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// ---- settings ---------------------------------------------------------------------------------------

export function SettingsPage() {
  const { data, t, reload, toast, lang, today } = useApp();
  const [s, setS] = useState<Settings>(structuredClone(data.settings));
  const [busy, setBusy] = useState('');
  const store = async (key: keyof Settings, value: unknown) => {
    setBusy(key);
    try {
      await post('settings', { key, value });
      await reload();
      toast(t('saved'));
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    } finally {
      setBusy('');
    }
  };
  const b = s.building;
  const setB = (k: keyof Settings['building'], v: string) => setS((x) => ({ ...x, building: { ...x.building, [k]: v } }));
  const d = s.dues;
  const setD = (patch: Partial<Settings['dues']>) => setS((x) => ({ ...x, dues: { ...x.dues, ...patch } }));
  const periods = [...d.periods].sort((a, c) => a.from.localeCompare(c.from));
  const current = rateFor(data.settings, today.slice(0, 7));
  return (
    <div class="page settings">
      <section class="card">
        <h2>{t('duesSettings')}</h2>
        <p class="lead">{t('monthlyDues')}: <strong>{money(current)}</strong></p>
        <div class="form grid2">
          <Field label={t('duesStart')}><input type="month" value={d.start} onInput={(e) => setD({ start: e.currentTarget.value })} /></Field>
          <Field label={t('dueDay')}><input type="number" min={1} max={28} value={d.dueDay} onInput={(e) => setD({ dueDay: Math.min(28, Math.max(1, Number(e.currentTarget.value) || 1)) })} /></Field>
        </div>
        <h3>{t('rates')}</h3>
        <p class="muted small">{t('ratesHelp')}</p>
        <table class="list rates">
          <thead><tr><th>{t('fromMonth')}</th><th>{t('monthlyDues')}</th><th /></tr></thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={i}>
                <td><input type="month" value={p.from} onInput={(e) => setD({ periods: periods.map((x, j) => (j === i ? { ...x, from: e.currentTarget.value } : x)) })} /> <span class="muted small">{p.from && monthName(p.from, lang)}</span></td>
                <td><MoneyInput value={p.amount} onChange={(k) => setD({ periods: periods.map((x, j) => (j === i ? { ...x, amount: k ?? 0 } : x)) })} /></td>
                <td>{periods.length > 1 && <button class="icon" onClick={() => setD({ periods: periods.filter((_, j) => j !== i) })} aria-label={t('delete')}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button class="ghost" onClick={() => setD({ periods: [...periods, { from: today.slice(0, 7), amount: periods[periods.length - 1]?.amount ?? 0 }] })}>+ {t('addRate')}</button>
        <label class="check"><input type="checkbox" checked={d.lateFee} onChange={(e) => setD({ lateFee: e.currentTarget.checked })} /><span>{t('showLateFee')}</span></label>
        <div class="form-actions"><span /><button class="primary" disabled={busy === 'dues'} onClick={() => store('dues', { ...d, periods: periods.filter((p) => p.from) })}>{t('save')}</button></div>
      </section>

      <section class="card">
        <h2>{t('building')}</h2>
        <div class="form grid2">
          <Field label={t('buildingName')}><input value={b.name} onInput={(e) => setB('name', e.currentTarget.value)} /></Field>
          <Field label={t('address')}><input value={b.address} onInput={(e) => setB('address', e.currentTarget.value)} /></Field>
          <Field label={t('managerName')}><input value={b.manager} onInput={(e) => setB('manager', e.currentTarget.value)} /></Field>
          <Field label={t('managerPhone')}><input type="tel" value={b.managerPhone} onInput={(e) => setB('managerPhone', e.currentTarget.value)} /></Field>
          <Field label={t('bankName')}><input value={b.bank} onInput={(e) => setB('bank', e.currentTarget.value)} /></Field>
          <Field label={t('iban')}><input value={b.iban} onInput={(e) => setB('iban', e.currentTarget.value.toUpperCase())} placeholder="TR00 0000 0000 0000 0000 0000 00" /></Field>
          <Field label={t('accountHolder')}><input value={b.holder} onInput={(e) => setB('holder', e.currentTarget.value)} /></Field>
          <Field label={t('payNote')} help={t('payNoteHelp')}><input value={b.payNote} onInput={(e) => setB('payNote', e.currentTarget.value)} /></Field>
        </div>
        <div class="form-actions"><span /><button class="primary" disabled={busy === 'building'} onClick={() => store('building', b)}>{t('save')}</button></div>
      </section>

      <section class="card">
        <h2>{t('accountsSettings')}</h2>
        <p class="muted small">{t('accountsHelp')}</p>
        <div class="form grid2">
          <Field label={t('openingDate')}><input type="date" value={s.accounts.date} onInput={(e) => setS((x) => ({ ...x, accounts: { ...x.accounts, date: e.currentTarget.value } }))} /></Field>
          <span />
          <Field label={t('bank')}><MoneyInput value={s.accounts.banka} onChange={(k) => setS((x) => ({ ...x, accounts: { ...x.accounts, banka: k ?? 0 } }))} allowNegative /></Field>
          <Field label={t('cash')}><MoneyInput value={s.accounts.kasa} onChange={(k) => setS((x) => ({ ...x, accounts: { ...x.accounts, kasa: k ?? 0 } }))} allowNegative /></Field>
        </div>
        <div class="form-actions"><span /><button class="primary" disabled={busy === 'accounts'} onClick={() => store('accounts', s.accounts)}>{t('save')}</button></div>
      </section>

      <section class="card">
        <h2>{t('categoriesSettings')}</h2>
        <div class="form grid2">
          <Field label={t('expenseCats')} help={t('oneLine')}>
            <textarea rows={8} value={s.categories.expense.join('\n')} onInput={(e) => setS((x) => ({ ...x, categories: { ...x.categories, expense: lines(e.currentTarget.value) } }))} />
          </Field>
          <Field label={t('incomeCats')} help={t('oneLine')}>
            <textarea rows={8} value={s.categories.income.join('\n')} onInput={(e) => setS((x) => ({ ...x, categories: { ...x.categories, income: lines(e.currentTarget.value) } }))} />
          </Field>
        </div>
        <div class="form-actions"><span /><button class="primary" disabled={busy === 'categories'} onClick={() => store('categories', { expense: clean(s.categories.expense), income: clean(s.categories.income) })}>{t('save')}</button></div>
      </section>

      <section class="card">
        <h2>{t('display')}</h2>
        <label class="check"><input type="checkbox" checked={s.display.publicNames} onChange={(e) => setS((x) => ({ ...x, display: { publicNames: e.currentTarget.checked } }))} /><span>{t('publicNames')}</span></label>
        <div class="form-actions"><span /><button class="primary" disabled={busy === 'display'} onClick={() => store('display', s.display)}>{t('save')}</button></div>
      </section>

      <PasswordCard />
      <BackupCard />
    </div>
  );
}

const lines = (v: string) => v.split('\n');
const clean = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))];

function PasswordCard() {
  const { t, toast } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const change = async (e: Event) => {
    e.preventDefault();
    try {
      await post('password', { current: cur, next });
      setCur('');
      setNext('');
      toast(t('passwordChanged'));
    } catch (err) {
      toast((err as Error).message === 'wrong' ? t('wrongLogin') : `${t('error')}: ${(err as Error).message}`, true);
    }
  };
  return (
    <section class="card">
      <h2>{t('security')}</h2>
      <form class="form grid2" onSubmit={change}>
        <Field label={t('currentPassword')}><input type="password" autocomplete="current-password" value={cur} onInput={(e) => setCur(e.currentTarget.value)} /></Field>
        <Field label={t('newPassword')}><input type="password" autocomplete="new-password" minLength={8} value={next} onInput={(e) => setNext(e.currentTarget.value)} /></Field>
        <div class="form-actions span2"><span /><button class="primary" type="submit" disabled={!cur || next.length < 8}>{t('changePassword')}</button></div>
      </form>
    </section>
  );
}

function BackupCard() {
  const { t, toast, reload, today } = useApp();
  const download = async () => {
    try {
      const res = await fetch('api/backup', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-mimoza': '1' }, body: '{}' });
      if (!res.ok) throw new Error(String(res.status));
      downloadJson(`mimoza-yedek-${today}.json`, await res.json());
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    }
  };
  const restore = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !confirm(t('restoreConfirm'))) return;
    try {
      await post('restore', { dump: JSON.parse(await file.text()) });
      await reload();
      toast(t('restored'));
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    }
  };
  return (
    <section class="card">
      <h2>{t('backup')}</h2>
      <div class="row">
        <button class="primary" onClick={download}>⤓ {t('downloadBackup')}</button>
        <label class="btn ghost">⤒ {t('restoreBackup')}<input type="file" accept=".json,application/json" hidden onChange={restore} /></label>
      </div>
    </section>
  );
}
