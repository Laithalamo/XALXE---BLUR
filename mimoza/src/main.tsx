/** Mimoza: the web app shell (navigation, data loading, language, sign-in state). */
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ApiError, getData, post } from './api';
import { allAccounts, todayISO, type Data } from './calc';
import { monthName } from './format';
import { loadLang, makeT, saveLang, type Key, type Lang } from './i18n';
import { AppCtx, Toast, type Ctx } from './ui';
import { BankImport } from './views/import';
import { Activity, Login, Receipt } from './views/misc';
import { DuesTable, Debts, Finance, Notices, Overview, Report, Statement } from './views/public';
import { Charges, Expenses, Incomes, NoticesAdmin, Payments } from './views/records';
import { SettingsPage, Units } from './views/setup';
import './style.css';

const PUBLIC: [string, Key][] = [
  ['', 'overview'], ['aidat', 'duesTable'], ['gelir-gider', 'finance'], ['borclar', 'debts'], ['ekstre', 'statement'], ['rapor', 'reports'],
];
const ADMIN: [string, Key][] = [
  ['tahsilat', 'payments'], ['giderler', 'expenses'], ['gelirler', 'incomes'], ['ek-borc', 'charges'], ['banka', 'bankImport'],
  ['daireler', 'units'], ['duyurular', 'notices'], ['ayarlar', 'settings'], ['gecmis', 'activity'],
];

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [lang, setLang] = useState<Lang>(loadLang());
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const hash = useHash();
  const t = useMemo(() => makeT(lang), [lang]);
  const today = todayISO();

  const reload = async () => {
    try {
      setData(await getData());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status} ${e.code}` : String(e));
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const monthLabel = (ym: string) => monthName(ym, lang);
  const accounts = useMemo(() => (data ? allAccounts(data, { today, monthName: monthLabel, horizon: `${today.slice(0, 4)}-12` }) : []), [data, lang]);
  if (!data) {
    return (
      <div class="boot">
        {error ? <><p>{t('offline')} <span class="muted">({error})</span></p><button class="primary" onClick={reload}>{t('retry')}</button></> : <p class="muted">{t('loading')}</p>}
      </div>
    );
  }
  const [route, param = ''] = hash.replace(/^#\/?/, '').split('/');
  const admin = data.admin;
  const ctx: Ctx = {
    data, t, lang, today, accounts, admin, reload,
    toast: (text, bad) => setToast({ text, bad }),
    go: (h) => { location.hash = h; },
    monthLabel,
    unitName: (id) => data.units.find((u) => u.id === id)?.label ?? id,
  };
  const adminOnly = ADMIN.some(([r]) => r === route) || route === 'makbuz';
  let page;
  if (adminOnly && !admin) page = <Login />;
  else {
    switch (route) {
      case 'aidat': page = <DuesTable />; break;
      case 'gelir-gider': page = <Finance />; break;
      case 'borclar': page = <Debts />; break;
      case 'ekstre': page = <Statement unitId={param} />; break;
      case 'rapor': page = <Report />; break;
      case 'duyurular': page = admin ? <NoticesAdmin /> : <Notices />; break;
      case 'giris': page = admin ? <Payments /> : <Login />; break;
      case 'tahsilat': page = <Payments />; break;
      case 'giderler': page = <Expenses />; break;
      case 'gelirler': page = <Incomes />; break;
      case 'ek-borc': page = <Charges />; break;
      case 'banka': page = <BankImport />; break;
      case 'daireler': page = <Units />; break;
      case 'ayarlar': page = <SettingsPage />; break;
      case 'gecmis': page = <Activity />; break;
      case 'makbuz': page = <Receipt id={param} />; break;
      default: page = <Overview />;
    }
  }
  const logout = async () => {
    await post('logout', {}).catch(() => undefined);
    await reload();
    location.hash = '#/';
  };
  const tab = ([r, k]: [string, Key]) => (
    <a key={r} href={`#/${r}`} class={route === r || (r === 'tahsilat' && route === 'giris' && admin) ? 'on' : ''}>{t(k)}</a>
  );
  return (
    <AppCtx.Provider value={ctx}>
      <header class="top no-print">
        <div class="brand">
          <span class="logo" aria-hidden="true" />
          <div>
            <a href="#/" class="name">{data.settings.building.name}</a>
            <div class="sub">{t('appSub')}{!admin && <span class="view-only"> · {t('viewOnly')}</span>}</div>
          </div>
        </div>
        <div class="top-actions">
          <button class="ghost small" onClick={() => { const l = lang === 'tr' ? 'en' : 'tr'; setLang(l); saveLang(l); }}>{t('langName')}</button>
          {admin ? <button class="ghost small" onClick={logout}>{t('logout')}</button> : <a class="ghost small btn" href="#/giris">{t('admin')}</a>}
        </div>
      </header>
      <nav class="tabs no-print">{PUBLIC.map(tab)}</nav>
      {admin && <nav class="tabs admin no-print">{ADMIN.map(tab)}</nav>}
      <main>{page}</main>
      <footer class="foot no-print">
        <span>{data.settings.building.name}</span>
        {data.settings.building.manager && <span>{t('admin')}: {data.settings.building.manager}</span>}
      </footer>
      {toast && <Toast text={toast.text} bad={toast.bad} />}
    </AppCtx.Provider>
  );
}

render(<App />, document.getElementById('app')!);
