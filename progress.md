Original prompt: Sounds good do you want to make a branch and work there reusing only what we need and truly porting lineage 2 to the web so I can launch a small test server at some point

# Browser port restart

## Original level collector and BSP regions — 27 September 2026

The ordinary level collector now preserves BSP/attached-level/terrain/actor
phase order with explicit source callbacks. It distinguishes the caller's
Model from the current Model used for terrain region admission, retains all
64 resolved zone slots including repeats, and preserves scratch fields left
behind by misses or rejected terrain regions. Actor copying stops at 64 while
later providers still run. World scratch overflow is unsupported instead of
silently dropping participants. Source sorting and shortening are reused.

The new PointRegion module follows the original BSP front/back selection,
Float32 plane-distance store, final leaf/zone writes and null-zone fallback.
Serialized operands are bound to the original Model/node/zone serializers.
A nonempty tree with zero saved zones still requires explicit runtime slot
zero; a missing slot never becomes an invented null default.

Elbera Tools compares 260 authored collector scenes with retained instructions:
743 results, 941 callback invocations and 671 collector instruction addresses,
plus sparse scratch and capacity checks. PointRegion adds 312 original-method
comparisons and 32 fresh saved-map probes from Talking Island/Giran. Those map
probes use explicit diagnostic actor tokens, not observed live identities.
The optional pinned comparison names the attached-level gate GIsL2Seamless;
its live value remains required source state. The source boundary, callback
limits and reproducible commands are documented in the
[collector](docs/native-level-query-evidence.md) and
[region](docs/native-bsp-region-evidence.md) guides.

Terrain now exposes whether it reached the original result-writing stage.
Early outer misses leave the result untouched; later misses clear Actor only.
The verifier records actual instruction writes against sentinel fields. This
closes a primitive adapter distinction without fabricating Item/node values.
All 109 combined portable collision tests pass; the terrain differential
distinguishes 61 hits, seven untouched misses and 32 Actor-clear-only misses.

Live provider population, zone/terrain lifecycle, static/transformed primitives
and MoveActor/floor/step/ledge response still need integration. Existing
gameplay queries have not been replaced by partial collision coverage. The
full official browser-client goal remains active and incomplete.

## Original terrain, actor cylinders and level result operations — 27 September 2026

Three more collision components are now implemented against original Interlude
inputs. Terrain follows the source cell traversal, triangle order, one-sided
tests, unnormalized edge planes and hit backoff. Actor cylinders preserve
unequal extent behavior, inside/touching distinctions and each caller's result
record. The actor-hash result factory reproduces its original zero constructor;
it is separate from the level collector's material-only scratch slots.

Level operations now use the retained Core sort, including its nonstable tie
order, instead of assuming a stable browser sort. BSP and terrain retain their
different endpoint-shortening allowances and Float32 stores. SingleLineCheck
filtering preserves the attached-level loop and raw source flags; missing
node/surface/actor inputs remain explicit unsupported states.

Elbera Tools provides reproducible original-instruction checks for the actual
browser modules. Terrain validation covers 100 cases / 61 hits and 2,165
retained instruction addresses. Fresh original inputs from Talking Island and
Giran supply 65,536 vertices and 1,536 bound values each; 24 diagnostic sweeps
produce 20 hits. Their explicit no-owner, not-deleted, present-map state is a
diagnostic assumption, not an observed live actor. Cylinder validation covers
2,277 cases / 1,138 hits plus the source result factory. Level validation covers
138 sort cases / 23,973 source comparisons, 396 shortening cases and 500
single-filter cases. The combined portable suites pass 81 browser-module tests
and 28 Python checks, including 12 terrain-exporter cases. These are
authored inputs evaluated against retained instructions, not an original
running-client capture or a claim of complete world collision. Original input
fingerprints, supplemental binding limits and reproduction commands are in the
[terrain](docs/native-terrain-collision-evidence.md),
[cylinder](docs/native-cylinder-collision-evidence.md) and
[level](docs/native-level-collision-evidence.md) evidence documents.

The source-only GitHub boundary and existing README gallery are preserved.
Gameplay movement/camera have not been switched to an incomplete query. Next:
join actual world/zone/actor participants, PointRegion terrain admission and
static primitives, then the original MoveActor/floor/step/ledge response. The
full browser-client goal remains active and incomplete.

## Original BSP extent sweep and inspector — 27 September 2026

The no-owner world UModel component now composes original hull orientation,
saved planes, bounds, pair/axis bevel construction, interval adoption, segment
length and final hit adjustment. Repeated hull order and early rejection are
preserved. The native wrapper decision is separate from the retained hit
record. Unsupported data/arithmetic remains unknown; no terrain or actor
result, native walking response or camera adoption is claimed.

The BSP exporter now follows the actual serialized Level.Model reference,
replacing its unique-zoned-model heuristic. Fresh Talking Island and Giran
checks select the same models and retain every previously staged geometry
field. Original serializer and runtime receiver share Level+0xc0; later
runtime reassignment is not observed. Native checks distinguish retained owned
instructions from explicitly pinned supplemental import correspondence.

Elbera Tools now has an offline BSP inspector using that same module. Its
portable box fixture contains no original game assets; local source exports
stay in the browser. Inputs, bounds, query projection, adjusted hit and unknown
states are visible. Normal browser controls verified blocked/clear/invalid
queries, local original loading, changed-input invalidation and a narrow layout.
A Talking Island diagnostic query matches the independently interpreted source
result, including signed-zero normal components. The curated README screenshot
uses only the synthetic fixture, and all previous gallery images are preserved.

Validation so far: 43 portable runtime cases, 11 exporter cases, 64 source bevel
sets/441 exact-bit planes, 90 composed synthetic queries and 49 original-map
probes across 17_25/22_22. The original-map probes yielded 37 hits / 948 plane clips;
these authored probes are not an original running-client capture or a full-map
playability claim. Float64/x87 and mathematical square-root limits remain
explicit. Peer review corrected sparse-array admission and the screenshot file
extension. The source-only BSP Inspector kit passes eight packaging tests and all 43
portable runtime tests after isolated extraction; ten source-free verifier
tests also pass. Public CI includes these checks. Final publication review
remains separate from source arithmetic evidence.

Next: complete terrain/actor/adjacent-level query aggregation and the original
MoveActor/floor/step response before replacing gameplay collision or enabling
native walking-to-Wait transitions. The full browser-client goal stays active.

## Remote stopping and original movement inputs — 27 September 2026

Remote NPCs and players now discard an obsolete browser movement route when
StopMove arrives. Position and facing are preserved: the original handler
ignores packet heading and runs guarded position correction before clearing
its queue. Null browser target does not establish native zero velocity or a
Wait transition. Converted movement animation can remain after the route
stops; exact physics/collision and return-to-Wait are still unfinished.

The gateway preserves ChangeMoveType’s previously discarded signed Environment
input, including repeated modes. Source evidence distinguishes this received
value from the effective Pawn field, which the native handler only updates
when the mode changes. Closed/replaced sessions cannot publish these movement
changes or stops, including obsolete self-position updates.

Elbera Tools extends the existing grounding verifier with StopMove dispatch,
complete handler stack-read verification and an optional pinned comparison
for erased Size/Empty/GetStateFrame calls. Portable mutation tests need only
the Python standard library; original-input checks remain separate. The owned
Core Size result has a Float32 return store, not an assumed Math.hypot result.
No original code, client binaries, generated assets or receipts are published.

Verification: 12 standard-library grounding mutation cases and both native
verification modes passed (94 grounding, 41 StopMove and 44 ChangeMoveType
anchors; complete 32-instruction stop-handler read audit). The optional
comparison matched four finite blocks and five owned Core return-store anchors.
220 combined gateway/handler/entity/source-wait/entry/scene cases
passed. The 40-case handler/entity subset reproduces four failures with the old
handler, then passes with the fix. Normal browser Online entry through the
updated local gateway loaded Talking Island and advancing original starter
Gremlin waits; no new browser errors. This is an entry/rendering smoke check,
not a captured remote StopMove proof or full native movement certification.
The existing README gallery remains intact; the new entry capture stays local.

Next: use the original controller polling, Role/Physics initialization,
per-tick acceleration/velocity, collision result and yaw predicates to preserve
source animation through ordinary movement and return-to-wait. The full
browser-port goal remains active and incomplete.

## Normal Online entry joins NPC source resources — 27 September 2026

The initial NPC source loop no longer permanently captures the previous offline
map. Real entities continue processing packets while the first current entry
waits for its model and matching adopted center scene. The same readiness path
supports a preloaded map and NPCs received before UserInfo; repeated readiness
does not restart an active clock. Unsupported intervening actions, stale scene
loads, replacement entries and disconnects cannot revive initial playback.
Center adoption does not wait for surrounding maps or the self model.

Actual browser verification started on default scene 16_21 and entered Online
as the existing test character without manually selecting Talking Island.
Starter Gremlins advanced original Wait frames and Sound decisions after the
automatic map load. Movement retirement, disconnect cleanup, same-page reconnect
and manual inspector play/pause/restore passed; no new browser errors appeared.
The existing curated screenshot remains representative. Native loading/tick
history, movement transitions, placement and full rendering remain unported.

The prior live NPC milestone is published through PR #15 at public merge
0ee4407. Its public checks exposed an inherited test import of a local dependency;
the test now uses the checked-in browser Three.js and both final checks passed.
The private local main/history and immutable standalone releases remain untouched.

Verification: 95 focused entity, source-adapter, entry and scene-loader cases
passed with no skips. The broader CI lifecycle group also passed all 115 cases
(overlapping suites, not an additional total). The stale retry regression first
reproduced the defect, then passed with the entry-identity guard. Browser resource
tests do not certify native movement predicates or loading history.

## Live original NPC waiting milestone — 27 September 2026

On `codex/native-npc-event-playback`, the normal entity loader now drives a
bounded initial Wait/AtkWait for independently verified NPC IDs 18342, 20001
and 20091. Both the displayed terrain and received NPC coordinates must be on
the audited source tile 17_25. Complete raw packet/state/source inputs are
required; unsupported state changes retire the source loop without re-admitting
that actor. Movement, combat, damage, skill, social, death, respawn, later NPC
snapshots and removal all invalidate pending source audio/pose ownership.

Original sparse keys use the existing native clock and hierarchy evaluator.
Player and NPC Sound notifies share the recovered integer generator and signed
gate; every dispatched base Sound consumes a draw, including Random0/100 and
muted/unavailable audio. Browser entropy, context lifetime, resource-ready
scheduling and unported random consumers remain explicit platform limits.
Native movement transitions, world placement, lighting and full skinning are
still incomplete. The full browser-port goal remains active.

Elbera Tools now exposes live NPC frames, event counts, sound-gate outcomes and
retirement reasons in the existing World inspection panel. Real online starter
Gremlins demonstrated advancing Wait frames, admitted/filtered sound events and
individual movement retirement; fresh-page reconnect repeated the result.
Manual 18342 play/pause/restore still works. No new browser errors; existing
unhandled PlaySound packet warnings remain. The curated live screenshot is
`docs/img/elbera-tools-live-npc-events.jpg`; all earlier README images remain.

Verification: 162 focused Node tests, 106 gateway portable tests, 20 NPC native
tool fixtures and nine sound verifier fixtures passed. Original-input checks
also passed, including the browser-module RNG differential and independently
framed 6,519-row NPC table. The standalone NPC Source candidate passes 103
checks across its same 43 text files; the published 0.1.0 archive is unchanged.
Private regeneration added 18342 to the selected index while both NPC bundles
and all fourteen player bundles remained byte-identical.

Next: preserve original playback through movement and return-to-wait, resolve
world-entry/resource scheduling without invented catch-up, then extend the
verified class/transition domain. Initial waiting is a milestone, not full NPC
animation, a completed test server or completion of the browser client.

Goal: a faithful browser-playable Lineage 2 Interlude port, with no installed player client, progressing toward a small test server.

Binding goal constraint (owner, 26 September 2026): always stay true to OFFICIAL
game data; never invent values. Decode, decrypt and investigate original inputs
as needed. Unknown data remains explicitly unknown. See root AGENTS.md.

Public foundations began at `9f4903b`. The live-animation checkpoint starts from
merged PR #8 (`3c0f261`) on `codex/native-animation-transitions`. The preserved local research branch
`codex/web-port-foundations` contains private intermediate history and must not
be merged or pushed into public ancestry.

## Working rules

- Keep the authoritative aCis server, protocol gateway, browser renderer and useful offline converters.
- Fix demonstrated defects in small changes; compare independent source/server evidence, not just old baselines.
- Preserve private client files, generated assets, database state and local audit artifacts. Do not push them or bulk-add the working tree.
- The original audit and repros are in ignored `tmp/restart-audit/`. Public documentation must summarize conclusions without bundling private assets/state.
- Source geometry, rendered geometry, walking queries and server navigation need a consistent coordinate/surface contract.

## First batch in progress — 26 September 2026

1. Fix floor-aware navigation against the independently reproduced Aden case.
2. Repair test-runner argument handling and inventory so failures remain failures.
3. Verify terrain bitmap indexing/triangle conventions before preserving visibility and triangulation in conversion.
4. Make terrain queries agree with drawn triangles and tile edges; inspect the result in the browser.

## Release gates ahead

- Representative outdoor/town/stair/bridge/dungeon/border routes agree with source geometry and server movement.
- Complete player journey: create, travel, fight/quest, loot/equip, shop, respawn, reconnect and recover.
- Feature/region support matrix states partial and unsupported areas explicitly.
- Restore/build/start from documented private inputs; backup/restore verified; deliberate public repository inventory and test-server admission/session controls.

## Verification baseline

- Prior audit: Online create/move/logout/rejoin passed with a separate `PortAudit` character; source library 27 tests passed.
- Known failures: battery inventory, multi-flag false-green runner defect, top-layer-only navigation permissions, terrain topology discarded, terrain mesh/query disagreement.
- Do not interpret historical README suite totals as the current release state.

## Completed first checkpoint — 26 September 2026

- Floor-aware navigation: server nearest-layer tie, strict step ceiling, integer crossed-cell wall checks, floor-bearing A* states and smoothing. Review found and fixed invalid actual-start/goal connections; tests cover enclosed starts and necessary final turns.
- Shared triangle sampling/index layout for terrain; final stretched interval sampled at its physical width. Neighbor queries read actual decimated/stitched mesh heights. The stretch is still a compatibility workaround.
- Lossless terrain topology exporter, provenance hashes and topology-only updater. At this first checkpoint, conventions were unverified and runtime use was disabled; the next checkpoint below supersedes that limitation. Only three ignored local scenes received sidecars; source height files stayed unchanged.
- Login lifecycle guards prevent overlapping authentication and orphaned delayed game sessions after disconnect.
- Battery now passes literal argument arrays, rejects bundled flags, registers missing suites and includes the new numerical/session regressions.
- README now describes the prototype honestly; docs/WEB-PORT-PLAN.md records milestone acceptance criteria.

Verification:
- 26 Node navigation/surface/session tests passed; 7 real-mesh integration checks passed; 6 converter tests passed, including private source round-trips. No skips in this local run.
- Actual battery subset: 5 suites passed, zero failed, no retries. Full inventory: 132 suites, zero unclassified. Full historical battery was NOT run.
- Browser workflow uses the installed CUA Playwright interface and screenshots, per the computer-use restriction; the skill's standalone browser driver was not used. No fake time stepping of the authoritative online server.
- Online entry and reload/reconnect succeeded as the preexisting separate audit character PortAudit. Short floor movement persisted after disconnect. No new console errors observed; existing unhandled tutorialQuestionMark/tutorialEvent warnings remain.
- Game services were started directly with detached processes for local verification. PID files and logs are ignored in tmp/restart-audit; world/gateway bind loopback. No public push or deployment.

## Visible world checkpoint — 26 September 2026

- Visibility indexing/polarity now agree with the independently serialized native `TerrainSector` quad table: 6,502,500 ordinary quads across all 100 converted maps match their current masks. Map `22_19` differs from its `Orig` mask at 430 quads; its exceptional case remains gated and unverified.
- Three ignored local scenes (`17_25`, `22_22`, `24_18`) use verified visibility and adjacent source-map edge samples. Original heights and positions stay immutable; these scenes no longer apply the old final-interval stretch or height repairs. Other scenes retain compatibility behavior.
- Giran `(78400,163712)` improved from a 232.393 L2-unit disagreement to rendered Z `-3312.78704`, grounded Z `-3312.78624`, gap `0.000802`. This proves local render/grounding agreement, not full native world fidelity.
- Native seamless-terrain reconstruction and triangle diagonals remain unverified. Adjacent edge samples have source evidence; the native seam algorithm does not yet.
- Offline review URL: `/?dev=1&inspect=1&checkpoint=giran-border`. Presets also include `giran-plaza` and `giran-statue`; **Previous terrain repairs** compares implementations, not an original-client reference. No public push.
- Source gates bind the actual decoded height bytes, visibility words and adjacent edge values to recorded SHA-256 digests; mismatched tiles, coordinates, incomplete proofs and altered samples fail explicitly. Small source sidecars revalidate instead of relying on a cached version.

