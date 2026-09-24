import type { CombatEvent } from '../race/powerups';

/**
 * Online play: messages between the browsers and the room server (a Cloudflare Durable Object
 * online, or the home server on the WiFi). The room server only relays and keeps the player
 * list; one player's browser (the host = whoever is in the room longest) runs the race rules,
 * the AI cars and the power-ups. Every player drives their own car and sends its state.
 * Type-only imports here: this file is also bundled into the Worker.
 */
export const NET_HZ = 20;
export const MAX_PLAYERS = 8;
export const MAX_MESSAGE = 24_000;
export const ROOM_CODE = /^[A-Z0-9]{4,8}$/;

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PlayerInfo {
  id: number;
  name: string;
  car: string;
  paint: number;
}

export interface RoomSettings {
  laps: number;
  ai: number;
  difficulty: Difficulty;
}

/** one car on the grid; index in RaceSetup.grid = racer index everywhere */
export interface GridEntry {
  name: string;
  car: string;
  paint: number;
  mapColor: string;
  /** network id of the player driving it; absent = AI (driven by the host) */
  player?: number;
}

export interface RaceSetup {
  /** server time (ms) of GO */
  go: number;
  countdown: number;
  laps: number;
  difficulty: Difficulty;
  seed: number;
  grid: GridEntry[];
}

/**
 * Packed car state: position, rotation, velocity, spin, front wheel angle, flags
 * (1 braking, 2 reversing, 4 airborne, 8.. wheel contacts), suspension, sideways and
 * lengthways tyre slip per wheel, drift amount.
 */
export type CarState = number[];
export const CS = {
  P: 0, Q: 3, V: 7, W: 10, STEER: 13, FLAGS: 14, SUSP: 15, SLIP_LAT: 19, SLIP_LONG: 23, DRIFT: 27, LEN: 28,
} as const;

/** power-up state for the non-host browsers (sent a few times a second) */
export interface CombatSnap {
  /** per car: health, shield, shieldHits, surge, wreck, sel, slots (letters), arcLeft, hits, kills */
  c: (number | string)[][];
  /** pickups: one letter per pickup, '-' while it respawns */
  p: string;
  /** shots: id, kind (0 pulse, 1 arc), target, x, y, z, dx, dy, dz, speed */
  sh: number[][];
  /** mines: id, owner, x, y, z, arm */
  m: number[][];
}

/** race state from the host: per racer lap, maxLap, finished (0/1), finishTime, bestLap (-1 = none); finish order */
export interface RaceSnap {
  l: number[][];
  o: number[];
}

/** relayed between browsers (the server adds `from`; with `to` it goes to one player, else to everyone else) */
export type RelayMsg =
  | { t: 'setup'; s: RoomSettings; racing: boolean; to?: number }
  | { t: 'start'; race: RaceSetup }
  | { t: 'end' }
  | { t: 'w'; ts: number; cars: [number, CarState][]; cb?: CombatSnap; r?: RaceSnap }
  | { t: 's'; ts: number; i: number; st: CarState }
  | { t: 'ev'; e: CombatEvent[] }
  | { t: 'use'; to: number; sel: number }
  | { t: 'cycle'; to: number }
  | { t: 'crash'; to: number; dmg: number }
  | { t: 'knock'; to: number; i: number; k: number; v: number[]; w: number[] };

/** browser -> room server (answered, not relayed) */
export type ControlMsg = { t: 'ping'; c: number } | { t: 'info'; name: string; car: string; paint: number };

export type ClientMsg = ControlMsg | RelayMsg;

/** room server -> browser */
export type ServerMsg =
  | { t: 'welcome'; you: number; host: number; players: PlayerInfo[]; now: number }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'info'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'host'; id: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'refused'; why: string }
  | (RelayMsg & { from: number });

/** messages only the host may send */
export const HOST_ONLY = new Set(['setup', 'start', 'end', 'w', 'ev', 'knock']);
export const RELAYED = new Set(['setup', 'start', 'end', 'w', 's', 'ev', 'use', 'cycle', 'crash', 'knock']);

export const KIND_LETTER = { pulse: 'p', arc: 'a', surge: 's', trap: 't', barrier: 'b', patch: 'h', storm: 'x' } as const;

/** 4 letters, no look-alikes (0/O, 1/I) */
export function newRoomCode(rand = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}

export function cleanName(s: unknown) {
  const t = String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
  return t || 'PLAYER';
}
