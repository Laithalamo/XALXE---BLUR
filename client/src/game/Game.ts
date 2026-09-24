import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TRACKS, type TrackDef } from '@shared/track/trackDefs';
import { buildCenterline, type Centerline } from '@shared/track/centerline';
import { buildRacingLine, type RacingLine } from '@shared/track/racingLine';
import { nextCorner, type Corner } from '@shared/track/corners';
import { createTrackWorld, spawnAt, PHYSICS_HZ } from '@shared/physics/trackPhysics';
import { Vehicle, emptyInput, type DriveInput } from '@shared/physics/vehicle';
import { AIDriver } from '@shared/ai/driver';
import { Race, gridSlot } from '@shared/race/race';
import { CARS, DEFAULT_CAR } from '@shared/cars';
import { clamp, rng } from '@shared/math';
import { Assets } from '../core/Assets';
import { Input } from '../core/Input';
import {
  PRESETS, loadQuality, saveQuality, loadAutoRes, saveAutoRes, loadDifficulty, saveDifficulty,
  type Quality, type AIDifficulty,
} from '../core/Settings';
import { Pipeline } from '../render/Pipeline';
import { Environment, THEMES } from '../render/Environment';
import { createWorldMaterials } from '../world/materials';
import { createFacadeMaterial } from '../world/FacadeMaterial';
import { buildCity } from '../world/City';
import { buildTrackView } from '../world/TrackView';
import { buildProps, updateTreeLod, type TreeCell } from '../world/Props';
import { CarView } from '../vehicle/CarView';
import { makeShopSignAtlas } from '../world/banners';
import { ChaseCamera } from '../vehicle/ChaseCamera';
import { Hud, type ResultRow } from '../ui/Hud';
import { Minimap, type MapBlip } from '../ui/Minimap';
import { Effects } from '../fx/Effects';
import { CarReflections, DETAIL_LAYER } from '../render/Reflections';
import { Racer, type RacerInfo } from './Racer';

const PHYS_DT = 1 / PHYSICS_HZ;
const HOLD = emptyInput();

/** the other drivers (names are made up; colours = paint + a readable mini map colour) */
const ROSTER: RacerInfo[] = [
  { name: 'KADE', paint: 0xf0b400, mapColor: '#ffc21a' },
  { name: 'MIRA', paint: 0x0b3d91, mapColor: '#4a86ff' },
  { name: 'JUNO', paint: 0xe8e8e8, mapColor: '#f2f2f2' },
  { name: 'REX', paint: 0x101010, mapColor: '#9aa0a8' },
  { name: 'NOVA', paint: 0x0d6b3a, mapColor: '#2bd66f' },
  { name: 'VEX', paint: 0xff5a00, mapColor: '#ff7a1f' },
  { name: 'LINA', paint: 0x4b1d8f, mapColor: '#b070ff' },
];

/** forward direction (XZ) of a car from its rotation */
const fwdX = (q: THREE.Quaternion) => -2 * (q.x * q.z + q.w * q.y);
const fwdZ = (q: THREE.Quaternion) => -(1 - 2 * (q.x * q.x + q.y * q.y));