Verification for this checkpoint:
- 42 Node navigation/surface/session tests, 10 real-mesh integration tests and 17 Python source/export tests passed: 69 total, no skips. The runner's independent argument/failure checks and 132-suite inventory also pass; the full historical battery was not run.
- Browser screenshots verified Giran border, plaza and prop checkpoints. The old prop repair raised one source vertex by 1422 L2 units and buried the character; source mode preserves the original terrain and grounds on the extracted prop at Z -2289. Plaza walking/drawn Z both remain -3496.
- Actual Online entry, floor movement, disconnect and reconnect passed on Talking Island. The server saved PortAudit at (-71502,258398,-3104); reconnect restored the same XY, with rendered/grounded feet both Z -3142. Server navigation Z and visual floor Z are deliberately reported separately.
- Repeated in-place inspection swaps stalled during asset loading; comparison controls now navigate to reproducible URLs and release the previous document. Large scene transitions are still slow and need profiling before playtest. Added visible loading stages. Source checks rejected an older edge payload during regeneration; the final matching build loaded and reconnected without new console errors. Existing unhandled tutorial event warnings remain.
- Local screenshots and detailed audit evidence are ignored under tmp/restart-audit. Preview: `http://127.0.0.1:8083/?dev=1&inspect=1&checkpoint=giran-statue`. Everything remains local on codex/web-port-foundations; nothing pushed.

## Next work / limits

1. Prove native seam reconstruction and triangle diagonals, and resolve the `22_19` current/`Orig` exception from original data. Do not promote a comparison with another port into source evidence.
2. Extend the three-scene source path only after representative town, slope, stair, bridge/underpass, dungeon and border checks. The remaining compatibility scenes and legacy height repairs are not certified.
3. Establish the Talking Island beginner-loop acceptance route, with multiplayer/recovery checks and supported-region matrix, then close the deployment/admission/backup gates in docs/WEB-PORT-PLAN.md.
4. Legacy verify_pathfinding remains a diagnostic browser script with historical harness assumptions; the new offline tests are the actual navigation regression gate. The battery still has old broad process-name cleanup on timeout/mock shutdown; avoid full runs until that cleanup is scoped to owned processes.


## Full-port goal continues — 26 September 2026

The owner rejected completion of the partial checkpoint and reaffirmed the full
Lineage 2 browser port. The active goal remains unfinished. A demo, terrain
repair, beginner loop or invited server is a milestone, never the whole goal.
`docs/PORT-COVERAGE.md` inventories inspected missing and partial systems.

Current implementation batch (verification still in progress):

- Original Engine.dll can be statically decoded in memory. Its native functions
  prove terrain diagonals, outer visibility and adjacent edge-copy directions;
  saved coordinate matrices/native corner bounds are now under validation.
- Original tutorial windows are separate from NPC HTML. Question IDs and link
  targets are preserved. The native event mask reports enabled actions once,
  with ground/camera/zoom inputs traced to actual original command branches.
- Original questname-e.dat fully decoded: 2,050 records/342 quests, strict byte
  boundaries, source hashes and exact raw coordinate bits for anomalous rows.
  Native serializer independently confirms layout. NWindow proves count-vs-mask
  progress, sparse stage history and completion predicates. Browser journal
  now renders source descriptions and item requirements with inventory counts.
- Prop loading is bounded to four concurrent templates; obsolete neighbor and
  scene loads are discarded; partial loads and instanced buffers are disposed.
- Asset manifests now refresh rather than hiding new decoded data for an hour.

Confirmed so far: 68 Node tests passed, six quest-decoder tests passed including
private original-file roundtrip, native tutorial/quest binary verifier passed.
Browser replay shows original quest titles/history/descriptions/icons without
console errors. It is explicitly simulated progress, not a live quest claim.
Online PortAudit question mark opened original tutorial HTML; its TE012 exit
link caused the live server to close only the tutorial viewer. No errors seen.
Viewport clamp fixed an original saved position that was offscreen at 789px.
Live beginner quest/combat/reward and native-height rollout are still underway.
Everything remains local; no push/deployment.


## Native fidelity and Elbera Tools checkpoint — 26 September 2026

The full browser-client goal is ACTIVE. The owner explicitly includes all
skills, effects, mobs, progression and every original menu/dialog. Pixel and
interaction parity are acceptance criteria; no demo or subsystem ends the goal.
Reusable decoding/testing work is now maintained as **Elbera Tools** for a
future community offering, with originals/generated assets kept private.

Completed and verified in this batch:

- Native terrain diagonals, runtime outer visibility, saved FCoords height
  transform and adjacent source edges proved from original binaries. Enabled
  source data on91 local scenes;9 scenes remain excluded and19 unavailable
  edge directions remain absent. All200 source height files/PNGs stayed
  byte-identical. All91 actual source meshes passed finite/upward/index gates;
  counts and source closure are recorded in docs/native-terrain-evidence.md.
- Removed collision-height visual fitting. Original class DrawScale/DrawScale3D
  and mesh MeshScale cover6519 NPC records/495 built transforms. Exact declared
  field gating rejects false default streams; ambiguous visual consensus stays
  documented. Root centering/floor adjustment still needs native fidelity.
- Original targeting cylinders replace40px click fallback. Source picking
  rules have a native verifier; full native floor adjustment/trace flags do not.
- Original class-specific animation supplements recover5 exact clips for10
  NPC records sharing4 meshes. Final glTF/buffer hashes are checked before the
  actual verified bytes enter the loader. Original geometry/earlier clip bytes
  survive unchanged and rebuilding is deterministic.
- Original tutorial event masks/input reporting and separate tutorial viewer
  are wired. Original journal has2050 decoded records/342 quests with native
  progress/history/completion rules and inventory-fed requirements.
- Original DialogBox Warning/Notice replaces browser confirmation. Quest abort
  rechecks selection/session before and after confirmation; reset cancels it.
  No-selection shows the original Notice1201 instead of an invented disabled
  state. The Abort label is sourced from native Button ID385.
- Retired sockets and stale scene/model loads cannot adopt after reconnect.
  Failed replacement keeps the visible model/map. Prop template loads overlap
  within a bound; obsolete neighbor and candidate resources are disposed.
- Malformed zero/one/two-byte frame lengths reject once instead of looping;
  login/game lifecycle tests cover closure and cleared timers. Device secrets
  no longer appear in new gateway login logs.
- Shared original UI decoder recovers1962 position records, including176
  formerly null pairs and132 named targets. All352 Button records decode,
  including229 original labels. Shared runtime layout migration remains pending.

Verification at this checkpoint:

- 146 Node tests passed across terrain/navigation, real mesh integration,
  loading/session races, tutorial/journal/dialogs, actor scale/picking/variants
  and gateway packet/lifecycle checks. Zero skips/failures.
- 53 Python tests passed:12 DAT,20 terrain,6 NPC animation,11 shared UI record,
  4 dialog decoder. Native actor/picking/tutorial/quest/layout verifiers and
  generated NPC/quest/dialog comparison checks pass. Layout proof now checks
  88 instructions. Battery argument/exit checks and suite inventory pass.
- CUA browser tests: Online existing PortAudit entry and reconnect; current
  Talking Island NPC models load without console errors; live Q1 stage2 journal
  displays original prose/history; source Warning Cancel and no-selection
  Notice Confirm work without abandoning the quest. Replay Confirm remains
  explicitly disconnected from the server.
- Live protocol journey accepted Q1 at Darin, delivered letter687 to Roxxy,
  received kerchief688 and reached stage2. One final route waypoint stalled;
  ordinary NPC action completed approach. This is not full navigation proof.
  Earlier live combat yielded5 hits, Gremlin death, XP145/SP10/level2. Final
  quest return/reward and the complete beginner progression loop remain open.
- Elbera Tools NPC inspector uses the actual EntityManager. Visually verified
  Orc/Dwarf/Angel corpse poses and Ritual Offering source idle/social. Angel
  wing planes show an existing material alpha error, explicitly still open.
- Screenshots, protocol logs, source migration receipts, original files,
  generated tables/models and database backups remain ignored/local. No push
  or deployment. Full historical battery not run (old broad cleanup/harness
  assumptions are still unsafe for an indiscriminate full run).

Next active work: exact native skill-letter motion selection; original Shader
material variants; original skill trainer request/list/info/learn workflow;
shared UI anchor/runtime migration. Remaining full-game gaps are maintained in
`docs/PORT-COVERAGE.md`; browser inspections are indexed in `tools/README.md`.


Elbera Tools source-boundary correction: `extract_uscript.sources()` used to
search from each TextBuffer's start to the end of the entire package. Four
nonclass NWindow buffers therefore borrowed later classes. Bounded export
reads now return87 unique NWindow classes (Interface remains142), reject
missing terminators/out-of-file exports/duplicate class names, and preserve
all existing unique recovered text byte-for-byte under the existing Latin-1
representation. Six portable synthetic tests and original read-only --check
pass. This is a boundary correction, not a full TextBuffer serializer claim.

## Original trainers, skill data and recovered pawn clips — 26 September 2026

The full-port goal remains ACTIVE. The owner permits original/official visual
references from the web when useful and reaffirmed that server auto-learn is
normal for the intended experience. Trainer completeness does not require
manual learning for every skill. Both local source and built server configs
already contain AutoLearnSkills=True; no configuration or gameplay values
were changed for this checkpoint.

Completed:

- Recovered native window-specific parents, explicit TextBox autosizing,
  default text and trainer TreeCtrl cursor flow. The trainer consumes the
  original 256×401 total rectangle; old L2Window callers retain their earlier
  height contract pending individual migration. General anchors, inherited
  autosizing, exact font wrapping, frame states and keyboard parity remain open.
- Exact skill-level catalog joins all 29,812 original skill records. Requested
  levels no longer borrow another level's prose, icon or display values.
  Native operate-type labels are source-derived. Nine missing original art
  references remain diagnosed; no replacement art was made.
- Original acquisition list/info/done packets and separate request/learn
  messages reach original trainer controls. Costs, requirements, ordering,
  normal/fishing/clan modes and server updates remain authoritative. Enchant
  is a separate unimplemented protocol, not silently routed through learning.
- Original signed clan reputation reaches trainer resource display. Invalid
  clan counts/trailing bytes reject before replacing state. Trainer requests
  and clan snapshots clear on disconnect/reconnect, including pending details.
- Native skill animation selection covers all 32 selector codes. Removed
  guessed VFX bindings and the authored radial flash. The full native phase,
  rate and interruption scheduler is still missing; only the first selected
  phase currently plays, with provisional duration scaling.
- All 14 player models received exact castEnd, magicShot, magicNoTarget and
  picItem clips previously omitted by the exporter. Verified 115,215 raw keys
  and 9,112 channels against original full skeletons; preserved 36,589,280
  existing binary bytes and all earlier geometry/animation records. Fresh
  metadata, structural, before/after and idempotence checks pass for all 14.
  The source PSA drops parent indices, so original UKX RefBones and complete
  PSK skeletons provide the independent parent evidence. No scheduler was
  inferred from the presence or name of these clips.
- Seven ghosts now use verified original slot textures and Brighten blending.
  Both angel corpses use original wing opacity and strict alpha >160/255,
  blend/depth/cull rules. Black wing triangles are gone; environment specular,
  lighting/color conversion and unsupported material graphs remain unresolved.
- A separate original-source player transform audit disproved the suspected
  gross base-player scale problem. Existing height fitting differs from source
  scale by at most 0.115%; origin/centering/grounding need a complete native
  placement trace. Reusable audit code is preserved under tools/dat.
- Unversioned model/buffer development caching could hide the newly recovered
  clips. The local server now serves these mutable resources without storage,
  and Character's loader revalidates dependent requests. The browser now sees
  the appended clips. An animation file handle leak exposed by tests is closed.

Verification:

- 162 Node tests passed across the current editor/world test files plus
  trainer/clan gateway tests; zero failures or skips. This includes exact
  skill text, material binding, selector/VFX gates, trainer flow/layout,
  navigation and session regression coverage.
- Eight adversarial pawn-recovery Python tests pass. Current legacy offline
  cast checks report 53/0, phase checks 40/0, and 14/14 recovered availability
  for each of the four clips. Battery argument/exit tests and inventory pass;
  the historical full battery was not run because broad cleanup and legacy
  browser harness assumptions remain unresolved.
- Earlier checks in this same batch passed: 16 shared UI decoder tests,
  native layout 119 instructions, trainer tree flow 22 instructions,
  skill-text 8 Python tests and full original rederivation, material 4 Python
  tests and 86 native checks, and native clan field verification. These
  numerical/source checks do not certify complete visual parity.
- CUA browser: actual Human Fighter recovered casting/pickup slots load and
  scrub; female Dwarf's recovered MagicShot loads through Character. All 14
  have data/structural checks, not a claimed exhaustive visual review.
- Live Online browser: selected Klufe, opened the returned fishing-learning
  link, received four server skills and selected Fishing level 1. Original
  description/MP1 and server SP0/Adena1000 requirement rendered. Learn returned
  insufficient-Adena/prerequisite messages and the server refreshed the list.
  Details→List→details still worked. No warnings/errors seen. This is refusal
  coverage, not successful learning. The approach to Klufe used ordinary
  server movement via the private protocol journey; no teleport or DB edit.
- Local screenshot: tmp/restart-audit/trainer-live-fishing.png. Original
  frames measure 256×401. Inspector stages use explicitly non-game lighting.

Elbera Tools now has an index at /test/index.html with journal/dialog replay,
NPC animations/materials, original pawn slot playback/scrubbing and captured
trainer replay. Source code and evidence descriptions are separate from
private original inputs, generated outputs and playtest receipts.

Current local services: world 49365 (8083), gateway 49367 (8090); login/game
and MariaDB were not restarted. The existing audit character remains level 2,
near Klufe in Talking Island, with Q1 stage 2. No successful skill purchase,
quest reward, account creation, database edit, public push or deployment was
performed in this batch. Generated character manifest.json and pawnanim.json
are historically tracked but their new data is deliberately unstaged.

Next work remains substantial: native cast phase/rate/interruption scheduling;
live auto-learn level-up and persistence; successful learning and remaining
progression; exact window/frame/keyboard behavior; actor placement and world
route coverage; pets, crafting, fishing gameplay, clan/social/competitive
systems and all other full-client gaps in docs/PORT-COVERAGE.md. Do not mark
the full goal complete for this checkpoint.


## Live auto-learn, session reliability and original casting evidence — 26 September 2026

The full browser-port goal remains ACTIVE. Auto-learn is an existing local
server policy, not a replacement for the original trainer workflows. Both
source and built AutoLearnSkills=True settings were left unchanged.

- Ordinary combat advanced the existing human fighter from level2 to level5.
  Five gateway-driven Elder Keltir fights preceded a Bearded Keltir fight
  selected and started by clicking its model in the actual Online browser.
  The open skill panel immediately received six new skills at the exact
  server levels, including Power Strike/Mortal Blow/Power Shot level3 and
  Relax level1. Browser Relax use produced sitting and the recovery tutorial.
  Reconnect restored all nine skills. See docs/auto-learn-playtest.md.
- SkillList validates its complete 13-byte rows before publication. Runtime
  skill panels and shortcuts use received levels/passive/disabled state.
  Disconnect clears learned skills, cooldowns, casts and shortcut view.
  Shortcuts still use local storage and need original server persistence.
- Original signed MyTargetSelected color is preserved. The original packet
  has an additional field absent from aCis; this remains documented.
- Casting cancellation invalidates asynchronous metadata work. Late metadata
  cannot resurrect a cancelled or replaced actor's cast. Launch packets no
  longer replay the opening animation; original launch handlers associate
  effect actors. The cast bar starts immediately, with an exact-level label
  adopted only while the same cast/session remains current.
- Remote player models now use per-spawn admission identities. Removal,
  clearing, out-of-order loads and object-ID reuse cannot admit an obsolete
  model or delete a newer pending load. Unadmitted base GPU resources are
  disposed without disturbing shared equipment assets.
- SystemMessage preserves wire types and skill ID/level pairs. Original
  network substitution indexes the numbered parameter, including reordered
  and repeated placeholders. Removed the guessed per-message parameter map
  from runtime. Live Relax abort now displays the original skill name rather
  than 226. Native type6 width differs from aCis; native type8 and some other
  name-resolution types remain gaps.
- Elbera Tools now includes a controlled manual playtest CLI. It uses an
  explicitly supplied existing identity/character and private ignored receipt;
  no character creation, GM/SQL changes or combat automation loop. Requests
  cannot queue an attack behind failed movement. Pre-entry world events now
  survive until matching character entry. A fresh connection saw 37 nearby
  NPCs; a 100-unit source-geodata walk reached its observed server origin.
  Power Strike level3 then produced skill cast/launch and MP66->55 against
  an Elder Keltir. Ordinary combat ended at EXP3470/SP80. This protocol test
  does not certify offensive animation or a broad world route.
- Static original casting evidence recovers the ordinary scheduler: exact
  source duration NumFrames/Rate, flexible phases, notify-derived shot time,
  cumulative deadlines and cancellation. The verifier checks 60 instruction
  anchors and 12 arithmetic cases; 10 portable evaluator tests and all32
  selectors pass. Runtime still uses provisional first-phase stretching.
  Agent +0x74 identity, terminal-frame interpolation, type13/NPC paths and
  full notify/effect scheduling require further source investigation.

Validation: 201 combined Node tests passed with no failures/skips across
editor/world tests, focused gateway trainer/clan/skills/messages tests and
playtest controller tests. Native skill-state checks passed; typed system
messages pass 32 native instruction checks. Live browser checked skill grants,
Relax, reconnect and corrected abort text without warnings/errors. Screenshots
and receipts are ignored under tmp/restart-audit. Historical full battery was
not run because its old broad process cleanup and browser harness need repair.

