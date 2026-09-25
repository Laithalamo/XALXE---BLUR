/**
 * Mimoza building accounts (valve.ist/mimoza): aidat, payments, expenses, income.
 * Everyone can read (names and phones hidden); the yönetici signs in to edit.
 * Data lives in the D1 database bound as MIMOZA_DB. The admin password is only stored there,
 * as a PBKDF2 hash: never in this (public) repository.
 */
import {
  SETTINGS_KEYS, TABLES, TABLE_NAMES, cleanRow, defaultSettings, defaultUnits, type Settings, type TableName,
} from '../../mimoza/src/schema';

export interface MimozaEnv {
  ASSETS: { fetch(req: Request): Promise<Response> };
  MIMOZA_DB?: D1Database;
}

const BASE = '/mimoza';
const COOKIE = 'mimoza_s';
const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const FAIL_WINDOW = 15 * 60 * 1000;

const DDL = [
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'daire',
    owner TEXT NOT NULL DEFAULT '', tenant TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', pays_dues INTEGER NOT NULL DEFAULT 1,
    dues_amount INTEGER, opening INTEGER NOT NULL DEFAULT 0, keywords TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, date TEXT NOT NULL, amount INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '', batch TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, date TEXT NOT NULL, amount INTEGER NOT NULL,
    account TEXT NOT NULL DEFAULT 'banka', description TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL, account TEXT NOT NULL DEFAULT 'banka', vendor TEXT NOT NULL DEFAULT '', doc_no TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS incomes (id TEXT PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL, account TEXT NOT NULL DEFAULT 'banka', ref TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, date TEXT NOT NULL, from_acc TEXT NOT NULL, to_acc TEXT NOT NULL,
    amount INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0)`,
  'CREATE TABLE IF NOT EXISTS matches (sender TEXT PRIMARY KEY, unit_id TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '')`,
  'CREATE TABLE IF NOT EXISTS admin (username TEXT PRIMARY KEY, hash TEXT NOT NULL, salt TEXT NOT NULL, iter INTEGER NOT NULL, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS attempts (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, since INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS payments_ref ON payments (ref)',
  'CREATE INDEX IF NOT EXISTS expenses_ref ON expenses (ref)',
];

