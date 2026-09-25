// npx tsx mimoza/test/calc.test.ts : checks the bookkeeping rules
import assert from 'node:assert/strict';
import { unitAccount, monthCell, balances, monthSummaries, ledger, type Data } from '../src/calc';
import { defaultSettings, defaultUnits } from '../src/schema';
import { parseMoney, amountWords, norm } from '../src/format';
import { toBankLines, suggest, senderKey } from '../src/bank';

const s = defaultSettings(new Date('2026-01-15'));
s.dues.start = '2026-01';
s.dues.dueDay = 10;
s.dues.periods = [{ from: '2026-01', amount: 100000 }, { from: '2026-04', amount: 150000 }];
const units = defaultUnits();
units[2].owner = 'Ahmet Yılmaz';
units[2].keywords = 'AYSE YILMAZ';
const data: Data = { admin: true, settings: s, units, charges: [], payments: [], expenses: [], incomes: [], transfers: [], notices: [] };
const pay = (unit: string, date: string, amount: number) => data.payments.push({ id: `p${data.payments.length}`, unit_id: unit, date, amount, account: 'banka', description: '', ref: '' });

// Jan-May: 1000 x3 + 1500 x2 = 6000 TL; paid Jan (on time), Feb late, part of Mar
pay('d1', '2026-01-05', 100000);
pay('d1', '2026-02-25', 100000);
pay('d1', '2026-03-05', 50000);
let a = unitAccount(data, units[0], { today: '2026-05-20' });
assert.equal(a.owed, 600000);
assert.equal(a.paid, 250000);
assert.equal(a.balance, 350000);
assert.equal(monthCell(a, '2026-01', '2026-05-20').state, 'paid');
assert.equal(monthCell(a, '2026-03', '2026-05-20').state, 'partial');
assert.equal(monthCell(a, '2026-04', '2026-05-20').state, 'late');
assert.equal(monthCell(a, '2026-05', '2026-05-05').state, 'unpaid');
assert.equal(a.unpaidMonths, 3); // Mar (partial counts as open), Apr, May
assert.equal(a.oldestUnpaid, '2026-03');
// late fee: Feb paid 15 days late: 1000 * 15 * 0.05/30 = 25 TL, plus the open amounts to 20 May
assert.ok(a.lateFee > 2500);
// prepaid: a flat pays 3 months at once in January
pay('d2', '2026-01-02', 300000);
a = unitAccount(data, units[1], { today: '2026-01-20', horizon: '2026-12' });
assert.equal(a.balance, -200000);
assert.equal(monthCell(a, '2026-02', '2026-01-20').state, 'prepaid');
assert.equal(monthCell(a, '2026-03', '2026-01-20').state, 'prepaid');
assert.equal(monthCell(a, '2026-04', '2026-01-20').state, 'future');
// shops pay no aidat, but extra charges apply; a negative charge is a discount
data.charges.push({ id: 'c1', unit_id: 's1', date: '2026-02-01', amount: 200000, description: 'Çatı', batch: 'g1' });
data.charges.push({ id: 'c2', unit_id: 's1', date: '2026-02-02', amount: -50000, description: 'İndirim', batch: '' });
a = unitAccount(data, units[6], { today: '2026-03-01' });
assert.equal(a.owed, 200000);
assert.equal(a.balance, 150000);
assert.equal(ledger(a).at(-1)!.balance, 150000);
// balances and summaries
s.accounts.banka = 1000000;
data.expenses.push({ id: 'e1', date: '2026-01-10', category: 'Elektrik', description: '', amount: 30000, account: 'banka', vendor: '', doc_no: '', ref: '' });
data.transfers.push({ id: 't1', date: '2026-01-11', from_acc: 'banka', to_acc: 'kasa', amount: 10000, description: '' });
const b = balances(data);
assert.equal(b.kasa, 10000);
assert.equal(b.banka, 1000000 + 100000 + 100000 + 50000 + 300000 - 30000 - 10000);
const [jan] = monthSummaries(data, [unitAccount(data, units[0], { today: '2026-05-20' })], ['2026-01']);
assert.equal(jan.expense, 30000);
assert.equal(jan.byCategory.Elektrik, 30000);
// money parsing (Turkish input)
assert.equal(parseMoney('1.500'), 150000);
assert.equal(parseMoney('1.500,50'), 150050);
assert.equal(parseMoney('1500,5'), 150050);
assert.equal(parseMoney('1500.50'), 150050);
assert.equal(parseMoney('-250 TL'), -25000);
assert.equal(parseMoney('1.250.000'), 125000000);
assert.equal(parseMoney('abc'), null);
assert.equal(amountWords(150000), 'Yalnız bin beş yüz Türk Lirası');
assert.equal(amountWords(275050), 'Yalnız iki bin yedi yüz elli Türk Lirası elli kuruş');
assert.equal(norm('Ayşe Yılmaz İŞ'), 'AYSE YILMAZ IS');
// bank lines: header row, Turkish amounts, matching
const rows = [
  ['Garanti BBVA Hesap Hareketleri'],
  ['Tarih', 'Açıklama', 'Etiket', 'Tutar', 'Bakiye', 'Dekont No'],
  ['05.09.2026', 'FAST GELEN - AHMET YILMAZ - MIMOZA EYLUL AIDAT', '', '1.500,00', '12.500,00', '1'],
  ['06.09.2026', 'HAVALE GELEN AYSE YILMAZ', '', '1.500,00', '14.000,00', '2'],
  ['07.09.2026', 'EFT GELEN MEHMET KAYA D5 AIDAT', '', '1.500,00', '15.500,00', '3'],
  ['08.09.2026', 'ENERJISA ELEKTRIK FATURA', '', '-850,40', '14.649,60', '4'],
  ['09.09.2026', 'GELEN FAST ZEYNEP DEMIR', '', '1.500,00', '16.149,60', '5'],
];
const lines = toBankLines(rows)!;
assert.equal(lines.length, 5);
assert.equal(lines[0].amount, 150000);
assert.equal(lines[3].amount, -85040);
const sg = suggest(lines, data);
assert.equal(sg[0].unitId, 'd3'); // owner name
assert.equal(sg[1].unitId, 'd3'); // keyword
assert.equal(sg[2].unitId, 'd5'); // "D5"
assert.equal(sg[3].kind, 'expense');
assert.equal(sg[3].category, 'Elektrik');
assert.equal(sg[4].unitId, ''); // unknown sender: the manager picks
assert.equal(senderKey(lines[4].description), 'ZEYNEP DEMIR');
// re-import: same lines are recognised
data.payments.push({ id: 'px', unit_id: 'd3', date: lines[0].date, amount: lines[0].amount, account: 'banka', description: '', ref: lines[0].ref });
assert.equal(suggest(lines, data)[0].duplicate, true);
// learned sender
data.matches = [{ sender: 'ZEYNEP DEMIR', unit_id: 'd6' }];
assert.equal(suggest(lines, data)[4].unitId, 'd6');
// no header: columns guessed from contents
const bare = toBankLines([['05.09.2026', 'FAST AHMET YILMAZ', '1.500,00', '12.500,00'], ['06.09.2026', 'MARKET', '-120,00', '12.380,00']])!;
assert.equal(bare.length, 2);
assert.equal(bare[1].amount, -12000);
console.log('calc tests: ALL OK');