Current services: world PID49365 on loopback8083; gateway PID59966 on
loopback8090. Login/game/MariaDB unchanged. Existing character is level5,
EXP3470/SP80, near Talking Island keltirs, Q1 stage2, sitting after Relax.
Browser is Online with the skill panel visible. No account/character created,
no DB/GM edits, configuration changes, public push or deployment. Generated
character manifest.json and pawnanim.json remain deliberately unstaged.

Next: resolve remaining original scheduler inputs and playback timing before
integrating full phases; replace local shortcuts with verified server packets;
continue remaining UI, movement/world, progression and full-game feature gaps
in docs/PORT-COVERAGE.md. Checkpoints are not completion of the full-port goal.


## Server-persisted hotbar — 26 September 2026

Replaced browser-local bindings with original ShortCutInit/Register/Delete
protocol. Character/class storage belongs to the existing server; no invented
starter layout or migration writes. Native packet forms, ordinary player flag1,
and ten-by-twelve slot indexing have pinned checks. Item augmentation words,
skill flag and server-only delete tail are retained without guessed meanings.
Unsupported macro/recipe/pet records stay data and cannot dispatch as player
skills/items/actions. Received learned levels remain authoritative.

Assignment/removal requests commit only on server events. A bounded ten-second
browser reservation prevents rapid first-free requests colliding and expires
without changing game state. Complete snapshots and disconnect clear it.
No timers or browser identity persistence framework were added. Removed old
localStorage hotbar parsing/migration/writing rather than maintaining two stores.

Live browser restored the existing Attack/PickUp/SitStand/Tutorial item slots.
Registered Relax and Power Strike; F2 used Relax. Removed Power Strike, then
fresh page/reconnect restored Relax and retained that removal. Restored Power
Strike afterward. Temporary duplicate Tutorial Guide assignment/removal also
passed; no item consumed/destroyed. Native item/skill ownership value1 verified.
No browser warnings/errors. Screenshot tmp/restart-audit/shortcuts-live.png.
Inventory opened partly off-screen at narrow viewport; dragged into view for
this test. This default placement remains a UI gap, not certified parity.

Checks: eight new gateway packet/bridge tests, five new browser state tests,
existing five skill-state tests and eight online-session tests pass; native
shortcut verifier passes38 pinned checks. Agent's combined gateway run49/49.
Source-format differences and register-before-server-integrity/DB-write caveat
are documented in docs/native-shortcut-evidence.md; reconnect is the actual
persistence check. Gateway now PID62841, world unchanged49365. Browser Online,
existing level5 fighter, skill window open; F1 Attack/F2 Relax/F3 Power Strike,
F4 Pick Up/F11 SitStand/F12 Tutorial. No push/deploy or DB/GM manipulation.

Native casting work continues independently: exact skill_visual_effect object
paths were found in original skillgrp data, disproving by-skill-ID bindings;
Agent+0x74 is FlyingTime. Source animation loop endpoints/interpolation are
being traced before claiming phase playback fidelity. Full goal stays ACTIVE.

## Exact effect sources and direct cast dispatch — 26 September 2026

Corrected a fundamental inherited join: a Skill.usk object's numeric leaf is
not the skill ID that selects it. Fresh original skillgrp decoding now retains
skill_visual_effect, joins its full qualified path for the exact ID/level, and
keeps all 244 original objects independent of renderer support. Across 29,812
rows, 17,576 have no Agent reference, 12,094 resolve and 142 point to objects not
present in the owned package. 7,930 rows across 758 IDs name a different leaf;
five IDs change paths by level. Unknown levels and empty overrides cannot
borrow another record. Four generated gamedata tables remain private/unstaged.

Agent +0x74 is now independently proven SkillVisualEffect.FlyingTime using
reflected property order, Core linking rules and original field accesses.
Omitted tags have verified class default 0; decoded Float32 overrides keep
full precision. No Agent is a separate state, with no FlyingTime property;
the sound convenience accessor returns null there, preventing an invented
instant legacy impact. Scheduler branches must inspect binding status.

Effects now consume actual gateway events with exact level and injected actor
lookup. Removed the debug-ring scan/WeakSet workaround and guessed missing-
target/collision-height fallbacks. Pending metadata retires after cancellation,
replacement or session reset; deferred spawns cannot move to origin after an
actor disappears. Independent review caught unexpected-close cleanup missing
from resetOnlineSession; regression proved the defect and the correction even
when reconnect reuses the same character object/ID. Already queued particle
cancellation and native lifetime rules remain separate incomplete work.

The cast bar also dispatches cancellation directly. Removed debug-ring evidence
polling; a bare ActionFailed cannot cancel a new cast due to stale old messages.
One identity-guarded timeout handles expiry without animation frames, and old
queued callbacks cannot stop a newer cast. Existing system-message 27/748 bar
compatibility remains explicitly aCis behavior, not a native gauge proof.

Original animation evidence now distinguishes the N/R loop period and (N-1)/R
one-shot sample endpoint. Native scheduler deadlines are independent. Original
MFighter_anim was read directly with every movement/export boundary checked:
114 sequences, 70 bones, no nonconstant track ends before N-1. Loop closure is
still missing in playback; exact native quaternion interpolation, other source
exports and the full phase scheduler remain unresolved. Pawn inspector exposes
period versus sample span without claiming native playback equivalence.

Elbera Tools adds test/skill-source.html to inspect exact levels, object paths,
source hashes, FlyingTime and supported/omitted emitter classes. Browser checks
covered 21 level 1 resolved, 1177 level 1 empty, 1338 level 1 unresolved, 4544 levels 1/3
changing reference, and unknown skill/level with no fallback; no console errors.
Three old visual suites now fail explicitly as UNSUPPORTED before running,
because their Wind Strike same-ID Agent oracle contradicted original data.

Validation: 227 combined Node tests passed (zero failures/skips). Agent evidence
passes 67 native anchors plus 8 source-free tests; exact binding export passes
all 29,812 rows / all 244 objects in 5 DAT tests. Both compact builders --check pass.
Animation evidence passes 54 anchors, 7 pinned ranges, 8 arithmetic cases plus the
114-sequence source audit. Live browser reloaded/reconnected, restored server
shortcuts and exact learned levels, used F2 Relax and showed original abort text
without warnings/errors. This smoke does not certify offensive VFX. Screenshots
skill-source.png and skill-dispatch-live.png stay in ignored tmp/restart-audit.

Native legacy investigation also proves that source Agent None does NOT mean
no effects. Wind Strike 1177 uses compiled SkillEffectInit/Shot/Explosion ID
branches with LineageEffect.m_u000_a/b/c/d; Power Strike 3 initialization uses
s_u002_a. These original class references replace the rejected name heuristic;
complete placement, projectile motion and lifecycle still require mapping.
Legacy verification passes 49 native anchors, 4 evaluated switches, 5 class
audits, 5 pinned ranges and 9 source-free evaluator tests.

Browser left Online as the existing level 5 fighter with SkillWnd open, F2 Relax
and F3 Power Strike restored. World PID49365 / gateway PID62841 unchanged. No GM/DB
or configuration changes, new accounts/characters, public push or deployment.
Sitting placement and narrow-window placement remain visible known gaps.
Next: implement full ordinary phase scheduling and the verified legacy effect
path, after completing its necessary source inputs; continue wider UI/world/
progression coverage in PORT-COVERAGE. The full browser-port goal stays ACTIVE.


## Ordinary source cast playback — 26 September 2026

Integrated the ordinary original InitSkillProcess schedule into player casting.
The browser now plays every selected opening/intermediate/release phase instead
of stretching the first clip to packet hitTime. It uses exact level metadata,
original sequence frames/rates/serialized AttackShot order, exact Agent status
and server mAtkSpd/333. MagicSkillLaunched no longer replays a gesture. Unknown
source, invalid/degenerate budgets, style13, single-frame playback and missing
renderable phases remain unsupported; no substitute clip or minimum is invented.

The timing planner matched 912 cases against the existing bounded evaluator of
original decoded instructions across all32 selector codes. Native phase clock
uses strict previous-elapsed deadline comparisons, initial negative-frame tween,
zero-tween source offsets, one-shot last-frame hold and source loop period.
Original tween reciprocal uses unrounded product before Float32 store; review
caught and fixed an extra Float32 rounding. Loop/tween crossing remainders and
four-step update limit are preserved for the callback-free path. Actual native
notify delivery/splits, x87 bit parity and compressed-track quaternion evaluation
remain gaps. Three exported-pose interpolation and idle/cancellation transitions
are still adaptations, not certified native pose parity.

Pawn exporter now traverses bounded original MeshAnimation exports directly,
retaining source timing and every notify in serialized order. All14 models:
1367 source sequences /3744 notify entries /497 AttackShot /368 empty sequences.
151 notify arrays are nonchronological, which made the old sorting incorrect.
Null-object entries and two original non-shot times above1 are preserved.
Private pawnanim v2 was regenerated, never staged with public source.

Source loops preserve every exported key and append frame zero at N/R. Browser
verification initially rejected castEnd because its exporter losslessly collapses
constant tracks to two identical endpoint keys. The gate now accepts only dense
exact-frame samples or that byte-constant endpoint form; sparse moving tracks
remain unsupported. Elbera check_cast_loop_inputs.py --source freshly verifies
all14 castEnd exports against original extracts, skeleton permutation, .int
binding and direct UKX timing. It does not certify other loops or subframe parity.
Real Three mixer regressions caught a constant-bone tween cache bug: restore the
captured target pose BEFORE sampling the positive-time remainder, preserving
both unchanged and moving tracks. Both cases now pass.

Startup prewarms all cast metadata, then adopts synchronously at receipt.
Deferred metadata cannot revive a cancelled/replaced/dead actor or start a cast
past its computed final deadline. Shorter cold-load latency still starts phase
zero; no invented seek policy. Removed the unused castPhases wall-clock callback
subsystem. Archived verify_castanim.js explicitly returns UNSUPPORTED before
its obsolete self-transcribed callback oracle can run.

Elbera pawn-original.html now replays full ordinary casts using the actual
Character.update path. Packet hit time and casting speed are required inputs,
with no invented defaults. Browser checked1177/1 at6253ms and213 casting speed
on human fighter male and dwarf female: opening -> intermediate loop -> release
-> idle. Cancelled during human intermediate loop; level999 rejected with no
fallback. Saved dwarf release pose at6.015s in ignored cast-phases.png. No pawn
console warnings/errors. These are inspection-stage visual checks, not an
original-client side-by-side equivalence test or a live offensive cast.

Live client reloaded and Online reconnected as the existing level5 PortAudit;
server shortcuts and learned levels restored. F2 Relax showed original messages
and SkillWnd remained usable, with no browser warnings/errors. Screenshot
cast-phases-live.png stays private. The existing floating sitting placement
remains visible. No accounts/GM/DB/configuration changes or service restart.

Legacy Wind Strike evidence advanced without guessing a renderer:49 dispatch+
58 lifecycle anchors,10 pinned ranges,8 original class-default streams. Source
proves distinct trailer pivots/relative offsets, particle-life adjustment versus
actor expiry, target-following projectile and impact paths. Complete vector
helpers, projectile initialization/target-point evaluator, emitter evaluation
and erased cleanup calls remain unresolved. Source-none Agent still does not
mean effect-free. Preserve these gaps rather than restore a same-ID/name effect.

Validation:264 combined Node tests pass, zero failures/skips. Fresh native
schedule differential912 cases; terminal evidence90 anchors/13 ranges,8
normalization+4 tween+3 loop cases,114 MFighter sequence audit. Python source
checks:9 pawn,5 terminal,9 legacy,3 loop shape tests pass; pawn --check and
all14 original loop-input checks pass. Source docs and Elbera catalog updated.
All original/generated data and screenshots remain unstaged/local. No push or
deployment. Full port goal ACTIVE; next work is actual native notify/effect
lifecycle and the wider world/UI/gameplay gaps in docs/PORT-COVERAGE.md.


## Original animation events and full sound layers — 26 September 2026

Ordinary Character casts now use the recovered skeletal notify clock. Candidate
crossings preserve serialized order, Float32 stores, null-object time splits,
native batch remainder arithmetic (including finite negative results), terminal
rate stop, and the shared four-advancement tween/loop budget. Browser cast
channels explicitly enable events; the original fresh-channel default is still
unproven. Named legacy script conversion, callback-mutated channels/AnimEnd and
batches requiring uncertain aliased array removal remain unsupported. Runtime
rejects nonfinite derived clocks without partial dispatch; invalid schedules do
not replace an active cast. All1,008 theoretical A–L/model/stance combinations
have complete original sources without removal potential. This is source-slot
coverage, not1,008 tested skills or full playback parity.

The source metadata now retains original object identity, class predicates,
Sound volume/radius/Random and verified Engine.u defaults. Direct Sound notifies
are connected for the supported exact original class, Random100 and positive
radius. Surface selection, other probabilities and erased mode/default-radius
globals remain separate gaps. Character exposes observational events, but does
not yet consume native Pawn pending-shot/channeling state or dispatch full
skill effects. Source code proves h=ChannelingActions; its premature packet-cast
trigger was removed. Native Agent Preshot is a separate no-op. LastShotName's
erased imported identity helper remains a boundary; no guessed equality wired.

Skill audio export preserves all1398 ordered ID/level rows, three layers of
cast/shot/explosion phases, exact gains (including zero/fractions), and both
voice arrays. Runtime uses original LAST exact row / FIRST level-one fallback
and plays every populated phase layer. Removed the obsolete collapsed skill
index and misleading parser/runtime comments. Cast/shot voices remain preserved
but unplayed; packet shot/impact timing and FlyingTime timeout remain explicitly
provisional until native finalization/projectile paths are connected.

Elbera original-UAX alias tool reads25 banks/5143 Sound exports against5128
existing audio outputs. It resolves5113 qualified names without guessing groups
or colliding basenames. Ordinary animation scope:770 direct events/195 distinct
references;193 resolve. Two dwarf_m castLong references name a different original
sound group and remain unresolved. No transcoding. Detailed per-export/hash
proof stays in ignored receipts; runtime manifest uses a compact digest/counts,
reducing the draft proof-heavy manifest from2090728 to678550 bytes while keeping
all10241 flat/qualified mappings. No claim of codec/content or audio-driver parity.

Session resets now retire GameSound impact timers and pending positional audio
decodes; delayed positions are captured before scratch vectors change. Cast
replacement/cancellation and model replacement retire pending direct sounds.
Same-session main model adoption now cancels the detached old Character, fixing
a guard that could otherwise stay live forever. Already playing sounds are not
stopped by these browser guards; native StopSpellSound and per-caster GameSound
cancellation are still work. Native interpolation and world/player placement
remain unchanged gaps.

Browser: Elbera pawn replay1177/1,6253ms,speed213 on female dwarf completed with
source events and enabled direct sounds without console warnings/errors. Native
unsorted batches can repeat a later-time Sound on a subsequent update; the log
retains that behavior rather than deduplicating. Cancel after the first original
event left the event count at1; replay then reached phase2 and phase3, paused
after AttackShot at5.907s. Screenshot notify-sound-cast.png stays private. Header
scrolling keeps the model visible while the source/event details are expanded.
Audio reference/event delivery was checked; this is not an acoustic comparison
against a running original client. Inspector marks unresolved audio references.

Main browser reloaded, Online reconnected to the existing level5 PortAudit;
received shortcuts/learned skills restored. F2 Relax and Alt+K worked, original
messages named Relax and its full-HP deactivation; no browser warnings/errors.
Existing floating sit placement and surrounding-map loading status remain known
visible issues. No new account, GM, DB/config changes, service restart, push or
deployment. AutoLearnSkills stays true and original trainer support is retained.

Validation:288 combined world/gateway Node tests passed;912 original scheduler
comparisons;186 notify-clock differential cases including5 rejected derived
domain cases. Native notify91 anchors/16 ranges/90 instruction comparisons/6
arithmetic executions; Pawn88 anchors/16 ranges/296 instruction cases; sound81
anchors/1398 fresh DAT rows. Portable Python23 notify,9 Pawn,4 sound,12 pawn
export and9 audio tests passed. Fresh pawn source/alias checks and diff checks
pass. Tool sources, evidence docs and PORT-COVERAGE updated. Original/generated
assets, sound manifests, receipts and screenshots remain private/unstaged.

Full goal ACTIVE. Next: close LastShotName/native pending-event integration,
connect verified cast/shot voices and source effect lifecycles (including legacy
Wind Strike/Power Strike), resolve native projectile/emitter placement and motion,
then keep advancing wider world/grounding/UI/progression gaps in PORT-COVERAGE.
A source animation/sound checkpoint is not full client completion.

## Checkpoint — native actor tick order, action records and player voices

Full-port goal remains ACTIVE. AutoLearnSkills stays enabled; original trainer
support is retained. No server configuration, account, database, public push or
deployment changes in this checkpoint.

Corrected a real phase-clock ordering error using the original Actor/Pawn
vtables: UpdateAnimation runs before TickSpecial/NActionProcess/MagicProcess.
The old channel now advances and delivers its original events before phase
selection; a newly selected channel does not consume that same delta. Boundary
and final-completion events retain their actual source phase. Zero ActiveTime
repeats the initial branch and increments phase; completion Clear(1) precedes
the shared delta addition. Observational event elapsed time is distinct from
native ActiveTime. Deferred direct sounds survive normal completion, but
cancel/replacement/unsupported playback retires them; same-instance model reload
now also retires the old skeleton's sounds. These are browser resource guards,
not a claim of native StopSpellSound behavior.

