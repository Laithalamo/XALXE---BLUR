/** Sign-in, the activity log and the printable payment receipt (tahsilat makbuzu). */
import { useEffect, useState } from 'preact/hooks';
import { ApiError, post } from '../api';
import { amountWords, date, dateTime, money } from '../format';
import { Empty, Field, Money, useApp } from '../ui';

export function Login() {
  const { t, reload, go } = useApp();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await post('login', { username: user, password: pass });
      await reload();
      go('#/tahsilat');
    } catch (x) {
      const a = x as ApiError;
      setErr(a.status === 429 ? t('locked', { n: String(a.body.retry ?? 15) }) : a.status === 401 ? t('wrongLogin') : `${t('error')}: ${a.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="page narrow">
      <form class="card form login" onSubmit={submit}>
        <h2>{t('adminLogin')}</h2>
        <Field label={t('username')}><input autocomplete="username" value={user} onInput={(e) => setUser(e.currentTarget.value)} required /></Field>
        <Field label={t('password')}><input type="password" autocomplete="current-password" value={pass} onInput={(e) => setPass(e.currentTarget.value)} required /></Field>
        {err && <p class="field-error">{err}</p>}
        <button class="primary wide" type="submit" disabled={busy}>{t('signIn')}</button>
      </form>
    </div>
  );
}

interface LogRow {
  ts: number;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
}

export function Activity() {
  const { t } = useApp();
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    post<{ log: LogRow[] }>('log', {}).then((r) => setRows(r.log)).catch(() => setRows([]));
  }, []);
  if (!rows) return <div class="page"><p class="muted">{t('loading')}</p></div>;
  return (
    <div class="page">
      <section class="card">
        <h2>{t('changes')}</h2>
        {rows.length ? (
          <div class="table-scroll">
            <table class="list log">
              <thead><tr><th>{t('when')}</th><th>{t('what')}</th><th>{t('description')}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td class="nowrap">{dateTime(r.ts)}</td>
                    <td class="nowrap">{r.action} · {r.entity}</td>
                    <td class="detail">{summarize(r.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
      </section>
    </div>
  );
}

function summarize(detail: string) {
  try {
    const o = JSON.parse(detail) as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ['label', 'unit_id', 'date', 'category', 'title', 'description', 'added', 'skipped']) if (o[k] !== undefined && o[k] !== '') parts.push(String(o[k]));
    if (typeof o.amount === 'number') parts.push(money(o.amount));
    return parts.join(' · ') || detail.slice(0, 120);
  } catch {
    return detail.slice(0, 120);
  }
}

export function Receipt({ id }: { id: string }) {
  const { data, t, accounts, unitName } = useApp();
  const p = data.payments.find((x) => x.id === id);
  if (!p) return <div class="page"><Empty /></div>;
  const unit = data.units.find((u) => u.id === p.unit_id);
  const covers = accounts.find((a) => a.unit.id === p.unit_id)?.credits.find((c) => c.paymentId === p.id);
  const b = data.settings.building;
  return (
    <div class="page narrow">
      <div class="toolbar no-print">
        <a class="ghost btn" href={`#/ekstre/${p.unit_id}`}>← {unitName(p.unit_id)}</a>
        <button class="primary" onClick={() => print()}>⎙ {t('print')}</button>
      </div>
      <div class="receipt">
        <div class="receipt-head">
          <div>
            <strong>{b.name}</strong>
            {b.address && <div class="muted small">{b.address}</div>}
          </div>
          <div class="right">
            <div class="receipt-title">{t('receiptTitle')}</div>
            <div class="small">{t('receiptNo')}: {p.id.slice(0, 8).toUpperCase()}</div>
            <div class="small">{t('date')}: {date(p.date)}</div>
          </div>
        </div>
        <p>{t('received')}</p>
        <table class="list">
          <tbody>
            <tr><th>{t('unit')}</th><td>{unit?.label ?? p.unit_id}</td></tr>
            {(unit?.owner || unit?.tenant) && <tr><th>{t('payer')}</th><td>{unit?.tenant || unit?.owner}</td></tr>}
            <tr><th>{t('amount')}</th><td><strong><Money k={p.amount} /></strong><div class="muted small">{amountWords(p.amount)}</div></td></tr>
            <tr><th>{t('account')}</th><td>{p.account === 'banka' ? `${t('bank')}${b.bank ? ` (${b.bank})` : ''}` : t('cash')}</td></tr>
            {p.description && <tr><th>{t('description')}</th><td>{p.description}</td></tr>}
            {covers && covers.covers.length > 0 && (
              <tr>
                <th>{t('covers')}</th>
                <td>
                  {covers.covers.map((c, i) => <div key={i}>{c.label === 'devir' ? t('devir') : c.label}: {money(c.amount)}</div>)}
                  {covers.left > 0 && <div>{t('advance')}: {money(covers.left)}</div>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div class="signatures">
          <div>{t('payer')}<br /><br />…………………</div>
          <div>{t('signature')}<br /><br />{b.manager || '…………………'}</div>
        </div>
      </div>
    </div>
  );
}
