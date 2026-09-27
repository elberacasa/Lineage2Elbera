# Elbera Tools

Reusable tools developed while porting Lineage 2 Interlude to the browser.
They read original data, preserve its provenance, and test specific recovered
rules. The full collection remains a repository toolkit, not a claim of
complete client compatibility. [Elbera Tools Core](release/CORE-README.md) is a
separate allowlisted Python source kit: l2lib, the UTX editor, script extractor
and XDAT decoder, with portable checks and no game/app assets. Its release
builder tests the actual archive in an isolated directory before writing it.

[Elbera Tools NPC Source](release/NPC-SOURCE-README.md) is a second standalone
kit for qualified NPC selectors, original sparse-key bundles and optional GPU
weight inputs, plus the bounded initial-animation and GPU native verifiers.
It includes 43 text files and a hash manifest. Portable checks need only Python;
optional PE fixtures and original native checks require Capstone 5.0.7. Runtime
bundle export needs your matching converted model data. The graphical NPC
inspector remains in the full project. See the guide for the four supported
command paths; bundled support modules are not additional standalone commands.

Run commands below from the repository root. Python tools use the existing
repository modules; native verifiers also require `pefile` and `capstone`.
Game files are supplied locally by the operator and are never included in
the tool collection. Source-dependent commands reject unsupported or changed
inputs rather than treating another build as equivalent.

## Decoding and source verification