All 524 original SkillActionInfo records now survive conversion, including two
real Action references with no EffectClass. Bounded reads reject duplicate,
malformed and trailing fields. Arrays preserve order, original action reference
and qualified path, null/unresolved distinctions and exact SpecificStage. Fresh
independent reads confirm all524 stages are explicitly serialized int32 zeros
(the older parser discarded zero-valued tags, so omission could not be inferred
from its JSON). Original Core array zero-initialization is separately proven for
actually omitted fields. Removed three-decimal rounding from transported emitter
and action numbers. Fresh source index/build checks pass; generated outputs stay
private/unstaged.

New pure Agent action selector and Elbera Tools source inspector show casting,
channeling, no-op preshot, shot-stage selection and ordered target callbacks.
Null and non-drawable source actions remain inspectable. The tool preserves
associated duplicates and distinguishes main-target fallback; it does not cast
skills or execute effects. Selected unsupported references return an explicit
non-ready status even alongside known symbolic calls. Future scene integration
must require ready status. Live VFX still uses the provisional packet path.

Cast/shot voice selection now preserves exact original voice banks/gains and
plays after all three source sound layers. The mapping of all14 player model IDs
to native mesh indices was independently joined through original chargrp body
and face references and source pawn classes. Main passes the caster's verified
model, never the target or an assumed NPC identity. The current live audio trigger
remains packet-based, including unresolved native timing/effect-owner semantics;
this is source selection progress, not finished skill sound parity.

Native proof extensions: Pawn88 prior +78 new anchors,35 bounded ranges,
296 prior instruction cases plus zero-ActiveTime branch/3 Float32 suffix cases;
497 original AttackShot records represent496 source objects. Complete original
objectPath equality has a bounded fixed-model equivalence argument; erased
helper identity and the completion FName comparison polarity remain unresolved.
Sound131 anchors/1398 original rows/14 verified model mappings. Legacy effects
156 anchors/18 ranges/60 decoded arithmetic cases now pin target-bone choice,
physics-before-steering order, source Float32 friction/acceleration/displacement,
and Wind/Power sound owners. Full legacy projectile motion remains unimplemented:
erased vector helpers, initial velocity, collision and emitter evaluation need
completion; fixed duration/+1m target guesses are not substitutes.

Validation:259 world +49 gateway Node tests pass (308 total); final focused
33 cast/state tests pass after the event ActiveTime addition. Python47 checks
pass across action/binding/Pawn/sound/legacy suites, including owned-source checks.
Fresh scheduler912 and notify186 differential comparisons pass. Original action
export rebuild/check passes. Browser inspector: intermediate shot excludes stage0,
last shot with absent main target dispatches first/second/first in original order,
Preshot is no-op and casting passes null main target unchanged. Layout inspected.
Dwarf-female1177/1 replay6253ms/speed213 crossed all3 phases with direct source
sounds enabled, paused after AttackShot at5.927s; no browser errors/warnings.
Screenshot cast-tick-order.png is private. Online reconnected existing level5
PortAudit, restored shortcuts/learned skills, F2 Relax and Alt+K worked without
console errors. This was not an acoustic comparison with a running original.
Known floating sit origin and surrounding-map loading status remain visible gaps.

Next: connect pending notify consumption and the proven Agent action selector
to the live cast lifecycle, preserving native same-tick order and last-shot
identity boundaries. Replace provisional packet sound/effect launch and impact
paths only with recovered rules. Continue native legacy projectile/emitter and
player-origin work alongside the wider world/UI/gameplay gaps in PORT-COVERAGE.
This checkpoint does not complete the browser client goal.

## Bounded live Agent events and exact player scale — 26 September 2026

`pawnskill.js` now connects recovered original pending-event consumption to
Character's old-channel animation tick. Ordinary resolved-Agent casts use
source LastShot object identity within the verified model package, initial
ActiveTime-zero casting, channel/preshot/shot order, overwrite semantics, stage
increments, and Clear(0)'s separate main/current-action targets. Launch packets
only append associated actors, retaining order/duplicates and ignoring incoming
level as the native path does. The ordinary initializer requires a resolved
non-null target. Future-stage unsupported action references reject admission.

Ready action plans enter the existing emitter renderer and casting/shot sound
tails enter the source sound selector. This bounded path schedules no guessed
FlyingTime projectile or impact audio. Pending source SpawnDelay order is stable;
actor/cast/session guards prevent replacement or removed actors from receiving
old effects/audio. Completed/cancelled late-packet tombstones retain no character
model graphs. Warm-index ordinary casts use this path; cold-index, instant,
non-player and source-none paths retain their prior provisional presentation.
Completion's erased comparison, native returned effect-actor bookkeeping,
projectile movement, emitter behavior and sound stopping remain incomplete.

Exact original player DrawScale × DrawScale3D × MeshScale products now replace
rounded-height fitting and the unsupported 1.75m fallback. The source exporter
checks all92 actual built parts across14 models, binds the original identities
and current model/buffer hashes, and writes a compact private manifest record.
Character admits the actual model ID/loader path and applies Float32 per-axis
products directly. Missing evidence fails explicitly. A fresh actual-loader
scale audit measured zero error across14 models; legacy fitting is labelled as
comparison data only. Existing bounding-box recentering remains provisional.

Elbera Tools original-pawn viewer now replays the actual Agent controller,
records casting/shot calls, accepts explicit inspection-target associations and
optionally plays source skill layers/voices. Dwarf-female21/1 with supplied
6253ms/213 timing completed all3 phases: casting1, shot2 after two duplicate
associations; association itself fired nothing. Completion displayed the unknown
comparison. Cancellation and a separate one-target replay passed. The latter
was paused at7.355s with its delayed emitter visible; screenshot
`tmp/restart-audit/native-agent-replay.png` stays private. These are inspection
inputs and current renderer output, not an original-client visual/audio match.
Online reconnected existing PortAudit, F2Relax and Alt+K restored/used learned
skills without browser errors. AutoLearnSkills remains True. Floating sit
placement and surrounding-map loading remain visible gaps.

Validation:294 world +49 gateway portable JavaScript tests pass (343 total),
including actual Character loader/hook, SkillFx, sound and packet integration.
Player-scale3 Python + Pawn14 portable checks pass. Fresh original Pawn proof:
88 main anchors/16 ranges/300 actual-instruction cases,497 original shot
identities,122 additional identity/tick/array/target anchors,4 append and6
initial-target cases. Scale export --check passes with zero unresolved models.
Battery inventory167 suites/zero unclassified; the full historical browser
battery was not run. Source and local browser verification are separate from
native visual parity. Nothing pushed or deployed; private generated data stays
unstaged. Full browser-port goal remains active.

Next: finish native placement/pose composition to address sitting/floor issues,
recover the unresolved completion/legacy projectile rules, and audit emitter
placement/material behavior against the original. Keep the broader world,
UI, progression, multiplayer and test-server gates in PORT-COVERAGE in scope.

Placement investigation in the same checkpoint: the new Elbera native verifier
pins53 instruction anchors and27 evaluations of the actual import-free
MeshOrigin adjustment. Its independent original LOD0 POSITION-set audit passes
all92 built parts across14 models; reflected raw-source Y distinguishes the
mesh conversion from the world's coordinate map. This does not certify indices,
weights, posed skeletons or final placement. Nine additional portable tests
pass. Current doc records unresolved normal-instance flags, erased matrix
operators, inferred PrePivot field name and collision-center floor traces.
No sitting-only offset or native-origin transform was applied prematurely.
The final11 SkillFx tests also pass after reducing inspector allocations and
ensuring duplicate post-completion ticks cannot invalidate emitted sound guards.

## Original sit/stand playback and attachment admission — 26 September 2026

Recovered28 missing Sit/Stand clips across all14 original player models using
existing Elbera Tools recovery, with original skeleton/key verification and
preserved geometry/buffer prefixes. The indexed-only localized parser had
silently discarded scalar SitAnimRate/StandAnimRate; it now exports exact
Float32 values along with exact Sit/SitWait/Stand/Wait stance bindings.
Fresh source metadata matches14 models and3,744 ordered animation notifies;
scale fingerprints were refreshed privately for14 models/92 parts.

Ordinary wait packets now play source Sit→SitWait and Stand→Wait. The bounded
channel-zero AnimEnd path consumes remaining time within the same original
four-advancement budget. Source tween values and loop closure are retained;
standing successors follow the current weapon stance. Duplicate wait packets
do not restart a transition. Actual mixer tests check the last transition pose
as the same-tick successor tween origin. Shared source-pose helpers also keep
the existing cast regressions passing. Missing clips and unsupported channel
paths remain explicit; they cannot silently become seated idle. Cancellation,
movement, errors and observer reentrancy retire queued notify audio safely.

The gateway now preserves original remote sex and initial wait-state fields.
Remote snapshot handling admits the later steady loop, without fabricating a
sit-down transition; exact initial/update timing still has native unknowns.
Independent original CharInfo AND UserInfo byte traces prove the first packet
multiplier→Float32 Pawn rate argument. Self initial ordinary standing uses that
rate and zero tween; AnimEnd's script successor separately uses literal1.
The reused boot model and asynchronous model adoption both receive initial
self state. Reconnect clears stale sitting and character-sheet inputs. Repeated
stat/snapshot animation-rate updates and the full movement/combat waiting
selector remain unported; special wait types are not converted into standing.

The new native sitting verifier pins111 anchors and four actual original
endpoint arithmetic cases. An independent sound-reference audit confirmed the
surprising original Human Fighter sit sounds via sequence, raw compact/name/
property/import records and original UAX export chains. Four of five have exact
playable aliases; the ambiguous Silenos basename has none and remains silent.
The preview displays missing audio bindings explicitly. These checks do not
certify native compressed pose interpolation or audible codec parity.

Elbera Tools pawn preview now includes live Character sit/stand controls and
notify diagnostics. Human Fighter and dwarf female transitions, seated loops
and dwarf bow waiting were visibly checked; human sit/stand was also exercised
Online on the existing PortAudit character. Final Online reconnect and both
preview/game consoles had no errors. Private evidence includes
`tmp/restart-audit/source-sit-online.png`. The character still appears raised;
no invented floor offset was applied. Surrounding-map loading also remains a
visible separate defect. AutoLearnSkills stays True and trainers remain in scope.

Original LocateEffect proof pins90 anchors,23 original arithmetic cases,
16 actor-selection cases,6 failure cases and all524 current source actions.
It disproves the inherited uniform visual-half-height offset rule: relative X
uses collision radius, Y is raw, Z uses collision height or MeshOrigin.Z times
DrawScale. Its erased relative-vector helper and exact native Actor.Location
baseline remain unresolved, so the provisional placement is explicitly labeled.
One closed behavioral gap is fixed: absent explicit hand/bone attachments and
unsupported alias/foot attachments no longer silently spawn at actor center.
Admission happens before allocating emitter/scene resources, including delayed
spawns. Seven portable arithmetic tests and actual dispatcher tests cover it.

Placement evidence also now proves PrePivot identity through a named native
setter, plus100 original Core matrix and100 point-transform arithmetic cases.
The complete basis check still passes92 built parts;14 portable placement tests
pass. Live mesh-instance flags and erased Engine matrix-call bindings remain
open, so none of this authorizes a speculative native-origin adjustment.
The existing actual-loader bounds tool gained --poses for idle/Sit/SitWait/Stand
endpoints with refreshed skinned bounds. Human first SitWait minimum is about
-1.9224 L2 units relative to today's browser feet adaptation; all models' minima
are below that baseline. This is browser measurement, not a native correction.

Validation:364 world/gateway JavaScript tests passed together, followed by all15
wait tests including an additional same-tick endpoint/tween regression (365 unique
tests overall). Python focused checks:25 sitting source/recovery/reference,
14 placement,7 LocateEffect. Fresh source/built-scale audits pass. Battery
inventory168 suites, zero unclassified; full historical browser battery was not
run. Public code/docs/tests are separated from private originals, regenerated
models/data and receipts. Nothing pushed or deployed. Full-port goal stays active.

Next: resolve native placement/grounding and the rendered surface discrepancy;
finish original effect coordinates/emitter behavior and unresolved completion
rules; preserve the broader UI, quest/combat/progression, multiplayer and
invited-server gates in docs/PORT-COVERAGE.md. A working animation checkpoint is
not completion of the browser client.


## 2026-09-26 — measurable grounding, source aliases and deeper Engine recovery

The full browser-port goal remains active. AutoLearnSkills stays True; original
trainer behavior remains in scope. This checkpoint does not certify complete
placement, effects, progression, UI or invited-server readiness.

Elbera Tools' existing world inspector gained an opt-in current-player mode
(`?dev=1&inspect=1&checkpoint=current`) and an on-demand body/surface probe. It
does not stage or relocate Online players. The probe samples actual skinned
vertices from submitted triangles, respects index/draw ranges, material groups
and hidden ancestors, and separately intersects terrain/prop geometry below
the actor origin and the lowest body vertex. Transparent surfaces are labeled.
Actual Three fixtures cover parent transforms, updated skinning, instances,
penetration and unused/hidden vertices. Independent review caught the latter
case before completion; it is now a regression. Geometry is not native collision
or alpha-tested pixel coverage, and measurement never supplies a game offset.

Online Human Fighter standing at the current Talking Island checkpoint was
within a fraction of one L2 unit of actual rendered terrain; the first recorded
sample was +0.0018 L2. The seated minimum was about −1.6636 L2. Animation phase
changes the result slightly. This narrows the earlier visual 'raised' concern:
a universal upward floor correction is not justified at this spot. Native pose,
mesh origin, contact/shadows and complete collision remain distinct gaps.
Private screenshots and live observations stay under tmp/restart-audit/.

The original grounding audit pins 63 instruction anchors and four executed
trace-input arithmetic cases. ChangeWaitType corrects remote location before
duplicate-state suppression, but explicitly skips the local viewport's player.
Its ordinary remote cylinder sweep differs from initial UserInfo placement;
erased admission helpers and trace/FarMoveActor semantics are still open.
The bridge now preserves signed ChangeWaitType XYZ and repeated-state updates,
without inventing actor relocation. The local gateway was restarted on 127.0.0.1
with the same existing binding; reconnect passed.

The apparently stuck surrounding-map text was actually an opacity-only hidden
overlay: browser class was hidden and the scene playable, but DOM/AX still
exposed its stale text. Hidden loading now becomes visibility:hidden after the
existing fade; a next load restores it. No timeout or neighbor-load/error
semantics were changed. The actual-loader completion/reopen regression and
final browser visibility/error checks pass.

LocateEffect evidence now strictly decodes all 14 original primary player mesh
alias arrays through verified class Mesh defaults. It keeps exact Float32
coordinates and rejects mismatched/ambiguous arrays. e_bone→Bip01_head covers
five of eleven alias action requests; the other six soulshot aliases are absent
from those particular serialized tables, not proven absent at native runtime.
38 extra Engine anchors and 12 actual Core arithmetic cases distinguish multiple
ABI-compatible helpers. Unknown lookup/following/transform bindings remain
explicit, so no unsupported alias effect is enabled. The documented --output
receipt option now works.

Independent raw Engine byte subtraction and round trips confirm our decoder
did not delete the missing transform calls. Three additional startup transforms
recover a 692,566-byte compressed stream to 983,624 handler bytes in memory.
The next bounded trace identifies a 4,995-byte VM program, eight entry tokens,
native bridge and 299-byte dispatcher. 110 original anchors pin these boundaries.
No VM program semantics or original import targets are claimed, and no native
code is executed or written. Reusable verifier, portable decompressor tests and
source/limits documentation are preserved as Elbera Tools.

Validation: 373 world/gateway JavaScript tests pass; 26 focused Python tests
(15 alias/coordinate, 3 grounding, 8 decompressor) pass. Fresh native grounding,
LocateEffect and Engine-recovery checks pass. Battery inventory 169 suites,
zero unclassified; the historical complete browser battery was not run.
Public code/docs/tests remain separate from the six existing private generated
file modifications. Nothing pushed or deployed.

Next: continue from the identified VM/transform binding boundary where it can
close real effects/placement gaps, and keep the actual early-game quest/combat/
progression loop and remaining full-client UI gates in PORT-COVERAGE.md active.
Do not mistake tooling or a verified geometry checkpoint for the finished game.

## 2026-09-26 — Q1 reward/persistence and original quest feedback

The existing PortAudit character completed Letters of Love through ordinary
dialogs: kerchief688→receipt1079→potion1080→Necklace of Knowledge906. The final
Darin interaction at21:06:56 UTC sent original reference ItemSound.quest_finish
and QuestList progress0. Fresh login retained the necklace, absent quest items,
level5/EXP3470/SP80/Adena320. No creation, teleport, SQL edits or grants were
used. The browser subsequently showed the necklace and empty0/25 journal;
private screenshots and full receipts remain under tmp/restart-audit/.
This proves configured-server behavior and reconnect persistence, not official
server reward rules or persistence across a server/database restart.

Completed zero-progress server rows now retire journal entries, count,
selection/expansion and pending abort confirmations, following original native
stage-event emission. The original FE/1A quest-update packet is bridged with
current-session guards; its source32×32 resting icon anchors42,-5 above chat
and opens the requested quest's final chapter without a server request. A
labeled Elbera replay verified icon→chapter focus→zero-progress retirement.
Original48-anchor/script/XDAT checks and four portable decoder tests pass.
Native glow/pointer states, MainWnd tabs, alternate SystemMsgWnd anchoring,
guidance and full text/keyboard behavior remain open.

