/**
 * XALXE on Cloudflare: serves the built game (static assets) and runs the online rooms,
 * one Durable Object per room code. Optional password: set the SITE_PASSWORD secret.
 * Deploy: see ONLINE.md.
 */
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from '../../shared/src/net/room';
import { ROOM_CODE, type PlayerInfo } from '../../shared/src/net/protocol';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  ROOMS: DurableObjectNamespace<Room>;
  SITE_PASSWORD?: string;
}

/** one race room: relays messages between the players' browsers (WebSocket Hibernation API) */
export class Room extends DurableObject<Env> {
  private core = new RoomCore(() => Date.now());

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // waking up after a quiet spell: the sockets are still open, rebuild the player list
    for (const ws of ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as PlayerInfo | null;
      if (info) this.core.restore(info, (s) => ws.send(s));
    }
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const url = new URL(req.url);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const q = url.searchParams;
    const peer = this.core.join((s) => server.send(s), q.get('name'), q.get('car'), q.get('paint'));
    if (peer) server.serializeAttachment(peer.info);
    else server.close(4001, 'room full');
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    const info = ws.deserializeAttachment() as PlayerInfo | null;
    if (!info) return;
    const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg);
    if (this.core.message(info.id, text)) ws.serializeAttachment(this.core.peers.get(info.id)!.info);
  }

  async webSocketClose(ws: WebSocket) {
    const info = ws.deserializeAttachment() as PlayerInfo | null;
    if (info) this.core.leave(info.id);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}

const COOKIE = 'xalxe_key';

async function keyFor(password: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('xalxe:' + password));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loginPage(wrong: boolean, back: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XALXE</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c10;color:#f2f2f2;font:16px system-ui,sans-serif}
form{background:#15171c;border:1px solid #2a2d34;border-radius:14px;padding:28px 30px;width:min(320px,86vw)}
h1{margin:0 0 18px;font-size:30px;letter-spacing:.2em}input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3a3e46;background:#0b0c10;color:#fff;font-size:16px}
button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:8px;background:#e8202a;color:#fff;font-weight:700;font-size:16px;letter-spacing:.1em;cursor:pointer}
p{color:#ff6b6b;margin:10px 0 0;font-size:14px}</style></head><body>
<form method="post" action="/login?back=${encodeURIComponent(back)}"><h1>XALXE</h1><input type="password" name="password" placeholder="Password" autofocus>
<button>PLAY</button>${wrong ? '<p>Wrong password</p>' : ''}</form></body></html>`;
  return new Response(html, { status: wrong ? 401 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.SITE_PASSWORD) {
      const key = await keyFor(env.SITE_PASSWORD);
      if (url.pathname === '/login' && req.method === 'POST') {
        const form = await req.formData();
        if (String(form.get('password') ?? '') !== env.SITE_PASSWORD) return loginPage(true, url.searchParams.get('back') ?? '/');
        const back = url.searchParams.get('back') ?? '/';
        return new Response(null, {
          status: 303,
          headers: { location: back.startsWith('/') && !back.startsWith('//') ? back : '/', 'set-cookie': `${COOKIE}=${key}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` },
        });
      }
      const cookie = req.headers.get('cookie') ?? '';
      if (!cookie.split(/;\s*/).includes(`${COOKIE}=${key}`)) {
        // the page itself shows the password form (and returns to the same link, room code included)
        if (url.pathname === '/' || url.pathname === '/index.html') return loginPage(false, url.pathname + url.search);
        return new Response('login first', { status: 401 });
      }
    }
    const m = url.pathname.match(/^\/room\/([A-Z0-9]+)$/);
    if (m) {
      if (!ROOM_CODE.test(m[1])) return new Response('bad room code', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
