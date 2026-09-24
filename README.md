# XALXE

Arcade combat racing in the browser — realistic cars, city street circuits,
weapon power-ups. Private game for friends on the same home WiFi.

> **Status:** Phase 1 (visual gate) — one car on the *Midtown Circuit*, free driving.

## Run it (host PC)

1. Install **Node.js 20 or newer** from <https://nodejs.org> (the "LTS" button).
2. Open a terminal in this folder and run **one command**:

   ```
   npm start
   ```

   The first run downloads everything it needs (a minute or two).
3. It prints two addresses:
   - **On this PC:** `http://localhost:3000`
   - **Friends on WiFi:** something like `http://192.168.1.20:3000`

Friends just open that second address in Chrome or Edge. No install needed.

> **Windows:** easiest is to double-click **`start.bat`**. In PowerShell, type `npm.cmd start`
> (plain `npm start` is blocked by PowerShell's script policy).
> Windows may ask to allow Node.js through the firewall — click **Allow** (private networks).

## Controls

| Key | Action |
|---|---|
| **W / S** or ↑ / ↓ | Throttle / brake (hold S when stopped to reverse) |
| **A / D** or ← / → | Steer |
| **Space** | Handbrake (drift) |
| **Shift** | Test boost |
| **R** | Reset car onto the road |
| **C** | Change camera (chase, far, hood, bumper) |
| **1 / 2 / 3** | Graphics: Low / Medium / High |
| **F** | Auto resolution on/off |
| **H** | Hide the help box |

Gamepads work too (RT/LT throttle/brake, left stick steer, A handbrake, Y reset).

## Graphics settings

- **High** — live car reflections, MSAA + SMAA, AO, motion blur, all trees.
- **Medium** (default) — AO, SMAA, motion blur, most trees.
- **Low** (default on laptops with built-in graphics) — no AO/motion blur, simpler windows, fewer trees.

**Auto resolution** (on by default, toggle with **F**) lowers the render resolution
a little whenever the frame rate drops below ~56 FPS, and raises it again when
there is headroom. The top-left shows FPS, frame time and the current resolution.

## For developers

```
npm run dev        # hot-reload dev server on http://localhost:5173 (also on your LAN)
npm run typecheck  # TypeScript checks
```

Folders: `client/` (game), `server/` (host server), `shared/` (physics + track
data used by both), `assets/` (models, textures, HDRIs), `tools/` (texture
generator, Blender car pipeline, physics tests).

Asset sources and licences: see [CREDITS.md](CREDITS.md).
