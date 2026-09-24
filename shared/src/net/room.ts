import { HOST_ONLY, MAX_MESSAGE, MAX_PLAYERS, RELAYED, cleanName, type PlayerInfo, type ServerMsg } from './protocol';

/**
 * One online room: player list, host choice and message relay. No game logic. The platform
 * glue (a Cloudflare Durable Object, or the home server's WebSocket server) passes sockets in.
 * Ids are never reused while the room lives, so "host = lowest id" is simply whoever has been
 * in the room longest, and it survives the Durable Object sleeping (nothing else to remember).
 */
export interface RoomPeer {
  id: number;
  info: PlayerInfo;
  send(data: string): void;
  /** token bucket for the relay rate limit */
  tokens: number;
  refill: number;
}

const RATE = 70; // messages per second per player (20 Hz states + events + pings, with headroom)

export class RoomCore {
  readonly peers = new Map<number, RoomPeer>();
  private nextId = 1;

  constructor(private now: () => number) {}

  get host() {
    let h = 0;
    for (const id of this.peers.keys()) if (!h || id < h) h = id;
    return h;
  }

  private infos() {
    return [...this.peers.values()].map((p) => p.info);
  }

  /** a peer that was already connected (Durable Object waking up) */
  restore(info: PlayerInfo, send: (s: string) => void) {
    this.peers.set(info.id, { id: info.id, info, send, tokens: RATE, refill: this.now() });
    this.nextId = Math.max(this.nextId, info.id + 1);
  }

  /** a new connection; null if the room is full */
  join(send: (s: string) => void, name: unknown, car: unknown, paint: unknown): RoomPeer | null {
    if (this.peers.size >= MAX_PLAYERS) {
      send(JSON.stringify({ t: 'refused', why: 'full' } satisfies ServerMsg));
      return null;
    }
    const id = this.nextId++;
    const info: PlayerInfo = { id, name: cleanName(name), car: String(car ?? '').slice(0, 24), paint: Number(paint) | 0 };
    const peer: RoomPeer = { id, info, send, tokens: RATE, refill: this.now() };
    this.peers.set(id, peer);
    send(JSON.stringify({ t: 'welcome', you: id, host: this.host, players: this.infos(), now: this.now() } satisfies ServerMsg));
    this.broadcast({ t: 'join', p: info }, id);
    return peer;
  }

  leave(id: number) {
    if (!this.peers.has(id)) return;
    const wasHost = this.host === id;
    this.peers.delete(id);
    this.broadcast({ t: 'leave', id });
    if (wasHost && this.peers.size) this.broadcast({ t: 'host', id: this.host });
  }

  /** returns true when the peer's info changed (the caller may want to persist it) */
  message(id: number, raw: string): boolean {
    const peer = this.peers.get(id);
    if (!peer || raw.length > MAX_MESSAGE) return false;
    // rate limit: token bucket
    const now = this.now();
    peer.tokens = Math.min(RATE, peer.tokens + ((now - peer.refill) / 1000) * RATE);
    peer.refill = now;
    if (peer.tokens < 1) return false;
    peer.tokens -= 1;
    let m: { t?: unknown; to?: unknown; from?: number; [k: string]: unknown };
    try {
      m = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!m || typeof m.t !== 'string') return false;
    if (m.t === 'ping') {
      safeSend(peer, JSON.stringify({ t: 'pong', c: Number(m.c) || 0, s: now } satisfies ServerMsg));
      return false;
    }
    if (m.t === 'info') {
      peer.info = { id, name: cleanName(m.name), car: String(m.car ?? '').slice(0, 24), paint: Number(m.paint) | 0 };
      this.broadcast({ t: 'info', p: peer.info });
      return true;
    }
    if (!RELAYED.has(m.t) || (HOST_ONLY.has(m.t) && id !== this.host)) return false;
    m.from = id;
    const out = JSON.stringify(m);
    if (typeof m.to === 'number') {
      const p = this.peers.get(m.to);
      if (p && m.to !== id) safeSend(p, out);
      return false;
    }
    for (const p of this.peers.values()) if (p.id !== id) safeSend(p, out);
    return false;
  }

  private broadcast(msg: ServerMsg, except = 0) {
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.id !== except) safeSend(p, s);
  }
}

function safeSend(p: RoomPeer, s: string) {
  try {
    p.send(s);
  } catch {
    /* socket closing */
  }
}
