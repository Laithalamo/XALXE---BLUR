# Credits & Licenses

XALXE is a private, non-commercial game for home LAN play. Every third-party
asset is listed here with its source and licence. Nothing from the game
"Blur" is used (no names, assets, UI or logos).

## Cars

| In game | Original | Author | Licence | Source | Changes |
|---|---|---|---|---|---|
| **Ferrano 458** | Ferrari 458 Italia (Spider) | [vicent091036](https://sketchfab.com/vicent091036) | CC BY 4.0 (per the Sketchfab listing) | [Sketchfab model](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), as shipped in the three.js examples (`examples/models/gltf/ferrari.glb`) | Renamed; all real logos removed (grille + rear emblems, rear lettering, fender shields, hood badge, wheel/steering centre caps recoloured); duplicate faces removed; materials remapped to game slots; wheels re-rigged; interior decimated; meshopt-compressed. Pipeline: `tools/blender/process_car.py` (Blender 5.0 `bpy`). |
| **Kestrel C** | "Car Concept" glTF sample model | © 2024 Darmstadt Graphics Group GmbH — model & textures by Eric Chadwick; based on a CC0 model by Unity Fan | CC BY 4.0 | [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | Renamed; Khronos / 3D Commerce logos removed (steering-wheel emblem deleted, licence-plate and all logo textures dropped — the game uses its own untextured materials); colour variants removed; wheels re-rigged (static brake calipers); car turned to face -Z; heavy parts decimated; near/far LODs for AI cars. Pipeline: `tools/blender/process_concept.py`, `make_lod.py`, `strip_attributes.mjs`. |

Power-up icons, projectile/lightning/shield effects: drawn in code (original work).

## HDRI skies (lighting & reflections)

All from [Poly Haven](https://polyhaven.com) — **CC0** (public domain).

| File | Poly Haven asset | Mirror used to download |
|---|---|---|
| `assets/hdri/san_giuseppe_bridge_2k.hdr` | San Giuseppe Bridge | three.js examples |
| `assets/hdri/venice_sunset_1k.hdr` | Venice Sunset | three.js examples |
| `assets/hdri/potsdamer_platz_1k.hdr` | Potsdamer Platz | pmndrs/drei-assets |

## Textures

| File(s) | Source | Licence |
|---|---|---|
| `asphalt_*`, `concrete_*`, `pavers_*`, `bricks_*`, `plaster_*`, `noise_rgba`, `chainlink`, `smoke_atlas`, `flakes_normal` | Generated for XALXE by `tools/textures/generate.py` (procedural noise) | Original work |
| `grass_albedo.jpg` | "Dark grass" from OpenGameArt, via three.js examples (`textures/terrain/grasslight-big.jpg`), resized | CC BY 3.0 |
| Tree bark & leaf textures (bundled in ez-tree) | Poly Haven (bark_brown_02, bark_willow_02) and TextureCan, packaged by ez-tree | CC0 / MIT (ez-tree) |
| Sponsor boards, gantry banner | Drawn at runtime (fictional brands only) | Original work |

## Code libraries

| Library | Licence |
|---|---|
| [three.js](https://threejs.org) | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib |
| [N8AO](https://github.com/N8python/n8ao) | ISC |
| [Rapier](https://rapier.rs) physics | Apache-2.0 |
| [ez-tree](https://github.com/dgreenheck/ez-tree) (procedural trees) | MIT |
| [Vite](https://vitejs.dev) | MIT |
| [Express](https://expressjs.com) | MIT |

## Fonts

| Font | Licence |
|---|---|
| Rajdhani (via @fontsource) | SIL Open Font License 1.1 |