| Tool | Command | Scope and limits |
| --- | --- | --- |
| Original script extraction | `python3 tools/uscript/extract_uscript.py --check` | Bounded TextBuffer reads, unique class validation, no cross-export look-ahead. Checks supplied UI packages without writing their private source text. |
| Original hair assets | `python3 tools/dat/build_hair.py --check` | All162 source meshes, unchanged LOD0 weights/indices/UVs and 648 material references. No converted player models required; optional `--compare-built` checks existing browser geometry separately. Omit `--check` to generate private outputs. Full body attachment remains unresolved. [Pipeline](../docs/hair-asset-pipeline.md). |
| Original hair attachment | `python3 tools/ui/check_hair_attachment_native.py --check` | Distinguishes ordinary/dynamic dispatch, master-head records and retained coordinate arithmetic. `--audit-assets` freshly checks all 162 original meshes and 14 pawn defaults. Optional pinned comparison-copy checks identify four imports in exactly matched surrounding blocks; archive authenticity and browser attachment remain separate. [Evidence](../docs/native-hair-attachment-evidence.md). |
| Supplemental Engine comparison | `python3 tools/ui/check_supplemental_engine.py --engine /private/path/engine.dll --core /private/path/Core.dll --check` | Explicit pinned archive inputs plus owned originals. Compares the complete 2379-byte player-placement method and five exact Core bodies, without running binaries. Requires Capstone; archive provenance and complete runtime equivalence remain unverified. [Retrieval, checks and limits](../docs/supplemental-engine-evidence.md). |
| Creation appearance choices | `python3 tools/ui/check_creation_appearance_native.py --check` | Original five male/seven female styles, four colors, three faces, language IDs and request fields. No guessed swatches or claim of creator screen parity. [Evidence](../docs/native-creation-appearance-evidence.md). |
| Quest journal | `python3 tools/dat/export_quests.py --check` | Re-decrypts and compares original records, exact boundaries and hashes; requires the generated private table. Does not prove server quest rewards. |
| NPC visual scale | `python3 tools/dat/export_npc_visuals.py --check` | Qualified class inheritance and mesh scale, independent of collision fitting. See [native actor evidence](../docs/native-actor-evidence.md) for default-stream limits. |
| Player visual scale export | `python3 tools/dat/export_player_visuals.py --check` | Fresh original fields, actual built-part identity and glTF/buffer hashes. `--write-manifest` records exact per-axis products; never infers scale from a silhouette. Placement remains separate. |
| Player scale audit | `python3 tools/dat/audit_player_transforms.py` | Original class/mesh transforms compared with actual-loader bounds; writes an ignored local receipt. Scale proof is separate from unresolved native placement. [Evidence](../docs/player-transform-audit.md). |
| Player placement/basis audit | `python3 tools/ui/check_player_transform_native.py --check --basis --output tmp/restart-audit/player-placement-native.json` | Original transform arithmetic and exact built POSITION-set comparison; unresolved matrix imports, instance flags, skinning and grounding prevent full placement certification. [Evidence](../docs/player-transform-audit.md). |
| Original grounding | `python3 tools/ui/check_grounding_native.py --check --output tmp/restart-audit/grounding/evidence.json` | Distinct local spawn and remote wait-correction paths, collision extent inputs and local-player exclusion. Does not replace native collision with a scalar ground offset. [Evidence](../docs/native-grounding-evidence.md). |
| Original camera | `python3 tools/ui/check_camera_native.py --check` | Native draw dispatch, configured camera extent, source equations, original INI defaults and world/static trace categories. Separates active native behavior from stored script. Does not certify the browser pivot or collision geometry. [Evidence](../docs/native-camera-evidence.md). |
| Original BSP collision arithmetic | `python3 tools/ui/check_bsp_camera_native.py --check` | Native comparisons cover primary traversal and plane clipping (108), branch/hull/bounds admission (224), final interval and explicit-metric adjustment (250), and bevel-axis admission (787). Leaf-hull framing preserves unresolved plane flags. Full sweeps, the distance metric, terrain and actor aggregation remain unported. [Evidence](../docs/native-camera-evidence.md). |
| Engine recovery boundary | `python3 tools/ui/check_engine_recovery_native.py --check` | Independent raw-byte round trips, three further startup layers and bounded handler-payload decompression. Works in memory; no DLL execution or decrypted payload output. Exact missing call bindings remain unresolved. [Evidence](../docs/native-engine-recovery-evidence.md). |
| NPC animation selectors and variants | `python3 tools/anim/build_npc_variants.py --selectors-only --npc 20001 20091` | Fresh qualified class inheritance, serialized mesh/animation binding and exact source sequence timing. No model rebuild; this collector also feeds the separate NPC runtime index for manual inspection. Automatic native state selection remains unsupported. `--check` compares an existing private catalog. Default mode still builds five bounded clips for four class variants. [Inputs, evidence and gaps](../docs/npc-animation-variants.md). |
| Missing pawn clips | `python3 tools/anim/recover_pawn_clips.py human_fighter_m` | Dry-run recovery of six original slots, with complete skeleton and per-key checks. Explicit `--write` appends verified clips while preserving existing model data. [Evidence and limits](../docs/pawn-clip-recovery-evidence.md). |
| Original sit/stand evidence | `python3 tools/anim/check_sitting_native.py --check --output tmp/restart-audit/sitting-animation.json` | Source wait-state branches, scalar rates, native AnimEnd handoff and snapshot timing limits. [Evidence](../docs/sitting-animation-audit.md). |
| Original sitting sound references | `python3 tools/anim/check_sitting_sound_refs.py` | Independent original notify/import/UAX checks; ambiguous output aliases remain unplayable. Requires private inputs. |
| Player posed bounds | `node tools/dat/audit_player_bounds.mjs --poses` | Actual-loader first/last source-key bounds and selected bones for idle/Sit/SitWait/Stand. Measures the current browser adaptation, never derives a native ground offset. Keep output private. |
| Original pawn timing | `python3 tools/anim/build_pawnanim.py --check` | Bounded original sequence traversal for 14 player models; exact frame/rate fields and ordered, class-identified notifies. Requires private source and generated timing data. [Contract and limits](../docs/pawn-animation-timing-evidence.md). |
| Original sparse animation keys | `python3 tools/anim/export_source_tracks.py` | Read-only by default; `--write` retains private source keys and hashes, `--check` compares a fresh decode. All 14 player exports; no PSA resampling or fabricated keys. [Browser preview](../docs/native-track-evidence.md#browser-pose-preview). |
| Original animation runtime | `python3 tools/anim/export_source_tracks.py --runtime` | Lossless private bundles for all 1,367 sequences; `--write` builds and `--check` freshly decodes. Strict immutable browser loader and prepared sampling support live wait/cast schedules. [Format, use and limits](../docs/original-animation-runtime.md). |
| Original NPC sparse runtime inputs | `python3 tools/anim/export_source_tracks.py --npc 20001 20091 --runtime` | Read-only by default; `--write` builds the private selected-set index and bundles, `--check` freshly compares them. All eight sequences each for Gremlin/fox, including one-frame corpse poses. Exact triangle geometry and bone-path checks; optional `--npc-skin` retains original GPU weight lanes after loader normalization. Full native skinning remains unverified. The entity loader admits inputs for manual inspection, not automatic native playback. [Inputs, browser route and limits](../docs/original-npc-animation-runtime.md). Included in [NPC Source](release/NPC-SOURCE-README.md), excluded from Core 0.1.0. |
| Original NPC GPU skin inputs | `python3 tools/ui/check_npc_skin_native.py --comparison-engine /path/to/pinned/engine.dll --check` | Original soft52 serializer, conditional GPU stream binding and all 1,746 source records checked. The optional source bundle carries exact lanes; full shader, inverse-bind and CPU deformation parity remain open. [Evidence and limits](../docs/native-npc-skin-evidence.md). |
| Original NPC initial-animation inputs | `python3 tools/ui/check_npc_animation_native.py --comparison-engine /path/to/pinned/engine.dll --comparison-core /path/to/pinned/Core.dll --check` | Owned originals plus explicitly supplied pinned supplemental binaries, read without executing them. Bounded initial-loop, packet, empty-equipment stance and fresh-allocation evidence; the original spawn-event table miss is closed for Gremlin/Fox, while fresh abnormal-state/modifier admission remains open. Portable synthetic checks are separate. [Evidence](../docs/native-npc-animation-evidence.md). |
| Original player skeletons | `python3 tools/anim/export_source_tracks.py --skeletons` | Read-only source face/class/chargrp/animation joins; `--write` emits matching private `.skeleton.json` sidecars and `--check` re-decodes them. All 14 source faces admitted; male Human Fighter has 69 links and one original reference fallback. [Inputs and usage](../docs/native-track-evidence.md#browser-pose-preview). |
| Native bone association | `python3 tools/ui/check_animation_linkup_native.py --check` | First matching original FName; duplicate names retain the first animation index, missing names remain −1. Optional pinned comparison binds the erased equality call. Parent matching and serialized movement `BoneIndices` are separate. [Evidence](../docs/native-animation-linkup-evidence.md). |
| Native local-pose fallback | `python3 tools/ui/check_pose_fallback_native.py --check` | 49 anchors and 47 instruction cases establish local copies, negative-link skips, reference selection and the root-lock gate. Optional `--comparison-engine` binds mask allocation/current composition; `--audit-assets` adds the original Fighter example. Neutral inputs only. [Evidence](../docs/native-pose-fallback-evidence.md). |
| Native initial tween | `python3 tools/ui/check_pose_tween_native.py --check` | Retained negative-frame arithmetic, raw destination keys and separate quaternion helper; optional pinned supplemental imports. Known source-cache transitions now run in admitted live schedules under an explicit normal Win32 exception policy. [Evidence and limits](../docs/native-pose-tween-evidence.md). |
| Native pose-cache lifetime | `python3 tools/ui/check_pose_cache_native.py --check` | Fresh channel fields, repeated tick/frame evaluation, empty-cache reset and successful local-pose validity. Optional `--comparison-engine` binds erased calls/globals in exact blocks. Browser epochs and successful-display commits remain adaptations. [Evidence](../docs/native-pose-cache-evidence.md). |
| Original animation FPU policy | `python3 tools/ui/check_animation_fpu_native.py --check` | Pinned startup precision, ordinary D3D preserve flags and bounded animation paths under documented Windows/CRT defaults. Does not certify modified control words or arbitrary callbacks. [Platform contract and evidence](../docs/native-animation-fpu-evidence.md). |
| Fresh pose-cache allocation | `python3 tools/ui/check_pose_allocation_native.py --help` | Original default-template allocation and constructor preservation establish fresh frame-zero sampling. Requires explicit separately pinned `--comparison-engine` and `--comparison-core` inputs; copies and custom templates are excluded. [Reproduction and evidence](../docs/native-pose-allocation-evidence.md). |
| Original parent-coordinate math | `python3 tools/ui/check_pose_coordinates_native.py --check` | 888 retained Core cases plus 104 quaternion-coordinate cases. Distinguishes reference `ApplyPivot` from current `ApplyPivotWithoutScale`; Float32 stores retained, x87/CRT approximation and supplemental import boundaries explicit. [Evidence](../docs/native-pose-coordinate-evidence.md). |
| Ordinary quaternion interpolation | `python3 tools/ui/check_quaternion_native.py --check` | Complete 519-byte owned method and explicit erased-call boundary. Optional pinned `--comparison-engine` verifies five named math imports and 210 instruction cases; not native CRT parity. [Evidence](../docs/native-quaternion-evidence.md). |
| Ordinary sparse-track sampling | `python3 tools/ui/check_track_native.py --check` | Original key search, closing-pair hemisphere and translation stores: 687 instruction cases plus 59 browser comparisons. Requires owned inputs and Node; no full skeleton or initial-tween claim. [Evidence](../docs/native-track-evidence.md). |
| Cast loop inputs | `python3 tools/anim/check_cast_loop_inputs.py --source` | Original keys, skeleton and source frame/rate checks against existing `castEnd` exports; accepts only exact dense samples or byte-constant endpoint pairs. Without `--source`, validates shape only. Writes an ignored receipt; does not certify native interpolation or other loop slots. |
| NPC material variants | `python3 tools/dat/export_npc_materials.py --help` | Original per-NPC material slots and source graphs; independently checked geometry and native blend states. [Evidence and limitations](../docs/native-npc-material-evidence.md). |
| Skill animation selector | `python3 tools/ui/check_skillanim_native.py --check` | Derives all 32 original selector branches; verifies browser mapping. Does not certify playback rates or complete phase scheduling. |
| Animation endpoints | `python3 tools/ui/check_anim_terminal_native.py --check` | Original one-shot endpoint and loop period, with explicit compressed-track/interpolation limits. [Evidence](../docs/native-animation-terminal-evidence.md). |
| Animation notify clock | `python3 tools/ui/check_anim_notify_native.py --check` | Original ordered crossings, null records, batch arithmetic and shared four-step budget. Optional `--comparison-engine` freshly binds the new channel's zero notify-disable field through the existing allocation verifier. Later channel state and filtering/callback boundaries remain explicit. [Evidence](../docs/native-animation-notify-evidence.md). |
| Browser notify comparison | `python3 tools/ui/check_anim_notify_runtime.py --check` | Actual JavaScript channel compared with the independent bounded reference. `--source-coverage` audits original slot combinations, not skill/playability completeness. |
| Pawn skill-event lifecycle | `python3 tools/ui/check_pawn_notify_native.py --check` | Original pending flag order, Agent stages/targets and cleanup. LastShotName imported helper and complete effect playback remain unresolved. [Evidence](../docs/native-pawn-notify-evidence.md). |
| Skill and animation sounds | `python3 tools/ui/check_cast_sound_native.py --check` | Original three-layer phase table, ordered ID/level lookup, voice slots and direct Sound-notify fields/defaults. [Evidence and limits](../docs/native-cast-sound-evidence.md). |
| Qualified sound references | `python3 tools/audio/sound_reference_aliases.py --check` | Reads original UAX outer chains and admits only unique original/output filename identities. Detailed evidence stays in an ignored receipt; runtime manifest carries aliases and a compact digest. Codec parity and ambiguous/malformed original references remain unresolved. |
| Native cast scheduler | `python3 tools/ui/check_cast_scheduler_native.py --check` | Pinned ordinary scheduling instructions and an independent arithmetic evaluator; not runtime parity. [Evidence and unresolved inputs](../docs/native-cast-scheduler-evidence.md). |
| Browser cast schedule comparison | `python3 tools/ui/check_castschedule_runtime.py --check` | Actual JavaScript planner compared with decoded original Agent-lead and timing instructions using synthetic sequence inputs. Ordinary positive schedules only; no original renderer execution or complete effects proof. |
| Exact casting Agent | `python3 tools/ui/check_cast_agent_native.py --check` | Original skill-level object paths, reflected FlyingTime field and verified class default. Empty references remain distinct from missing objects. [Evidence](../docs/native-cast-agent-evidence.md). |
| Native effect placement | `python3 tools/ui/check_locate_effect_native.py --check --output tmp/restart-audit/locate-effect-native.json` | Original actor selection, per-component offsets, failed attachments and exact alias tables from 14 primary player meshes. Surviving Core arithmetic is distinguished without guessing erased call bindings. Alias following, native actor baseline and relative vector helper remain unresolved. [Evidence](../docs/native-locate-effect-evidence.md). |
| Native legacy effects | `python3 tools/ui/check_legacy_skill_effects_native.py --check` | Compiled Wind Strike and Power Strike ID dispatch, original class references and owning emitter objects. Placement, motion and lifecycle remain incomplete. [Evidence](../docs/native-legacy-skill-effects-evidence.md). |
| Server shortcuts | `python3 tools/ui/check_shortcut_native.py --check` | Original list/register/delete formats and player registration flag, ScriptText/XDAT controls and native drawer fields. Runtime applies completed drawer positions; native slide animation remains open. Explicit current-server byte differences are retained. [Evidence and live check](../docs/native-shortcut-evidence.md). |
| Typed system messages | `python3 tools/ui/check_sysmsg_native.py --check` | Original skill ID/level pairs and numbered network substitutions. Explicit configured-server width differences remain. [Evidence](../docs/native-system-message-evidence.md). |
| Learned-skill packets | `python3 tools/ui/check_skill_state_native.py --check` | Original SkillList row format/reset dispatch and signed target-level differences, with explicit current-server format limits. [Evidence](../docs/native-skill-state-evidence.md). |
| Exact skill-level text | `python3 tools/dat/build_meta.py --skills-only` | Re-decodes original skill tables into a private exact-level catalog; preserves missing records instead of borrowing another level. [Evidence](../docs/skill-level-text-evidence.md). |
| Inventory actions and accessories | `python3 tools/ui/check_inventory_native.py --check` | Original use warnings, destroy/crystallize quantity branches, shared dialog ownership, bounded Alt-drag count producer and paired accessory object identities. Reads pinned binaries/scripts and fresh item DATs. Server outcomes, complete drag lifecycle and trash-feedback audio remain separate. [Evidence](../docs/native-inventory-evidence.md). |
| Item action metadata | `python3 tools/dat/build_meta.py --items-only` | Re-decodes only the four original item tables and writes private `itemmeta.json` with exact `isRecipe`, `popMsgNum`, `consumeType` and `crystallizable` inputs; missing source stays null. `--check-items` compares those fields without writing. No skills, icons or decoded tables are rebuilt. |
| Skill trainer | `python3 tools/ui/mine_skilltraining.py --check` | Native packet contracts, window parents/anchors, text sizing and tree cursor flow; requires its ignored source export. [Evidence](../docs/native-skilltraining-evidence.md). |
| Original dyes and tattoos | `python3 tools/ui/mine_henna.py --check` | Re-decrypts180 records, verifies native field/class/packet meanings and source window records, and compares the private export/icons. `--emit` writes only henna metadata and its12icons. `python3 tools/ui/check_henna_native.py --check` checks original evidence without requiring the export. [Evidence and limits](../docs/native-henna-evidence.md). |
| Original recipe crafting | `python3 tools/ui/mine_recipes.py --check` | Re-decrypts871 recipe rows and referenced original item names, verifies native identity/material/tree/packet meanings and three source windows. `--emit` writes ignored recipe metadata and six original tree textures; `python3 tools/ui/check_recipe_native.py --check` checks originals independently. Portable decoder cases require no client. [Evidence and limits](../docs/native-recipe-evidence.md). |
| Original actor gauges | `python3 tools/ui/check_gauge_native.py --check` |193 instruction anchors,14 bodies and 20 ranges establish four independent countdowns and local-actor drawing. Includes60 actual draw-argument comparisons, seven source texture records and native draw alpha128; browser rendering remains unported. [Evidence and gap](../docs/native-gauge-gap.md). |
| Clan reputation | `python3 tools/ui/check_clan_native.py --check` | Original full/update packet fields and native trainer lookup; preserves signed values. Does not certify clan management or subpledges. |
| Skeletal transform evidence | `python3 tools/ui/check_actor_native.py --check` | Reads original executable bytes without executing them; checks named functions, transform operations and serialization. |
| Actor selection evidence | `python3 tools/ui/check_picking_native.py --check` | Native targeting cylinders, static trace eligibility and source collision-array consumers. Browser placement, extent sweeps and hit shortening/bias remain bounded differences. [Evidence](../docs/native-picking-evidence.md). |
| Next Target evidence | `python3 tools/ui/check_nexttarget_native.py --check` | Original action4 dispatch, attackable/dead filters, remembered scalar-distance cycling and ordinary target packet. The protected distance operation and native map tie order remain unresolved; no guessed runtime selector. [Evidence](../docs/native-nexttarget-evidence.md). |
| Qualified world references | `python3 tools/world/export_static_collision.py all --references-only` | Read-only census across existing scene tiles using original map outer chains. Substitute one tile for `all` to narrow it. Reports flattened-name collision risks, unresolved records and source hashes; no shape attribution or asset changes. Keep detailed actor receipts private. |
| Static collision surfaces | `python3 tools/world/export_static_collision.py 17_25 --audit` | Read-only map census with qualified source identities and rejection reasons. File123 ordinary and lazy saved-end arrays are bounded to original exports and independently checked. `--all-supported` selects the admitted actor/material subset; only `--emit` writes private triangles and the scene reference. Native sweeps, actor defaults and complete world coverage remain open. [Evidence](../docs/native-picking-evidence.md#audited-static-collision-surfaces-elbera-tools). |
| Original BSP collision records | `python3 tools/world/export_bsp_collision.py 17_25 --check` | Full original node/plane/solid inputs, references and bounded prefix consumption. Optional `--stage` writes only to a new ignored audit directory. No render filtering or live adoption. [Contract and source census](../docs/bsp-collision-source.md). |
| Qualified prop repair | `python3 tools/world/convert.py --repair-prop-identities 17_25 --mesh V_Obj_S.Etc.O_Cart01` | Stages explicitly selected source identities; repeat `--mesh` for each required variant. Checks original per-section triangle positions/materials, paired buffers, unchanged placements and texture conflicts. Only `--emit` adopts with backup. Bounded V_Obj_S/V_Obj_T domain; no broad regeneration or full shader-parity claim. [Repair evidence](../docs/native-prop-identity-evidence.md). |
| Tutorial and quest evidence | `python3 tools/ui/check_tutorial_quest_native.py --check` | Original event masks, input reports, journal encoding and completion predicates. |
| Floor navigation | `node tools/world/inspect_navigation.mjs startX,startY,startZ targetX,targetY,targetZ` | Coarse/fine route comparison with private geodata hashes; no movement sent. `PlayerNavigationProbe.java` independently checks installed server blocks and reproduces rounding hazards. [Evidence](../docs/quest-completion-playtest.md). |
| Quest update marker | `python3 tools/ui/check_questmark_native.py --check` | Original FE/1A packet, event1520→730, ChatWnd anchor, pointer art and discrete glow/blink timers; `--emit` writes private metadata. GPU composition and complete MainWnd container remain open. [Evidence](../docs/native-quest-marker-evidence.md). |
| Original PlaySound | `python3 tools/ui/check_playsound_native.py --check` | Original packet fields, stereo source/driver and conditional dry-gain reduction. Radius/type-query bindings remain unresolved; gateway preservation is not audible playback. [Evidence](../docs/native-playsound-evidence.md). |
| Quest stereo audio | `python3 tools/audio/export_quest_sounds.py --check` | Re-reads the original bank and compares four unchanged stereo WAVs plus private metadata. Omit `--check` to export; no downmix or transcoding. Does not certify runtime audio. |
| Shared UI records | `python3 tools/xdat/parse_xdat.py --check` | Original sizes, anchors, signed offsets and preserved record data. Decoding is distinct from runtime layout migration. |
| UI placement evidence | `python3 tools/ui/check_layout_native.py --check` | Source serializers, nine anchor points, native integer conversion, saved-position corner checks and separate reset defaults. Full resize/docking lifecycle and Inventory's inherited native parent remain unresolved. [Evidence](../docs/native-layout-evidence.md). |
| Saved window metadata | `python3 tools/ui/mine_windowsinfo.py --emit` | Preserves INI saved coordinates and adds the independently bounded XDAT default-position table to private `windowsinfo.json`; does not regenerate the full interface tree. Initial creation, saved restore and reset are distinct paths. |
| Original dialogs | `python3 tools/ui/mine_dialogbox.py --check` | Source Warning/Notice/NumberPad geometry, labels, controls and background; requires its private generated table. Quantity validation belongs to the caller; complete keyboard dispatch and exact wrapping remain separate work. |
| Original shop rules | `python3 tools/ui/check_shop_source.py --check` | Fresh original script, layout/reset and selected language checks; no original content emitted. Paired portable shop/packet tests and offline replay remain separate from source proof. [Evidence](../docs/shop-playtest.md). |
| Original NumberPad input | `python3 tools/ui/check_numberpad_native.py --check` | Pinned input operations, comma grouping, English magnitude text, normal edit-frame/color/insets and bounded source-loop comparison. Requires local originals. Full cursor, selection, IME/paste and button state rendering remain outside this check. [Evidence](../docs/native-numberpad-evidence.md). |
| NumberPad frame art | `python3 tools/ui/build_uiskin.py --dialog-edit-only --check` | Compares three qualified original UTX textures, decoded pixels and native frame crops with the private skin output. Omitting `--check` updates only those entries in an existing 1× skin; no broad atlas rebuild or authored replacement art. |
| Terrain conversion | `python3 tools/world/convert.py --help` | Existing converter and bounded edge/topology updates. [Native terrain evidence](../docs/native-terrain-evidence.md) documents original-data gates and reproduction. |

Omit `--check` only after reading each tool's help: some tools emit private
generated assets by default, while narrow miners require `--emit`.

## Browser inspections

With the existing local world server running, open
[Elbera Tools](http://127.0.0.1:8083/test/index.html) for the inspection index.
These inspections do not connect to the game server:

- **Original hair:** `/test/original-hair.html` shows exact source LOD0 geometry
  and color materials across all 14 player models, preserving absent table
  entries. Mesh/PNG hashes are checked before display. Original alpha and blend
  state is applied without recoloring. It is a static inspection in source
  coordinates; body attachment, animation and native sampling remain separate.
- **Prop identity:** retained legacy Cart/Tank exports beside the repaired
  qualified source variants in17_25, at a shared camera scale. Checks loaded
  embedded source labels and shows export fingerprints, triangle counts and
  material names. Diagnostic lighting/camera are separate from game fidelity.
- **Shop transfers:** actual merchant buy/sell controls and original quantity/stock
  dialogs, with explicitly simulated stock, prices and money. Equipment rows
  remain separate; requests stay offline.
- **Inventory dialogs:** actual inventory/dialog controls with original item
  metadata and explicitly simulated counts/capability. Replay use warnings,
  destroy quantity selection and crystallize admission; Confirm records a
  local request. It never consumes an item or proves server acceptance.
- **Quest journal:** original text/art with explicitly simulated progress;
  includes the original Warning/Notice confirmation flow.
- **NPC animation/materials:** actual entity renderer, original corpse/social
  clips, seven ghost material variants and original angel wing alpha; source slots and unresolved graphs
  remain inspectable without a fabricated game encounter.
  `/test/npc-original.html?npc=20001` (Gremlin) or `?npc=20091` (fox) additionally
  exposes all eight original sparse sequences. The manual source overlay pauses
  the entity mixer and restores its local pose on exit. Its `frames/rate` timeline
  is an inspection control. Optional source GPU weight lanes are preserved
  without renormalization; full skinning, state selection, placement and gameplay
  timing remain separate. [Generate the private inputs](../docs/original-npc-animation-runtime.md).
- **Player faces, animation and casting:** actual Character loader with exact
  source face indices, mesh/material/texture references and explicit unsupported
  hair paths. The original-key preview combines private sparse tracks and the
  matching `--skeletons` sidecar: native first-name linkup, original reference
  fallback and current-parent math are displayed through the measured glTF
  matrix basis. All 14 source faces are admitted, including male Human Fighter's
  69 links plus one reference bone; empty movement maps are not rejected as
  missing native associations. This is a neutral channel-zero/base-bone-zero,
  root-lock-off, modifier-free comparison using existing browser skinning/hair.
  [Generate inputs and use the preview](../docs/native-track-evidence.md#browser-pose-preview).
  The separate Sit → SitWait / Stand → Wait and ordinary casting replays retain
  the game playback path, original slot/stance lookup and supported direct
  notify sounds. They use supplied timing and targets, do not cast an online
  skill, and do not certify full native playback, sound or effect placement.
- **Dyes and tattoos:** supply list/detail/state packets to the actual source-backed
  controls. Drawing/removal requests stay in local inspection output; the page
  never applies a tattoo or changes resources. No prices or stat totals are
  generated. Native text metrics, frame/button/selection behavior and inventory
  pixel states remain separate parity work.
- **Skill training:** paste captured list/detail payloads and follow the actual
  trainer controls. Learning requests remain local diagnostic output, without
  granting skills or claiming live eligibility.
- **Recipe crafting:** `/test/recipes.html` replays explicit book/detail,
  capacity, inventory and shortcut snapshots in the actual recipe windows.
  Dragging a book row to the bar records a type5/source-index request and an
  explicitly labeled local echo. Restored shortcut replay can open details
  without a book; it does not establish server eligibility or persistence. Recipe
  deletion and creation requests remain local; no resources or results are
  invented. The native material tree keeps exact product/rate lookup and
  source material order. Successful live crafting is a separate check.
- **Skill effect sources:** inspect exact level references, original Agent
  fingerprints, FlyingTime and all original action records, including non-drawable ones.
  Choose casting/channeling/preshot/shot, explicit stage/pending state and ordered
  target labels to inspect native callback selection. No scene or server changes.
  All 524 original SpecificStage values are stored zeros; synthetic tests also
  cover omitted fields and nonzero stages. Empty references,
  unresolved paths and missing levels are separate states. The original
  legacy effect path is separate from these Agent objects.

Actual Online playtests are recorded separately. A replay or model viewer is
not evidence that quest rewards, AI or multiplayer gameplay work.

The **World geometry and character grounding** inspector opens the game with
`?dev=1&inspect=1&checkpoint=current`. It measures actual skinned vertices and
upward mesh intersections on demand without staging or relocating the player.
Online is optional and explicitly selected by the operator. Hidden geometry
is excluded; transparent geometry is labeled. Alpha-tested pixels and native
collision flags are not inferred from triangles. [Scope and measured example](../docs/native-grounding-evidence.md).

The collapsed **Elbera Tools — Camera inspection** in `?dev=1` records requested
and actual camera distance, obstruction samples and selected movement/dialog
receipts. Its body button measures the current player and target transforms,
animation clip and camera-to-drawn-bounds distance. Zero bounds distance alone
does not prove mesh penetration. It never moves the player or sends requests.
[Recorded merchant regression and remaining camera limits](../docs/shop-playtest.md).

## Controlled live playtests

`node tools/playtest/play.mjs --help` opens the entry point for a manually
driven gateway session on an explicitly supplied existing identity/character.
It records ordinary movement, combat, skill, inventory and quest events in an
ignored private receipt. It never seeds progression or queues combat behind
a failed movement command. See [setup and protocol limits](playtest/README.md).
The [live auto-learn checkpoint](../docs/auto-learn-playtest.md) distinguishes
configured-server behavior from original-client fidelity and browser proof.

## Regression checks

The current focused tests include portable synthetic fixtures as well as
optional private-input integration checks. Tests that require private files
must report that requirement or an explicit skip, never a false pass.

```sh
node --test editor/world/test/questdata.test.mjs editor/world/test/quest-confirmation.test.mjs editor/world/test/npcvisual.test.mjs editor/world/test/npcanimations.test.mjs editor/world/test/picking.test.mjs
node --test editor/world/test/npcsourceanim.test.mjs editor/world/test/npc-source-skin.test.mjs editor/world/test/npc-source-inspection.test.mjs editor/world/test/npc-entity-lifecycle.test.mjs
node --test tools/playtest/session.test.mjs gateway/test/skill-list.test.js editor/world/test/skill-state.test.mjs
python3 -m unittest discover -s tools/ui -p test_cast_scheduler_native.py
python3 -m unittest discover -s tools/ui -p test_anim_terminal_native.py
python3 -m unittest discover -s tools/ui -p test_anim_notify_native.py
python3 -m unittest discover -s tools/ui -p test_pawn_notify_native.py
python3 -m unittest discover -s tools/ui -p test_cast_sound_native.py
python3 -m unittest discover -s tools/audio -p 'test_*.py'
node --test editor/world/test/animnotify-clock.test.mjs editor/world/test/skillsound-binding.test.mjs editor/world/test/gamesound.test.mjs editor/world/test/audio-lifecycle.test.mjs
node --test editor/world/test/native-castschedule.test.mjs editor/world/test/castplayback.test.mjs editor/world/test/castplayback-review.test.mjs editor/world/test/native-skillanim.test.mjs
python3 -m unittest discover -s tools/ui -p test_cast_agent_native.py
python3 -m unittest discover -s tools/ui -p test_legacy_skill_effects_native.py
python3 -m unittest discover -s tools/dat -p test_skill_bindings.py
python3 -m unittest discover -s tools/dat -p test_skill_actions.py
node --test editor/world/test/skillaction-dispatch.test.mjs
node --test editor/world/test/skillvfx-binding.test.mjs
python3 -m unittest discover -s tools/uscript -p test_extract_uscript.py
python3 -m unittest discover -s tools/xdat -p test_parse_xdat.py
python3 -m unittest discover -s tools/anim -p test_build_npc_variants.py
python3 -S -m unittest discover -s tools/ui -p test_npc_animation_native.py
python3 -m unittest discover -s tools/anim -p test_recover_pawn_clips.py
python3 -m unittest discover -s tools/anim -p test_pawnanim_source.py
python3 -m unittest discover -s tools/anim -p test_export_source_tracks.py
python3 -S -m unittest discover -s tools/ui -p test_animation_linkup_native.py
python3 -S -m unittest discover -s tools/ui -p test_pose_coordinates_native.py
node --test editor/world/test/nativequaternion.test.mjs editor/world/test/nativetrack.test.mjs editor/world/test/nativecoords.test.mjs
node --test editor/world/test/sourcepose.test.mjs editor/world/test/pawn-source-inspection.test.mjs
python3 -m unittest discover -s tools/anim -p test_cast_loop_inputs.py
python3 -m unittest discover -s tools/dat -p 'test_export_*.py'
```

`node tools/ui/verify_appearance_native.mjs` runs the original appearance-wire
and face-selector proofs. It requires the owner's pinned Engine.dll/Engine.u
and Python dependencies; missing inputs fail explicitly, never count as a pass.
The separate `appearance-packets.test.js`, `appearance.test.mjs` and
`tools/dat/test_build_appearance.mjs` fixtures are portable and need no originals.

`tools/battery.sh --list` inventories the larger historical battery. Its old
mock cleanup and browser harness assumptions still need repair; listing it
does not certify every suite or authorize running the complete battery.
The historical `verify_skillanim.js`, `verify_skillphase.js` and
`verify_skillvfx.js` currently report **UNSUPPORTED** before running. Their
Wind Strike visual oracle used a same-ID Agent that the original skill row
does not reference; preserving that oracle would give false confidence.
`verify_castanim.js` likewise reports unsupported: its old whole-clip callbacks
do not certify the new source phase clock.

## Contribution standard

Keep tools useful outside one debugging session. Record the original build,
input hashes, command, output format, independent evidence and unresolved
behavior. Prefer synthetic fixtures for public tests. Never bundle original
binaries, decompiled client code, extracted artwork, generated game tables,
credentials, database snapshots or local gameplay logs in a public release.
The current ignored `tmp/` receipts remain local evidence.

The current paths are stable entry points. Branding does not require duplicate
wrappers or another framework. Each standalone release uses an explicit file
allowlist, documents its dependencies and supported source builds, and tests the
actual extracted archive without private inputs or the browser application.


Bounded live Agent lifecycle and player-scale regressions (portable):

```sh
node --test editor/world/test/pawnskill.test.mjs editor/world/test/skillfx-native.test.mjs editor/world/test/player-transform.test.mjs
node --test editor/world/test/world-inspection.test.mjs editor/world/test/scene-loading.test.mjs gateway/test/collision-packets.test.js
python3 -m unittest discover -s tools/dat -p 'test_player_visuals.py'
python3 -m unittest discover -s tools/ui -p 'test_grounding_native.py'
python3 -S -m unittest discover -s tools/ui -p 'test_engine_recovery_native.py'
node tools/ui/test_inventory_native.mjs
node tools/ui/test_numberpad_native.mjs
node tools/ui/test_layout_native.mjs
node tools/world/test_static_collision.mjs
node --test gateway/test/inventory-actions.test.js
```

The four small Node adapters run source-free Python fixtures and are registered
in the battery's `solo` section. They test metadata/framing and bounded geometry
or placement/input rules. The gateway inventory suite also runs in `solo`, using
synthetic sessions to check the actual bridge-to-packet count contract without
sending an item action. The separate source-verification commands above require
local originals and do not run as part of these portable suites.

The original-pawn viewer can preview the live Agent controller and sound tails.
Its explicit self target and supplied timing are inspection inputs, not a server
cast or proof of native target selection. Completion, effect placement and
projectile/emitter gaps are visible beside the replay.