PlaySound0x98 now preserves all dSdddddd fields, with transient stale/pre-entry
events dropped. Original four quest sounds are stereoPCM16/22050Hz; the old
general exporter downmixed them. A separate Elbera exporter now preserves
1,192,368 exact original WAV bytes and checks private metadata. The107-anchor
native proof includes initial pawn/gain/pitch, stereo driver format, conditional
player-node pawn location, and Draw→Audio.Update call evidence. Full radius
admission, intervening per-frame gain/occlusion and mixer semantics remain open,
so browser playback was not approximated; the live unsupported-sound warning
is expected. Existing audio comments no longer claim mono conversion is native.

Baulro's exact position had no complete NavGrid route. A reachable approach
worked; departure then stopped at(-84703,245040,-3720). An independent offline
reproduction shows the new rounded origin enters a north-forbidden cell that
the initial line avoided. The harness correctly refused its next probe.
An explicit eastward recovery and full return to Darin passed. Geodata was
not altered; this remains a reproducible navigation boundary, not a route
parity pass. See docs/quest-completion-playtest.md. The playtest tool now also
records actual MoveToPawn origins and post-entry feedback without inventing
arrival or replaying transient entry events.

Engine recovery now conditionally interprets the first15-byte VM operation:
three explicit synthetic captured-register cases traverse1,753 original
instructions and stop after a28-dword bank rotation/copy. 113 anchors and16
portable tests pass. Subsequent VM operations and native matrix/import bindings
remain unresolved; no native code was executed or decrypted payload written.

Validation:408 world/gateway/playtest JavaScript tests pass;25 focused Python
tests pass (16 recovery,4 marker,3 RIFF,2 exporter). Fresh original marker,
PlaySound and recovery verifiers pass; stereo outputs compare byte-for-byte.
Battery runner regression passes; inventory172 suites,zero unclassified. The
historical complete browser battery was not run. Live browser reward/journal
and offline marker replay passed; no captured browser errors. Local gateway
restarted on127.0.0.1:8090, same account/server configuration. AutoLearnSkills
remains True. Six pre-existing private generated changes remain unstaged.
No push or deployment. Full-port goal remains active.

Next: complete the native quest-sound admission/update proof from the recovered
Draw/player-node/Audio.Update chain and integrate only proven playback; move
into further ordinary kill/loot/progression quests while addressing the observed
movement boundary and full original client UI/effects gaps. Preserve the full
scope in PORT-COVERAGE.md rather than equating one completed quest with a client.


## 2026-09-26 — Q154 hunt/reward, narrow stairs and quest-marker animation

PortAudit completed Sacrifice to the Sea with ordinary actions: accept at
Rockswell, eight individual Power Strike fights against visible keltirs,
10fur→Cristel yarn→Rolfe doll→Rockswell Mystic's Earring113+300EXP.
Cristel, Rolfe and final reward interactions ran through real browser NPC
HTML; live quest markers selected the new chapters and final journal retired
to0/25. Fresh login21:56:31 retained earring113, prior necklace906,
level6/EXP6859/SP160/Adena615 and no remaining Q154 quest items. No creation,
grants, SQL, teleport or game-data edits. These are configured-server results,
not proof of original drop/reward rules; no server/database restart tested.
AutoLearnSkills stays True. Level6 keeps the existing nine skills; class0's
next configured learning threshold is10. Full class coverage remains open.

The lighthouse and warehouse exposed coarse128-unit routing misses. A bounded
16-unit fallback now keeps source floor/NSWE state and every short waypoint.
An independent installed-server Java probe reproduces the earlier Baulro
rounded-step failure and validates39segments of the final Rockswell route.
Actual protocol walks passed first lighthouse ascent/descent and warehouse
entry. The long warehouse return hit the90-second operational command limit
at the stairs and is explicitly incomplete. Browser ground movement and
Rockswell talk/reward worked after reconnect, but no browser per-waypoint
trace proves which movement path executed. The Baulro coarse rounded-diagonal
hazard remains unresolved; no geodata was altered.

The protocol harness now requires exact waypointXY/source-floor arrival and
rejects snapped goals. Browser fine routes use actual server origins, one
pending waypoint, bounded probes, an explicit origin-refresh movement request
and cancellation on casts/actions/session transitions. These are interoperable
browser transport choices, not decoded native pathfinding. Actual-source tests
cover refresh/cast/lifecycle integration and failure without a straight fallback.

Quest marker now uses original float timer arithmetic, blink/alpha/scale
progression, duplicate callback semantics, both glows' first texture binding
and source pointer art.106original anchors,4code hashes,7actual-instruction
arithmetic cases and6portable Python tests back the bounded implementation.
Replay and live Q154 marker→chapter checks passed. GPU composition, inherited
alpha/dimming, MainWnd tabs and full native input still remain.

Native PlaySound evidence grew to165anchors with corrected Draw→Audio.Update
ordering, conditional same-pawn dry gain and separate EAX radius dependencies.
Six portable Python tests pass; four private questWAVs remain exact stereo
PCM16/22050Hz. The protected radius and camera type-query bindings and broader
mixer behavior remain unresolved. Quest playback stays unsupported rather than
using invented parameters.

Live play exposed stale NPC dialogs after disconnect and an X button captured
by title-bar dragging. Both are fixed and browser-verified. Interrupted/lost
pointer capture also ends drag in standalone and managed windows. Inventory
still opens offscreen at623px; window placement, native picking and continuous
movement presentation need further work.

Validation:452 world/gateway/playtest JavaScript tests pass, plus12focused
native-marker/PlaySound Python tests and the unchanged exact stereo exporter
check. Battery manifest check passes;175suites,zero unclassified. Historical
full browser battery was not run. Public Elbera Tools/code/tests/docs remain
separate from original binaries, generated assets and private receipts/screens.
Six pre-existing private generated changes stay unstaged. No push/deployment;
full-port goal remains active.

Next: address viewport-safe native window placement and browser navigation
pacing/picking with recorded live evidence, continue the original quest audio
binding investigation, and expand the actual equip/shop/progression regression
while retaining all missing systems in PORT-COVERAGE.md. A second completed
quest is a milestone, not a full client.

## 2026-09-26 — Inventory source behavior and lighthouse picking

Decoded the separate XDAT reset table (56records,53unique names), native
saved-position corner predicate and reset arithmetic.174original instruction
anchors and11code ranges support the bounded layout change. Inventory now
applies the supplied INI position before restoring saved browser placement;
saved positions are no longer overwritten. It uses the exact recovered reset
record when no corner is inside the browser root. At623×760, live layout reset
gave(321,130) for256×401, and dragging to(80,100) survived reload/reconnect.
The viewport override was removed. Native inherited parent, complete resize/
docking and all-window migration remain open. Alt+Enter also opens chat;
that input-dispatch defect remains recorded, not treated as source parity.

Inventory right/double-click now calls original UseItem rather than assigning
the first free shortcut. Fresh original DATs provide isRecipe/popMsgNum for
9238items, including939recipes and28positive popup records.66native anchors
and original script checks establish recipe-warning priority, reserved object
confirmation and accessory identity. Gateway now preserves the17object-ID
paperdoll bank independently of the item-template bank; left/right ear/ring
icons follow the exact object. Live right-click equipped the earned necklace906
and earring113; only the left ear filled. Recipe1788 opened its original
Warning; Cancel preserved it. Fresh ordinary login22:17:25UTC retained both
equipped, level6/EXP6859/SP160/Adena615 and the same9skills. No live recipe
registration, server restart, grants or game-data/stat rule changes.
AutoLearnSkills remains True and full trainer support stays in scope.

Independent review reproduced two async issues: an older full inventory could
overwrite a newer update while text loaded, and delayed refresh/loot text could
leak across sessions. Server inventory mutations now stay in arrival order;
only metadata/presentation waits. Session guards and actual-source regression
tests cover both races. Original drop/quantity/destruction dialogs, shared
dialog ownership, two-hand states and henna remain gaps; see
docs/inventory-client-playtest.md.

The earlier lighthouse click-through had a missing world surface: only terrain/
BSP were queried. Elbera Tools now extracts native collision triangles for two
audited StaticMeshActors from17_25, including32faces absent from the visible
mesh. All4146triangles are reachable in the native source tree. Original
actor/class flags, material admission and23additional native anchors constrain
the supported domain; unsupported inputs fail without a render-mesh fallback.
Private521KBsidecar loads atomically with its scene. Live clicks selected
actor141triangle1034 on stairs and713 on the lower landing, with visible
movement to each surface and no captured browser errors. Dev-only Elbera Tools
output records the exact pixel/actor/triangle/L2 hit. These checks do not prove
native0.1extent sweep, hit bias, exact server arrival Z, navigation pacing or
other map/prop coverage. The Baulro coarse-step hazard remains open.

Quest audio investigation now checks205anchors, independent raw recovery of
the zero radius slot, and all29literal loads. The default-radius role is clear,
but its provider/value and protected camera query remain unbound. Playback
stays unsupported; repeating gain algebra cannot close those identities.

Validation:483world/gateway/playtest JavaScript tests and28focused portable
Python tests pass. Original inventory, layout, picking and PlaySound checks
pass. Battery manifest has180suites,zero unclassified; the five new portable
suites run through the battery successfully. Full historical browser battery
was not run. The historical shortcut harness's stale inventory-right-click
assignment was changed to dragging and its old I/Digit2 controls to Alt+V/F2;
syntax was checked, but that whole mock-browser scenario was not rerun.
Source-only checkpoint preserves six pre-existing private asset
changes plus this pass's private item/window metadata and ignored collision
sidecar. No push or deployment. Full-port goal remains active.

Next: replace inherited browser destroy/crystallize confirmations with the
original inventory dialog/quantity paths, expand real use/equip/shop scenarios,
and extend source collision coverage/native trace math with evidence. Keep
class progression, effects/animation and all remaining client systems in
PORT-COVERAGE.md; this checkpoint is not completion of the browser client.

## 2026-09-26 — Original inventory quantities and expanded source collision

Replaced inherited browser confirmations with original destroy Warning/NumberPad
and crystallize Warning paths. Fresh original9,238item records retain raw
consumeType/crystallizable; UserInfo's crystallize byte is no longer discarded.
Original capability/origin gates control admission. Quest and inventory share
one owned DialogBox; session/item retirement only cancels that owner's request.
Selected quantities now reach gateway packets unchanged, including native
empty→zero. The former count0→1 fallback is removed; unsupported overflow is
refused. Original AllItemCount branch is represented, but its complete native
drag Count/modifier lifecycle remains unclosed.

Elbera Tools recovers NumberPad's434×128geometry,13buttons, exact156×17edit,
three source frame textures/crops,2pxtext inset, digit-based color cycle,
comma grouping and English magnitude reading.71instruction anchors,15ranges,
16actual magnitude-loop cases and31native color-branch cases support it.
No arbitrary quantity clamp or1default was added. Native font-width acceptance,
caret/selection/focus/IME/paste, other localized readings and button states are
still gaps. The inventory checker now covers162anchors and shared ownership;
trash sound identity is traced, but unresolved driver/radius behavior prevents
invented playback. All generated source art/data remains private.

The offline browser replay exercised Dagger Warning/Confirm, Adena All/clear/
backspace/count2/empty0, physical12345grouping/color, crystallize Warning/count1,
and capability/origin rejection. It records requests only. Drag automation
emitted start/end without drop; successful actual drag remains unverified.
Independent review fixed a replay Reset/out-of-order load race and tightened
the original drop-origin gate. Live Online reconnect after a gateway refresh
preserved visible equipment/items/615Adena; recipe Warning/Cancel still works,
and Human Fighter's crystallize control is hidden. No captured browser errors;
no real item destruction/crystallization/registration or server data changes.

Collision extraction now preserves qualified source object names and admits
only collision-referenced material slots.17_25 expands from2 to81 of986actors,
36 of193qualified meshes and27,044placed triangles (2.39MB).905actors need
licensee>=17lazy-array decoding plus applicable actor/default gates. The live
browser loads the expanded sidecar. Measured CPU cost does not justify a BVH.
Separate audit proves inherited rendering flattens distinct Cart/Tank group
names: current Cart/Tank03 geometry belongs to a different source object for
some actors. No visual props have been silently regenerated. See native picking
evidence for exact identities and the bounded migration plan.

Validation:500world/gateway/playtest JavaScript tests pass;30focused Python
checks pass (including original-dependent miner checks). Native NumberPad,
dialog layout, exact three-texture RGBA and all9,238item-field checks pass.
The two new portable battery entries pass; manifest has182suites and no
unclassified entries. Full historical browser battery was not run. Public
source/tools/tests/docs remain separate from all private generated assets and
receipts. No push/deployment; full-port goal remains active.

Next: correct qualified render identity for the demonstrated Cart/Tank collisions
through isolated source-verified exports, extend collision lazy-array support,
and verify ordinary navigation/shop/progression. Native input/audio gaps and
all broader client systems remain tracked in PORT-COVERAGE.md.

## 2026-09-26 — Qualified prop repairs and native lazy collision arrays

Elbera Tools' read-only original-reference census now covers100existing scene
tiles/162,805StaticMeshActors. It finds23legacy package/leaf collision groups
on9maps, involving157actor references, with60unresolved original records.
This measures naming risk, not157proven wrong shapes or complete map fidelity.

Repaired the demonstrated17_25Cart/Tank defect through grouped original
exports:6qualified meshes/11scene placements, exact per-section triangle
positions after source Float32 export transform, original material identities,
paired glTF/buffer names and12unique source texture identities. Dry staging
left all947live files byte-identical. Explicit backed-up adoption added6glTF/
buffer pairs and changed only the11rows' gltf/sourceMesh fields. All placement
transforms, other scene data and shared textures stayed intact. Old leaf files
remain for comparison. Legacy full conversion now refuses this map's known
group collisions before mutation; general package-wide identity remains open.

The new offline Elbera Tools prop comparison displays legacy versus both
qualified variants at a common camera scale. Actual browser checks rendered
all3families with source labels/fingerprints and no console errors. Review
caught and fixed unchecked glTF/source label association and unclosed owned
ImageBitmap resources. Visual checking caught a high-DPI canvas sizing bug;
the corrected canvas fits its CSS area and reframes on resize. The tool's
inspection lighting/camera are explicitly separate from native game rendering.

Recovered native lazy collision framing for the157previously rejected source
meshes. Each array stores its absolute saved-end offset, then the same compact
count/element serializers as the legacy arrays. Bounded views enforce exact
payload end and original export limits. Named Core archive methods,28new
instruction checks,4code ranges and one complete sample from each supplied
licensee18/19/20/22/23/25/28/31support it. All193meshes in17_25decode; existing
actor/material gates admit868actors/179meshes and131,152placed collision faces.
The118remaining actors keep explicit unsupported rotation/flag reasons.

After source checks, backed-up local adoption replaced the81actor collision
sidecar while preserving the scene semantically. Ordinary Online login loaded
the868actor diagnostic. A visible landing click selected actor141triangle712
at rounded source hit(-79075,240270,-3471); rendering showed movement along
the landing. No captured browser warnings/errors. Native extent sweep/bias,
exact server arrival, new-actor route coverage and general navigation remain
open.7.70MBsidecar CPU sample:20.6msJSONparse,40.4mstransform,44.4msfor1,000
sampled vertical rays. No extra spatial-index architecture was added.

Validation:13portable collision tests,8portable prop-repair tests and10terrain
edge checks pass; native picking checks and17_25scene validation pass. Updated
historical inventory harness removes direct action callbacks and stale fixture
assumptions; syntax and static peer checks pass, but its browser flow was not
executed. The4focused world/loading/picking/repair battery entries pass; manifest
has183suites,zero unclassified. Prior500client/gateway/playtest tests remain the
earlier inventory checkpoint's run, not a claim that the full browser battery
was rerun. No public push/deployment; private generated assets/receipts stay
unstaged. Full-port goal remains active.

Next: general grouped source identity for all conversion paths, resolve the
remaining collision actor/default gates and verify ordinary village routes.
Continue the actual shop/combat/class-progression regression and unfinished
native UI/effects systems; the broader scope remains in PORT-COVERAGE.md.

## Original merchant behavior, qualified conversion and collision defaults

Continued on `codex/web-port-foundations`; AutoLearnSkills remains True in the
configured server. Original trainer support remains in scope. No server rule,
character grant, account creation, teleport or SQL edit was used for this pass.

Fresh original ShopWnd extraction found inherited quantity and cart defects.
The browser now uses ConsumeType1/2/3, shared NumberPad72, class-reserved dialog
acceptance, distinct direct-buy rows and source limited-stock Warning1338.
Blank/zero shop input does nothing; caller rules stay separate from inventory
destroy. The original price accumulator's sell-return overshoot asymmetry is
preserved in the small-number domain. Source labels/money snapshot, Inventory
hide-on-open, total256x401 bounds and distinct creation/reset anchors are wired.
The backdrop now follows the source frame/Texture drawing path rather than
stretching a generic sliced frame. Source evidence and limits: shop-playtest.md.

Pending lists/dialogs cannot survive merchant replacement, close or reconnect;
per-cell async metadata reads were removed to prevent interleaved rows. Shared
game-data loading now retries failed requests on a subsequent call while
preserving cached successes and single-flight requests. The gateway rejects
invalid exact DWORD requests as a whole; no count wrapping, silent50-row
truncation or dropping unknown sale objects. Inventory snapshots replace the
object map, and retired game sessions cannot restore merchant/list identities.

