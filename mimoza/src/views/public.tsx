/** The read-only pages everyone sees: overview, dues table, income & expenses, balances, statement, report. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ColumnChart } from '../chart';
import {
  addMonths, balances, daysInMonth, ledger, monthCell, monthRange, monthSummaries, movements, rateFor, sumSummaries, years,
  type MonthSummary, type UnitAccount,
} from '../calc';
import { downloadCsv } from '../csv';
import { date, money, monthName, monthShort, plain, unitNo } from '../format';
import { Empty, Legend, Money, PrintHead, StateMark, Tile, Toolbar, UnitSelect, useApp, YearSelect } from '../ui';

// ---- overview -----------------------------------------------------------------------------------

export function Overview() {
  const { data, t, today, accounts, monthLabel, go, admin } = useApp();
  const b = balances(data);
  const month = today.slice(0, 7);
  const [sum] = monthSummaries(data, accounts, [month]);
  const paying = accounts.filter((a) => a.unit.pays_dues);
  const expected = paying.reduce((s, a) => s + (a.debits.find((d) => d.kind === 'aidat' && d.month === month)?.amount ?? 0), 0);
  const debtors = accounts.filter((a) => a.balance > 0);
  const receivable = debtors.reduce((s, a) => s + a.balance, 0);
  const recent = [...data.expenses].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);
  const notices = [...data.notices].sort((x, y) => y.pinned - x.pinned || y.date.localeCompare(x.date)).slice(0, 3);
  const s = data.settings;
  const rate = rateFor(s, month);
  return (
    <div class="page">
      {admin && rate === 0 && <div class="banner warn" onClick={() => go('#/ayarlar')}>⚠ {t('setRate')}</div>}
      <section class="hero">
        <div class="hero-label">{t('totalBalance')}</div>
        <div class="hero-value">{money(b.total)}</div>
        <div class="hero-sub">
          <span>{t('bank')}: <Money k={b.banka} /></span>
          <span>{t('cash')}: <Money k={b.kasa} /></span>
        </div>
      </section>
      <section class="tiles">
        <Tile label={`${t('thisMonth')}: ${t('collected')}`} value={money(sum.collected)} sub={expected ? `${t('expected')}: ${money(expected)}` : undefined} />
        <Tile label={`${t('thisMonth')}: ${t('expense')}`} value={money(sum.expense)} />
        <Tile label={t('receivable')} value={money(receivable)} sub={debtors.length ? t('owedBy', { n: debtors.length }) : t('noDebt')} tone={debtors.length ? 'bad' : 'good'} />
        <Tile label={t('monthlyDues')} value={money(rate)} sub={t('dueDayInfo', { d: s.dues.dueDay })} />
      </section>

      <section class="card">
        <div class="card-head">
          <h2>{t('monthStatus', { m: monthLabel(month) })}</h2>
          <a href="#/aidat" class="link">{t('duesTable')} →</a>
        </div>
        <div class="unit-grid">
          {paying.map((a) => {
            const c = monthCell(a, month, today);
            return (
              <a key={a.unit.id} class={`unit-card st-${c.state}`} href={`#/ekstre/${a.unit.id}`}>
                <div class="unit-name">{a.unit.label}</div>
                <StateMark state={c.state} label />
                <div class="unit-bal">{a.balance > 0 ? <>{t('debtor')}: <Money k={a.balance} /></> : a.balance < 0 ? <>{t('inCredit')}: <Money k={-a.balance} /></> : t('settled')}</div>
              </a>
            );
          })}
        </div>
      </section>

      <div class="cols">
        <section class="card">
          <div class="card-head">
            <h2>{t('recentExpenses')}</h2>
            <a href="#/gelir-gider" class="link">{t('seeAll')} →</a>
          </div>
          {recent.length ? (
            <table class="list">
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id}>
                    <td class="nowrap">{date(e.date)}</td>
                    <td>{e.category}{e.description && <div class="muted small">{e.description}</div>}</td>
                    <td class="num"><Money k={-e.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty />}
        </section>
        <section class="card">
          <h2>{t('payInfo')}</h2>
          <dl class="pay">
            {s.building.iban && <><dt>{t('iban')}</dt><dd class="mono">{s.building.iban}</dd></>}
            {s.building.holder && <><dt>{t('accountHolder')}</dt><dd>{s.building.holder}</dd></>}
            {s.building.bank && <><dt>{t('bankName')}</dt><dd>{s.building.bank}</dd></>}
            {s.building.payNote && <><dt>{t('writeInDesc')}</dt><dd class="mono">{s.building.payNote.replace('{no}', 'X').replace('{ay}', monthName(month, 'tr').split(' ')[0].toLocaleUpperCase('tr-TR'))}</dd></>}
            <dt>{t('monthlyDues')}</dt><dd>{money(rate)} · {t('dueDayInfo', { d: s.dues.dueDay })}</dd>
            {s.building.manager && <><dt>{t('admin')}</dt><dd>{s.building.manager}{s.building.managerPhone && ` · ${s.building.managerPhone}`}</dd></>}
          </dl>
        </section>
      </div>

      {notices.length > 0 && (
        <section class="card">
          <div class="card-head">
            <h2>{t('notices')}</h2>
            <a href="#/duyurular" class="link">{t('seeAll')} →</a>
          </div>
          {notices.map((n) => (
            <article key={n.id} class="notice">
              <div class="notice-head"><strong>{n.pinned ? '📌 ' : ''}{n.title}</strong><span class="muted">{date(n.date)}</span></div>
              {n.body && <p>{n.body}</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

// ---- dues table (aidat çizelgesi) ---------------------------------------------------------------------

export function DuesTable() {
  const { data, t, lang, today, accounts } = useApp();
  const ys = years(data, today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const all = monthRange(`${year}-01`, `${year}-12`);
  const paying = accounts.filter((a) => a.unit.pays_dues);
  // months before the dues started (or with no dues at all) are just empty columns: leave them out
  const used = all.filter((m) => paying.some((a) => monthCell(a, m, today).state !== 'none'));
  const months = used.length ? used : all;
  const current = today.slice(0, 7);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // on a phone the table scrolls sideways: start at this month
    const box = scroller.current;
    const th = box?.querySelector<HTMLElement>('th.current');
    if (box && th && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, th.offsetLeft - box.clientWidth / 2);
  }, [year, months.length]);
  const cellSum = (a: UnitAccount) => {
    let owed = 0, paid = 0;
    for (const d of a.debits) {
      if (d.kind !== 'aidat' || d.future || !d.month.startsWith(`${year}-`)) continue;
      owed += d.amount;
      paid += d.paid;
    }
    return { owed, paid };
  };
  const csv = () => {
    const rows: (string | number)[][] = [[t('unit'), ...months.map((m) => monthName(m, lang)), t('duesCol'), t('totalPaid'), t('remaining')]];
    for (const a of paying) {
      const { owed, paid } = cellSum(a);
      rows.push([a.unit.label, ...months.map((m) => {
        const c = monthCell(a, m, today);
        return c.debit ? `${plain(c.debit.paid)} / ${plain(c.debit.amount)}` : '';
      }), plain(owed), plain(paid), plain(owed - paid)]);
    }
    downloadCsv(`aidat-cizelgesi-${year}`, rows);
  };
  let tOwed = 0, tPaid = 0;
  return (
    <div class="page">
      <PrintHead title={`${t('duesTable')} ${year}`} />
      <Toolbar onPrint onCsv={csv}>
        <YearSelect value={year} years={ys.includes(year) ? ys : [year, ...ys]} onChange={setYear} />
      </Toolbar>
      <div class="card">
        <div class="table-scroll" ref={scroller}>
          <table class="matrix">
            <thead>
              <tr>
                <th class="sticky">{t('unit')}</th>
                {months.map((m) => <th key={m} class={m === current ? 'current' : ''}>{monthShort(Number(m.slice(5)), lang)}</th>)}
                <th class="num hide-sm">{t('duesCol')}</th>
                <th class="num hide-sm">{t('totalPaid')}</th>
                <th class="num">{t('remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {paying.map((a) => {
                const { owed, paid } = cellSum(a);
                tOwed += owed;
                tPaid += paid;
                return (
                  <tr key={a.unit.id}>
                    <th class="sticky"><a href={`#/ekstre/${a.unit.id}`}>{a.unit.label}</a>{a.unit.owner && <div class="muted small">{a.unit.owner}</div>}</th>
                    {months.map((m) => {
                      const c = monthCell(a, m, today);
                      const d = c.debit;
                      const tip = d ? `${monthName(m, lang)}: ${money(d.paid)} / ${money(d.amount)}${d.paidOn ? ` · ${date(d.paidOn)}` : ''}` : '';
                      return (
                        <td key={m} class={`cell st-${c.state}`} title={tip}>
                          <StateMark state={c.state} />
                          {c.state === 'partial' && d && <div class="small">{money(d.amount - d.paid, { short: true })}</div>}
                        </td>
                      );
                    })}
                    <td class="num hide-sm"><Money k={owed} /></td>
                    <td class="num hide-sm"><Money k={paid} /></td>
                    <td class={`num ${owed - paid > 0 ? 'bad' : ''}`}><Money k={owed - paid} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th class="sticky">{t('total')}</th>
                {months.map((m) => {
                  let o = 0, p = 0;
                  for (const a of paying) {
                    const d = a.debits.find((x) => x.kind === 'aidat' && x.month === m && !x.future);
                    if (d) {
                      o += d.amount;
                      p += Math.min(d.paid, d.amount);
                    }
                  }
                  return <td key={m} class="small num">{o ? `%${Math.round((p / o) * 100)}` : ''}</td>;
                })}
                <td class="num hide-sm"><Money k={tOwed} /></td>
                <td class="num hide-sm"><Money k={tPaid} /></td>
                <td class="num"><Money k={tOwed - tPaid} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Legend />
        <p class="muted small">{t('collectionRate')}: % = {t('collected')} / {t('accrued')}. {t('matrixNote')}</p>
      </div>
    </div>
  );
}

// ---- income & expenses ------------------------------------------------------------------------------

function useYear() {
  const { today } = useApp();
  return useState(Number(today.slice(0, 4)));
}

export function Finance() {
  const { data, t, lang, today, accounts, unitName } = useApp();
  const ys = years(data, today);
  const [year, setYear] = useYear();
  const [month, setMonth] = useState('');
  const [type, setType] = useState('');
  const months = monthRange(`${year}-01`, `${year}-12`);
  const sums = monthSummaries(data, accounts, months);
  const total = sumSummaries(month ? sums.filter((s) => s.month === month) : sums);
  const list = movements(data).filter((m) => m.date.startsWith(month || `${year}-`) && (!type || m.type === type));
  const cats = Object.entries(total.byCategory).sort((a, b) => b[1] - a[1]);
  const csv = () => downloadCsv(`gelir-gider-${month || year}`, [
    [t('date'), t('type'), t('category'), t('unit'), t('description'), t('account'), t('amount')],
    ...list.map((m) => [date(m.date), m.type, m.category, m.unit ? unitName(m.unit) : '', m.label, m.account, plain(m.amount)]),
  ]);
  const typeName = (x: string) => (x === 'aidat' ? t('aidatPayment') : x === 'gelir' ? t('income') : x === 'gider' ? t('expense') : t('transfer'));
  return (
    <div class="page">
      <PrintHead title={t('finance')} sub={month ? monthName(month, lang) : String(year)} />
      <Toolbar onPrint onCsv={csv}>
        <YearSelect value={year} years={ys.includes(year) ? ys : [year, ...ys]} onChange={(y) => { setYear(y); setMonth(''); }} />
        <label class="inline">
          <span>{t('month')}</span>
          <select value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
            <option value="">{t('allYear')}</option>
            {months.map((m) => <option key={m} value={m}>{monthName(m, lang)}</option>)}
          </select>
        </label>
        <label class="inline">
          <span>{t('type')}</span>
          <select value={type} onChange={(e) => setType(e.currentTarget.value)}>
            <option value="">{t('all')}</option>
            <option value="aidat">{t('aidatPayment')}</option>
            <option value="gelir">{t('income')}</option>
            <option value="gider">{t('expense')}</option>
            <option value="virman">{t('transfer')}</option>
          </select>
        </label>
      </Toolbar>
      <section class="tiles">
        <Tile label={t('collected')} value={money(total.collected)} sub={total.accrued ? `${t('collectionRate')}: %${Math.round((total.collected / total.accrued) * 100)}` : undefined} />
        <Tile label={t('otherIncome')} value={money(total.otherIncome)} />
        <Tile label={t('expense')} value={money(total.expense)} />
        <Tile label={t('net')} value={money(total.net, { sign: true })} tone={total.net < 0 ? 'bad' : 'good'} />
      </section>
      {!month && (
        <section class="card">
          <h2>{t('byMonth')}</h2>
          <ColumnChart
            labels={months.map((m) => monthShort(Number(m.slice(5)), lang))}
            series={[
              { name: t('income'), color: '--series-1', values: sums.map((s) => s.collected + s.otherIncome) },
              { name: t('expense'), color: '--series-2', values: sums.map((s) => s.expense) },
            ]}
          />
          <MonthTable sums={sums} />
        </section>
      )}
      <div class="cols">
        <section class="card">
          <h2>{t('byCategory')}</h2>
          {cats.length ? (
            <table class="list">
              <tbody>
                {cats.map(([c, v]) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td class="bar-cell"><span style={{ width: `${Math.round((v / cats[0][1]) * 100)}%` }} /></td>
                    <td class="num"><Money k={v} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th>{t('total')}</th><th /><th class="num"><Money k={total.expense} /></th></tr></tfoot>
            </table>
          ) : <Empty />}
        </section>
        <section class="card">
          <h2>{t('balance')}</h2>
          <BalanceTable upTo={month ? `${month}-${String(daysInMonth(month)).padStart(2, '0')}` : `${year}-12-31`} />
        </section>
      </div>
      <section class="card">
        <h2>{t('finance')}</h2>
        {list.length ? (
          <div class="table-scroll">
            <table class="list">
              <thead>
                <tr><th>{t('date')}</th><th>{t('type')}</th><th>{t('description')}</th><th>{t('account')}</th><th class="num">{t('amount')}</th></tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.type + m.id}>
                    <td class="nowrap">{date(m.date)}</td>
                    <td>{typeName(m.type)}</td>
                    <td>{m.type === 'aidat' ? unitName(m.unit ?? '') : m.category}{m.label && <div class="muted small">{m.label}</div>}</td>
                    <td>{m.account === 'banka' ? t('bank') : m.account === 'kasa' ? t('cash') : ''}</td>
                    <td class="num"><Money k={m.amount} sign={m.type !== 'virman'} /></td>
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

function BalanceTable({ upTo }: { upTo: string }) {
  const { data, t } = useApp();
  const b = balances(data, upTo);
  return (
    <table class="list">
      <tbody>
        <tr><td>{t('bank')}</td><td class="num"><Money k={b.banka} /></td></tr>
        <tr><td>{t('cash')}</td><td class="num"><Money k={b.kasa} /></td></tr>
      </tbody>
      <tfoot><tr><th>{t('total')}</th><th class="num"><Money k={b.total} /></th></tr></tfoot>
    </table>
  );
}

function MonthTable({ sums }: { sums: MonthSummary[] }) {
  const { t, lang } = useApp();
  const tot = sumSummaries(sums);
  return (
    <div class="table-scroll">
      <table class="list month-table">
        <thead>
          <tr>
            <th>{t('month')}</th><th class="num">{t('accrued')}</th><th class="num">{t('collected')}</th>
            <th class="num">{t('otherIncome')}</th><th class="num">{t('expense')}</th><th class="num">{t('net')}</th>
          </tr>
        </thead>
        <tbody>
          {sums.map((s) => (
            <tr key={s.month}>
              <td>{monthName(s.month, lang)}</td>
              <td class="num"><Money k={s.accrued} /></td>
              <td class="num"><Money k={s.collected} /></td>
              <td class="num"><Money k={s.otherIncome} /></td>
              <td class="num"><Money k={s.expense} /></td>
              <td class="num"><Money k={s.net} sign /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>{t('total')}</th><th class="num"><Money k={tot.accrued} /></th><th class="num"><Money k={tot.collected} /></th>
            <th class="num"><Money k={tot.otherIncome} /></th><th class="num"><Money k={tot.expense} /></th><th class="num"><Money k={tot.net} sign /></th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---- balances (borç durumu) ---------------------------------------------------------------------------

export function Debts() {
  const { data, t, accounts, admin, today, monthLabel } = useApp();
  const late = data.settings.dues.lateFee;
  const b = data.settings.building;
  const csv = () => downloadCsv('borc-durumu', [
    [t('unit'), t('owner'), t('totalOwed'), t('totalPaid'), t('balance'), t('unpaidMonths'), t('oldestUnpaid'), ...(late ? [t('lateFee')] : [])],
    ...accounts.map((a) => [a.unit.label, a.unit.owner, plain(a.owed), plain(a.paid), plain(a.balance), a.unpaidMonths, a.oldestUnpaid ? monthLabel(a.oldestUnpaid) : '', ...(late ? [plain(a.lateFee)] : [])]),
  ]);
  const wa = (a: UnitAccount) => {
    const phone = a.unit.phone.replace(/\D/g, '').replace(/^0/, '90');
    const text = t('waText', { b: b.name, u: a.unit.label, m: date(today), a: money(a.balance), i: b.iban || '-' });
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  };
  const tot = accounts.reduce((s, a) => ({ owed: s.owed + a.owed, paid: s.paid + a.paid, bal: s.bal + a.balance, late: s.late + a.lateFee }), { owed: 0, paid: 0, bal: 0, late: 0 });
  return (
    <div class="page">
      <PrintHead title={t('debts')} />
      <Toolbar onPrint onCsv={csv} />
      <div class="card">
        <div class="table-scroll">
          <table class="list">
            <thead>
              <tr>
                <th>{t('unit')}</th><th class="num">{t('totalOwed')}</th><th class="num">{t('totalPaid')}</th><th class="num">{t('balance')}</th>
                <th>{t('status')}</th><th>{t('oldestUnpaid')}</th>{late && <th class="num">{t('lateFee')}</th>}{admin && <th class="no-print" />}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.unit.id}>
                  <td><a href={`#/ekstre/${a.unit.id}`}>{a.unit.label}</a>{(a.unit.owner || a.unit.tenant) && <div class="muted small">{[a.unit.owner, a.unit.tenant].filter(Boolean).join(' · ')}</div>}</td>
                  <td class="num"><Money k={a.owed} /></td>
                  <td class="num"><Money k={a.paid} /></td>
                  <td class={`num ${a.balance > 0 ? 'bad' : ''}`}><strong><Money k={a.balance} /></strong></td>
                  <td>{a.balance > 0 ? <StateMark state={a.oldestUnpaid && lateNow(a, today) ? 'late' : 'unpaid'} label /> : a.balance < 0 ? <span class="muted">{t('inCredit')}</span> : a.owed ? <StateMark state="paid" label /> : <span class="muted">{t('settled')}</span>}{a.unpaidMonths > 0 && <div class="muted small">{a.unpaidMonths} {t('unpaidMonths').toLocaleLowerCase()}</div>}</td>
                  <td>{a.oldestUnpaid ? monthLabel(a.oldestUnpaid) : '—'}</td>
                  {late && <td class="num"><Money k={a.lateFee} /></td>}
                  {admin && (
                    <td class="no-print">
                      {a.balance > 0 && (a.unit.phone ? <a class="btn small" href={wa(a)} target="_blank" rel="noopener">WhatsApp</a> : <span class="muted small">{t('noPhone')}</span>)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t('total')}</th><th class="num"><Money k={tot.owed} /></th><th class="num"><Money k={tot.paid} /></th><th class="num"><Money k={tot.bal} /></th>
                <th /><th />{late && <th class="num"><Money k={tot.late} /></th>}{admin && <th class="no-print" />}
              </tr>
            </tfoot>
          </table>
        </div>
        {late && <p class="muted small">{t('lateFeeNote')}</p>}
      </div>
    </div>
  );
}

// ---- one flat's statement (hesap ekstresi) ------------------------------------------------------------

export function Statement({ unitId }: { unitId: string }) {
  const { data, t, accounts, go, admin, monthLabel } = useApp();
  const id = unitId || accounts[0]?.unit.id || '';
  const acc = accounts.find((a) => a.unit.id === id);
  const lines = useMemo(() => (acc ? ledger(acc) : []), [acc]);
  if (!acc) return <div class="page"><Empty /></div>;
  const label = (l: (typeof lines)[number]) =>
    l.kind === 'aidat' ? `${t('monthlyDues')}: ${l.label}` : l.kind === 'devir' ? t('devir') : l.kind === 'odeme' ? `${t('aidatPayment')}${l.label ? ` · ${l.label}` : ''}` : l.kind === 'indirim' ? `${t('indirim')}: ${l.label}` : l.label;
  const csv = () => downloadCsv(`ekstre-${acc.unit.label}`, [
    [t('date'), t('description'), t('debit'), t('credit'), t('balance')],
    ...lines.map((l) => [date(l.date), label(l), l.debit ? plain(l.debit) : '', l.credit ? plain(l.credit) : '', plain(l.balance)]),
  ]);
  const late = data.settings.dues.lateFee;
  return (
    <div class="page">
      <PrintHead title={`${t('statement')}: ${acc.unit.label}`} sub={[acc.unit.owner, acc.unit.tenant].filter(Boolean).join(' · ')} />
      <Toolbar onPrint onCsv={csv}>
        <UnitSelect value={id} onChange={(v) => go(`#/ekstre/${v}`)} />
      </Toolbar>
      <section class="tiles">
        <Tile label={t('totalOwed')} value={money(acc.owed)} />
        <Tile label={t('totalPaid')} value={money(acc.paid)} />
        <Tile label={t('balance')} value={money(acc.balance)} sub={acc.balance > 0 ? t('debtor') : acc.balance < 0 ? t('inCredit') : t('settled')} tone={acc.balance > 0 ? 'bad' : 'good'} />
        {late && <Tile label={t('lateFee')} value={money(acc.lateFee)} sub={acc.oldestUnpaid ? `${t('oldestUnpaid')}: ${monthLabel(acc.oldestUnpaid)}` : undefined} />}
      </section>
      <div class="card">
        {lines.length ? (
          <div class="table-scroll">
            <table class="list">
              <thead>
                <tr><th>{t('date')}</th><th>{t('description')}</th><th class="num">{t('debit')}</th><th class="num">{t('credit')}</th><th class="num">{t('balance')}</th>{admin && <th class="no-print" />}</tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td class="nowrap">{date(l.date)}</td>
                    <td>{label(l)}</td>
                    <td class="num">{l.debit ? <Money k={l.debit} /> : ''}</td>
                    <td class="num">{l.credit ? <Money k={l.credit} /> : ''}</td>
                    <td class={`num ${l.balance > 0 ? 'bad' : ''}`}><Money k={l.balance} /></td>
                    {admin && <td class="no-print">{l.paymentId && <a class="link small" href={`#/makbuz/${l.paymentId}`}>{t('receipt')}</a>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
      </div>
    </div>
  );
}

// ---- printable period report (aylık / yıllık faaliyet raporu) ------------------------------------------

export function Report() {
  const { data, t, lang, today, accounts, unitName } = useApp();
  const ys = years(data, today);
  const [year, setYear] = useYear();
  const [month, setMonth] = useState(addMonths(today.slice(0, 7), 0));
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const months = mode === 'month' ? [month] : monthRange(`${year}-01`, `${year}-12`);
  const sums = monthSummaries(data, accounts, months);
  const tot = sumSummaries(sums);
  const from = `${months[0]}-01`;
  const lastMonth = months[months.length - 1];
  const lastDay = `${lastMonth}-${String(daysInMonth(lastMonth)).padStart(2, '0')}`;
  const to = lastDay;
  const opening = balances(data, prevDay(from));
  const closing = balances(data, to);
  const expenses = data.expenses.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const incomes = data.incomes.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const period = mode === 'month' ? monthName(month, lang) : String(year);
  const allMonths = monthRange(data.settings.dues.start < `${year}-01` ? data.settings.dues.start : `${year}-01`, today.slice(0, 7)).reverse();
  return (
    <div class="page report">
      <PrintHead title={mode === 'month' ? t('monthlyReport') : t('yearlyReport')} sub={period} />
      <Toolbar onPrint>
        <label class="inline">
          <span>{t('period')}</span>
          <select value={mode} onChange={(e) => setMode(e.currentTarget.value as 'month' | 'year')}>
            <option value="month">{t('monthlyReport')}</option>
            <option value="year">{t('yearlyReport')}</option>
          </select>
        </label>
        {mode === 'month' ? (
          <select value={month} onChange={(e) => setMonth(e.currentTarget.value)}>
            {allMonths.map((m) => <option key={m} value={m}>{monthName(m, lang)}</option>)}
          </select>
        ) : (
          <YearSelect value={year} years={ys} onChange={setYear} />
        )}
      </Toolbar>
      <section class="card">
        <h2 class="no-print">{mode === 'month' ? t('monthlyReport') : t('yearlyReport')}: {period}</h2>
        <table class="list summary">
          <tbody>
            <tr><td>{t('opening')} ({date(prevDay(from))})</td><td class="num"><Money k={opening.total} /></td></tr>
            <tr><td>+ {t('collected')} ({t('aidatPayment')})</td><td class="num"><Money k={tot.collected} /></td></tr>
            <tr><td>+ {t('otherIncome')}</td><td class="num"><Money k={tot.otherIncome} /></td></tr>
            <tr><td>− {t('expense')}</td><td class="num"><Money k={-tot.expense} /></td></tr>
          </tbody>
          <tfoot>
            <tr><th>{t('balance')} ({date(lastDay)})</th><th class="num"><Money k={closing.total} /></th></tr>
            <tr><td class="muted">{t('bank')} / {t('cash')}</td><td class="num muted">{money(closing.banka)} / {money(closing.kasa)}</td></tr>
          </tfoot>
        </table>
        <p class="muted small">{t('accrued')}: {money(tot.accrued)} · {t('collectionRate')}: {tot.accrued ? `%${Math.round((tot.collected / tot.accrued) * 100)}` : '—'}</p>
      </section>
      {mode === 'year' && (
        <section class="card">
          <h2>{t('byMonth')}</h2>
          <MonthTable sums={sums} />
        </section>
      )}
      <div class="cols">
        <section class="card">
          <h2>{t('byCategory')}</h2>
          {Object.keys(tot.byCategory).length ? (
            <table class="list">
              <tbody>{Object.entries(tot.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => <tr key={c}><td>{c}</td><td class="num"><Money k={v} /></td></tr>)}</tbody>
              <tfoot><tr><th>{t('total')}</th><th class="num"><Money k={tot.expense} /></th></tr></tfoot>
            </table>
          ) : <Empty />}
        </section>
        <section class="card">
          <h2>{t('debts')}</h2>
          <table class="list">
            <tbody>
              {accounts.filter((a) => a.unit.pays_dues || a.balance).map((a) => (
                <tr key={a.unit.id}><td>{a.unit.label}</td><td class={`num ${a.balance > 0 ? 'bad' : ''}`}><Money k={a.balance} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {mode === 'month' && (
        <section class="card">
          <h2>{t('expenses')}</h2>
          {expenses.length ? (
            <table class="list">
              <thead><tr><th>{t('date')}</th><th>{t('category')}</th><th>{t('description')}</th><th class="num">{t('amount')}</th></tr></thead>
              <tbody>{expenses.map((e) => <tr key={e.id}><td class="nowrap">{date(e.date)}</td><td>{e.category}</td><td>{e.description}{e.vendor && <span class="muted"> · {e.vendor}</span>}</td><td class="num"><Money k={e.amount} /></td></tr>)}</tbody>
            </table>
          ) : <Empty />}
          {incomes.length > 0 && (
            <>
              <h3>{t('incomes')}</h3>
              <table class="list">
                <tbody>{incomes.map((e) => <tr key={e.id}><td class="nowrap">{date(e.date)}</td><td>{e.category}</td><td>{e.description}</td><td class="num"><Money k={e.amount} /></td></tr>)}</tbody>
              </table>
            </>
          )}
          <h3>{t('payHistory')}</h3>
          <table class="list">
            <tbody>
              {data.payments.filter((p) => p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map((p) => (
                <tr key={p.id}><td class="nowrap">{date(p.date)}</td><td>{unitName(p.unit_id)}</td><td>{p.account === 'banka' ? t('bank') : t('cash')}</td><td class="num"><Money k={p.amount} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div class="print-only signatures">
        <div>{t('preparedBy')}<br /><br />{data.settings.building.manager || '…………………'}</div>
        <div>{t('signature')}<br /><br />…………………</div>
      </div>
    </div>
  );
}

/** some open debt is past its due date */
function lateNow(a: UnitAccount, today: string) {
  return a.debits.some((d) => !d.future && d.paid < d.amount && d.due < today);
}

function prevDay(d: string) {
  const x = new Date(Date.parse(d) - 864e5);
  return x.toISOString().slice(0, 10);
}

export function Notices() {
  const { data, t } = useApp();
  const list = [...data.notices].sort((x, y) => y.pinned - x.pinned || y.date.localeCompare(x.date));
  return (
    <div class="page">
      <section class="card">
        <h2>{t('notices')}</h2>
        {list.length ? list.map((n) => (
          <article key={n.id} class="notice">
            <div class="notice-head"><strong>{n.pinned ? '📌 ' : ''}{n.title}</strong><span class="muted">{date(n.date)}</span></div>
            {n.body && <p>{n.body}</p>}
          </article>
        )) : <Empty />}
      </section>
    </div>
  );
}

export { unitNo };
