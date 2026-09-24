/**
 * XALXE host server.
 * Serves the built game to every device on the home WiFi and prints the
 * address friends should open. (LAN multiplayer rooms arrive in phase 6.)
 */
import express from 'express';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../client/dist');

if (!existsSync(dist)) {
  console.error('\n  The game is not built yet. Run:  npm start  (it builds first)\n');
  process.exit(1);
}

const app = express();
app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true });
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

app.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  const line = '─'.repeat(52);
  console.log(`\n  ${line}`);
  console.log('   XALXE server is running');
  console.log(`  ${line}`);
  console.log(`   On this PC:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   Friends on WiFi:   http://${ip}:${PORT}`);
  if (!ips.length) console.log('   (no WiFi/LAN address found — are you connected?)');
  console.log(`  ${line}\n   Press Ctrl+C to stop.\n`);
});
