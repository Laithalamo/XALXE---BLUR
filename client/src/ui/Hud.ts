import type { Vehicle } from '@shared/physics/vehicle';
import type { Corner } from '@shared/track/corners';
import type { Quality } from '../core/Settings';
import { POWERS, type PowerKind } from '@shared/race/powerups';
import { powerIconUrl } from './powerIcons';

const SEVERITY_LABEL: Record<Corner['severity'], string> = {
  kink: 'FLAT OUT', fast: 'FAST', medium: 'MEDIUM', sharp: 'SHARP', hairpin: 'HAIRPIN',
};
const SEVERITY_COLOR: Record<Corner['severity'], string> = {
  kink: '#7dff9a', fast: '#c6ff5e', medium: '#ffd21f', sharp: '#ff8a1f', hairpin: '#ff3b30',
};

export interface RaceHudInfo {
  position: number;
  total: number;
  lap: number;
  laps: number;
  lapTime: number;
  bestLap: number | null;
}

export interface StandingRow {
  name: string;
  color: string;
  isPlayer: boolean;
}

export interface ResultRow extends StandingRow {
  /** finish time (s), null = still racing */
  time: number | null;
  best: number | null;
  /** cars this driver wrecked */
  kills: number;
}

export interface PanelInfo {
  mode: 'results' | 'pause';
  rows?: ResultRow[];
  place?: number;
  difficulty: string;
  car: string;
  cars: { id: string; name: string; stats: { speed: number; acceleration: number; handling: number; health: number } }[];
  carNote?: string;
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

const ordinal = (n: number) => (n % 10 === 1 && n !== 11 ? 'ST' : n % 10 === 2 && n !== 12 ? 'ND' : n % 10 === 3 && n !== 13 ? 'RD' : 'TH');

/** In-race HUD: speed, gear, turn warnings, mini map slot, race info, drift score, toasts. */
export class Hud {
  private speed: HTMLElement;
  private gear: HTMLElement;
  private rpm: HTMLElement;
  private top: HTMLElement;
  private toastEl: HTMLElement;
  private help: HTMLElement;
  private turn: HTMLElement;
  private turnArrow: HTMLElement;
  private turnText: HTMLElement;
  private turnDist: HTMLElement;
  private drift: HTMLElement;
  private race: HTMLElement;
  private raceEls: HTMLElement[];
  private raceCache: string[] = [];
  private stand: HTMLElement;
  private standKey = '';
  private results: HTMLElement;
  private resultsKey = '';
  private banner: HTMLElement;
  /** results screen buttons */
  onRestart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onDifficulty: ((d: string) => void) | null = null;
  onCar: ((id: string) => void) | null = null;
  readonly mapSlot: HTMLElement;
  readonly slotsEl: HTMLElement;
  private healthFill: HTMLElement;
  private healthText: HTMLElement;
  private vignette: HTMLElement;
  private incoming: HTMLElement;
  private feedEl: HTMLElement;
  private slotKey = '';
  private healthKey = '';
  private vig = 0;
  private toastTimer = 0;
  private helpTimer = 14;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private driftShown = 0;
  private driftFade = 0;
  fps = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-top"></div>
      <div class="hud-help">
        <div><kbd>W</kbd><kbd>S</kbd> throttle / brake-reverse &nbsp; <kbd>A</kbd><kbd>D</kbd> steer</div>
        <div><kbd>Space</kbd> handbrake → drift (hold throttle to keep it) &nbsp; <kbd>R</kbd> reset</div>
        <div><kbd>E</kbd> use power-up &nbsp; <kbd>Q</kbd> next power-up &nbsp; <kbd>C</kbd> camera</div>
        <div><kbd>Esc</kbd> pause / change car &nbsp; <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> graphics &nbsp; <kbd>F</kbd> auto-res &nbsp; <kbd>H</kbd> help</div>
      </div>
      <div class="hud-turn"><div class="arrow"></div><div class="txt"><div class="t1"></div><div class="t2"></div></div></div>
      <div class="hud-race">
        <div class="pos"><b></b><span></span><em></em></div>
        <div class="lap">LAP <b></b><i></i></div>
        <div class="time"></div>
        <div class="best"></div>
      </div>
      <div class="hud-stand"></div>
      <div class="hud-results"></div>
      <div class="hud-banner"></div>
      <div class="hud-toast"></div>
      <div class="hud-drift"></div>
      <div class="hud-mapslot"></div>
      <div class="hud-vignette"></div>
      <div class="hud-incoming">⚠ INCOMING</div>
      <div class="hud-feed"></div>
      <div class="hud-combat">
        <div class="hud-health"><div class="fill"></div><span></span></div>
        <div class="hud-slots"></div>
      </div>
      <div class="hud-speed">
        <div class="v">0</div><div class="u">KM/H</div>
        <div class="g">GEAR <b>1</b></div>
        <div class="hud-rpm"><div></div></div>
      </div>`;
    this.speed = root.querySelector('.hud-speed .v')!;
    this.gear = root.querySelector('.hud-speed .g b')!;
    this.rpm = root.querySelector('.hud-rpm > div')!;
    this.top = root.querySelector('.hud-top')!;
    this.toastEl = root.querySelector('.hud-toast')!;
    this.help = root.querySelector('.hud-help')!;
    this.turn = root.querySelector('.hud-turn')!;
    this.turnArrow = root.querySelector('.hud-turn .arrow')!;
    this.turnText = root.querySelector('.hud-turn .t1')!;
    this.turnDist = root.querySelector('.hud-turn .t2')!;
    this.drift = root.querySelector('.hud-drift')!;
    this.race = root.querySelector('.hud-race')!;
    this.raceEls = ['.pos b', '.pos span', '.pos em', '.lap b', '.lap i', '.time', '.best'].map((q) => this.race.querySelector(q)!);
    this.stand = root.querySelector('.hud-stand')!;
    this.results = root.querySelector('.hud-results')!;
    this.results.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.act === 'restart') this.onRestart?.();
      else if (t.dataset.act === 'resume') this.onResume?.();
      else if (t.dataset.act === 'diff') this.onDifficulty?.(t.dataset.v!);
      else if (t.dataset.act === 'car') this.onCar?.(t.dataset.v!);
    });
    this.setRace(null);
    this.banner = root.querySelector('.hud-banner')!;
    this.mapSlot = root.querySelector('.hud-mapslot')!;
    this.slotsEl = root.querySelector('.hud-slots')!;
    this.healthFill = root.querySelector('.hud-health .fill')!;
    this.healthText = root.querySelector('.hud-health span')!;
    this.vignette = root.querySelector('.hud-vignette')!;
    this.incoming = root.querySelector('.hud-incoming')!;
    this.feedEl = root.querySelector('.hud-feed')!;
    this.setSlots([], 0);
  }

  toggleHelp() {
    const hidden = this.help.style.display === 'none';
    this.help.style.display = hidden ? '' : 'none';
    this.helpTimer = hidden ? 1e9 : 0;
  }

  toast(text: string, seconds = 1.6) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  /** big centre text (countdown, FINISH...) — empty string hides it */
  setBanner(text: string, color = '#ffffff') {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.classList.toggle('show', text.length > 0);
  }

  setRace(info: RaceHudInfo | null) {
    if (!info) {
      this.race.style.display = 'none';
      this.stand.style.display = 'none';
      return;
    }
    this.race.style.display = '';
    this.stand.style.display = '';
    // only touch the DOM when a value actually changes
    const vals = [
      String(info.position), ordinal(info.position), `/${info.total}`,
      String(Math.min(info.lap, info.laps)), `/${info.laps}`,
      fmtTime(info.lapTime), `BEST ${info.bestLap !== null ? fmtTime(info.bestLap) : '--:--.--'}`,
    ];
    for (let i = 0; i < vals.length; i++) {
      if (this.raceCache[i] !== vals[i]) {
        this.raceCache[i] = vals[i];
        this.raceEls[i].textContent = vals[i];
      }
    }
  }

  /** race order list (leader first) */
  setStandings(rows: StandingRow[]) {
    const key = rows.map((r) => r.name).join('|');
    if (key === this.standKey) return;
    this.standKey = key;
    this.stand.innerHTML = rows
      .map((r, i) => `<div class="row${r.isPlayer ? ' me' : ''}"><b>${i + 1}</b><i style="background:${r.color}"></i>${r.name}</div>`)
      .join('');
  }

  /** end-of-race table; null hides it. Updates live while the others finish. */
  /**
   * Results / pause panel; null hides it. Results update live while the others finish.
   * Car changes apply to the next race.
   */
  setPanel(p: PanelInfo | null) {
    if (!p) {
      this.results.classList.remove('show');
      // a focused (now hidden) button would still react to Space/Enter
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    const rows = p.rows ?? [];
    const leader = rows[0]?.time ?? null;
    const body = rows
      .map((r, i) => {
        const t = r.time === null ? '<span class="racing">RACING…</span>' : i === 0 || leader === null ? fmtTime(r.time) : `+${(r.time - leader).toFixed(2)}`;
        return `<tr class="${r.isPlayer ? 'me' : ''}"><td class="p">${i + 1}</td><td><i style="background:${r.color}"></i>${r.name}</td><td class="t">${t}</td><td class="t">${r.best !== null ? fmtTime(r.best) : '--'}</td><td class="t">${r.kills || ''}</td></tr>`;
      })
      .join('');
    const diffs = ['easy', 'medium', 'hard']
      .map((d) => `<button data-act="diff" data-v="${d}" class="${d === p.difficulty ? 'on' : ''}">${d.toUpperCase()}</button>`)
      .join('');
    const cars = p.cars
      .map((c) => `<button data-act="car" data-v="${c.id}" class="car${c.id === p.car ? ' on' : ''}">${c.name}<small>SPD ${c.stats.speed} · ACC ${c.stats.acceleration} · HDL ${c.stats.handling} · HP ${c.stats.health}</small></button>`)
      .join('');
    const title = p.mode === 'pause' ? 'PAUSED' : `${p.place}<span>${ordinal(p.place ?? 0)}</span> PLACE`;
    const table = rows.length
      ? `<table><tr class="h"><td></td><td>DRIVER</td><td class="t">TIME</td><td class="t">BEST LAP</td><td class="t">WRECKED</td></tr>${body}</table>`
      : '';
    const buttons = p.mode === 'pause'
      ? `<div class="row2"><button class="go alt" data-act="resume">RESUME <small>ESC</small></button><button class="go" data-act="restart">RESTART <small>ENTER</small></button></div>`
      : `<button class="go" data-act="restart">RACE AGAIN <small>ENTER</small></button>`;
    const html = `
      <div class="panel">
        <div class="title">${title}</div>
        ${table}
        <div class="opts"><span>AI</span>${diffs}</div>
        <div class="opts cars"><span>CAR</span>${cars}</div>
        ${p.carNote ? `<div class="note">${p.carNote}</div>` : ''}
        ${buttons}
      </div>`;
    if (this.resultsKey !== html) {
      this.resultsKey = html;
      this.results.innerHTML = html;
    }
    this.results.classList.add('show');
  }

  /** held power-ups (up to 3), the selected one highlighted */
  setSlots(kinds: PowerKind[], sel: number) {
    const key = kinds.join(',') + '|' + sel;
    if (key === this.slotKey) return;
    this.slotKey = key;
    let html = '';
    for (let i = 0; i < 3; i++) {
      const k = kinds[i];
      if (!k) {
        html += '<div class="slot empty"></div>';
        continue;
      }
      html += `<div class="slot${i === sel ? ' active' : ''}" style="--c:${POWERS[k].color}"><img src="${powerIconUrl(k)}" alt=""><span class="nm">${POWERS[k].name}</span>${i === sel ? '<kbd>E</kbd>' : ''}</div>`;
    }
    this.slotsEl.innerHTML = html;
  }

  setHealth(frac: number, wrecked: boolean) {
    const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    const key = `${pct}${wrecked}`;
    if (key === this.healthKey) return;
    this.healthKey = key;
    this.healthFill.style.width = `${pct}%`;
    this.healthFill.style.background = pct > 55 ? '#4be37a' : pct > 28 ? '#ffc21a' : '#ff3b30';
    this.healthText.textContent = wrecked ? 'WRECKED' : `${pct}`;
  }

  /** red screen-edge flash when the player takes damage (0..1) */
  hurt(strength: number) {
    this.vig = Math.min(1, Math.max(this.vig, strength));
  }

  setIncoming(on: boolean) {
    this.incoming.classList.toggle('show', on);
  }

  /** short line in the event feed (hits, wrecks) */
  feed(html: string) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.feedEl.prepend(d);
    while (this.feedEl.children.length > 4) this.feedEl.lastElementChild!.remove();
    setTimeout(() => d.classList.add('out'), 3800);
    setTimeout(() => d.remove(), 4400);
  }

  /** upcoming corner warning; pass null to hide */
  setTurn(corner: Corner | null, distance: number) {
    if (!corner || distance > 230) {
      this.turn.classList.remove('show');
      return;
    }
    this.turn.classList.add('show');
    const col = SEVERITY_COLOR[corner.severity];
    this.turn.style.setProperty('--turn', col);
    this.turnArrow.className = `arrow ${corner.dir > 0 ? 'left' : 'right'} ${corner.severity}`;
    this.turnText.textContent = `${corner.dir > 0 ? 'LEFT' : 'RIGHT'} · ${SEVERITY_LABEL[corner.severity]}`;
    this.turnDist.textContent = distance > 8 ? `${Math.round(distance / 10) * 10} m` : 'NOW';
  }

  /** drift score counter (Forza style), shows while drifting and briefly after */
  setDrift(active: boolean, score: number, dt: number) {
    if (active && score > 50) {
      this.driftShown = score;
      this.driftFade = 1.6;
      this.drift.innerHTML = `DRIFT <b>${Math.round(score).toLocaleString()}</b>`;
      this.drift.classList.add('show');
      this.drift.classList.remove('banked');
    } else if (this.driftFade > 0) {
      this.driftFade -= dt;
      if (!this.drift.classList.contains('banked') && this.driftShown > 50) {
        this.drift.innerHTML = `+${Math.round(this.driftShown).toLocaleString()} <small>DRIFT</small>`;
        this.drift.classList.add('banked');
      }
      if (this.driftFade <= 0) this.drift.classList.remove('show');
    }
  }

  update(dt: number, v: Vehicle, quality: Quality, trackName: string, drawCalls: number, scale = 1, autoRes = true) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      const ms = (1000 / Math.max(1, this.fps)).toFixed(1);
      const res = `${Math.round(scale * 100)}%${autoRes ? ' AUTO' : ''}`;
      this.top.innerHTML = `<b>${trackName.toUpperCase()}</b> &nbsp;·&nbsp; <b>${Math.round(this.fps)} FPS</b> (${ms} ms) &nbsp;·&nbsp; ${quality.toUpperCase()} &nbsp;·&nbsp; RES ${res} &nbsp;·&nbsp; ${drawCalls} draws`;
    }
    this.speed.textContent = String(Math.round(Math.abs(v.speed) * 3.6));
    this.gear.textContent = v.gear === 0 ? 'R' : String(v.gear);
    this.rpm.style.width = `${Math.min(100, (v.rpm / 8800) * 100)}%`;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.vig > 0) {
      this.vig = Math.max(0, this.vig - dt * 2.2);
      this.vignette.style.opacity = this.vig.toFixed(3);
    }
    if (this.helpTimer > 0 && this.helpTimer < 1e8) {
      this.helpTimer -= dt;
      if (this.helpTimer <= 0) this.help.style.display = 'none';
    }
  }
}
