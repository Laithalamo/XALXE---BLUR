// Room relay rules without a network: join order, host hand-over, relay targets, host-only messages.
// Run: npx tsx tools/sim/room_test.ts
import { RoomCore } from '../../shared/src/net/room';

let t = 0;
const room = new RoomCore(() => t);
const inbox: Record<string, string[]> = {};
const mk = (name: string) => {
  inbox[name] = [];
  return room.join((s) => inbox[name].push(s), name, 'kestrel', 0x123456)!;
};
const a = mk('ANA'), b = mk('BOB'), c = mk('CEM');
const last = (n: string) => JSON.parse(inbox[n][inbox[n].length - 1]);
let ok = true;
const check = (cond: boolean, what: string) => { if (!cond) { ok = false; console.log('FAIL', what); } else console.log('ok  ', what); };
check(JSON.parse(inbox.ANA[0]).t === 'welcome' && JSON.parse(inbox.ANA[0]).host === a.id, 'first player is host');
check(last('ANA').t === 'join' && last('ANA').p.name === 'CEM', 'host hears joins');
t += 100;
room.message(b.id, JSON.stringify({ t: 's', ts: 1, i: 2, st: [1, 2, 3] }));
check(last('ANA').t === 's' && last('ANA').from === b.id && last('CEM').t === 's', 'state relayed to everyone else');
const n = inbox.BOB.length;
room.message(b.id, JSON.stringify({ t: 'start', race: {} }));
check(inbox.ANA.at(-1) !== undefined && last('ANA').t !== 'start', 'guest cannot start a race');
room.message(a.id, JSON.stringify({ t: 'knock', to: c.id, i: 3, k: 1, v: [0, 1, 0], w: [0, 0, 0] }));
check(last('CEM').t === 'knock' && inbox.BOB.length === n, 'targeted message only to its player');
room.message(c.id, JSON.stringify({ t: 'ping', c: 42 }));
check(last('CEM').t === 'pong' && last('CEM').c === 42, 'ping answered');
room.leave(a.id);
check(last('BOB').t === 'host' && last('BOB').id === b.id, 'host hand-over to the next oldest');
room.message(b.id, JSON.stringify({ t: 'end' }));
check(last('CEM').t === 'end', 'new host can send host messages');
const d = mk('DEM');
check(d.id > c.id && JSON.parse(inbox.DEM[0]).host === b.id, 'late joiner does not become host');
// rate limit
let got = 0;
const before = inbox.DEM.length;
for (let k = 0; k < 200; k++) room.message(c.id, JSON.stringify({ t: 's', ts: k, i: 1, st: [] }));
got = inbox.DEM.length - before;
check(got >= 60 && got <= 75, `rate limit (${got} of 200 in a burst)`);
t += 1000; // bucket refills
room.message(c.id, JSON.stringify({ t: 'info', name: '<b>x</b>', car: 'tugra_t10', paint: 1 }));
check(last('DEM').t === 'info' && !/[<>]/.test(last('DEM').p.name), 'names are cleaned');
for (const x of ['E', 'F', 'G', 'H', 'I', 'J']) mk(x);
check(room.peers.size === 8 && JSON.parse(inbox.I[0]).t === 'welcome' && JSON.parse(inbox.J[0]).t === 'refused', 'room full at 8');
console.log(ok ? 'ALL OK' : 'PROBLEM');
