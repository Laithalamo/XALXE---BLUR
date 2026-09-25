# XALXE

Arcade combat racing in the browser — realistic cars, city street circuits,
weapon power-ups. Private game for friends on the same home WiFi.

> **Status:** Solo combat race on the *Midtown Circuit*: you vs 7 AI cars, 3 laps, 7 power-ups,
> health and wrecks, start lights, positions, lap times, mini map, turn warnings, drift score.
> Eight cars. **Online races with friends** (browser, up to 8 cars): see [ONLINE.md](ONLINE.md).
> Next: more tracks, menus, profiles, sound.
>
> Also in this repo: **Mimoza**, the building's aidat / expense accounts at valve.ist/mimoza: see [MIMOZA.md](MIMOZA.md).

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
| **E** | Use the selected power-up |
| **Q** | Select the next power-up |
| **R** | Reset car onto the road |
| **C** | Change camera (chase, far, hood, bumper) |
| **1 / 2 / 3** | Graphics: Low / Medium / High |
| **F** | Auto resolution on/off |
| **H** | Hide the help box |
| **Esc** | Menu: resume, restart, change car / AI level, online rooms |
| **Enter** | Race again (results screen) / restart (pause menu) |

Gamepads work too (RT/LT throttle/brake, left stick steer, A handbrake, B use power-up,
X/LB next power-up, Y reset, Start = race again).

## Racing

- The race starts with a 3-2-1 countdown and the start lights (red → green).
- Top right: your position, lap and lap time. Top left: the running order.
- Bottom left: mini map (turns with your car; coloured dots are the other cars).
- Top centre: next turn — direction, how sharp, and distance. Yellow/black chevron
  boards mark the outside of every corner on the track too.
- AI level (Easy / Medium / Hard) is picked on the results screen.
- Free driving without opponents: add `?race=0` to the address.

## Online races

**Esc** → your name → **CREATE ROOM** → **COPY LINK** and send it to your friends (or give them
the 4-letter code to **JOIN**). The host picks AI cars and laps and presses **START RACE**.
Works over the internet on Cloudflare's free plan (setup: [ONLINE.md](ONLINE.md)) and on the
home WiFi with `start.bat`.

## Cars

| Car | Drive | Style |
|---|---|---|
| **Ferrano 458** | RWD | Highest top speed, loose and easy to drift |
| **Kestrel C** | AWD | Concept car, quickest off the line, lots of grip |
| **Bavra R3 GTR** | RWD | Light race car: fast, sharp, big downforce — but fragile |
| **Bavra R3 Coupe** | RWD | Tuned coupe with a wing, all-rounder |
| **Mercator 190E** | RWD | 80s sports saloon, soft and slidey |
| **Renova Clyo RS** | FWD | Hot hatch, nimble in the tight turns |
| **Dacor Logen** | FWD | Everyday saloon: slow and soft, but hard to wreck |
| **Tugra T10** | AWD | Electric SUV: heaviest and toughest, strong launch |

Press **Esc** (pause) or use the results screen to pick your car and the AI level;
the choice is used from the next race. The AI field mixes all the cars.

## Power-ups

Glowing badges float over the road in groups of three — drive through one to take it
(you can hold 3). The icon shows what it is:

| Power-up | What it does |
|---|---|
| **Pulse** (violet) | Homing shot that chases the car ahead of you |
| **Arc** (cyan) | Three fast bolts straight ahead (slight auto-aim) |
| **Surge** (blue) | Nitro boost for 3 seconds |
| **Trap** (orange) | Mine dropped behind you |
| **Barrier** (green) | Shield: blocks the next 2 hits for 8 seconds |
| **Patch** (pink) | Repairs 55% health |
| **Storm** (yellow) | Lightning on up to 3 cars ahead of you |

The green bar above your power-ups is your health. Hits and hard crashes cost health;
at zero you're **wrecked** and come back on the road after ~3 seconds (power-ups lost).
A violet **INCOMING** warning means a Pulse is chasing you — a Barrier blocks it.

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

Adding a car: write a settings file in `tools/blender/cars/` (orientation, size, which source
materials map to which game material, which logos to delete or paint out), run
`tools/blender/process_model.py` with Blender's Python, then `tools/blender/build_car.sh`
to get the game model and its two lighter versions for AI cars, and add a spec in
`shared/src/cars.ts`. Physics checks: `npx tsx tools/sim/lap_test.ts` (`CAR=<id>`),
`CAR=mix npx tsx tools/sim/race_test.ts`.

Asset sources and licences: see [CREDITS.md](CREDITS.md).