let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: D1Database) {
  schemaReady ??= (async () => {
    await db.batch(DDL.map((s) => db.prepare(s)));
    const has = await db.prepare('SELECT COUNT(*) AS n FROM units').first<{ n: number }>();
    if (!has?.n) {
      const now = Date.now();
      const cols = Object.keys(TABLES.units);
      const stmts = defaultUnits().map((u) => {
        const r = u as unknown as Record<string, unknown>;
        return db.prepare(`INSERT OR IGNORE INTO units (id, ${cols.join(', ')}, created) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`)
          .bind(u.id, ...cols.map((c) => r[c] as string | number | null), now);
      });
      const s = defaultSettings();
      for (const k of SETTINGS_KEYS) stmts.push(db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(k, JSON.stringify(s[k])));
      await db.batch(stmts);
    }
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

// ---- helpers --------------------------------------------------------------------------------------

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function sha256(s: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export async function pbkdf2(password: string, saltHex: string, iter: number) {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cookieValue(req: Request, name: string) {
  for (const part of (req.headers.get('cookie') ?? '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

async function isAdmin(req: Request, db: D1Database) {
  const token = cookieValue(req, COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const row = await db.prepare('SELECT expires FROM sessions WHERE token = ?').bind(await sha256(token)).first<{ expires: number }>();
  return !!row && row.expires > Date.now();
}

async function log(db: D1Database, action: string, entity: string, id = '', detail: unknown = '') {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  await db.prepare('INSERT INTO log (ts, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), action, entity, id, text.slice(0, 600)).run();
}

async function readSettings(db: D1Database): Promise<Settings> {
  const rows = (await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()).results;
  const s = defaultSettings() as unknown as Record<string, unknown>;
  for (const r of rows) {
    try {
      s[r.key] = { ...(s[r.key] as object), ...JSON.parse(r.value) };
    } catch {
      /* keep the default */
    }
  }
  return s as unknown as Settings;
}

async function readAll(db: D1Database) {
  const tables = TABLE_NAMES;
  const res = await db.batch(tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY ${t === 'units' ? 'sort, id' : 'date, created'}`)));
  const out: Record<string, unknown[]> = {};
  tables.forEach((t, i) => { out[t] = res[i].results; });
  return out as Record<TableName, Record<string, unknown>[]>;
}

/** what the public page may see: no phones, notes, bank descriptions or matching keywords */
function publicView(all: Record<TableName, Record<string, unknown>[]>, settings: Settings) {
  const names = settings.display.publicNames;
  return {
    ...all,
    units: all.units.map((u) => ({ ...u, phone: '', keywords: '', note: '', owner: names ? u.owner : '', tenant: names ? u.tenant : '' })),
    payments: all.payments.map((p) => ({ ...p, description: '', ref: '' })),
    expenses: all.expenses.map((e) => ({ ...e, ref: '' })),
    incomes: all.incomes.map((e) => ({ ...e, ref: '' })),
  };
}

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

async function upsert(db: D1Database, table: TableName, row: Record<string, unknown>) {
  const cols = Object.keys(TABLES[table]);
  const id = (row.id as string | undefined) ?? newId();
  const values = cols.map((c) => row[c] as string | number | null);
  await db.prepare(
    `INSERT INTO ${table} (id, ${cols.join(', ')}, created) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT(id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).bind(id, ...values, Date.now()).run();
  return id;
}

// ---- API ------------------------------------------------------------------------------------------

async function api(req: Request, env: MimozaEnv, path: string): Promise<Response> {
  const db = env.MIMOZA_DB;
  if (!db) return json({ error: 'database not configured' }, 503);
  await ensureSchema(db);
  const method = req.method;

  if (path === '/data' && method === 'GET') {
    const [admin, settings, all] = await Promise.all([isAdmin(req, db), readSettings(db), readAll(db)]);
    if (admin) {
      const matches = (await db.prepare('SELECT sender, unit_id FROM matches').all()).results;
      return json({ admin, settings, ...all, matches });
    }
    return json({ admin, settings, ...publicView(all, settings) });
  }

  if (method !== 'POST') return json({ error: 'not found' }, 404);
  // every write comes from the app itself (a cross-site form cannot set this header)
  if (req.headers.get('x-mimoza') !== '1') return json({ error: 'forbidden' }, 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  if (path === '/login') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const now = Date.now();
    const att = await db.prepare('SELECT count, since FROM attempts WHERE ip = ?').bind(ip).first<{ count: number; since: number }>();
    if (att && now - att.since < FAIL_WINDOW && att.count >= MAX_FAILS) {
      return json({ error: 'locked', retry: Math.ceil((att.since + FAIL_WINDOW - now) / 60000) }, 429);
    }
    const user = String(body.username ?? '').trim().toLowerCase();
    const pass = String(body.password ?? '');
    const acc = await db.prepare('SELECT username, hash, salt, iter FROM admin WHERE username = ?').bind(user)
      .first<{ username: string; hash: string; salt: string; iter: number }>();
    const ok = !!acc && pass.length > 0 && pass.length < 200 && sameText(await pbkdf2(pass, acc.salt, acc.iter), acc.hash);
    if (!ok) {
      const fresh = !att || now - att.since >= FAIL_WINDOW;
      await db.prepare('INSERT INTO attempts (ip, count, since) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = ?, since = ?')
        .bind(ip, now, fresh ? 1 : att!.count + 1, fresh ? now : att!.since).run();
      return json({ error: 'wrong' }, 401);
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await db.batch([
      db.prepare('DELETE FROM attempts WHERE ip = ?').bind(ip),
      db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
      db.prepare('INSERT INTO sessions (token, expires) VALUES (?, ?)').bind(await sha256(token), now + SESSION_DAYS * 864e5),
    ]);
    await log(db, 'login', 'admin', user);
    return json({ ok: true }, 200, {
      'set-cookie': `${COOKIE}=${token}; Path=${BASE}; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (path === '/logout') {
    const token = cookieValue(req, COOKIE);
    if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=${BASE}; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }

  // ---- everything below needs the yönetici
  if (!(await isAdmin(req, db))) return json({ error: 'login' }, 401);

  if (path === '/save') {
    const table = body.table as TableName;
    if (!TABLE_NAMES.includes(table)) return json({ error: 'bad table' }, 400);
    const { row, error } = cleanRow(table, (body.row ?? {}) as Record<string, unknown>);
    if (!row) return json({ error }, 400);
    const id = await upsert(db, table, row);
    await log(db, row.id ? 'update' : 'add', table, id, row);
    return json({ ok: true, id });
  }

  if (path === '/delete') {
    const table = body.table as TableName;
    const id = String(body.id ?? '');
    if (!TABLE_NAMES.includes(table) || !id) return json({ error: 'bad request' }, 400);
    const old = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (table === 'units') {
      const used = await db.prepare('SELECT (SELECT COUNT(*) FROM payments WHERE unit_id = ?1) + (SELECT COUNT(*) FROM charges WHERE unit_id = ?1) AS n')
        .bind(id).first<{ n: number }>();
      if (used?.n) return json({ error: 'unit has records' }, 409);
    }
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    await log(db, 'delete', table, id, old ?? '');
    return json({ ok: true });
  }

  if (path === '/bulk') {
    // imported bank lines and batch charges: rows with a ref that is already stored are skipped
    const table = body.table as TableName;
    if (!['payments', 'expenses', 'incomes', 'charges'].includes(table)) return json({ error: 'bad table' }, 400);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    const clean: Record<string, unknown>[] = [];
    for (const r of rows) {
      const { row, error } = cleanRow(table, r as Record<string, unknown>);
      if (!row) return json({ error }, 400);
      clean.push(row);
    }
    let skipped = 0;
    const cols = Object.keys(TABLES[table]);
    const stmts: D1PreparedStatement[] = [];
    const now = Date.now();
    const seen = new Set<string>();
    for (const row of clean) {
      const ref = row.ref as string | undefined;
      if (ref) {
        const dup = seen.has(ref) || (await db.prepare(`SELECT 1 FROM ${table} WHERE ref = ?`).bind(ref).first());
        seen.add(ref);
        if (dup) {
          skipped++;
          continue;
        }
      }
      stmts.push(db.prepare(`INSERT INTO ${table} (id, ${cols.join(', ')}, created) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`)
        .bind(newId(), ...cols.map((c) => row[c] as string | number | null), now));
    }
    const learned = Array.isArray(body.learn) ? body.learn.slice(0, 500) : [];
    for (const m of learned as { sender?: unknown; unit_id?: unknown }[]) {
      const sender = String(m.sender ?? '').slice(0, 120);
      const unit = String(m.unit_id ?? '').slice(0, 40);
      if (sender && unit) stmts.push(db.prepare('INSERT INTO matches (sender, unit_id) VALUES (?, ?) ON CONFLICT(sender) DO UPDATE SET unit_id = excluded.unit_id').bind(sender, unit));
    }
    if (stmts.length) await db.batch(stmts);
    await log(db, 'import', table, '', { added: clean.length - skipped, skipped });
    return json({ ok: true, added: clean.length - skipped, skipped });
  }

  if (path === '/settings') {
    const key = body.key as (typeof SETTINGS_KEYS)[number];
    if (!SETTINGS_KEYS.includes(key)) return json({ error: 'bad key' }, 400);
    const value = JSON.stringify(body.value ?? null);
    if (value.length > 20000 || typeof body.value !== 'object' || body.value === null) return json({ error: 'bad value' }, 400);
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
    await log(db, 'settings', key, '', value);
    return json({ ok: true });
  }

  if (path === '/password') {
    const acc = await db.prepare('SELECT username, hash, salt, iter FROM admin LIMIT 1').first<{ username: string; hash: string; salt: string; iter: number }>();
    const cur = String(body.current ?? '');
    const next = String(body.next ?? '');
    if (!acc || !sameText(await pbkdf2(cur, acc.salt, acc.iter), acc.hash)) return json({ error: 'wrong' }, 401);
    if (next.length < 8 || next.length > 100) return json({ error: 'short' }, 400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await db.batch([
      db.prepare('UPDATE admin SET hash = ?, salt = ?, updated = ? WHERE username = ?').bind(await pbkdf2(next, salt, acc.iter), salt, Date.now(), acc.username),
      // sign out every other browser
      db.prepare('DELETE FROM sessions WHERE token <> ?').bind(await sha256(cookieValue(req, COOKIE))),
    ]);
    await log(db, 'password', 'admin', acc.username);
    return json({ ok: true });
  }

  if (path === '/backup') {
    const [settings, all] = await Promise.all([readSettings(db), readAll(db)]);
    const matches = (await db.prepare('SELECT sender, unit_id FROM matches').all()).results;
    return json({ app: 'mimoza', version: 1, exported: new Date().toISOString(), settings, ...all, matches });
  }

  if (path === '/restore') {
    const dump = body.dump as Record<string, unknown> | undefined;
    if (!dump || dump.app !== 'mimoza') return json({ error: 'not a mimoza backup' }, 400);
    const stmts: D1PreparedStatement[] = [];
    for (const t of TABLE_NAMES) stmts.push(db.prepare(`DELETE FROM ${t}`));
    stmts.push(db.prepare('DELETE FROM matches'));
    const now = Date.now();
    for (const t of TABLE_NAMES) {
      const cols = Object.keys(TABLES[t]);
      const rows = Array.isArray(dump[t]) ? (dump[t] as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const { row, error } = cleanRow(t, r);
        if (!row || !row.id) return json({ error: `${t}: ${error ?? 'missing id'}` }, 400);
        stmts.push(db.prepare(`INSERT INTO ${t} (id, ${cols.join(', ')}, created) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`)
          .bind(row.id as string, ...cols.map((c) => row[c] as string | number | null), Number(r.created) || now));
      }
    }
    const settings = (dump.settings ?? {}) as Record<string, unknown>;
    for (const k of SETTINGS_KEYS) {
      if (settings[k] && typeof settings[k] === 'object') {
        stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(settings[k])));
      }
    }
    for (const m of (Array.isArray(dump.matches) ? dump.matches : []) as { sender?: string; unit_id?: string }[]) {
      if (m.sender && m.unit_id) stmts.push(db.prepare('INSERT OR REPLACE INTO matches (sender, unit_id) VALUES (?, ?)').bind(String(m.sender), String(m.unit_id)));
    }
    await db.batch(stmts);
    await log(db, 'restore', 'all', '', { rows: stmts.length });
    return json({ ok: true });
  }

  if (path === '/log') {
    const rows = (await db.prepare('SELECT ts, action, entity, entity_id, detail FROM log ORDER BY id DESC LIMIT 300').all()).results;
    return json({ log: rows });
  }

  return json({ error: 'not found' }, 404);
}

/** everything under /mimoza: the API, or the web app's files */
export async function mimoza(req: Request, env: MimozaEnv, url: URL): Promise<Response> {
  if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
  const path = url.pathname.slice(BASE.length);
  if (path.startsWith('/api/')) {
    try {
      return await api(req, env, path.slice(4));
    } catch (e) {
      return json({ error: 'server', detail: String((e as Error).message ?? e).slice(0, 200) }, 500);
    }
  }
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  out.headers.set('x-frame-options', 'DENY');
  out.headers.set('referrer-policy', 'same-origin');
  out.headers.set('x-content-type-options', 'nosniff');
  if ((out.headers.get('content-type') ?? '').includes('text/html')) {
    out.headers.set('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  }
  return out;
}
