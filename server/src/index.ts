/**
 * XALXE home server.
 * Serves the built game to every device on the home WiFi, prints the address friends
 * should open, and runs the race rooms for online play on the WiFi (the same rooms as the
 * Cloudflare version: see ONLINE.md for playing over the internet).
 */
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomCore } from '../../shared/src/net/room';
import { ROOM_CODE } from '../../shared/src/net/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../client/dist');
const serveGame = existsSync(dist);

if (!serveGame && !process.env.ROOMS_ONLY) {
  console.error('\n  The game is not built yet. Run:  npm start  (it builds first)\n');
  process.exit(1);
}

const app = express();
if (serveGame) app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// ---- rooms -------------------------------------------------------------------------------------
const rooms = new Map<string, RoomCore>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const server = createServer(app);

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const m = url.pathname.match(/^\/room\/([A-Z0-9]+)$/);
  if (!m || !ROOM_CODE.test(m[1])) {
    socket.destroy();
    return;
  }
  const code = m[1];
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    let room = rooms.get(code);
    if (!room) {
      room = new RoomCore(() => Date.now());
      rooms.set(code, room);
    }
    const q = url.searchParams;
    const peer = room.join((s) => ws.readyState === ws.OPEN && ws.send(s), q.get('name'), q.get('car'), q.get('paint'));
    if (!peer) {
      ws.close(4001, 'room full');
      return;
    }
    ws.on('message', (data) => room.message(peer.id, data.toString()));
    ws.on('close', () => {
      room.leave(peer.id);
      if (!room.peers.size) rooms.delete(code);
    });
    ws.on('error', () => ws.close());
  });
});

function lanAddresses() {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  const line = '─'.repeat(52);
  console.log(`\n  ${line}`);
  console.log('   XALXE server is running');
  console.log(`  ${line}`);
  console.log(`   On this PC:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   Friends on WiFi:   http://${ip}:${PORT}`);
  if (!ips.length) console.log('   (no WiFi/LAN address found — are you connected?)');
  console.log(`  ${line}\n   Online race: Esc > ONLINE > CREATE ROOM, friends join with the code.`);
  console.log('   Press Ctrl+C to stop.\n');
});
