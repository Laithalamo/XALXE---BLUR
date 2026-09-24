import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
const cl = buildCenterline(TRACKS.midtown);
let cur: { s0: number; s1: number; dir: number } | null = null;
for (const s of cl.samples) {
  if (Math.abs(s.k) > 1 / 200) { if (!cur) cur = { s0: s.s, s1: s.s, dir: Math.sign(s.k) }; cur.s1 = s.s; }
  else if (cur) { const m = cl.at((cur.s0 + cur.s1) / 2); console.log(`corner s ${cur.s0.toFixed(0)}-${cur.s1.toFixed(0)} dir ${cur.dir > 0 ? 'L' : 'R'} mid (${m.x.toFixed(0)}, ${m.z.toFixed(0)})`); cur = null; }
}