Actual browser purchase/use: ordinary separately recorded CLI travel reached
Katerina; that tool disconnected before browser Online login. Actual NPC HTML
Buy14, Potion1060 quantity1 at received103, NumberPadConfirm and shopOK produced
an inventory item and Adena615->512. Ordinary inventory use removed the potion
and produced the server use message. Full health means no healing amount/timing
proof. Offline Elbera Tools shop replay separately checked duplicate Ring116
rows, positive-stock warning, sellAll3 and zero quantity. Exact source backdrop
alignment was visually inspected. No live sale or equipment/limited-stock
transaction was exercised. Source/input files and screenshots remain private.

Removed database funding, automated farming and unrelated item sales from the
historical live shop harness. It now requires an explicitly selected existing
identity already near Katerina with sufficient received money. Mock/live shop
harnesses use actual shared dialog controls and exact requests, with mock stock
and prices labeled synthetic. Syntax/static review only: neither historical
browser harness was executed in this CUA-only workflow.

General prop conversion now validates qualified geometry against complete
original package exports and uses exact grouped export paths, with paired
qualified glTF/buffer names and sourceMesh fingerprints. The global basename
geometry fallback is gone; singleton references to a duplicate package leaf
are covered. Fresh selected stages for17_25 and18_21 matched original triangle
sections and left1477live files unchanged. General texture/material identity
and full conversion atomicity remain open. No extra maps were adopted.

Original Core class-default zeroing/superclass copy establishes absent Rotation
as the source default; native nonzero mouse flag admission is now distinct from
the zero-extent flag. This adds61+25actors:954/986,189meshes,142897placed faces.
Remaining32explicitly disable collision/nonzero traces. Backed-up local adoption
preserved scene bytes. Browser verification exposed and corrected the runtime
parser's obsolete zero-flag gate; malformed flags remain rejected. A local
sidecar/runtime regression now guards this integration. Corrected Online login
loaded954actors; ordinary floor click and visible movement passed with no new
captured errors. This is not all-actor traversal or native extent-sweep proof.

Validation:538client/gateway/playtest Node tests pass,31portable collision/prop
Python tests pass, six selected battery entries pass,186registered suites with
zero unclassified. Native picking and fresh original shop source checks pass;
source backdrop evidence is included with the shop verifier. Local checkpoint
commit2b2edd1 contains world changes. Public code/tools/docs stay separate from
private generated inputs, identities and receipts; no push/deployment occurred.

Next: investigate the visible merchant-interaction body/camera occlusion and
dark interiors; guard repeated scene-load failures from frame-loop retry spam.
Continue ordinary progression/combat/class checks and missing complete-client
systems in PORT-COVERAGE.md. Native extent sweeps, other-map collision, material
identity, animations/effects, full dialogs/tooltips and long-session readiness
remain explicit. The full-port goal remains active.

Read-only next-step diagnosis: interaction does not change NPC scale/camera
target. FollowCamera's walking-height obstruction samples can collapse the
boom to zero within its first0.30m; an offline actual-module reproduction
confirmed that mechanism, not its occurrence in the saved live frame. Actor
and vertical-wall geometry are not camera obstructions yet. The approach
handler also targets the NPC center if already within stop radius. Capture
actual camera distance/floor source, actor transforms and approach packets
before attributing the observed close-up or changing original camera rules.
The backdrop verifier additionally passes39native anchors/five code ranges.

## Merchant approach diagnosis, scene recovery and original BSP structure

AutoLearnSkills remains True; trainer support remains in scope. Continued on
codex/web-port-foundations with the full-port goal active. No account creation,
character grant, teleport, inventory change, public push or deployment.

Added a collapsed Elbera Tools camera inspector in dev mode. It records copied
camera/focus coordinates, requested/actual boom, the current obstruction sample
and selected movement/dialog receipts. An on-demand measurement captures full
precision camera data, current player/target scales, animation and drawn AABB
distance. AABB containment is labeled as a candidate, not mesh penetration proof.
It does not send movement or replace authoritative position bookkeeping.
Final inspector review also removed stale measurements when fixed inspection
framing bypasses FollowCamera. Inactive modes invalidate the sample; returning
to follow mode requires a new frame. Five focused inspector checks pass.

Ordinary Online Katerina interaction reproduced the old defect. MoveToPawn
distance150 arrived at player[-84138,240470] about94.05units from NPC[-84204,
240403]. The browser still walked into the NPC center. The camera then shortened
2m to0 at its first walking-height sample. Actor scales remained unchanged.
The bounded approach fix now clears an old visual destination and stays put when
already within the received distance; outside keeps the existing projection.
Fresh native dispatch/reached-result evidence supports that correction, while
the full native collision/vertical/equality predicate remains unresolved.
Two ordinary browser repetitions after the fix opened the dialog at the same
player coordinates with a2m boom and no new captured warnings/errors. Private
before/after receipts and screenshots are under tmp/restart-audit/camera-* and
merchant-reviewed-build.png. No purchase/use was repeated in this pass.
The final reviewed build was reloaded and reconnected once more, with the same
unchanged position and two-metre camera after ordinary Katerina interaction.
The captured console has no warnings/errors. Final private receipts are
camera-final-build.txt and merchant-final-build.png in that audit directory.

Scene-load failures no longer restart from the frame watcher. The previous
adopted scene survives candidate failure and a visible Retry scene action is
available without dev controls. Session/new-request retirement prevents stale
completions or detached retry buttons from winning. Review also fixed initial
Online retry spawning at scene center, stale floor hints, disappearing retry
access when returning to a failed tile, and foreign-tile grounding during slow
retries. A further independent review reproduced that grounding issue during
ordinary pending crossings too; every online keep-position adoption now checks
current tile coverage and selects a fresh matching server Z or current local Y.
Three actual-loader regressions cover foreign-tile teleport, same-tile movement
and a fresh matching receipt. These fixes do not assert native window parity.

Fresh original camera work distinguishes the stored Engine.u script from the
active native override. Original Draw dispatches to native PlayerCalcView and
CalcBehindView; reflected property order, Core bool packing and native copies
bind the camera configuration flags. Shipped settings select hit-check=true,
volume=false and the (Float32(0.1), Float32(0.1), 5) extent sweep. The ordinary
native pitch bounds are -15000/+16384, unlike the script's symmetric15000.
Both examined branches use ViewDist+30 reach and ViewDist-30 final distance;
close hits are signed. Script Trace(false) is separately a zero-extent path
including BSP/terrain/static actors. It cannot replace the native box sweep.
The model-half-height pivot, horizontal-FOV interpretation, input/tracking
and walking-height march are now explicitly unverified in camera.js. Default
camera arithmetic was not replaced. Native direction-vector imports and
complete special-camera, primitive and aggregation semantics remain open.

Elbera BSP exporter preserves original full UModel records, including fields
previously discarded, with export-bounded reads and separate prefix/tail hashes.
It stages private data only. Both17_25(1819nodes/458surfaces) and22_22(2770/1091)
were staged. Read-only original census:157maps,160912nodes,66636surfaces all pass
structural checks; this is not157 playable maps. Inactive stale vertex records
remain byte-derived data and are never followed as live node references.

The separate BSP primary zero-extent JS traversal follows source front/back
epsilon order, solid-node0x21 predicate, RootOutside, start-inside and near-first
rules. Native checks compare four decoded plane/split arithmetic cases with JS;
Float64 intermediate and wrapper/material/normal/backoff limits remain explicit.
No camera/world runtime adoption occurred. Independent source review passed.
The recorded collapsed-browser ray misses primary BSP but meets a generic source
static triangle at29.521units; the corrected view's first generic static hit is
578.979units beyond the script260unit segment. These partial comparisons do not
prove full native collision or that the old height obstruction was necessarily
false; they reinforce the proven approach trigger and remaining static trace work.

Validation:577 client/gateway/playtest Node checks pass;6focused battery entries
pass;191registered suites/zero unclassified. Camera source check:3camera and2login
bodies,12script/37Trace anchors/seven ranges; native override64Engine/9Core
anchors/six ranges plus8portable cases. BSP primary check:
35anchors/four ranges/four instruction-arithmetic comparisons and13JS cases.
BSP source:7portable cases; existing l2lib package suite15passes. Grounding
check94anchors/four original arithmetic cases. Private asset modifications
remain unstaged. Next: port the proven native camera branch's nonzero extent,
resolve direction imports, trace wrapper/static and terrain collision before
adopting a replacement, then continue the full gameplay,
UI, progression and effects inventory in PORT-COVERAGE.md.

## Original henna protocol/UI and bounded BSP sweep work

Continued on codex/web-port-foundations with the full browser-port goal active.
AutoLearnSkills remains a server policy; original manual trainer support remains
required. No public push, deployment, grants or character-state edits.

The henna miner freshly decrypts all180 original records, preserving the four
separate string fields, row boundaries/hashes and12source icons. Native evidence
binds the two description fields,89class steps, five incoming packet callbacks,
six requests, list identity differences and signed inventory delta bytes versus
unsigned detail totals. The original list request's extra DWORD is the ordinary
UIScript caller return address exposed by a missing vararg; source-build caller
words are preserved as ignored padding, with relocation limits explicit.

Gateway parsing validates complete records before emission; queued entry henna
snapshots replace earlier ones, including empty state. Retired sessions cannot
flush them. Current subclass ID now survives the later UserInfo field separately
from the base-class appearance header. Drawing/removal controls and inventory
symbols use server-owned state and original catalog/layout inputs. Closing,
replacing a list or disconnecting retires pending details; no browser-side money,
dye or stat update fabricates an equip/remove result. Six repeated txtArrow
records remain separate source controls. Elbera Tools adds an offline packet
replay. Native text metrics, frame/button/selection states, tooltip appearance and
inventory icon inset/disabled tint remain explicit gaps. Money tooltip text now
uses the recovered English reading and original Adena suffix, preserving its
whitespace and empty/long-input branches.

BSP work adds the original leaf-hull framing and complete retained single-plane
nonzero helper, isolated from the live camera. Every one of133helper instructions
is exercised across108cases and matches the JS interval/predicate/normal output.
All291staged17_25hulls decode (1617planes,525flagged operations); unknown plane
operations remain unknown. The primary empty-solid-model path is now unsupported
rather than a false clear ray. Full hull traversal, extra bounds/bevel planes,
owner transforms and final hit adjustment remain required before camera adoption.

Live henna checkpoint: existing PortAudit received the empty entry snapshot,
empty drawing/removal lists and both requested detail responses for original
symbol1 through the updated gateway. Only read-only henna queries were sent;
the existing Elbera playtest tool now records those five events and exposes
catalog-gated query commands. The offline browser replay used unchanged actual
server fees/stats and explicitly labeled detail-derived selection rows. Both
panels, six arrows, Back and OK paths passed visible checks; no console errors.
No successful live tattoo application/removal or eligibility is claimed.
Final Online browser entry and Inventory rendering passed with source class0
rowcount1 and empty server symbols/maxSlots0. Native text/overflow, inherited
artwork behavior and nonempty live state still need further verification.

Validation:610 client/gateway/playtest Node tests pass; five portable henna
decoder cases pass; six focused battery entries pass (195registered suites,
zero unclassified). Fresh henna source/export check passes180records/12icons/
55controls and229native anchors. Original BSP checker passes35primary anchors/
four code ranges/four primary arithmetic cases plus37nonzero anchors/seven
ranges/108full-helper comparisons. Private generated metadata/assets and live
receipts remain unstaged. Full-port goal remains active.

## Original recipe crafting and native gauge gap

Continued on codex/web-port-foundations. AutoLearnSkills stays enabled as the
configured server policy; the original manual trainer remains supported.
No publication, deployment, recipe grants or character-class changes.

Elbera Tools freshly decodes871 original recipe rows and5250 material pairs,
with three distinct IDs retained: recipe index, recipe item, output product.
Native evidence binds fields, exact product/rate lookup, literal100 child
rates, source titles, fresh collapsed tree nodes, cursor/child geometry,
ordinary recipe shortcut AE semantics and full nonempty additional names.
Empty-string native getter, conflicting duplicate ordering, saved expansion,
texture sampling/resolver limits and inherited frame/font behavior remain
explicit. Six source tree textures are decoded unchanged from pinned packages;
the private export and pixels stay ignored. The existing repeated-control
helper is shared with henna instead of copying a second implementation.

Gateway AC–AF/D6/D7 and FE/2E preserve real IDs, result values and all seven
capacities. Latest complete capacity snapshots flush only after matching
entry. Book/manufacture/tree UI uses original metadata and actual inventory;
MP and inventory updates preserve unrelated controls. Back, tree independence,
deletion Warning74 and session retirement are wired. No local timer, result,
money, product or material consumption is inferred. Recipe shortcuts remain
disabled despite newly recovered source semantics; private crafting shops and
successful ordinary learning/manufacture/deletion remain future work.

Live browser Common Craft1322 opened the empty General Recipe Book0/50.
Separate read-only CLI queries received both empty books and recipe1 detail
(MP74/max74/status−1). The offline replay uses these actual values/inventory
with an explicitly labeled artificial selection row. Browser checks exercised
details, expanded ingredients, Create request, Back, independent Tree Close,
Warning Cancel/Confirm and final reconnect. Hidden-window placement and missing
tree art discovered in this pass were fixed. Final replay has no new console
errors; inherited gauge warnings exposed a real missing subsystem, not a
recipe-book failure. Screenshots/receipts remain in ignored tmp/restart-audit.

The gauge investigation establishes four independent decreasing timers and
actor-attached projected depth bars. The existing bottom cast HUD grows from
MagicSkillUse, uses a server-specific threshold and misses nonblue channels.
New Elbera source checker passes94 anchors/11 bodies/9 ranges/5 finite examples;
those examples are not native emulation. No placeholder handler was added to
hide the warning. Full native placement, texture/depth behavior and session
guards are explicit next work in docs/native-gauge-gap.md.

BSP candidate traversal/bounds checkpoint is committed as0982e4b. It adds103
branch cases,94 native instruction traversal cases and27 bounds cases to the
previous108 plane-helper comparisons. All25 JS BSP cases pass. The plane flag
still affects254 of291 local hulls; these slices do not alter the live camera.

Validation:645 aggregate client/gateway/playtest Node tests pass; five portable
recipe decoder cases pass; six focused battery entries pass,199 registered
suites/zero unclassified. Fresh recipe native/export/pixel comparisons pass.
Next: actual eligible recipe learning/crafting/persistence, recipe shortcuts,
native actor gauges, remaining ItemWindow/font/chrome details, and complete
camera sweep/flag/actor/terrain aggregation. The full browser-port goal remains
active and the broader PORT-COVERAGE inventory still governs scope.

## Recipe shortcuts and viewport repair

Continued the active full-port goal on codex/web-port-foundations; AutoLearnSkills
remains enabled. RecipeItem drag and type5 shortcut receive/use are now connected.
Fresh original evidence proves recipe index identity, recipe-item name and product
icon. Registration sends original0x33/type5/characterType1; use requests AE details,
never AF crafting or0x34. A received saved binding can open manufacture before a
book has been opened. New assignments require a current received book row and
source metadata. Unknown/pet/macro rows retain their explicit limitations.

A late result for an open recipe A previously consumed a pending shortcut request
for B. Fixed request matching and added a regression. Book drag contexts retire on
close/replacement/reset; no catalog lookup grants ownership or changes inventory.
The existing Elbera recipe inspector reuses ShortcutWnd, accepts explicit shortcut
snapshots and labels its local registration/deletion echoes as UI fixtures.
Browser F1 restored-shortcut → AE → Item Creation → expanded material tree passed.
An initial inspector module-map error was fixed; later browser checks show no new
errors. Drag testing exposed the inherited saved-INI-as-default placement bug:
horizontal y722 falls below a720-pixel viewport; source placement repair follows.

Configured progression investigation found no immediate solo common-recipe craft
for the current human6 character: its Bow recipe1788 is dwarven/index4. A legitimate
future target is a normally created dwarf, Create Item at5, Spoil/Sweeper at10,
Utuku Orc Grunt20448 for RecipeWoodenArrow1666 and nearby mobs for four Stem and
two IronOre. Original recipe1 gives500 WoodenArrow17 for30MP/100%. Acquisition is
configured aCis data, not a claim about official server rules or completed gameplay.
No grants, class mutation, purchases, recipe learning or live manufacture occurred.

Independent source checkpoints saved locally:6ada82a adds BSP interval admission
and explicit-metric time adjustment (106+144 new native comparisons,29 JS cases).
495079b adds gauge rectangles/full texture spans (60 comparisons over263 decoded
instructions;123anchors/14bodies/13ranges). A second read-only review reproduced
the gauge argument assembly and material boundary. World gauge placement/effective
material state and BSP flagged-plane/metric bindings remain unresolved; neither
investigation changes the live camera or replaces the authored cast bar.

Placement repair completed from fresh source: retain admitted saved positions,
use qualified vertical reset metadata when the merged browser bar is offscreen,
and preserve the main BottomRight when rotating. Expansion no longer applies
an extra negative root margin. Fresh script verification now accompanies the
original packet checker; it confirms page wrapping, plain1–10 page labels,
one-extra/two-extra/collapsed expansion and hidden JoypadBtn until enabled.
The browser repair uses a verified full-script reset as an explicit adaptation;
native horizontal missing-default behavior and independent/vertical extra-page
geometry/controls remain unresolved. No numerical screen margin was invented.