/** Solo race: the player and up to 7 AI cars on one track (or free driving with ?race=0). */
export class Game {
  private pipeline: Pipeline;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 3000);
  private assets = new Assets();
  private input = new Input();
  private quality: Quality = loadQuality();
  private facadeMat!: THREE.MeshStandardMaterial;
  private treeCells: TreeCell[] = [];
  // auto resolution: keeps the frame rate up by lowering render resolution
  private autoRes = loadAutoRes();
  private resFrames = 0;
  private resTime = 0;
  private goodSecs = 0;
  private badSecs = 0;
  private upBlockedUntil = 0;
  private clock = 0;
  private def: TrackDef = TRACKS.midtown;
  private cl!: Centerline;
  private line!: RacingLine;
  private corners: Corner[] = [];
  private world!: RAPIER.World;
  private racers: Racer[] = [];
  private player!: Racer;
  /** drives the player's car after the finish line */
  private playerAI!: AIDriver;
  private race!: Race;
  private startLights: THREE.MeshStandardMaterial[] = [];
  private difficulty: AIDifficulty = loadDifficulty();
  private chase = new ChaseCamera(this.camera);
  private env!: Environment;
  private hud: Hud;
  private minimap!: Minimap;
  private blips: MapBlip[] = [];
  private fx!: Effects;
  private reflections: CarReflections | null = null;
  private acc = 0;
  private last = 0;
  private params = new URLSearchParams(location.search);
  private autopilot = this.params.has('drive');
  /** ?drive: the racing AI drives the player's car (tests); the old line-follower only for ?drive&drift=... tests */
  private aiPilot = this.autopilot && !['drift', 'lane', 'v'].some((k) => this.params.has(k));
  private shotMode = this.params.has('shot');
  /** free driving (no opponents, no laps): ?race=0, or a spawn point given with ?s= */
  private raceMode = this.params.get('race') !== '0' && !this.params.has('s');
  private frames = 0;
  private finishedAt = -1;
  private wrongWay = 0;
  private standTimer = 0;
  private lampState = '';
  private startRng = rng(7);

  constructor(private canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.pipeline = new Pipeline(canvas);
    this.hud = new Hud(hudRoot);
    this.hud.onRestart = () => this.restartRace();
    this.hud.onDifficulty = (d) => {
      this.difficulty = d as AIDifficulty;
      saveDifficulty(this.difficulty);
      this.showResults();
    };
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
      createFacadeMaterial(this.assets, mats.noise, makeShopSignAtlas()),
      this.env.load(theme, preset.shadowMapSize, preset.shadowDistance),
    ]);
    facade.uniforms.uNight.value = this.def.theme === 'night' ? 1 : 0;
    this.facadeMat = facade.material;
    this.applyFacadeDetail(preset.facadeDetail);

    progress(0.7, 'building city');
    this.cl = buildCenterline(this.def);
    const city = buildCity(this.def, this.cl, mats, facade.material, preset);
    this.scene.add(city.group);
    const track = buildTrackView(this.def, this.cl, mats);
    this.corners = track.corners;
    this.startLights = track.startLights;
    this.scene.add(track.group);
    const props = buildProps(city.props, mats);
    this.treeCells = props.treeCells;
    props.group.traverse((o) => o.layers.set(DETAIL_LAYER));
    this.scene.add(props.group);
    this.camera.layers.enable(DETAIL_LAYER);

    // the city never moves: skip per-frame matrix work for its ~1000 objects
    for (const g of [city.group, track.group, props.group]) {
      g.updateMatrixWorld(true);
      g.traverse((o) => { o.matrixAutoUpdate = false; });
    }

    progress(0.8, 'cars');
    this.world = createTrackWorld(this.def, this.cl);
    this.line = buildRacingLine(this.cl, this.def.roadWidth);
    await this.createRacers();
    this.fx = new Effects(this.scene, this.assets, preset.particles);
    await this.fx.init();
    this.fx.setLayer(DETAIL_LAYER);
    this.setReflections(preset.dynamicReflections);
    this.minimap = new Minimap(this.cl, this.def.roadWidth);
    this.hud.mapSlot.appendChild(this.minimap.el);

    this.camera.far = preset.drawDistance;
    this.pipeline.build(this.scene, this.camera, preset, theme.look);
    this.trackBlur();
    addEventListener('resize', () => this.pipeline.requestResize());

    // settle suspensions before the first frame
    for (let i = 0; i < PHYSICS_HZ; i++) this.physicsStep(HOLD, false);
    for (const rc of this.racers) {
      rc.savePrev();
      rc.interpolate(1);
      rc.view.update(rc.vehicle, rc.pos, rc.quat, this.def.theme === 'night');
    }
    this.chase.snap();
    this.reflections?.prime(this.pipeline.renderer, this.scene, this.player.view.root, this.player.curPos);
    // compile every shader up front (in parallel where the browser supports it), then render
    // a couple of hidden frames so post-processing and shadow shaders are warm: no hitching later
    progress(0.92, 'preparing shaders');
    await this.pipeline.renderer.compileAsync(this.scene, this.camera);
    this.chase.update(1 / 60, this.player.pos, this.player.quat, new THREE.Vector3(), 0);
    for (let i = 0; i < 2; i++) this.pipeline.render(1 / 60, 0);
    this.pipeline.motionBlur.resetHistory();
    const warp = Number(this.params.get('warp') ?? 0);
    if (warp > 0) this.warp(warp);
    progress(1, 'ready');
  }

  /** player + AI cars on the grid (or the player alone in free mode) */
  private async createRacers() {
    const spec = CARS[DEFAULT_CAR];
    const nAI = this.raceMode ? clamp(Math.round(Number(this.params.get('ai') ?? 7)), 0, ROSTER.length) : 0;
    const count = nAI + 1;
    const laps = this.raceMode ? clamp(Math.round(Number(this.params.get('laps') ?? 3)), 1, 20) : Infinity;
    const countdown = this.raceMode ? Number(this.params.get('cd') ?? 4) : 0;
    this.race = new Race(this.cl, laps, count, countdown);
    this.race.onLap = (i, lap) => {
      if (i !== this.player.index || !this.raceMode || lap < 2) return;
      this.hud.toast(lap === this.race.laps ? 'FINAL LAP' : `LAP ${lap}/${this.race.laps}`, 2);
    };
    this.race.onFinish = (i) => {
      if (i === this.player.index && this.raceMode) this.finishedAt = this.race.time;
    };

    const night = this.def.theme !== 'day';
    const [playerView, ...aiViews] = await Promise.all([
      new CarView(spec).load(this.assets, spec.paint, night),
      ...ROSTER.slice(0, nAI).map((info) => new CarView(spec).load(this.assets, info.paint, false, true)),
    ]);
    // the player starts mid-pack
    const playerSlot = Math.min(4, count - 1);
    let ai = 0;
    for (let g = 0; g < count; g++) {
      const isPlayer = g === playerSlot;
      const slot = gridSlot(g);
      const sp = this.raceMode
        ? spawnAt(this.cl, slot.s, slot.lateral)
        : spawnAt(this.cl, Number(this.params.get('s') ?? -18), Number(this.params.get('lat') ?? 3.6));
      const vehicle = new Vehicle(this.world, spec, sp.pos, sp.yaw);
      const view = isPlayer ? playerView : aiViews[ai];
      const info = isPlayer ? { name: 'YOU', paint: spec.paint, mapColor: '#e8202a' } : ROSTER[ai];
      const driver = isPlayer ? null : new AIDriver(this.cl, this.line, this.def.roadWidth, this.difficulty, 101 + ai);
      if (!isPlayer) ai++;
      const racer = new Racer(this.racers.length, info, vehicle, view, driver, isPlayer, g);
      this.racers.push(racer);
      this.scene.add(view.root);
      this.race.place(racer.index, sp.pos.x, sp.pos.z, true);
      if (isPlayer) this.player = racer;
    }
    this.playerAI = new AIDriver(this.cl, this.line, this.def.roadWidth, 'medium', 99);
    this.setReactions();
  }

  private setReactions() {
    for (const rc of this.racers) rc.reaction = rc.ai ? this.startRng.range(0.08, 0.4) : 0;
  }

  /** motion blur keeps the player and the 3 nearest cars sharp */
  private trackBlur() {
    const mb = this.pipeline.motionBlur;
    mb.track(this.player.view.root, this.player.view.half);
    for (const rc of this.racers) if (rc !== this.player) mb.track(rc.view.root, rc.view.half);
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

  /** one fixed physics step for every car; the AI decides here too */
  private physicsStep(playerDrive: DriveInput, advance = true) {
    const race = this.race;
    const go = race.started && advance;
    const states = go ? this.racers.map((rc) => rc.aiState(race.racers[rc.index])) : null;
    for (const rc of this.racers) {
      let inp = HOLD;
      if (states) {
        const aiDriven = !rc.isPlayer || race.racers[rc.index].finished || this.aiPilot;
        if (!aiDriven) inp = playerDrive;
        else if (race.time >= rc.reaction) inp = (rc.ai ?? this.playerAI).update(PHYS_DT, states[rc.index], states, race.time);
      }
      rc.input = inp;
      rc.savePrev();
      rc.vehicle.step(PHYS_DT, inp);
    }
    this.world.step();
    for (const rc of this.racers) {
      rc.sync();
      race.track(rc.index, rc.curPos.x, rc.curPos.z);
    }
    if (advance) race.step(PHYS_DT);
  }

  private autopilotInput(): DriveInput {
    const d = emptyInput();
    const car = this.player.vehicle;
    const p = car.body.translation();
    const pr = this.race.racers[this.player.index];
    const speed = car.speed;
    const look = 12 + Math.max(0, speed) * 0.9;
    // slow down for upcoming corners
    let maxK = 0;
    for (let a = 10; a < 60 + speed * 1.5; a += 5) maxK = Math.max(maxK, Math.abs(this.cl.at(pr.s + a).k));
    const vmax = Number(this.params.get('v') ?? 60);
    const target = maxK > 0 ? Math.min(vmax, Math.sqrt((1.25 * 9.81) / maxK)) : vmax;
    const aim = this.cl.at(pr.s + look);
    const lane = Number(this.params.get('lane') ?? 0);
    const ax = aim.x + aim.tz * lane, az = aim.z - aim.tx * lane;
    const fx = fwdX(this.player.curQuat), fz = fwdZ(this.player.curQuat);
    const tl = Math.hypot(ax - p.x, az - p.z) || 1;
    const cross = (fx * (az - p.z) - fz * (ax - p.x)) / tl;
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

  /** ?bench=N : time N rendered frames (GPU work forced with gl.finish) */
  private bench = Number(this.params.get('bench') ?? 0);
  private benchTimes: number[] = [];
  private benchStart = 0;
  private benchFrame() {
    const gl = this.pipeline.renderer.getContext();
    gl.finish();
    const now = performance.now();
    if (this.benchStart > 0 && this.frames > 3) this.benchTimes.push(now - this.benchStart);
    this.pipeline.profileOn = this.frames >= 3;
    this.benchStart = now;
    if (this.benchTimes.length >= this.bench) {
      const t = [...this.benchTimes].sort((a, b) => a - b);
      const avg = t.reduce((a, b) => a + b, 0) / t.length;
      const info = this.pipeline.renderer.info.render;
      const prof = Object.fromEntries(Object.entries(this.pipeline.profile).map(([k, v]) => [k, +(v / this.benchTimes.length).toFixed(0)]));
      (window as unknown as { __bench: unknown }).__bench = { avg: +avg.toFixed(1), p90: +t[Math.floor(t.length * 0.9)].toFixed(1), calls: info.calls, tris: info.triangles, prof };
      (window as unknown as { __shotReady: boolean }).__shotReady = true;
    }
  }

  private frame(dt: number, render = true) {
    if (render) this.frames++;
    const inp = this.input;
    inp.update(dt);
    if (inp.wasPressed('KeyC')) this.chase.cycle();
    if (inp.wasPressed('KeyH')) this.hud.toggleHelp();
    if (inp.wasPressed('KeyR') && this.race.started) this.respawn(this.player);
    if (inp.wasPressed('KeyF')) {
      this.autoRes = !this.autoRes;
      saveAutoRes(this.autoRes);
      if (!this.autoRes) this.pipeline.setScale(1);
      this.hud.toast(`AUTO RESOLUTION: ${this.autoRes ? 'ON' : 'OFF'}`);
    }
    for (const [k, q] of [['Digit1', 'low'], ['Digit2', 'medium'], ['Digit3', 'high']] as const) {
      if (inp.wasPressed(k)) this.setQuality(q);
    }
    const enter = inp.wasPressed('Enter') || inp.wasPressed('NumpadEnter');
    if (enter && this.resultsUp()) this.restartRace();
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
    for (const rc of this.racers) rc.interpolate(alpha);

    this.updateRacers(dt);
    const pl = this.player;
    const night = this.def.theme === 'night';
    if (!this.applyShotCamera()) this.chase.update(dt, pl.pos, pl.quat, pl.vel, pl.vehicle.speed);
    for (const rc of this.racers) {
      rc.view.selectLod(rc.pos.distanceToSquared(this.camera.position));
      rc.view.update(rc.vehicle, rc.pos, rc.quat, night);
    }
    const focus = pl.pos.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(pl.quat), 25);
    this.env.update(dt, focus, this.camera);
    const cam = this.camera.position;
    for (const rc of this.racers) this.fx.car(dt, rc.index, rc.vehicle, rc.quat, rc.pos.distanceToSquared(cam) < 110 * 110);
    this.fx.update(dt);
    this.pipeline.speedFx = clamp((Math.abs(pl.vehicle.speed) - 30) / 50, 0, 1);
    this.updateCountdown();
    if (!render) return;
    if (this.frames % 6 === 1 || this.shotMode) {
      const p = PRESETS[this.quality];
      updateTreeLod(this.treeCells, this.camera.position, focus, p.treeDistance, p.shadowDistance, p.treeShadows);
    }
    this.reflections?.update(this.pipeline.renderer, this.scene, pl.view.root, pl.pos, this.shotMode && this.bench === 0 ? 6 : 1);
    this.pipeline.render(this.shotMode ? 1 / 60 : dt, 0.55);
    this.updateHud(dt);
    if (this.autoRes) this.updateAutoRes(dt);
    if (this.bench > 0) this.benchFrame();
    else if (this.shotMode && this.frames === Number(this.params.get('frames') ?? 8)) (window as unknown as { __shotReady: boolean }).__shotReady = true;
  }

  private resultsUp() {
    return this.finishedAt >= 0 && this.race.time - this.finishedAt > 2.5;
  }

  /** impacts, rubber banding, respawns */
  private updateRacers(dt: number) {
    const race = this.race;
    const pl = this.player;
    const plDone = race.racers[pl.index].finished;
    const plProg = race.progress(pl.index);
    const cam = this.camera.position;
    for (const rc of this.racers) {
      const lv = rc.vehicle.body.linvel();
      rc.vel.set(lv.x, lv.y, lv.z);
      const dv = rc.vel.distanceTo(rc.lastVel);
      rc.lastVel.copy(rc.vel);
      // impacts -> sparks (and camera shake for the player)
      if (dv > 4 && dt > 0) {
        if (rc === pl) this.chase.shake = Math.min(0.25, dv * 0.012);
        if (rc.pos.distanceToSquared(cam) < 150 * 150) this.fx.impact(rc.pos, rc.vel, dv);
      }
      const pr = race.racers[rc.index];
      // rubber banding: cars far ahead of the player ease off, cars far behind push a little harder
      if (rc.ai) rc.ai.catchUp = plDone || !this.raceMode ? 1 : clamp(1 - (race.progress(rc.index) - plProg) * 0.0004, 0.94, 1.07);
      // flipped or off the road -> put back on track
      const off = Math.abs(pr.lateral) > this.def.roadWidth / 2 + 2.5;
      if (rc.vehicle.isUpsideDown() || off) rc.stuckTime += dt;
      else rc.stuckTime = 0;
      if (rc.stuckTime > (rc.isPlayer && !plDone ? 2.5 : 1.5)) {
        this.respawn(rc);
        continue;
      }
      // computer driven and not getting anywhere (wedged against a wall or another car)
      if ((rc.ai || plDone) && race.started && !pr.finished) {
        rc.noProgress += dt;
        if (rc.noProgress > 6) {
          const p = race.progress(rc.index);
          if (p - rc.lastProgress < 15) this.respawn(rc);
          rc.noProgress = 0;
          rc.lastProgress = race.progress(rc.index);
        }
      }
    }
  }

  /** start lights: 2, 4, 5 red lamps with the 3-2-1 count, all green at GO */
  private updateCountdown() {
    if (!this.raceMode) return;
    const t = this.race.time;
    const lit = t < -3 ? 0 : t < -2 ? 2 : t < -1 ? 4 : t < 0 ? 5 : 0;
    const green = t >= 0 && t < 4;
    const state = `${lit}${green}`;
    if (state === this.lampState) return;
    this.lampState = state;
    this.startLights.forEach((m, k) => {
      m.emissive.setHex(green ? 0x19ff3c : 0xff1a0a);
      m.emissiveIntensity = green || k < lit ? 7 : 0;
    });
  }

  private updateHud(dt: number) {
    const race = this.race;
    const pl = this.player;
    const pr = race.racers[pl.index];
    const v = pl.vehicle;
    this.hud.update(dt, v, this.quality, this.def.name, this.pipeline.renderer.info.render.calls, this.pipeline.scale, this.autoRes);

    // banner: countdown > finish > wrong way
    const t = race.time;
    let banner = '', color = '#ffffff';
    if (this.raceMode && t < 1 && t >= -3) {
      banner = t < -2 ? '3' : t < -1 ? '2' : t < 0 ? '1' : 'GO!';
      color = t < 0 ? '#ffffff' : '#3dff6a';
    } else if (this.finishedAt >= 0 && t - this.finishedAt < 2.5) {
      banner = 'FINISH';
    } else if (race.started && !pr.finished) {
      const c = this.cl.at(pr.s);
      const along = pl.vel.x * c.tx + pl.vel.z * c.tz;
      const facing = fwdX(pl.quat) * c.tx + fwdZ(pl.quat) * c.tz;
      this.wrongWay = facing < -0.3 && along < -2 ? this.wrongWay + dt : 0;
      if (this.wrongWay > 1.0) {
        banner = 'WRONG WAY';
        color = '#ff3b30';
      }
    }
    this.hud.setBanner(banner, color);

    // turn guide, drift score
    const nc = pr.finished ? null : nextCorner(this.corners, this.cl.length, pr.s);
    this.hud.setTurn(nc?.corner ?? null, nc?.distance ?? 0);
    this.hud.setDrift(v.drift > 0.5, v.driftScore, dt);

    // mini map (rotates with the car: heading = yaw around +Y, forward = -Z)
    const yaw = Math.atan2(-fwdX(pl.quat), -fwdZ(pl.quat));
    this.blips.length = 0;
    for (const rc of this.racers) {
      if (rc !== pl) this.blips.push({ x: rc.pos.x, z: rc.pos.z, color: rc.info.mapColor, kind: 'car' });
    }
    this.minimap.draw(pl.pos.x, pl.pos.z, yaw, this.blips);

    if (!this.raceMode) {
      this.hud.setRace(null);
      return;
    }
    this.hud.setRace({
      position: race.position(pl.index),
      total: this.racers.length,
      lap: race.displayLap(pl.index),
      laps: race.laps,
      lapTime: race.lapTime(pl.index),
      bestLap: pr.bestLap,
    });
    this.standTimer -= dt;
    if (this.standTimer <= 0) {
      this.standTimer = 0.25;
      this.hud.setStandings(race.standings().map((i) => ({ name: this.racers[i].info.name, color: this.racers[i].info.mapColor, isPlayer: i === pl.index })));
      if (this.resultsUp()) this.showResults();
    }
  }

  private showResults() {
    const race = this.race;
    const rows: ResultRow[] = race.standings().map((i) => {
      const r = race.racers[i];
      const rc = this.racers[i];
      return { name: rc.info.name, color: rc.info.mapColor, isPlayer: rc.isPlayer, time: r.finished ? r.finishTime : null, best: r.bestLap };
    });
    this.hud.setResults(rows, this.difficulty, race.finishOrder.indexOf(this.player.index) + 1);
  }

  private restartRace() {
    const race = this.race;
    race.restart();
    for (const rc of this.racers) {
      const slot = gridSlot(rc.gridSlot);
      const sp = spawnAt(this.cl, slot.s, slot.lateral);
      rc.teleport(sp.pos, sp.yaw);
      race.place(rc.index, sp.pos.x, sp.pos.z, true);
      if (rc.ai) rc.ai = new AIDriver(this.cl, this.line, this.def.roadWidth, this.difficulty, 101 + rc.index + this.frames);
      rc.lastProgress = 0;
    }
    this.playerAI = new AIDriver(this.cl, this.line, this.def.roadWidth, 'medium', 99);
    this.setReactions();
    this.finishedAt = -1;
    this.wrongWay = 0;
    this.lampState = '';
    this.acc = 0;
    this.hud.setResults(null);
    this.fx.clearAll();
    this.pipeline.motionBlur.resetHistory();
    this.chase.snap();
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
      const yaw = new THREE.Euler().setFromQuaternion(this.player.quat, 'YXZ').y + ang;
      const c = this.player.pos;
      this.camera.position.set(c.x + Math.sin(yaw) * dist, h, c.z + Math.cos(yaw) * dist);
      this.camera.lookAt(c.x, 0.55, c.z);
      this.camera.fov = fov || 40;
      this.camera.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  /** put a car back on the road where it left it, away from other cars */
  private respawn(rc: Racer) {
    const pr = this.race.racers[rc.index];
    const want = rc.ai ? this.line.latAt(pr.s) : clamp(pr.lateral, -4, 4);
    let sp = spawnAt(this.cl, pr.s, want);
    search: for (const back of [0, -7, -14]) {
      for (const lat of [want, 0, 4, -4]) {
        const c = spawnAt(this.cl, pr.s + back, lat);
        const free = this.racers.every((o) => o === rc || (o.curPos.x - c.pos.x) ** 2 + (o.curPos.z - c.pos.z) ** 2 > 5.5 * 5.5);
        if (free) {
          sp = c;
          break search;
        }
      }
    }
    rc.teleport(sp.pos, sp.yaw);
    // track() (not place) so stepping back over the start line un-counts the lap
    this.race.track(rc.index, sp.pos.x, sp.pos.z);
    rc.lastProgress = this.race.progress(rc.index);
    this.fx.liftCar(rc.index);
    this.pipeline.motionBlur.resetCar(rc.view.root);
    if (rc === this.player) this.chase.snap();
  }

  /**
   * Auto resolution: measure the real frame rate every second. Below ~56 FPS the
   * render resolution drops a step (down to 55%); after a long smooth stretch
   * it tries one step back up, and stays lower for a while if that was too much.
   */
  private updateAutoRes(dt: number) {
    this.clock += dt;
    this.resFrames++;
    this.resTime += dt;
    if (this.resTime < 1) return;
    const fps = this.resFrames / this.resTime;
    this.resFrames = 0;
    this.resTime = 0;
    const pl = this.pipeline;
    // one slow second (a hitch, a GC pause) is not enough: need two in a row, unless it is really slow
    this.badSecs = fps < 55.5 ? this.badSecs + 1 : 0;
    if ((this.badSecs >= 2 || fps < 40) && pl.scale > 0.56) {
      const next = Math.max(0.55, +(pl.scale - (fps < 40 ? 0.15 : 0.08)).toFixed(2));
      pl.setScale(next);
      this.goodSecs = 0;
      this.badSecs = 0;
      this.upBlockedUntil = this.clock + 20;
    } else if (fps >= 58) {
      this.goodSecs++;
      if (pl.scale < 1 && this.goodSecs >= 10 && this.clock > this.upBlockedUntil) {
        pl.setScale(Math.min(1, +(pl.scale + 0.05).toFixed(2)));
        this.goodSecs = 0;
        this.upBlockedUntil = this.clock + 4;
      }
    } else this.goodSecs = 0;
  }

  private applyFacadeDetail(detail: 'low' | 'high') {
    const m = this.facadeMat;
    const defs = (m.defines ??= {});
    const want = detail === 'low';
    if (want === 'FACADE_SIMPLE' in defs) return;
    if (want) defs.FACADE_SIMPLE = '';
    else delete defs.FACADE_SIMPLE;
    m.customProgramCacheKey = () => (want ? 'facade-simple' : 'facade');
    m.needsUpdate = true;
  }

  private setReflections(on: boolean) {
    if (on && !this.reflections) this.reflections = new CarReflections(256);
    if (!on && this.reflections) {
      this.reflections.dispose();
      this.reflections = null;
    }
    this.player.view.setEnvMap(this.reflections ? this.reflections.texture : null);
  }

  private setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    saveQuality(q);
    const preset = PRESETS[q];
    this.env.setShadowQuality(preset.shadowMapSize, preset.shadowDistance);
    this.camera.far = preset.drawDistance;
    this.pipeline.build(this.scene, this.camera, preset, THEMES[this.def.theme].look);
    this.trackBlur();
    this.setReflections(preset.dynamicReflections);
    this.reflections?.prime(this.pipeline.renderer, this.scene, this.player.view.root, this.player.curPos);
    this.applyFacadeDetail(preset.facadeDetail);
    this.hud.toast(`GRAPHICS: ${q.toUpperCase()}`);
  }
}
