# Browser port: path to a small test server

Updated 29 September 2026. The full browser client remains the goal. The
[coverage inventory](PORT-COVERAGE.md) records supported components and gaps;
source comparisons are not a substitute for playable journeys.

The actual scene loader now shares original static-actor/mesh preparation with
Elbera Tools. Both original-map checks cover 2,922 actors and 480 mesh records.
The Giran source loader prepares 1,936 static actors, 291 plain Brush collision
field sets and 287 meshes. Its source bundle preserves all 2,406 saved slots,
with 179 actors still awaiting preparation. Those include lights and cameras
as well as collision participants; this is not a count of 179 blocking obstacles.

This connection replaces duplicated verifier-only preparation code. The game
still uses the older approximate picking path. Saved level arrays and LevelInfo
mode are recovered, but current startup and actor participation remain separate.
Missing classes, resources and known flag bits stay explicit. The current large
private JSON bundles support development; production transfer and memory costs
still need work. See the [source-world contract](native-static-actor-bounds-evidence.md#source-resources-in-the-scene-loader).

The next world work is to finish the current startup join and brush/volume/mover
providers, then feed the existing original bounds, membership and query modules
into actual camera and walking queries. Validate town pavement, slopes, stairs,
bridges, interiors and tile transitions in Online mode before claiming map repair.
UI, class-specific animation, skills, effects, mobs, progression and the remaining
systems below remain part of the full port.

The source decoder now resolves an ambiguous mover default-property boundary
by following original class serialization. The two-map census retains exact
prefixes and ordered default tags for 26 distinct classes/ancestors. This
now feeds per-class saved Boolean records into the actual source loader. All
3,640 saved actors are covered, plus three retained static exports outside the
saved array. These inputs do not construct their live state; mover and brush
PostLoad remain separate source paths. Brush primitive selection and concrete
Model bounds now have original-instruction comparisons, including calls from
static-mesh auxiliary bounds. Saved Brush references now bind 495 original
Models into that loader, including their bounds and surface-node lists after
ordinary Model PostLoad. Plain Brush actors now use their own decoded defaults,
transforms and reference tags through the common actor property gates. Volumes
and movers still need their separate startup paths.
The ordinary Brush constructor and PostLoad wrapper are now source-bound,
and the browser preserves ordered Model/Polys flag writes in 192 native
comparisons. Its Models now link to 495 source-loaded Polys headers; the
decoder and independent record walker consume all 2,447 polygon records.
The header path has 128 original-instruction comparisons. Another 128 cases join
fresh Brush copying, construction and PostLoad. Both maps prepare 442 plain
Brush field sets; their ordered resource writes are retained for startup to
apply. Volume construction/localization and the full world startup join remain
unfinished. A volume's saved localized class bit must not be replaced by
the nonlocalized static-actor profile.
[Class-default evidence](native-class-defaults-evidence.md) and
[Model loading evidence](native-static-actor-bounds-evidence.md#saved-brush-model-resources) ·
[Brush startup component](native-static-actor-bounds-evidence.md#brush-construction-and-postload) ·
[Polys header scope](native-static-actor-bounds-evidence.md#source-loaded-polys-headers) ·
[Saved Brush fields](native-static-actor-bounds-evidence.md#saved-brush-actor-fields).

Public branches start from the reviewed public main. Original client inputs,
generated assets, accounts and raw local receipts remain private; the older
local research branch is preserved separately.

## Product and scope

Port Lineage 2 Interlude to the browser. Players open a URL and play against
the authoritative game server; they do not install the original client.
The private development pipeline still needs original client inputs.

**Binding fidelity rule:** use official game data and recovered native rules.
Never invent game values. Decode/decrypt/extract the source as needed and record
the evidence. Unknowns remain unknown; an emulator or another port can provide
a comparison but cannot establish official behavior. See root `AGENTS.md`.

The next release target is an invitation-only, limited-area playtest with a
complete beginner loop. Talking Island is the initial acceptance area. This
is a staging milestone toward the full port, not a claim that other regions
are correct or permanently excluded.

The active goal is the full browser port. A terrain checkpoint, successful
demo, beginner loop or invited playtest must not complete that goal. Keep a
feature/region evidence matrix and work through the remaining systems after
each milestone. The owner explicitly reaffirmed this scope on 26 September.
The inspected feature inventory is in [PORT-COVERAGE.md](PORT-COVERAGE.md).

## Reuse and simplify

- Keep aCis as game authority, the WebSocket/protocol gateway, Three.js browser
  rendering and the useful offline conversion library. No engine rewrite.
- Keep conversion separate from play. A player should never see converter
  settings, asset repair controls or developer scene selection.
- Prefer one shared rule for geometry and height queries. Remove a workaround
  only when source evidence and representative routes demonstrate its replacement.
- Treat old documentation, screenshots and passing historical suites as leads,
  not proof of current fidelity. Each correctness claim needs a fresh check.
- Prioritize source recovery and the player journey over speculative
  abstractions. Independent source investigations can proceed in parallel
  with world fixes; do not let one narrow checkpoint become the whole project.

## Current evidence

The audit found real browser/server integration worth keeping, alongside
reproducible defects. This branch fixes floor selection for movement permissions,
triangle/height-query disagreement, test-runner argument loss, and overlapping
or abandoned login attempts. New checks include independent geometry
intersection and a server-verified multilayer cell.

The original Engine.dll now establishes terrain visibility, edge-turn
diagonals (bit1 B–C / bit0 A–D), runtime `Orig` replacement and the appended
edge vertices. All 6,502,500 ordinary quads across the 100 converted maps agree
with the current visibility mask. The saved original coordinate matrices
replace the old assumed G16 zero point; the height transform is checked against
native sector bounds. See [native-terrain-evidence.md](native-terrain-evidence.md).

91 ignored local scenes now pass the source checks and use these rules. Their
200 existing raw height/preview files are unchanged. Nine scenes remain on the
compatibility path because a required source map fails the saved-height check:
`16_21`, `17_21`, `17_22`, `21_20`, `21_21`, `22_20`, `22_21`, `23_24`, `23_25`.
Nineteen missing edge directions stay absent. No substitute heights are made
up. Loading all 91 source surfaces and their complete meshes passed digest,
finite-coordinate, index and winding checks (6,008,144 vertices and 11,824,218
triangles). This is terrain-data coverage, not proof every map is playable.

Five representative real Terrain/Neighbor ground-query checks pass against
rendered triangles; the largest observed difference is 0.01962 L2 units from
Float32 renderer coordinates. At Giran `(78400,163712)`, visible Z is
`-3312.490258` versus grounded Z `-3312.489502`: a gap of `0.000756` L2 units.
Native streaming/loading transitions, lighting, prop collision and all gameplay
routes still require their own proof. Source inputs remain private and intact.

The journal reads 2,050 original records for 342 quests, including decoded
native stage-history and completion rules. The configured server's “Letters
of Love” journey has since completed through ordinary interactions; its reward
survived reconnect and appeared in the browser inventory. No quest-state
database edits or teleports were used. The
[quest playtest](quest-completion-playtest.md) separates protocol observations
from browser checks; it does not establish official server rewards or a
complete beginner loop.

Later work now includes source-bound face selection shared by creation and
the game renderer, native appearance/corpse packet fields, original recipe
windows, independent shortcut drawers and ordinary Dwarf progression to level3.
A nondefault female Human Fighter face survived creation, entry and fresh-page
reconnect. Auto-learn stays enabled while manual trainers remain supported
work. The [coverage inventory](PORT-COVERAGE.md) is the current system-by-system
record; hair, full native gauges/effects, complete camera collision and many
gameplay journeys remain unfinished.

The next appearance checkpoint now exports all 162 referenced source hair meshes
without changing their weights, plus648 exact material references. Creation
uses the original five male/seven female styles, four colors and three faces;
unsupported hair previews are labeled and the old RGB tint is removed. The
source/built comparison found differing skin influences in all 22 default hair
parts. That is a reason to recover native master-instance attachment, not proof
that changing texture alone finishes hair fidelity. Original material pass
state and raw geometry can be inspected independently while attachment remains
open. See [hair-asset-pipeline.md](hair-asset-pipeline.md).

Source extraction now runs independently of existing converted characters.
The character builder selects default hair and its exact texture graph from
decoded source records, with explicit absent parts and no guessed sibling
images. A fresh native census separates 148 ordinary and 14 dynamic hair meshes
and checks retained coordinate arithmetic. A separately pinned archive copy
also identifies four previously unknown imports in exactly matched surrounding
blocks. Its provenance and the protected copy's runtime restoration remain
unverified; this evidence guides the next transform comparison rather than
claiming finished attachment. See
[native-hair-attachment-evidence.md](native-hair-attachment-evidence.md).

Gremlin IDs 18342/20001 and Fox 20091 admitted on verified Talking Island tile
`17_25` now have a bounded initial Wait/AtkWait implementation using original
selectors, sparse keys, the
original channel clock and Sound-notify random gating. It starts when matching
private resources are ready and retires on unsupported movement/action/state
changes, without re-admitting the same entity. The shared RNG's browser
seed/lifetime, resource-ready scheduling,
unreconstructed native lazy-loader history, world placement, lighting and full
GPU bind/deformation fidelity remain explicit limits. The manual NPC inspector
still uses its separate timeline without event dispatch. See
[native NPC evidence](native-npc-animation-evidence.md); this
initial-loop browser check passed for real starter Gremlins, including event
dispatch, movement retirement and reconnect. See the
[live check and loading-order limitation](original-npc-animation-runtime.md#live-world-check).

Offline review is available at
`/?dev=1&inspect=1&checkpoint=giran-border`. The **Previous terrain repairs**
toggle compares implementations, not an original-client reference. The same
panel offers `giran-plaza` and `giran-statue` measured checkpoints.

## Ordered milestones and acceptance

The immediate priority is to turn the recovered components into verified player
behavior. The latest Online baseline reached the Newbie Helper, defeated a
Gremlin, advanced to level 2 and retained progress after reconnect. The gemstone
objective remains incomplete, and attempted body clicks exposed targeting and
placement as investigation priorities. Connect current actor fields, concrete
primitive methods and level queries before changing camera or walking behavior.
The recovered [trace filters](native-actor-trace-evidence.md) are one part of
that join; their explicit inputs do not establish live placement. Verify those
joins on representative real routes, alongside player/mob movement, attack and death
transitions. Continue through the complete beginner journey and operational
gates below. A decoder or synthetic comparison is evidence for a component,
not a replacement for that live acceptance pass.

Full-port scheduling remains uncertain while native behavior and major systems
are unresolved. Track integrated, reproducible journeys and remaining blockers
instead of deriving a completion percentage or launch date from test counts.

| Milestone | Work | Evidence required to finish |
| --- | --- | --- |
| 1. Trustworthy world | Extend verified source terrain; prove native seams and diagonals; verify BSP/props and floor selection. | Source/render/server comparisons on town pavement, slope, stairs, bridge/underpass, dungeon and tile boundary. No route crosses a wall or changes floors without a connecting route. |
| 2. Beginner journey | Complete browser entry and account recovery, character creation/selection, movement, combat, quest, loot, equipment, shop, death/respawn and reconnect. | A fresh player completes the journey without developer controls; two browsers see consistent state; saved progress survives reconnect and server restart. |
| 3. Playtest package | Reproducible private-input build, coherent startup, invitation/admission controls, bounded connections/messages, session cleanup, logs without credentials and restore procedure. | Fresh-machine build/start; exercised backup/restore; disconnect/retry and modest concurrent-player soak; asset/error/performance measurements on target browsers. |
| 4. Small invited server | Publish the supported region/features and known limitations; deploy the tested build and collect repeatable bug reports. | All prior gates pass. Choose player limit from measured capacity, not the server's configured maximum. |
| 5. Full Interlude coverage | Work through remaining regions, character/equipment/animation fidelity, skills/effects/audio, quests, crafting/enchanting, pets/summons, party/clan/alliance, trade/economy, fishing, transport, sieges and other original systems. | Each original player feature has an explicit supported/partial/unknown status and source-backed acceptance evidence; omissions are not hidden by a passing beginner route. |

## Source inputs

Record client edition/revision, origin, package hashes, converter revision and
runtime output hashes. Keep the current inputs intact. Compare a candidate
replacement in a separate location against known maps before adopting it.
Do not mix editions or geodata formats because an archive is newer. Existing
geodata integrity checks passed; demonstrated interpretation bugs come first.

Keep raw clients, generated world assets, database backups, private server
trees and local test captures out of public commits. The reviewed current-tree
cleanup preserves local generated files while removing them from source
distribution; it does not erase older public history. See the
[release boundary](public-release-boundary.md). Publish meaningful progress and
separate source-only Elbera Tools downloads with bounded evidence and actual
screenshots, without presenting a partial checkpoint as a finished client.
Never bulk-stage the workspace or publish a private input to make a build pass.

## Focused checks

Run from the repository root. Numerical/source checks do not need a running game:

```sh
node --test editor/world/test/*.test.mjs
node tools/world/test_surface_integration.mjs
node --test gateway/test/login-lifecycle.test.js
node --test gateway/test/tutorial-routing.test.js
node tools/world/test_world_loading.mjs
node tools/test_battery.js
python3 -m unittest discover -s tools/world -p 'test_terrain_topology.py'
python3 -m unittest discover -s tools/world -p 'test_terrain_edges.py'
python3 -m unittest discover -s tools/dat -p 'test_export_quests.py'
bash tools/battery.sh --list
```

The geometry integration check requires Node 22.15+ and the existing Three.js dependency in
`tools/src/char_pipeline`. Source-map tests report skips without private inputs.
These checks are a focused foundation gate, not the full game acceptance suite.
Browser checks must additionally use **Online**, enter the actual world,
move, disconnect and reconnect. Inspect rendered screenshots and console errors.

Detailed local audit/repro artifacts are ignored under `tmp/restart-audit/`.
Implementation and verification notes continue in root `progress.md`.
