import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS, type TrackDef } from '@shared/track/trackDefs';
import { buildCenterline, type Centerline } from '@shared/track/centerline';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '@shared/physics/trackPhysics';
import { Vehicle, emptyInput, type DriveInput } from '@shared/physics/vehicle';
import { CARS, DEFAULT_CAR } from '@shared/cars';
import { clamp } from '@shared/math';
import { Assets } from '../core/Assets';
import { Input } from '../core/Input';
import { PRESETS, loadQuality, saveQuality, type Quality } from '../core/Settings';
import { Pipeline } from '../render/Pipeline';
import { Environment, THEMES } from '../render/Environment';
import { createWorldMaterials } from '../world/materials';
import { createFacadeMaterial } from '../world/FacadeMaterial';
import { buildCity } from '../world/City';
import { buildTrackView } from '../world/TrackView';
import { buildProps } from '../world/Props';
import { CarView } from '../vehicle/CarView';
import { ChaseCamera } from '../vehicle/ChaseCamera';
import { Hud } from '../ui/Hud';
import { Effects } from '../fx/Effects';

const PHYS_DT = 1 / PHYSICS_HZ;

/** Phase 1 "visual gate" game: one car, one track, free driving. */
export class Game {
  private pipeline: Pipeline;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 3000);
  private assets = new Assets();
  private input = new Input();
  private quality: Quality = loadQuality();
  private def: TrackDef = TRACKS.midtown;
  private cl!: Centerline;
  private world!: RAPIER.World;
  private car!: Vehicle;
  private carView!: CarView;
  private chase = new ChaseCamera(this.camera);
  private env!: Environment;
  private hud: Hud;
  private fx!: Effects;
  private acc = 0;
  private last = 0;
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private curPos = new THREE.Vector3();
  private curQuat = new THREE.Quaternion();
  private lerpPos = new THREE.Vector3();
  private lerpQuat = new THREE.Quaternion();
  private progressHint = 0;
  private stuckTime = 0;
  private lastVel = new THREE.Vector3();
  private params = new URLSearchParams(location.search);
  private autopilot = this.params.has('drive');
  private shotMode = this.params.has('shot');
  private frames = 0;

  constructor(private canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.pipeline = new Pipeline(canvas);
    this.hud = new Hud(hudRoot);
    if (this.shotMode) document.body.classList.add('shot');
    (window as unknown as { __game: Game }).__game = this;
  }

  async init(progress: (p: number, label: string) => void) {
    progress(0.02, 'physics');
    await RAPIER.init();
    const r = this.pipeline.renderer;
    this.assets.maxAnisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    this.assets.onProgress = (d, t) => progress(0.05 + 0.6 * (d / Math.max(1, t)), 'assets');
    const preset = PRESETS[this.quality];
    const theme = THEMES[this.def.theme];

    const [mats] = await Promise.all([createWorldMaterials(this.assets)]);
    this.env = new Environment(this.scene, r, mats.noise);
    const [facade] = await Promise.all([
      createFacadeMaterial(this.assets, mats.noise),
      this.env.load(theme, preset.shadowMapSize, preset.shadowDistance),
    ]);
    facade.uniforms.uNight.value = this.def.theme === 'night' ? 1 : 0;

    progress(0.7, 'building city');
    this.cl = buildCenterline(this.def);
    const city = buildCity(this.def, this.cl, mats, facade.material, preset);
    this.scene.add(city.group);
    const track = buildTrackView(this.def, this.cl, mats);
    this.scene.add(track.group);
    const props = buildProps(city.props, mats);
    this.scene.add(props.group);

    progress(0.85, 'car');
    this.world = createTrackWorld(this.def, this.cl);
    const spec = CARS[DEFAULT_CAR];
    const s0 = Number(this.params.get('s') ?? -18);
    const sp = spawnAt(this.cl, s0, Number(this.params.get('lat') ?? 3.6));
    this.car = new Vehicle(this.world, spec, sp.pos, sp.yaw);
    this.carView = await new CarView(spec).load(this.assets, spec.paint, this.def.theme !== 'day');
    this.scene.add(this.carView.root);
    this.fx = new Effects(this.scene, this.assets, preset.particles);
    await this.fx.init();

    this.camera.far = preset.drawDistance;
    this.pipeline.build(this.scene, this.camera, preset, theme.look);
    this.pipeline.motionBlur.track(this.carView.root, this.carView.half);
    addEventListener('resize', () => this.pipeline.resize());

    // settle suspension before the first frame
    for (let i = 0; i < PHYSICS_HZ; i++) this.physicsStep(emptyInput());
    this.syncCarTransform();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.chase.snap();
    this.pipeline.renderer.compile(this.scene, this.camera);
    const warp = Number(this.params.get('warp') ?? 0);
    if (warp > 0) this.warp(warp);
    progress(1, 'ready');
  }

  start() {
    this.last = performance.now();
    const tick = (t: number) => {
      // screenshot mode: stop rendering once the requested frame is done
      if (!(window as unknown as { __shotReady?: boolean }).__shotReady) requestAnimationFrame(tick);
      // rAF timestamps can be older than performance.now() at start: never go negative
      const dt = clamp((t - this.last) / 1000, 0, 0.1);
      this.last = t;
      this.frame(dt);
    };
    requestAnimationFrame(tick);
  }

  private physicsStep(input: DriveInput) {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.car.step(PHYS_DT, input);
    this.world.step();
    this.syncCarTransform();
  }

  private syncCarTransform() {
    const t = this.car.body.translation();
    const q = this.car.body.rotation();
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(q.x, q.y, q.z, q.w);
  }

  private autopilotInput(): DriveInput {
    const d = emptyInput();
    const p = this.car.body.translation();
    const pr = this.cl.project(p.x, p.z, this.progressHint);
    const speed = this.car.speed;
    const look = 12 + Math.max(0, speed) * 0.9;
    // slow down for upcoming corners
    let maxK = 0;
    for (let a = 10; a < 60 + speed * 1.5; a += 5) maxK = Math.max(maxK, Math.abs(this.cl.at(pr.s + a).k));
    const target = maxK > 0 ? Math.min(Number(this.params.get('v') ?? 60), Math.sqrt((1.25 * 9.81) / maxK)) : Number(this.params.get('v') ?? 60);
    const aim = this.cl.at(pr.s + look);
    const lane = Number(this.params.get('lane') ?? 0);
    const ax = aim.x + aim.tz * lane, az = aim.z - aim.tx * lane;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.curQuat);
    const toAim = new THREE.Vector3(ax - p.x, 0, az - p.z).normalize();
    const cross = fwd.x * toAim.z - fwd.z * toAim.x;
    d.steer = clamp(cross * 2.2, -1, 1);
    if (speed < target - 1) d.throttle = 1;
    else if (speed > target + 3) d.brake = clamp((speed - target) / 10, 0.2, 1);
    const drift = Number(this.params.get('drift') ?? -1);
    if (drift >= 0 && pr.s > drift && pr.s < drift + 60) { d.handbrake = true; d.steer = clamp(d.steer * 1.6, -1, 1); d.throttle = 1; d.brake = 0; }
    return d;
  }

  /** run the simulation without rendering (screenshots of the car at speed) */
  private warp(seconds: number) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) this.frame(dt, false);
  }

  private frame(dt: number, render = true) {
    if (render) this.frames++;
    const inp = this.input;
    inp.update(dt);
    if (inp.wasPressed('KeyC')) this.chase.cycle();
    if (inp.wasPressed('KeyH')) this.hud.toggleHelp();
    if (inp.wasPressed('KeyR')) this.respawn();
    for (const [k, q] of [['Digit1', 'low'], ['Digit2', 'medium'], ['Digit3', 'high']] as const) {
      if (inp.wasPressed(k)) this.setQuality(q);
    }
    const drive = this.autopilot ? this.autopilotInput() : this.shotMode ? emptyInput() : inp.drive;

    // fixed-step physics with render interpolation
    this.acc += this.shotMode && !this.autopilot ? 0 : this.shotMode ? Math.min(dt, 1 / 60) : dt;
    let steps = 0;
    while (this.acc >= PHYS_DT && steps < 12) {
      this.physicsStep(drive);
      this.acc -= PHYS_DT;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    const alpha = clamp(this.acc / PHYS_DT, 0, 1);
    this.lerpPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.lerpQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);

    // impacts -> camera shake + sparks
    const lv = this.car.body.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const dv = vel.clone().sub(this.lastVel).length();
    if (dv > 4 && dt > 0) {
      this.chase.shake = Math.min(0.25, dv * 0.012);
      this.fx.impact(this.lerpPos, vel, dv);
    }
    this.lastVel.copy(vel);

    // auto-respawn when flipped or stuck off the road
    const pr = this.cl.project(this.curPos.x, this.curPos.z, this.progressHint);
    this.progressHint = pr.index;
    if (this.car.isUpsideDown() || Math.abs(pr.lateral) > this.def.roadWidth) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 2.5) this.respawn();

    const night = this.def.theme === 'night';
    this.carView.update(this.car, this.lerpPos, this.lerpQuat, night);
    if (!this.applyShotCamera()) this.chase.update(dt, this.lerpPos, this.lerpQuat, vel, this.car.speed);
    const focus = this.lerpPos.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.lerpQuat), 25);
    this.env.update(dt, focus, this.camera);
    this.fx.update(dt, this.car, this.carView, this.lerpQuat);
    this.pipeline.speedFx = clamp((Math.abs(this.car.speed) - 30) / 50, 0, 1);
    if (!render) return;
    this.pipeline.render(this.shotMode ? 1 / 60 : dt, 0.55);
    this.hud.update(dt, this.car, this.quality, this.def.name, this.pipeline.renderer.info.render.calls);
    if (this.shotMode && this.frames === Number(this.params.get('frames') ?? 8)) (window as unknown as { __shotReady: boolean }).__shotReady = true;
  }

  /** ?cam=x,y,z,tx,ty,tz  (world) or ?orbit=angle,dist,height for beauty screenshots */
  private applyShotCamera() {
    const cam = this.params.get('cam');
    const orbit = this.params.get('orbit');
    if (cam) {
      const [x, y, z, tx, ty, tz] = cam.split(',').map(Number);
      this.camera.position.set(x, y, z);
      this.camera.lookAt(tx, ty, tz);
      this.camera.fov = Number(this.params.get('fov') ?? 50);
      this.camera.updateProjectionMatrix();
      return true;
    }
    if (orbit) {
      const [ang, dist, h, fov] = orbit.split(',').map(Number);
      const yaw = new THREE.Euler().setFromQuaternion(this.lerpQuat, 'YXZ').y + ang;
      const c = this.lerpPos;
      this.camera.position.set(c.x + Math.sin(yaw) * dist, h, c.z + Math.cos(yaw) * dist);
      this.camera.lookAt(c.x, 0.55, c.z);
      this.camera.fov = fov || 40;
      this.camera.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  private respawn() {
    const t = this.car.body.translation();
    const pr = this.cl.project(t.x, t.z, this.progressHint);
    const sp = spawnAt(this.cl, pr.s, clamp(pr.lateral, -4, 4));
    this.car.reset(sp.pos, sp.yaw);
    this.syncCarTransform();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.stuckTime = 0;
    this.chase.snap();
    this.pipeline.motionBlur.resetHistory();
    this.fx.clearTrails();
  }

  private setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    saveQuality(q);
    const preset = PRESETS[q];
    this.env.setShadowQuality(preset.shadowMapSize, preset.shadowDistance);
    this.camera.far = preset.drawDistance;
    this.pipeline.build(this.scene, this.camera, preset, THEMES[this.def.theme].look);
    this.pipeline.motionBlur.track(this.carView.root, this.carView.half);
    this.hud.toast(`GRAPHICS: ${q.toUpperCase()}`);
  }
}
