# Elbera Tools: original NPC material bindings

This bounded correction preserves the original material choice for seven ghost
NPCs: 31452, 31454, 31524, 31538, 31919, 31920 and 32011. Their original NPC
records reuse ordinary living NPC meshes, but select different Shader objects.
A fixed texture per mesh discards that selection.

Angel corpse NPCs 30980 and 31752 additionally receive a bounded wing opacity
correction. The exact source alpha comparison and FinalBlend states are
implemented; their original specular graphs remain unresolved.

The golden pig, NPC 13035, is also decoded. Its shader uses a `TexEnvMap`
specular subgraph. That graph remains explicitly unresolved; this change does
not substitute a plain gold diffuse map and label it faithful.

## Original native binding

`tools/ui/check_npc_material_native.py --check` verifies the following against
the owner's original Interlude binaries, without executing them or writing
decoded copies. Addresses below are RVAs. The checker pins:

- `engine.dll`: `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
- `D3DDrv.dll`: `05622ddea5d96aec5618bc1ae064af9d27d83178f78d9631b5448377502e1323`.

| Step | Original evidence |
| --- | --- |
| Primary texture count and names | `FL2NpcData::Serialize`, `0x165561` and `0x165576`, serializes count at `+0x28` and name elements at `+0x2c + index*4`. |
| Per-NPC access | `User::GetNpcTexNum` at `0x1845cb` reads that count; `GetNpcTexName` at `0x1844d3` reads the indexed primary name. |
| Separate alternate array | `GetNpcTexName` checks abnormal-state mask `0x8000` before considering the array at `+0x40/+0x44`. All ten audited records have an empty alternate array. No alternate-state behavior is invented here. |
| Assignment | `User::SetPawnResource`, `0x18741a–0x187453`, loops the original count and dispatches `SetTexes(9, name, index)` through APawn's vtable slot `0xd4`. |
| Skin storage | `APawn::SetTexes` type 9 dispatches to `0x31e940`; index zero resets the array at Actor `+0x298`, and resolved materials append to it. |
| Rendered skin access | `AActor::GetSkin`, `0x22cfa0`, reads the requested entry of that same array. |

The exporter reads each original UKX material TextureIndex array. The five
audited meshes have identity mappings. It independently exports the original
PSK and reconstructs the model: current geometry bytes must begin with the
exact original conversion, and meshes, primitive material indexes, nodes and
skins must match. A mismatching model is rejected before material overrides
are generated. This avoids treating a coincidental material name or count as
proof of slot order.

## Ghost Shader blend behavior

The original Shader exports for the three ghost families explicitly contain:
Diffuse, SpecularityMask, OutputBlending=5 and TwoSided=true. Diffuse and the
mask point to the same original Texture. Additional shader properties or
non-Texture diffuse subgraphs are rejected by this bounded implementation.

The original `Engine.u` Shader TextBuffer declares enum entry 5 as
`OB_Brighten`. This source is read within the TextBuffer export's exact byte
bounds. `D3DDrv`'s original `FD3DRenderInterface::SetShaderMaterial` function
reads the enum at Shader `+0x598` and dispatches through the table at `0xcdc0`.
Entry 5 reaches `0xca6b`:

| Pass state | Setter | Consumption by original D3D9 renderer |
| --- | --- | --- |
| Source blend = 2 | `0xca77`, pass `+0x24` | `0x23083/0x2308e` copies it to deferred state `+0x10`; `0x2ef48` sends render state 19. |
| Destination blend = 4 | `0xca8a`, pass `+0x28` | `0x23091/0x2309c` copies it to deferred state `+0x14`; `0x2ef6f` sends render state 20. |
| Depth writes disabled | `0xcaac`, pass `+0x14` | `0x23045/0x23053` copies the flag to deferred state `+8`; `0x2eefa` sends render state 14. |
| Two-sided rendering | `0xcba3–0xcbbb`, pass `+0x18` | `0x23056–0x23069` chooses cull mode 1; `0x2ef96` sends render state 22. |
| Black fog override | `0xcabf–0xcae4` | Enables the pass fog override and stores an all-zero color, rather than the ordinary scene fog color. |

Microsoft's official definitions identify blend factors 2/4 as ONE and
INVSRCCOLOR, render states 19/20/14/22 as source blend, destination blend,
depth writes and culling, and cull mode 1 as no culling.
[Blend factors](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dblend),
[render-state identifiers](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3drenderstatetype),
[cull modes](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dcull).

The RGB blend equation is therefore `source + destination * (1 - source)`.
It does not use the diffuse texture's alpha as an ordinary opacity factor.
The browser uses those exact factors, disables depth writes, draws the
two-sided triangles once and substitutes black in the existing fog equation.
It preserves the current browser lighting/color pipeline; matching the native
lighting, shader passes and color management remains separate fidelity work.

## Angel wing alpha correction

Both original NPC records name `LineageMonsters.angel_m00`. Slot zero is
`LineageMonstersTex.angel_t00`; slot one is `LineageMonstersTex.angel_t01`.
The latter is a **FinalBlend**, not a plain Texture or Shader. Its explicit
properties are FrameBufferBlending=2, AlphaTest=true, AlphaRef=160,
TwoSided=true and TreatAsTwoSided=true. It wraps `angel_t01_sh`, whose Diffuse
and Opacity both reference the plain Texture `angel_t01_ori`.

The previously built wing PNG already matches that original Texture's RGBA
bytes exactly: 512×512, with 28,449 alpha-zero pixels and 233,695 alpha-255
pixels. Its alpha-zero pixels also have zero RGB. The glTF material omitted
alpha mode/cutoff, so those pixels became the visible black triangular wing
regions. No texture pixels were repainted to fix this.

Epic's original UE2 documentation confirms that a Shader's Opacity input
uses the referenced texture's **alpha channel**, and explains FinalBlend's
alpha-blend and alpha-reference controls.
[Shader inputs](https://docs.unrealengine.com/udk/Two/MaterialsShaders.html),
[FinalBlend](https://docs.unrealengine.com/udk/Two/MaterialsFinalBlend.html).
The exact comparison and values below come from the owner's Interlude data
and native renderer, rather than substituting the documentation's examples.

| Original evidence | Recovered behavior |
| --- | --- |
| Engine.u FinalBlend TextBuffer, bounded to its export | EFrameBufferBlending entry 2 is FB_AlphaBlend. |
| Engine.FinalBlend class export, unique typed terminal stream at relative offset 95 | Explicit defaults ZWrite=true and ZTest=true. The source export/default stream and Engine.u are hashed in the proof. |
| D3D `0x11159–0x1119c` | Copies FrameBufferBlending, ZWrite/ZTest, AlphaTest/TwoSided and AlphaRef from FinalBlend into modifier state. |
| `0xc7f9–0xc804` | Present FinalBlend state overrides the Shader's ordinary output-blend selection. |
| Jump table `0xf8b8`, entry 2 → `0xf530` | Sets SRCBLEND=5 (SRCALPHA), DESTBLEND=6 (INVSRCALPHA), enables blending. |
| `0xf81f–0xf86a` | Transfers original depth, cull, alpha-test enable and the exact reference byte to the render pass. |
| `0x22fb4–0x22fe2` | Transfers AlphaRef and AlphaTest to deferred state; sets alpha comparison to 5. |
| `0x2ef21`, `0x2efe4`, `0x2f00b` | Sends ALPHATESTENABLE (15), ALPHAREF (24), ALPHAFUNC (25) to D3D. |

Microsoft defines compare value 5 as **GREATER**, so alpha equal to 160/255
must be discarded as well. The browser uses the original reference and an
explicit `<=` discard comparison; it does not use Three's ordinary `<`
comparison or a guessed 0.5 cutoff.
[D3D comparison values](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dcmpfunc).

Only material slot one is replaced for those two NPC IDs. Slot zero keeps
its existing material. Native alpha blend factors, enabled depth writes and
depth testing, and one draw of two-sided triangles are applied to the wing.
The existing UV/sampling and lighting pipeline remain in use. The wing
Shader's TexEnvMap specular branch and the body Shader's specular behavior
are preserved as graph evidence, explicitly not implemented by this change.
The metadata status is `wing-alpha-and-blend-verified-partial`, with an exact
slot correction and separate limitations. The native verifier now performs
86 instruction checks; the material tests include 8 JavaScript and 4 Python
cases using synthetic portable inputs.

## Export, runtime validation and limitations

```sh
python3 tools/ui/check_npc_material_native.py --check
python3 tools/dat/export_npc_materials.py
python3 -m unittest discover -s tools/dat -p test_export_npc_materials.py
node --test editor/world/test/npcmaterials.test.mjs
```

The reusable decoder/verifier and synthetic tests are public-safe source.
Original client files, decoded graph metadata and images remain private and
ignored. The exporter writes `assets/gamedata/npcmaterials.json` and images
under `editor/characters/monsters/models/npc-materials/`; it does not modify the
base models. The format is `l2-interlude-npc-materials-v1`.

Metadata retains original NPC texture order, exact object references, Shader
and Texture export hashes, original package hashes, unmodified RGBA image
hashes, native proof, per-primitive slot bindings and current glTF/buffer hashes.
The gold pig's original material graph is retained with an unresolved status.
No guessed environment-coordinate or specular implementation is activated.

The browser compares the actual loaded glTF document and buffer with this
evidence, verifies image bytes, and uses GLTFLoader's primitive/material
associations to apply each slot. New textures detach their Three.js Source
objects, so changing one NPC cannot repaint another using the same model.
GLTFLoader annotates its parsed document with `isBone` and `isSkinnedMesh`.
Validation independently derives exactly those annotations from the verified
joint/node references before comparing the documents; unknown annotations
remain errors. A synthetic test parses a skinned triangle through the actual
vendored GLTFLoader, then verifies that an unrelated bone marker is rejected.
Old map sampling/UV/color settings and lighting remain unchanged; they are not
promoted to original-client proof by this correction. Rebuild this catalog
after rebuilding a referenced base model or adding animation supplements.

The Angel alpha defect is corrected as described above. Full original
lighting, specular effects and all other material graphs remain separate work.

## Elbera Tools browser inspection

Open `/test/npc-original.html?npc=31452` on the local world server. The page
uses the actual `EntityManager`, with no game-server connection. Its selector
contains the ten original-class animation cases, all seven corrected ghosts,
and the explicitly unresolved gold pig. The expandable source panel reports
the runtime's applied/unresolved state, exact original Shader-to-Diffuse
references, primitive/material/texture-slot bindings, model/package hashes,
and the loaded materials' current rendering state. `?npc=` preserves the
selected case for reproduction. Social playback uses the action currently
bound by the game renderer; only the separately documented class overrides
prove an original default-action choice.

Chrome inspection on 2026-09-26 loaded and visually checked IDs 31452, 31454,
31524, 31538, 31919, 31920 and 32011. All seven displayed translucent models
and the verified active-material state. The source panel for 31452 displayed
two separate loaded materials with the expected custom blend, disabled depth
writes and two-sided state. The three distinct model families remained
visible without the previous opaque base textures. This is a render and
binding check, not a pixel comparison with the original client. The neutral
stage's lights and background are inspection aids, not recovered game data.

The same browser session exposed and fixed the overly strict parsed-document
comparison described above. After reloading the fix, no new ghost warnings
or errors appeared. Selecting 13035 produced its intentional unresolved
Specular warning and retained the ordinary pink pig appearance. Selecting
30980 initially reproduced black triangular regions on the Angel wing planes
while playing `native:deathwait`. Selecting
32038 after the ghost cases restored the ordinary colored trader mesh with
`native:Social02`; the button dispatched `native:Death_Hand`. This also checked
that the ghost's texture replacement did not repaint the shared trader model.

After the Angel correction and completed metadata regeneration, a fresh load
of 30980 and then 31752 showed clean feather edges without the black triangles,
still playing `native:deathwait`. The source panel showed material zero with
alpha test 0, and wing material one with 160/255, enabled depth writes and
source/destination alpha blending. A subsequent 31452 selection retained its
verified ghost state. No new warnings/errors appeared after loading the
completed catalog. An earlier load during catalog regeneration was correctly
rejected because its proof predated the new checks; reloading the finished
catalog resolved it. The gold pig remains visibly pink and unresolved.
