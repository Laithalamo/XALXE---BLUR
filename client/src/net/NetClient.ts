import type { ClientMsg, PlayerInfo, ServerMsg } from '@shared/net/protocol';

/**
 * WebSocket connection to a room (Cloudflare Durable Object online, or the home server on the
 * WiFi — same address scheme: room/CODE next to the page). Keeps a server clock estimate from pings, so every
 * browser agrees on when the race starts and how old a car state is.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  you = 0;
  host = 0;
  players = new Map<number, PlayerInfo>();
  /** server time - performance.now(), from the lowest-latency ping */
  private offset = 0;
  private bestRtt = Infinity;
  private pingTimer = 0;
  rtt = 0;
  open = false;
  onMessage: ((m: ServerMsg) => void) | null = null;
  onClose: ((why: string) => void) | null = null;

  constructor(readonly code: string) {}

  /** server clock, ms */
  now() {
    return performance.now() + this.offset;
  }

  get isHost() {
    return this.you !== 0 && this.you === this.host;
  }

  connect(name: string, car: string, paint: number): Promise<void> {
    const q = new URLSearchParams({ name, car, paint: String(paint) });
    // next to the page, so it also works when the game lives under a path (valve.ist/blr/room/CODE)
    const url = new URL(`room/${this.code}?${q}`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      let settled = false;
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.you = m.you;
          this.host = m.host;
          this.players = new Map(m.players.map((p) => [p.id, p]));
          this.offset = m.now - performance.now();
          this.open = true;
          this.ping();
          this.pingTimer = window.setInterval(() => this.ping(), 2000);
          settled = true;
          resolve();
        } else if (m.t === 'refused') {
          settled = true;
          reject(new Error(m.why === 'full' ? 'Room is full (8 players)' : m.why));
          return;
        } else if (m.t === 'pong') {
          const rtt = performance.now() - m.c;
          this.rtt = rtt;
          // keep the estimate from the quickest round trip (least queueing), slowly forgetting old ones
          this.bestRtt = Math.min(this.bestRtt * 1.02 + 1, rtt);
          if (rtt <= this.bestRtt + 0.5) this.offset = m.s + rtt / 2 - performance.now();
        } else if (m.t === 'join' || m.t === 'info') this.players.set(m.p.id, m.p);
        else if (m.t === 'leave') this.players.delete(m.id);
        else if (m.t === 'host') this.host = m.id;
        this.onMessage?.(m);
      };
      ws.onclose = (e) => {
        clearInterval(this.pingTimer);
        const was = this.open;
        this.open = false;
        if (!settled) reject(new Error(e.code === 4001 ? 'Room is full (8 players)' : 'Could not connect to the room'));
        else if (was) this.onClose?.(e.reason || 'Connection lost');
      };
      ws.onerror = () => {
        /* onclose follows */
      };
    });
  }

  private ping() {
    this.send({ t: 'ping', c: performance.now() });
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    clearInterval(this.pingTimer);
    this.open = false;
    this.onClose = null;
    this.ws?.close();
    this.ws = null;
  }
}
