/**
 * Reads bank statement files in the browser, no library: .xlsx (zip + XML), "Excel" files that
 * are really HTML tables, and CSV / tab separated text (also text pasted from internet banking).
 * Returns the first sheet as rows of cells. The old binary .xls format is detected and reported.
 */
export type Cell = string | number | null;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** file name -> contents for the entries we ask for */
async function unzip(buf: Uint8Array, want: (name: string) => boolean) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count && u32(buf, p) === 0x02014b50; n++) {
    const method = u16(buf, p + 10);
    const csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : await inflate(raw));
  }
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Excel day number -> YYYY-MM-DD (1900 date system) */
export function excelDate(serial: number) {
  const ms = Math.round((serial - 25569) * 864e5);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

async function readXlsx(buf: Uint8Array): Promise<Cell[][]> {
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n.startsWith('xl/worksheets/sheet'));
  const dec = new TextDecoder();
  const parse = (name: string) => {
    const b = files.get(name);
    return b ? new DOMParser().parseFromString(dec.decode(b), 'application/xml') : null;
  };
  const shared: string[] = [];
  const ss = parse('xl/sharedStrings.xml');
  if (ss) for (const si of Array.from(ss.getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  // which cell styles are dates
  const dateStyles = new Set<number>();
  const st = parse('xl/styles.xml');
  if (st) {
    const custom = new Map<number, string>();
    for (const f of Array.from(st.getElementsByTagName('numFmt'))) custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '');
    const xfs = st.getElementsByTagName('cellXfs')[0];
    if (xfs) {
      Array.from(xfs.getElementsByTagName('xf')).forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId') ?? 0);
        const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
        if (BUILTIN_DATE_FORMATS.has(id) || (/[dy]/.test(code) && !/[#0]/.test(code))) dateStyles.add(i);
      });
    }
  }
  // first sheet in workbook order
  let sheetPath = '';
  const wb = parse('xl/workbook.xml');
  const rels = parse('xl/_rels/workbook.xml.rels');
  const first = wb?.getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (rid && rels) {
    for (const r of Array.from(rels.getElementsByTagName('Relationship'))) {
      if (r.getAttribute('Id') === rid) sheetPath = 'xl/' + (r.getAttribute('Target') ?? '').replace(/^\/?xl\//, '').replace(/^\//, '');
    }
  }
  if (!files.has(sheetPath)) sheetPath = [...files.keys()].filter((n) => n.startsWith('xl/worksheets/sheet')).sort()[0] ?? '';
  const sheet = parse(sheetPath);
  if (!sheet) return [];
  const rows: Cell[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    const cells: Cell[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const ci = ref ? colIndex(ref) : cells.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null;
      let val: Cell = null;
      if (t === 's') val = v === null ? null : shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
      else if (t === 'str' || t === 'e') val = v;
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== null) {
        const num = Number(v);
        val = dateStyles.has(Number(c.getAttribute('s') ?? -1)) && num > 0 ? excelDate(num) : num;
      }
      cells[ci] = val;
    }
    rows[r] = Array.from(cells, (x) => x ?? null);
  }
  return Array.from(rows, (x) => x ?? []);
}

function readHtml(text: string): Cell[][] {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  let best: HTMLTableElement | null = null;
  for (const t of Array.from(doc.querySelectorAll('table'))) if (!best || t.rows.length > best.rows.length) best = t;
  if (!best) return [];
  return Array.from(best.rows, (r) => Array.from(r.cells, (c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

/** CSV, semicolon or tab separated text (quotes handled) */
export function parseText(text: string): Cell[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sample = lines.slice(0, 20).join('\n');
  const count = (ch: string) => sample.split(ch).length - 1;
  const delim = count('\t') >= 2 ? '\t' : count(';') >= count(',') ? ';' : ',';
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

export async function readTable(file: File): Promise<Cell[][] | 'old-xls'> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'old-xls';
  // text: HTML table or CSV, in UTF-8 or the Turkish Windows code page
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1254').decode(buf);
  return /^\s*</.test(text) ? readHtml(text) : parseText(text);
}
