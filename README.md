# XALXE

Arcade combat racing in the browser — realistic cars, city street circuits,
weapon power-ups. Private game for friends on the same home WiFi.

> **Status:** Solo race on the *Midtown Circuit*: you vs 7 AI cars, 3 laps, start lights,
> positions, lap times, mini map, turn warnings, drift score. Power-ups and more cars are next.

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
| **Space** | Handbrake — tap it in a corner to start a drift, hold throttle to keep it |
| **Shift** | Test boost |
| **R** | Reset car onto the road |
| **C** | Change camera (chase, far, hood, bumper) |
| **1 / 2 / 3** | Graphics: Low / Medium / High |
| **F** | Auto resolution on/off |
| **H** | Hide the help box |
| **Enter** | Race again (on the results screen) |

Gamepads work too (RT/LT throttle/brake, left stick steer, A handbrake, Y reset, Start = race again).

## Racing

- The race starts with a 3-2-1 countdown and the start lights (red → green).
- Top right: your position, lap and lap time. Top left: the running order.
- Bottom left: mini map (turns with your car; coloured dots are the other cars).
- Top centre: next turn — direction, how sharp, and distance. Yellow/black chevron
  boards mark the outside of every corner on the track too.
- AI level (Easy / Medium / Hard) is picked on the results screen.
- Free driving without opponents: add `?race=0` to the address.

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
