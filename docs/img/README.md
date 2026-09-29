# Screenshot provenance

The homepage combines the project's retained game gallery with new Elbera Tools
captures. These groups are labeled separately: historical game views preserve
the development story, while the new images illustrate specific current tools.

## Elbera Tools · September 26–27, 2026

These direct browser captures use the page's normal viewport, without
compositing or replacement artwork. The first four captures use 1280 × 720;
the earlier animation previews use 771 × 760 and the cached-transition capture
uses 1280 × 720. The NPC source-track capture also uses 1280 × 720. The faces and recipes `.png` files retain their original
published names; those two files' encoded image format is JPEG.

| Image | What was actually running | Limits |
| --- | --- | --- |
| `elbera-tools-bsp-sweep.jpg` | Elbera Tools BSP inspector using the actual no-owner extent-sweep module and its explicitly synthetic box fixture; one traversed node, one candidate hull and 12 plane clips. | Direct browser-native 1280 × 720 capture, 27 September 2026. No original assets, compositing or replacement artwork. Candidate boxes are diagnostics; the view does not establish actor/terrain aggregation or complete game collision. |
| `elbera-tools-faces.png` | The existing Elbera Tools pawn inspector, using the game's Character loader, female Human Fighter and original face index2. The panel names its original mesh, material, texture and served image. | Offline asset inspection. The camera and lighting are inspection settings; hair selection, full native shaders and pose parity remain unfinished. |
| `elbera-tools-recipes.png` | The existing recipe inspector with supplied Wooden Arrow packet/inventory fixtures, manufacture details, expanded ingredient tree and independently selected shortcut drawers. Windows were positioned using their normal drag controls. | No server connection, recipe ownership, successful craft or shortcut persistence is demonstrated. The screenshot retains the tool's explicit replay notice and renderer gaps. |
| `elbera-tools-hair.jpg` | Original hair geometry and color inspector, displaying separate part identities and source material states. | Static original LOD0 view; animation, body attachment and native sampling remain unverified. |
| `elbera-tools-hair-soft.jpg` | Dark Elf female style 0 / color 0, including a separate original soft-rig hair part with its source bones and weights. | The soft rig is shown statically. This does not demonstrate dynamic hair simulation. |
| `elbera-tools-live-animation.jpg` | Male Human Fighter after Sit → Stand → Wait in the pawn inspector, using the live Character player and private lossless runtime bundle. The visible status reports Wait_Hand_MFighter, 69 original links and one reference bone. | Offline replay of the gameplay component. Nonnegative source poses are admitted; initial tween, modifiers, native skinning and actor placement remain unfinished. Manual clip controls above the replay remain a separate export comparison. |
| `elbera-tools-cached-transition.jpg` | Male Human Fighter after a fresh Sit → Stand → Wait replay. The current pose reports 69 mapped bones and one reference; the visible historical receipt retains the actual last evaluated Wait transition's frame and increment. | Direct offline capture with normal viewport and zoom controls. The receipt describes an earlier transition, not the current positive frame. Browser skinning, inspection lighting and an unresolved original audio reference remain visible; this is not full native rendering parity. |
| `elbera-tools-live-npc-events.jpg` | Live Talking Island starter Gremlin 18342 running original Wait, with source-frame/event observations and a separately retired movement transition in Elbera Tools. | Direct browser capture, 27 September 2026, normal 953 × 760 viewport. Real local server packets; no injected NPC state or compositing. Sound-gate results describe dispatch, not audible equivalence. Native movement, rendering, placement and random-history parity remain unfinished. |
| `elbera-tools-npc-source.jpg` | Gremlin 20001 in the existing NPC inspector, showing its original `atkwait` sparse sequence at a manually selected normalized frame. The browser verifies the model, geometry buffer and original source bundle before sampling. | Manual source inspection with 55 original bones. Updated capture: all 1,324 Gremlin vertices use original GPU weight lanes after import. Native shader math, inverse binds, lighting, placement, state selection, notifies and complete gameplay playback remain unfinished. No client files are bundled. |
| `elbera-tools-source-hierarchy.jpg` | Male Human Fighter, original CastMid at 0.677 seconds, using the original face skeleton, 69 native animation links, one source reference bone and recovered neutral parent transforms. | Existing browser skinning and per-part binds remain in use. This does not establish actor modifiers, world placement, native deformation or full gameplay animation parity. |
| `elbera-tools-animation-keys.jpg` | Female Human Fighter, original CastMid sequence at 0.677 seconds, rendered from decoded sparse tracks with recovered ordinary interpolation. The same inspector reports differences from the existing export. | Historical local-key preview before source-face hierarchy integration. Inspection camera/lighting; initial tweening, root modifiers and dynamic hair remain unfinished. |

Original client files and generated assets used to render these views are not
part of the public source or Elbera Tools Core archive. The screenshots are
selected illustrations of development output, not redistributable asset packs.

## Elbera Tools · September 29, 2026

`elbera-tools-object-localization.png` is a direct, complete 1280 × 1671 browser
capture of `test/actor-localization.html?path=defaults`, with partial parent
storage and nonempty authored payloads. It shows independent raw-array copies,
retained object references and cleared new fields. Every value and offset is a
synthetic inspection input. No original assets, game values, compositing or
replacement artwork appear in this capture. It does not show a live map or
complete class initialization. The tool's 96 scenarios passed with no captured
page/console errors. [Evidence and limits](../native-actor-localization-evidence.md).

## Retained game gallery

The original hero (`hero-armor-shield-giran.jpg`) and all twelve earlier showcase
images remain in this directory and are collected in the
[game gallery](../SHOWCASE.md). The README features the hero, Talking Island and
Giran. No historical game screenshot was removed or altered for this refresh.

These images predate the September restart. They are not a current release
certification; the [coverage inventory](../PORT-COVERAGE.md) takes precedence
over older captions or inferred completeness. The earlier creator image, for
example, shows hair swatches and disabled style choices that have since changed.