Real mouse drag initially reached dragenter but no final dragover, so the browser
discarded the drop. Both now accept the copy operation; the inspector retains
bounded DOM drag receipts. Registration→echo→click/F1→AE→tree, removal→echo→inert
F1,12→24→36→12 expansion, page9↔0 wrap, and restored shortcut with no book all
passed in the browser. Main Online reconnect restored the actual previous bars;
Common Craft opened General Book0/50. Only the known unhandled-gauge warning
remains in the current main run; no new recipe/shortcut errors. Final screenshots
are private recipe-shortcuts-online.png and recipe-shortcuts-final.png under
tmp/restart-audit. Inspector replay remains visibly labeled as offline evidence.

Final validation:668 aggregate client/gateway/playtest Node tests pass, including
12 positioning cases;8 focused battery entries pass,200 registered suites and
zero unclassified. Fresh original recipe/export/pixel, shortcut-script/native,
layout/default, gauge and BSP checks pass. Local code/doc/tool changes only;
original assets, generated catalogs and receipts remain unstaged. Next genuine
craft requires normal dwarf progression or an eligible real common recipe;
source gauge placement/material closure and complete world collision remain
parallel work. Full-port goal stays active.

## Independent shortcut drawers and ordinary Dwarf entry

Continued the full-port goal with AutoLearnSkills unchanged. Original ScriptText,
XDAT window fields, native serializer/getters and completed drawer placement now
back three independently selected shortcut pages in both orientations. The extra
pages initialize to1/2 separately from main0, wrap independently, permit duplicate
views and repaint from received bindings. F1–F12 remains on the main page. Exact
subwindow controls, page-label anchors/alignment and locked/unlocked artwork are
used; rotation and expansion preserve the main corner. Native drawer transition
motion/clipping, full drag/swap/lock behavior and joypad remain open.

Fresh XDAT regeneration exposed nested QuestTreeWnd beneath MainWnd. The layout
lookup now admits canonical paths and unique nested-window aliases, refuses
ambiguous paths and preserves top-level names. Browser boot recovered. Independent
review then reproduced a concurrent-load regression with distinct parsed trees;
coalescing one load fixes it, with a new failing-before/passing-after regression.

A one-character account previously auto-entered, hiding its only Create button.
Every nonempty account now reaches the existing selector; explicit cc=0 retains
the legacy path. Deferred metadata and both overlays retire with the session.
Through normal browser controls, a male Dwarf was created and selected without
grants or database edits. Entry exposed equipment sent to the old model during
async loading. Successful adoption now replays the latest authoritative paperdoll
before choosing the wait pose, without a repeated equip sound. Fresh original
weapon/socket checks found the real club assets present; no grip was invented.
Browser reload/reconnect visibly retained the club. An ordinary Gremlin target
and F1 attack completed combat, awarding145XP/10SP/32Adena and reaching level2.
The status panel and subsequent fresh-login selection list confirmed level2;
these are configured-server results, not a
claim about official rewards. Higher-level Dwarf skills/crafting remain untested.

Region23_12 lacked source static collision. Existing verified export gates admit
all789 original actors/121 meshes,149,497 placed triangles. The private sidecar
and scene reference were adopted after backups; all653 other files were unchanged.
Browser loaded those counts. A visible stone-support click hit source actor120,
triangle267 at rounded L2(107867,-172855,-527). This is a real static-picking
check, not proof of exact native sweep, movement arrival or all platform routes.
The known unsupported playSound warnings remain; no new current-run layout,
model or collision error was captured. Receipts/screenshots stay in ignored tmp.

Parallel source-only evidence also advanced: BSP bevel admission now compares787
cases against184 original instructions, with33 JS cases overall. Later bevel
construction, flagged planes and native metric bindings still block complete
sweeps, so the live camera is unchanged. Gauge evidence now pins alpha128,
seven original texture records and the named material-wrapper path;193 anchors,
14 draw/state bodies and20 source ranges pass. Live Canvas state, actor anchoring
and erased helper bindings remain unresolved; no approximate gauge was enabled.

Validation:691 aggregate client/gateway/playtest tests passed before the final
load-coalescing correction;30 focused layout/shortcut tests and an independent
7-case layout rerun passed after it. Eleven focused battery entries passed;
202 suites are registered with zero unclassified. Seventeen XDAT parser cases,
fresh native shortcut/layout/gauge/BSP checks, regenerated interface/texture refs,
and freshly derived shortcut-slot checks pass. default.black remains an explicit
unresolved texture reference. Local commits3e0324b/805f40f/08f610d/968d279 preserve
code and evidence only; private generated catalogs, world data and originals
remain unstaged. Nothing was pushed. The full-port goal remains active.

Next Target investigation: original ActionWnd ID4 dispatches to GetNextEnemy,
filters attackable living actors, cycles beyond its remembered result's scalar
distance and wraps, then sends ordinary0x04 Action. Browser currently forwards
RequestActionUse4, explaining the live inert button. The native scalar helper is
erased at10407dee; native map tie order and Actor.Location mapping are also open.
The new Elbera Tools verifier passes85 instruction anchors,10 ranges and6 network
vtable bindings against fresh originals. It preserves this bounded evidence without choosing a
2D/3D/squared metric or enabling a guessed selector. Next tasks remain ordinary
Dwarf progression/crafting, this native target boundary, face/hair application,
source gauges, complete camera collision and the full PORT-COVERAGE inventory.

## Original face selection and received corpse state

AutoLearnSkills remains True; the manual trainer path remains in scope. The
full-port goal is still active. Current UserInfo now supplies sex/face/hair
fields directly instead of borrowing stale selection data or fabricating zero.
CharInfo retains the same exact appearance fields for remote players. Native
wire evidence checks29 original anchors, two formats and eight destinations.

The shared Character renderer now applies explicit original face indices.
Fresh chargrp/native selectors bind14 source face meshes and42 textures;
the private catalog is emitted only after14 mesh position sets (2,713 unique
positions) and2,752,512 original RGBA texels match their built counterparts exactly. No tolerance,
recoloring or face-index fallback is admitted. Twenty-eight native anchors and
42 instruction-backed address arithmetic cases pass; these are not native
emulation. UVs, topology, weights, full shader state and the original generic
group resolver remain separate evidence gaps.

Self and remote appearance merge only explicit fields, keep the latest update
during model loading and cancel on replacement/removal/disconnect. Identical
updates share pending image work; actor-owned material/map wrappers retire
without disposing shared source images. The existing Elbera Tools pawn page
now exposes exact face choices and source references. Browser checks exercised
Dwarf0/1/2, female human fighter0/1/2 and model replacement; the inspector had
no captured warnings/errors. Hair fields are preserved but runtime hair
selection is still unsupported. Mid-session sex/class changes do not yet
reselect an already-loaded model; live two-player appearance remains untested.

The configured server's exact signed Die sweepable word now reaches the actor
incarnation, including a loading NPC. Absent values stay unknown; revive,
removal and session reset clear them. Duplicate NPC death messages retire an
older fade timer before scheduling another, preventing stale post-revive fades.
No glow or client-side Sweeper permission was invented. Original OnDie evidence
grew to112 anchors/15 ranges, including its exact spoil-effect reference; the
protected parameter binding and live skill/effect path remain unresolved.

Ordinary Dwarf Gremlin combat progressed to level3. A fresh page and connection
to the updated bridge retained level3,40SP and the equipped starter club; one
further ordinary fight awarded145XP/10SP/38Adena. No grants, database edits,
teleports or recipe injection were used. Current-run browser warnings were the
already-known unsupported playSound operations, with no new appearance/model
error. Higher Dwarf progression, crafting and Spoil/Sweeper remain unverified.

Validation:730 aggregate client/gateway/playtest tests passed, six portable
exporter cases passed, seven focused battery entries passed, and the existing
battery-runner regression passed. Independent review repeated the fresh source
catalog check and found no actionable lifecycle or source-binding issue. Private
catalogs, original packages, accounts and browser receipts remain local. The
creator face path and original hair-selector audit continue as separate work.

The creator now reuses the shared source-bound face controller and preserves
source indices through its actual creation request. It no longer uses legacy
face fallbacks, suffix-matched materials or a separate sampler approximation.
Ten actual-creator portable tests cover source indices, model/page retirement,
restoration and missing metadata. Ordinary browser creation of a female Human
Fighter with face C, entry and fresh-page reconnect passed; the existing visible
body inspector confirmed ready face2/FFighter.FFighter_m000_t02_f. Its diagnostics
now include appearance status, and world diagnostics no longer cover selection
or creation overlays.740 aggregate tests pass after these additions.

The bounded original hair audit recovered separate Hair1/Hair2 mesh indices,
absent-part rules and color-selected materials. All22 default parts across14
models match original LOD0 position sets;162 mesh and648 material references
resolve under the explicitly documented unique-package-leaf census.78 native
anchors/nine ranges and six portable parser cases pass. No hair runtime was
enabled: group resolution, alternate skeletal exports, FinalBlend state and
equipment/body overrides remain open. The creator's inherited tint remains
an explicit unsupported approximation, not source proof.

## Original hair data and creator correction — 27 September 2026

- Added Elbera Tools original-hair export and static browser inspection. All162
  referenced meshes retain original LOD0 positions, UVs, triangle order, bind
  bones and unmodified influences;648 selected material references retain exact
  source identity and decoded images. Content hashes are checked before display.
- Recovered ordinary Texture/FinalBlend material pass state: source-specific
  alpha references, strict GREATER including enabled zero, blend, depth and
  culling. The adapter rejects tinted/reused materials and preserves sampler
  ownership. Static inspection does not certify native lighting or sampling.
- Corrected creation data/UI to the original five male/seven female styles,
  four colors and three faces, using source language labels/indices. Removed
  invented RGB tint/swatches and the false painted-hair interpretation. Missing
  source choices prevent submission; hair choices visibly lack a preview.
- Preserved all17 UserInfo and12 CharInfo equipment words, distinguishing self
  presence object IDs from remote template IDs. Removed secondary-hand aliasing;
  late model admission now uses the latest remote equipment, including zero.
- All22 current default hair parts match original triangle position/UV/winding,
  but their3245 emitted vertices differ in skin influences. Native attachment
  must be recovered before treating that adaptation as equivalent. This is an
  explicit gap, not proof that different weights alone imply different output.

Verification:768 combined browser-runtime/creator/gateway/playtest fixture cases
passed before the final inspector PolyFlags gate; the final10 inspector cases
also pass. Twelve exporter,16 material-source and5 creation-source portable
cases pass without original files or third-party Python packages. The actual
battery ran all6 selected appearance suites successfully; other suites were
excluded. Its independent runner check passes. Fresh private export/check
matched all mesh/PNG/catalog bytes. Native creation, equipment and hair-material
checks pass against pinned originals.

Browser checks: Online reconnect and entry as the existing ElberaVisor succeeded
with the refreshed gateway/client. Male/female creator lists show5/7 styles and
four text color choices. The hair inspector displayed rigid Dwarf, soft-rig
Dark Elf (static only), Human Fighter AlphaRef0 and explicit absent slots, with
no browser errors observed. A curated actual screenshot is in docs/img/; raw
assets and receipts remain ignored. Live two-player equipment changes and
animated hair selection are still unverified.

## Native hair attachment and source-build correction — 27 September 2026

The original hair exporter no longer requires converted player models. Optional
`--compare-built` retains the separate geometry comparison; ordinary export and
the static inspector run from original inputs alone. Fresh export and read-only
check pass for all 162 meshes/876 material graph nodes. Browser checks displayed
rigid Dwarf and static soft-rig Dark Elf hair without errors.

The character builder now selects base style/color zero from decoded hair
records instead of deriving filenames from face names. Exact qualified texture
children are freshly decoded with unchanged RGBA; hair no longer uses library
siblings, mesh-slot substitutions or missing-texture drops. All14 source
defaults resolve to 22 present parts and 6 explicit absences. An isolated Human
Fighter female build produced7 parts/100 clips; both hair images match source
pixels and both triangle position/UV/winding multisets match original LOD0.
Ten active model/manifest/image files remained byte-identical. The existing
assembler still rewrites skin influences; that is not attachment parity.
The scale audit's caller now handles explicit source absence and exact mesh
identity, and freshly checks14 models/92 parts with zero local-scale difference.

A new Elbera Tools verifier distinguishes148 ordinary and 14 dynamic hair
meshes from the original saved dispatch word, reads14 pawn class defaults and
checks retained quaternion/master-coordinate arithmetic. Two hundred synthetic
composition cases and 150 original dynamic reference bones pass their bounded
instruction comparisons. Both native paths select a master head record; raw
weight differences alone cannot prove visually incorrect browser attachment.

An optional separately pinned archive copy supplies four named coordinate/matrix
imports in exactly matched surrounding blocks. Its provenance and the protected
owned copy's runtime restoration remain unverified. It is comparison evidence,
not an adopted executable or a completed transform implementation. Original
files, generated catalogs, staged characters and raw receipts remain private.
The full browser-port goal remains active.

The supplemental check additionally compares the entire2379-byte player
MeshToWorld method:25 named imports,10 same-target direct calls and one bounded
exception-handler relocation account for every changed byte. Five complete
Core bodies match the archive's companion Core exactly. Archive consistency
is checked through range hashes and member/header CRCs; vendor authenticity
and complete protected-runtime equivalence are not inferred.

Review found and fixed a false-success exit in the character builder. Failed
requested builds now return nonzero; all-failed runs preserve the existing
manifest. Partial successes merge but still return failure. Existing late
output writes are not transactional and remain a separate pipeline limitation.
Final focused validation:14 exporter,11 default-builder,17 attachment and 8
synthetic PE/comparison cases pass; all 4 selected battery suites pass, with 127
excluded. The battery-runner check and owned/supplemental source checks pass.
The PE comparison fixtures use Capstone 5.0.7; the other three suites also pass
without site packages. A curated actual soft-hair inspector screenshot is
included in the public guide, with its static-view limitation stated.


## Original sparse animation poses — 27 September 2026

Elbera Tools now retains every original sparse quaternion, translation and time
key from all 14 player exports: 1,367 sequences and 110,512 ordinary tracks.
Timing/notify consumers keep the existing API and freshly match the private
pawn catalog. A separate read-only-by-default exporter writes only ignored
source-key JSON when explicitly requested; no PSA resampling, normalization or
fabricated keys enters this path.

Recovered ordinary quaternion interpolation preserves its original branch
thresholds and Float32 stores. Source-key search, closing-pair hemisphere choice
and translation use retained original instructions. The named quaternion math
imports remain comparative evidence from the explicitly pinned supplemental
copy; host trigonometry and x87 precision are bounded approximations, not native
bit-parity claims. Native checks pass 210 quaternion instruction cases and 687
track-operation cases, with 59 source/browser differential cases.

The existing pawn inspector now offers an opt-in original-key preview. It
compares against an isolated exported pose, including the closing interval,
and visibly rejects missing/ambiguous binding records. Thirteen skeletons match
by exact source name plus parent identity. Male Human Fighter needs explicit
binding metadata for a source/export finger-name difference; two additional
index swaps are explained by a private original-part reconstruction. The tool
never patches that discrepancy with a guessed alias. Fifteen original empty
sequence maps stay unsupported.

Review fixed stale loads overriding newer playback and retired Three mixer
state before every comparison, including unchanged/constant tracks. Original
sequence period remains distinct from movement key-time duration. Focused
portable fixtures cover these failures and the actual browser math; original
checks confirm all 14 freshly exported JSONs and unchanged timing/notify output.
The browser displayed Human Fighter female and Dark Elf female source-key
casting, restored exported playback when toggled off, and visibly rejected the
Human Fighter male mismatch. A curated actual screenshot and usage guide are
published with explicit inspection-only limits.

The rich README hero and original gallery restored in PR #6 are retained. Game
playback still uses its existing exported poses; native mesh linkup, current
hierarchy, initial tweening, modifiers, mixing, skill effects and animated hair
remain part of the active full-port goal. No original client payloads, generated
key catalogs or raw evidence receipts are included in public changes.

Final focused validation: all 7 selected battery suites passed, with 129 unrelated
suites excluded; the battery runner's argument/exit checks also passed. The
source parser/exporter suites passed 25 cases, and the source-free quaternion
suite passed 10. Fresh all 14 JSON byte checks, the original timing/notify check,
and both retained-instruction verifiers passed. These results establish the
bounded decoder, arithmetic and inspection behavior described above.


## Original face linkup and neutral hierarchy — 27 September 2026

The paired original skeleton exporter now joins fresh class Mesh defaults,
unique chargrp face entries, original stored animation references and same-package
name-table tokens. All 14 private sidecars freshly byte-check; all 1,139 face
bones match exported names/parents. First-name native linkup leaves the male
Human Fighter right finger unmatched (69/70); retained GetFrame evidence copies
its original face reference q/p while its child still animates. No alias added.
Empty serialized movement BoneIndices no longer gate this ordinary native path.

The pawn inspector now samples original keys, selects source reference locals
for unmatched bones and computes neutral current-parent coordinates. Measured
B*C*B^-1 matrices drive existing browser bones without quaternion decomposition;
all manual matrices/flags restore before export sampling, model disposal or
errors. The two source files load together with model/package/export identity
checks and late intent/model guards. Root lock, additional modifiers, mixing,
initial tween and actor/world/native deformation remain outside this neutral
view; gameplay still uses exported animation. Existing part inverse binds are
preserved. Two source-reference differences reflect canonical upper-body nodes,
not a proven defect: fresh investigated part inverse binds retain their own
original references.

