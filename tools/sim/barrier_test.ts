import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS } from '../../shared/src/track/trackDefs';
import { buildCenterline } from '../../shared/src/track/centerline';
import { createTrackWorld } from '../../shared/src/physics/trackPhysics';
await RAPIER.init();
const def = TRACKS.midtown; const cl = buildCenterline(def); const world = createTrackWorld(def, cl);
world.step();
let colliders = 0; world.forEachCollider(() => colliders++); console.log('colliders', colliders);
for (const s of [0, 100, 300, 430, 470, 520, 800, 1200, 1600, 2000]) {
  const p = cl.at(s);
  for (const side of [1, -1]) {
    const dir = { x: p.tz * side, y: 0, z: -p.tx * side };
    const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: 0.5, z: p.z }, dir), 50, true);
    console.log('s', s, side > 0 ? 'left ' : 'right', hit ? hit.timeOfImpact.toFixed(2) : 'MISS');
  }
}
