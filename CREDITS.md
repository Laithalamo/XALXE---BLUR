# Credits & Licenses

XALXE is a private, non-commercial game for home LAN play. Every third-party
asset is listed here with its source and licence. Nothing from the game
"Blur" is used (no names, assets, UI or logos).

## Cars

| In game | Original | Author | Licence | Source | Changes |
|---|---|---|---|---|---|
| **Ferrano 458** | Ferrari 458 Italia (Spider) | [vicent091036](https://sketchfab.com/vicent091036) | CC BY 4.0 (per the Sketchfab listing) | [Sketchfab model](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), as shipped in the three.js examples (`examples/models/gltf/ferrari.glb`) | Renamed; all real logos removed (grille + rear emblems, rear lettering, fender shields, hood badge, wheel/steering centre caps recoloured); duplicate faces removed; materials remapped to game slots; wheels re-rigged; interior decimated; meshopt-compressed. Pipeline: `tools/blender/process_car.py` (Blender 5.0 `bpy`). |
| **Kestrel C** | "Car Concept" glTF sample model | © 2024 Darmstadt Graphics Group GmbH — model & textures by Eric Chadwick; based on a CC0 model by Unity Fan | CC BY 4.0 | [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | Renamed; Khronos / 3D Commerce logos removed (steering-wheel emblem deleted, licence-plate and all logo textures dropped — the game uses its own untextured materials); colour variants removed; wheels re-rigged (static brake calipers); car turned to face -Z; heavy parts decimated; near/far LODs for AI cars. Pipeline: `tools/blender/process_concept.py`, `make_lod.py`, `strip_attributes.mjs`. |
| **Bavra R3 GTR** | "2001 BMW M3 GTR" | [Dave Love](https://sketchfab.com/Tyler_Dave) | CC BY 4.0 | [Sketchfab](https://sketchfab.com/3d-models/2001-bmw-m3-gtr-6bb4d180cd0d454ba62fbfae24fc5155) | Renamed; badges, livery decals and caliper decals removed (plain paint); stacked duplicate parts removed; materials remapped to game slots; wheels re-rigged; LODs. |
| **Bavra R3 Coupe** | "2010 BMW M3 (E92)" | [ilvskf](https://sketchfab.com/ilvskf) | CC BY 4.0 | [Sketchfab](https://sketchfab.com/3d-models/2010-bmw-m3-e92-1b61f48d5ebc4d9d94ac5f76ef1aede4) | Renamed; all badges/emblems (hood, boot, wheels, steering wheel, glass, airbag) and the hood badge plinth removed; scaled to real size; suspension parts removed; heavy decimation; wheels re-rigged; LODs. |
| **Mercator 190E** | "1982 Mercedes W201" | [Dave Love](https://sketchfab.com/Tyler_Dave) | CC BY 4.0 | [Sketchfab](https://sketchfab.com/3d-models/1982-mercedes-w201-9b2ea34482654173a7f421aab8f1b287) | Renamed; star emblems, wheel badges and interior badge removed; materials remapped to game slots; wheels re-rigged; LODs. |
| **Renova Clyo RS** | "renault clio r.s. 200 edc" | [amogusstrikesback2](https://sketchfab.com/amogusstrikesback2) | CC BY 4.0 | [Sketchfab](https://sketchfab.com/3d-models/renault-clio-rs-200-edc-5e32db97ba1c4f23af012bb2a92ee53b) | Renamed; diamond emblems, badges and plate text painted out / deleted from the texture; stray light-glow planes removed; paint texture kept as a tint mask; wheels re-rigged; LODs. |
| **Dacor Logen** | "2009 Dacia Logan" | [Dave Love](https://sketchfab.com/Tyler_Dave) | CC BY 4.0 | [Sketchfab](https://sketchfab.com/3d-models/2009-dacia-logan-bd250be9928342a9b6f632d80da1fdc3) | Renamed; grille and boot emblems deleted, badge shadow, "DACIA"/"LOGAN" text and plate painted out of the textures, lettering texture deleted; original textures kept; wheels re-rigged; LODs. |
| **Tugra T10** | "Togg T10x" | [SuperScriptDEV2](https://sketchfab.com/superscriptdev2) | CC BY 4.0 | [Sketchfab](https://sketchfab.com/3d-models/togg-t10x-084e0c5e0549442b8e88725219c0010e) | Renamed; hood emblem and tailgate lettering painted out of the texture; wheels cut out of the fused mesh and re-rigged; decimated; LODs. |

All six: converted with `tools/blender/process_model.py` (per-car settings in `tools/blender/cars/*.json`), then `build_car.sh` (`make_lod.py`, `strip_attributes.mjs`: WebP textures, meshopt).

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
