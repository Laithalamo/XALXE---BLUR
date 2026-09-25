/** Bank import: Garanti BBVA "hesap hareketleri" Excel (or pasted rows) -> payments / income / expenses. */
import { useState } from 'preact/hooks';
import { post } from '../api';
import { senderKey, suggest, toBankLines, type LineKind, type Suggestion } from '../bank';
import { date } from '../format';
import { Money, UnitSelect, useApp } from '../ui';
import { parseText, readTable, type Cell } from '../xlsx';

export function BankImport() {
  const { data, t, reload, toast } = useApp();
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [learn, setLearn] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (cells: Cell[][]) => {
    const lines = toBankLines(cells);
    if (!lines) {
      setRows(null);
      setMsg(t('noRows'));
      return;
    }
    setRows(suggest(lines, data));
    setLearn({});
    setMsg(t('rowsFound', { n: lines.length }));
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const table = await readTable(file);
      if (table === 'old-xls') {
        setRows(null);
        setMsg(t('xlsOld'));
        return;
      }
      load(table);
    } catch (err) {
      setMsg(`${t('error')}: ${(err as Error).message}`);
    }
  };
  const update = (i: number, patch: Partial<Suggestion>) => setRows((r) => r && r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const saveAll = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const pick = (k: LineKind) => rows.filter((r) => r.kind === k && !r.duplicate);
      const pay = pick('payment').filter((r) => r.unitId);
      const inc = pick('income');
      const exp = pick('expense');
      const learned = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => r.kind === 'payment' && r.unitId && (learn[i] ?? !r.reason) && senderKey(r.line.description))
        .map(({ r }) => ({ sender: senderKey(r.line.description), unit_id: r.unitId }));
      let added = 0, skipped = 0;
      const send = async (table: string, list: Record<string, unknown>[], extra: Record<string, unknown> = {}) => {
        if (!list.length && !(extra.learn as unknown[] | undefined)?.length) return;
        const res = await post<{ added: number; skipped: number }>('bulk', { table, rows: list, ...extra });
        added += res.added;
        skipped += res.skipped;
      };
      await send('payments', pay.map((r) => ({ unit_id: r.unitId, date: r.line.date, amount: r.line.amount, account: 'banka', description: r.line.description.slice(0, 300), ref: r.line.ref })), { learn: learned });
      await send('incomes', inc.map((r) => ({ date: r.line.date, category: r.category || data.settings.categories.income[0] || 'Diğer Gelir', amount: r.line.amount, account: 'banka', description: r.line.description.slice(0, 300), ref: r.line.ref })));
      await send('expenses', exp.map((r) => ({ date: r.line.date, category: r.category || 'Diğer', amount: -r.line.amount, account: 'banka', description: r.line.description.slice(0, 300), vendor: '', doc_no: '', ref: r.line.ref })));
      await reload();
      toast(t('imported', { a: added, s: skipped }));
      setRows(null);
      setMsg(t('imported', { a: added, s: skipped }));
    } catch (err) {
      toast(`${t('error')}: ${(err as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const ready = rows?.filter((r) => !r.duplicate && ((r.kind === 'payment' && r.unitId) || r.kind === 'income' || r.kind === 'expense')).length ?? 0;
  return (
    <div class="page">
      <section class="card">
        <h2>{t('importTitle')}</h2>
        <ol class="steps">
          <li>{t('importHelp1')}</li>
          <li>{t('importHelp2')}</li>
        </ol>
        <div
          class="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer?.files[0]);
          }}
        >
          <label class="btn primary">
            {t('chooseFile')}
            <input
              type="file" accept=".xlsx,.xls,.csv,.txt,.htm,.html" hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                // so the same file can be chosen again (e.g. next month's download with the same name)
                e.currentTarget.value = '';
                void onFile(f);
              }}
            />
          </label>
          <span class="muted">.xlsx · .xls · .csv</span>
        </div>
        <textarea class="paste" rows={4} placeholder={t('pasteHere')} value={paste} onInput={(e) => setPaste(e.currentTarget.value)} />
        <button class="ghost" disabled={!paste.trim()} onClick={() => load(parseText(paste))}>{t('readPasted')}</button>
        {msg && <p class="note">{msg}</p>}
      </section>

      {rows && (
        <section class="card">
          <div class="table-scroll">
            <table class="list import">
              <thead>
                <tr><th>{t('date')}</th><th>{t('description')}</th><th class="num">{t('amount')}</th><th>{t('type')}</th><th>{t('unit')} / {t('category')}</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.line.ref + i} class={r.duplicate ? 'muted' : r.kind === 'payment' && !r.unitId ? 'attention' : ''}>
                    <td class="nowrap">{date(r.line.date)}</td>
                    <td class="desc">{r.line.description}{r.duplicate && <span class="tag">{t('duplicate')}</span>}</td>
                    <td class="num"><Money k={r.line.amount} sign /></td>
                    <td>
                      <select value={r.kind} disabled={r.duplicate} onChange={(e) => update(i, { kind: e.currentTarget.value as LineKind })}>
                        {r.line.amount > 0 ? (
                          <>
                            <option value="payment">{t('asPayment')}</option>
                            <option value="income">{t('asIncome')}</option>
                          </>
                        ) : <option value="expense">{t('asExpense')}</option>}
                        <option value="skip">{t('skip')}</option>
                      </select>
                    </td>
                    <td>
                      {r.kind === 'payment' && (
                        <div class="stack">
                          <UnitSelect value={r.unitId} onChange={(id) => update(i, { unitId: id, reason: '' })} />
                          {r.reason ? <span class="muted small">{t('matchedBy')}: {r.reason}</span> : r.unitId && senderKey(r.line.description) && (
                            <label class="check small">
                              <input type="checkbox" checked={learn[i] ?? true} onChange={(e) => setLearn((l) => ({ ...l, [i]: e.currentTarget.checked }))} />
                              <span>{t('remember')}: {senderKey(r.line.description)}</span>
                            </label>
                          )}
                        </div>
                      )}
                      {(r.kind === 'income' || r.kind === 'expense') && (
                        <select value={r.category} onChange={(e) => update(i, { category: e.currentTarget.value })}>
                          {(r.kind === 'income' ? data.settings.categories.income : data.settings.categories.expense).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="form-actions">
            <span class="muted">{ready} / {rows.length}</span>
            <button class="primary" disabled={!ready || busy} onClick={saveAll}>{t('importSave')}</button>
          </div>
        </section>
      )}
    </div>
  );
}