Validation: 9 focused battery suites pass, 130 excluded; battery runner check
passes. Exporter has14 source-free tests, linkup9, coordinate Python11/Node8,
sourcepose11 and actual inspector10 (including real source matrix lifecycle).
Original checks cover28 linkup anchors/185 matched bytes/105 integer cases;
49 fallback anchors/117 instruction cases;888 Core coordinate cases/427 body
instructions plus104 quaternion cases. Cross-language coordinate outputs654
match Float32 bits within the stated Float64/x87 approximation. Fresh original
sidecars and a private all14/70pose comparison pass; no rendering-parity inference.

GUI checked male Human Fighter69/70+1reference, female Human Fighter76/76 and
male Dark Elf82/82; source scrub/play, closing interval and return to exported
playback worked without browser warnings. Curated source-hierarchy capture and
README/docs preserve all previous gallery images. Publication boundary excludes
originals, generated skeleton/track catalogs and private evidence receipts.
Next: trace/admit native initial tween and modifier/mixing inputs, integrate
proved pose paths into actual gameplay, then native skin/attachment and actor
placement. Full browser client goal remains active.

## Original animation in live Character playback — 27 September 2026

On `codex/native-animation-transitions`, based on public PR #8 merge `3c0f261`.
The original-key/hierarchy path now feeds actual Character wait, sit, stand and
ordinary cast schedules at exact nonnegative channel frames. Cast plans retain
their original sequence identities; wait segments retain their own frame even
when AnimEnd changes the channel in the same tick. Manual matrices retire before
mixer work, cancellation, movement, one-shots, completion and model replacement.
Overlapping older model loads cannot replace the latest model or source rig.
Negative-frame initial transitions stay explicitly exported/unavailable; no
Three TRS pose is relabelled as a native cache. Other movement, attack and social
paths remain exported. The source rig exposes raw first keys separately from
ordinary sample(0), whose tiny-interval rule may choose the next key.

Elbera Tools `export_source_tracks.py --runtime` packages all 14 original source
catalogs and skeletons in an authored lossless ELBA container. All 1,367 sequences
and every original key survive; private outputs total 76,603,596 bytes versus
220,075,349 bytes of track JSON. Strict immutable browser decoding is shared per
model; key arrays are lazy and prepared samplers avoid full validation/copying
on every tick. Complete decoded content and fresh byte checks passed for all14.
Private input/output files and raw receipts remain ignored.

The separate negative-frame tween helper and native verifier recover incremental
source-local cache interpolation, raw destination keys, unconditional Core
normalization and bookkeeping. 31 anchors, five optional exact supplemental
blocks, 510 interpreted cases/36,071 instructions and123 browser comparisons pass.
Ordinary sampling does not update prior tween bookkeeping. Empty-cache setup
clears previous frame to zero; conditional masked-division instruction cases
show the reset result, but the active rendering thread's exception mask and
complete cache lifetime are still unproved. Zero previous frame remains rejected
by the helper; this research does not silently enable live native transitions.

Validation:11 actual Character/Three fixtures (including delayed model overlap
and real cast-plan identity),8 transport fixtures,18 exporter/codec Python tests,
17 prepared-track tests,13 rig tests,12 tween JS and11 tween Python tests pass.
The larger Character/cast/wait/inspector regression selection passed116 cases
before the final two new integration cases; the focused current selection passed
48. Original sparse-track retained-instruction check and59 browser comparisons
still pass. Eight selected battery suites pass,135 excluded; runner checks pass.
An independent agent diff review found no blocker.

GUI: male Human Fighter Sit→SitWait and Stand→Wait report69 mapped+1 reference
bone; ordinary cast reports its negative transition unavailable then original
CastMid, and cancellation completes cleanly. In the actual online world, existing
ElberaVisor loads female Human Fighter Wait_1HS_FFighter with76 source matrices
and76 matched bones. No inspector warnings/errors; online PlaySound warnings
remain the previously documented unsupported audio path. Curated live-player
inspector screenshot is added alongside every earlier README/gallery image.
Camera body measurements expose pose ownership only in existing dev tools.

Next: bind native exception/cache initialization for the first transition, then
use true cached source locals through transitions; continue native modifiers,
skin/attachment/effect anchors and remaining gameplay/UI/world gaps. Full browser
client goal remains active, with this playback slice only a milestone.

## Original pose transitions and NPC selector recovery — 27 September 2026

Resumed on `codex/native-transition-cache`, from public PR #9 merge `b7904cd`.
Live Character wait, sit, stand and ordinary cast schedules now use recovered
negative-frame tween arithmetic with evaluated original local poses. A fresh
ordinary source instance first samples frame zero, then performs the separate
masked zero-previous-frame reset on its next negative evaluation. Every mapped
bone consumes the same incoming bookkeeping; missing links retain the original
reference pose. Ordinary positive sampling never resets tween bookkeeping.

Elbera Tools now verifies original repeat-evaluation keys, cache validity and
fresh channel fields, the default-template allocation/constructor chain, and
the normal Windows/CRT floating-point contract. Browser update epochs and
successful-display commits remain explicit adaptations. An exported-only gap
after source evaluation loses known history; positive sampling cannot silently
repair it. Custom templates, modified native control words, callback-triggered
bone queries, actor modifiers, native skinning and hair attachment remain open.
The wait endpoint advances the animation clock and calls NotifyAnimEnd; it no
longer manufactures an extra evaluated source pose for every crossed segment.

The existing NPC variants tool now has a separate selector-only mode. It follows
qualified per-NPC class inheritance, per-element localized fields and each
mesh's serialized animation reference, preserving original sequence frames and
Float32 rates. Fresh Gremlin and fox checks are reproducible; this is not a
full-roster check or browser integration. Missing fields, explicit None and
unverified historical clip aliases stay distinct. The existing ten bounded
corpse/social overrides remain unchanged.

Validation: the isolated public workflow commands pass after correcting an
outdated test method lookup; its full animation group passes 159 tests. The
remaining groups include 131 protocol/lifecycle, 81 appearance and 4 Java-config
cases, Python decoder/native fixtures and standalone toolkit packaging. One
private-corpus fixture is intentionally skipped in that source-only tree.
New portable suites cover 14 NPC-selector cases, 8 cache cases and 5 FPU cases;
tween suites pass 13 JavaScript and 12 Python cases. Private original-input
checks include 510 tween instruction cases with 127 browser/reference comparisons
and 114 sit/stand anchors. Native allocation checks cover 40 anchors, 7 exact
supplemental blocks and 16 identical Core bodies. These bounded comparisons do
not claim complete native client execution or exact CRT transcendental math.

GUI: fresh male Human Fighter Sit → Stand → Wait and casting show original
cached transitions with 69 mapped bones plus 1 reference; female Human Fighter
casting shows 76 mapped bones. The inspector retains the actual last observed
transition and clears old replay readouts when changing models. No browser
warnings/errors appeared in the checked replay. Sound playback stayed off;
the existing unresolved original sit/stand audio reference remains visible.
A new direct inspector capture accompanies the preserved README/gallery images.
Originals, generated bundles/catalogs, local accounts and raw receipts remain
outside publication. The separate Core 0.1.0 release has not gained these newer
browser/native tools; the catalog states that boundary.

Next: admit original NPC state/stance/rate inputs and reuse the sparse-pose
pipeline for real NPC playback, then continue skin/attachment, effect anchors,
world and full gameplay/UI gaps. The full browser-port goal remains active.


## Original NPC source inspection and packet retention — 27 September 2026

Continued on `codex/native-npc-playback` from public PR #10 merge `e04fa66`.
Gremlin 20001 and Young Fox 20091 now have lossless source bundles with explicit
NPC skeleton identities, qualified mesh/animation references and all eight
original sequences each. The existing entity loader validates actual glTF,
geometry-buffer and bundle bytes together, then creates a separate scene per
actor while sharing immutable source data. Late upgrades cannot attach to
removed/replaced NPCs; retirement clears owned timers, mixers and placeholders.

The existing Elbera NPC inspector now exposes every recovered sequence, a
manual source timeline, normalized-frame scrubbing and exact local-pose
restoration. One-frame DeathWait works without an invented animation duration
rule. Original geometry matches triangle positions, UVs and winding; converted
skin influence records still differ at 582 Gremlin and 215 Fox vertices. The
inspector makes those limits visible. It does not enable native NPC gameplay
state selection or execute original notifies, effects or sound callbacks.

Native tracing corrected opcode 0x16 byte 25 from the inherited name-display
label to Controller.WaitType. The gateway now retains raw WaitType, combat,
all three equipment fields, summon-animation byte and the complete optional
post-string tail. Missing/truncated tails stay absent. Entity snapshots deep
copy/freeze these inputs. Original initial rate and stance inputs are now
bounded evidence, but the configured server sends summon byte 2, which invokes
SpawnEnterEvent; abnormal-state and fresh-instance admission cannot be inferred
from empty equipment alone. Automatic source NPC gameplay remains disabled.

Portable tests cover transport identities, exact verified-byte consumption,
retries, actor isolation, async model retirement, matrix restoration, all source
sequence types and raw packet values. All 14 existing player codec outputs remain
byte-identical. The browser exercised all 16 NPC sequences, both playback/pause
and restoration, plus the existing angel-corpse/material path, with no new
warnings/errors in the inspector. After a loopback-gateway restart, the existing
ElberaVisor character re-entered Talking Island with Gremlins visible; the
previously known unhandled PlaySound warnings remain. A direct Gremlin
combat-wait capture preserves the README's
existing hero/gallery and adds this tool layout. Private originals, generated
bundles and raw receipts remain outside publication; Core 0.1.0 remains the
previous smaller standalone release.

Next: resolve native SpawnEnterEvent and abnormal-state lifecycle, then connect
admitted source NPC states and replace mismatched skin influences using original
mesh data. Movement, attacks, casts, notifications and effects require their own
source rules; source inspection is a milestone, not the full browser-port goal.

## Original NPC GPU weights and spawn-event boundary — 27 September 2026

Continued on `codex/native-npc-state-and-skin` from public PR #11 merge
`ebb24da`. The original meshes contain two weight representations. Fresh
conversion explains every current Gremlin/Fox glTF vertex: the old exporter
uses lazy influences, quantizes them into bytes and normalizes; the assembler
normalizes again. The earlier 582/215 differences compare that output with the
separate stored GPU stream. No unexplained bone-set change or dropped influence
was found in these two models.

The new Elbera native check pins 78 serializer and 55 consumer anchors, bounded
supplemental correspondences, and all 1,746 original soft52 vertex records.
It establishes conditional native GPU stream binding, not complete shader or
CPU deformation parity. `--npc-skin` carries exact ordered lanes in the existing
private source bundles. No converted glTF, geometry buffer, animation key or
inverse-bind matrix is rewritten. Repeated bones remain repeated; nonunit sums
are not repaired. The browser replaces actor-owned attributes after the actual
GLTFLoader's normalization step, verifies source-to-joint ordering and disposes
only its owned geometry on retirement or an obsolete/failed upgrade.

All 1,746 records match original lane bytes through bundle JSON and the actual
browser decoder. Portable actual-loader tests additionally cover reordered
joints, signed zero, sentinel and zero-weight rows, shared geometry, rejected
joins and atomic failure. The isolated public workflow passes all 23 commands:
420 Node tests and 235 Python test executions, including standalone Core smoke
checks. All 14 player bundle hashes remain unchanged. Fresh NPC generation and
`--check` agree.

The browser exercised all 16 source sequences with the corrected inputs,
timeline playback, restoration and model changes. Both models rendered; the
inspector reported no warnings/errors. The refreshed live client re-entered
Talking Island as the existing ElberaVisor character, with Gremlins visible.
The known unhandled PlaySound warning remains. The README retains its gallery
and updates the actual Gremlin tool capture with the source-weight status.

Separately, the native state verifier now reads all 1,152 original enter-event
records and checks the exact lookup-miss path. Gremlin/Fox IDs are absent, so
their SpawnEnterEvent call returns before its effect/animation branches. The
initial wait also precedes packet abnormal-mask assignment. This does not prove
all fresh actor state neutral: abnormal-list lifecycle, other modifiers and
complete state transitions remain unresolved. Automatic native NPC animation
playback stays off.

Code, synthetic fixtures, guides and the selected screenshot are public-release
material. Original inputs, generated bundles and raw local receipts stay private;
Core 0.1.0 remains the earlier smaller standalone toolkit. Next: close the fresh
actor/modifier admission boundary, connect original NPC state playback, and
continue movement, attack/cast/death schedules, effects and the full-client gaps.

## Standalone NPC Source toolkit — 27 September 2026

Added the separate Elbera Tools NPC Source 0.1.0 release profile. It packages
the existing qualified NPC selector recovery, original sparse-key transport,
optional GPU input lanes, and bounded initial-animation/GPU evidence checks.
Its 43 text files and hash manifest contain no browser application, graphical
inspector, client files, converted models or generated game data. Users supply
their own original inputs; runtime export additionally checks their matching
converted geometry. The guide distinguishes each command's reads and writes,
the selected-set index behavior, native evidence limits and external dependencies.

The new profile reuses Core's deterministic allowlist/archive machinery.
Core's original profile produces identical bytes for identical inputs. Source
selector recovery now imports the old conversion stack only when the separate
legacy model-build path is called, reducing the NPC production dependency set
from 36 to 32 modules. No decoder or browser runtime was duplicated.

The extracted NPC archive passes 89 standard-library test executions and 97
with the optional pinned Capstone PE cases; no original-input tests silently
activate when users add their game files. Nine packaging cases cover the
manifest, deterministic output, source changes, symlinks, missing/binary inputs,
adjacent private-file exclusion and isolated extraction. Candidates explicitly
record working-tree provenance; reviewed releases are rebuilt from committed
source. CI now exercises both standalone profiles. The README keeps its full
gallery and distinguishes the two downloads from the complete repository.

Native spawn research continues separately. Constructor-return defaults,
startup script dispatch, earlier animation requests and later native selection
must remain distinct. Shipping analysis tools does not admit automatic native
NPC state playback or complete the full browser-client goal.

## Fresh animation notification default — 27 September 2026

The later pose-cache allocator proof supersedes the old claim that a fresh
channel's notification-disable field was unknown. The notify verifier now
accepts an explicit supplemental Engine input and reuses that existing check:
newly appended 112-byte channels have +0x44 zero. Without the comparison it
reports the caller binding as unbound; wrong or missing supplied files fail.
The archive remains unauthenticated, and existing channels, later enable calls,
actor/sequence eligibility and callbacks remain separate conditions. Updated
the evidence guides and runtime comments; browser behavior is unchanged.

Both original-input modes pass the retained 91 anchors, 16 ranges, 90 boundary
cases and six arithmetic executions. The 23 portable notify cases, eight
allocation/cache cases and six browser-clock cases pass. Independent review
checked failure handling and corrected an overstatement of the compared
78-byte allocation prefix as a complete function.

Private original-source investigation continues through NPC owner callbacks,
constructor/controller values, client startup scripts, volume guards and the
full resource-setup suffix. An earlier shortened SetPawnResource range located
the stance write but did not cover the remaining resource work. The full
ordinary method also adjusts accessory fields and resource flags; mesh loading
can queue asynchronously. These are explicit integration dependencies, not
reasons to infer a neutral live actor. Automatic original NPC playback remains
off while those finite joins are verified. No new gameplay parity is claimed
for this evidence correction, and the full browser-client goal remains active.

## Complete native method boundaries — 27 September 2026

The channel allocator comparison now covers its complete 80-byte body, including
all bytes of `ret 4`; SetMesh likewise covers 144 bytes through its return.
Earlier ends cut through those instructions. The cache and standalone tween
checks now reject partial instruction ranges. Independent review reproduced the
full comparisons, deliberately restored the truncated endpoints in memory and
confirmed rejection, and reran 20 portable cases plus native cache/tween checks.
This strengthens evidence framing without changing browser behavior.

## Original NPC notify objects — 27 September 2026

The NPC collector now reuses the player notify decoder instead of transporting
only raw object references. It retains all 34 original Gremlin/Fox events,
qualified classes, exact normalized times, source-object hashes and explicit
sound fields/default provenance. Engine.u must match selector recovery. The
16 sequence key payloads, both skeletons/GPU inputs and all 14 player bundles
remain unchanged. The existing NPC inspector shows compact ordered event cards
with expandable raw evidence; it dispatches no effects or sounds.

Verification: 35 portable export cases, 16 pawn-source cases (including the
private original comparison), 30 browser-module cases, fresh NPC export/check,
and independent review. The extracted standalone profile passes 98 cases with
the optional pinned synthetic PE suite; its 43-file allowlist already contains
the reused helpers. Browser checks covered both NPCs, attack events, empty
one-frame corpse events, timeline play/pause, restore and expandable evidence,
with no warning/error logs. A curated actual tool screenshot accompanies the
updated guide; existing README galleries remain intact. Published NPC Source
0.1.0 is immutable and predates this metadata addition.

Private native investigation also closes bounded fresh mesh setup and the
Talking Island zone/volume class census. Post-load animation linkage and
decoration initialization are being checked before live original NPC startup
can be admitted. Original Wait sounds have Random=30 and attack-wait sounds
Random=50; the current supported direct-sound runtime only admits Random=100.
Resolving that original RNG/dispatch path remains real work, not permission to
drop events or invent a browser probability. Automatic native NPC playback is
still off. The full browser-client goal remains active.
