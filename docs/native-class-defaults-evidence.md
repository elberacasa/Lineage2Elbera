# Original class-default boundaries

Elbera Tools now locates supported Interlude `UClass` default properties by
reading the serialized class prefix. The world exporter uses this path for
Actor, StaticMeshActor and the complete LevelInfo ancestry. It no longer
searches for a plausible terminal property stream for these inputs.

This matters for movers: two starts, one byte apart, can both look like valid
declared properties. In the pinned `Engine.Mover`, offset **738** begins the
original stream; **739** begins inside a compact name index and misreads
`RangeHeight` as `CollisionHeight`. The serialized prefix identifies 738
without comparing the resulting values or choosing whichever looks plausible.

## Reader contract

`tools/l2lib/classdata.py` exposes `read_class_default_prefix(package, export)`.
It requires file version **123**, a `Class` export without `RF_HAS_STACK`,
matching export/superclass identity, canonical compact indices and bounded
table references. All reads stop at that export's end. Unsupported versions,
tokens or malformed prefixes fail; there is no fallback scan.

The reader retains the six initial fields, line/text positions, serialized
script tokens, state scalars, class flags, four-word field, dependency records,
name arrays and final reference/name fields. Fields whose meanings have not
been independently bound retain their original native offsets as labels.
It reports the relative default offset and source spans/hashes. It does not
parse the default properties or construct a live class object.

The script's declared size describes its **native memory buffer**, not its
saved byte count. For example, Mover's script occupies 13 memory bytes but 10
saved bytes: saved compact object references expand to four-byte references.
The iterative expression walker follows supported original serializer paths:

| Token bytes, hexadecimal | Serialized operands followed |
| --- | --- |
| `08 0b 16 17 25 26 27 28 2a 2d 30 31` | None |
| `00 01 02 29` | Compact object reference |
| `13 2e` | Compact object reference, then one expression |
| `09 18` | Two-byte word, then one expression |
| `24 2c` | One byte |
| `39` | One byte, then one expression |
| `70..ff` | Argument expressions through token `16` |

This list describes serialization shapes, not gameplay meanings. Other token
paths are unsupported. The reader neither executes expressions nor interprets
replication conditions, and imposes no invented recursion-depth game rule.

`serialized_defaults` in the existing NPC-data module validates default tags
at this exact boundary against inherited declared property types and the exact
export end. Its legacy value decoder does **not** retain array indices; array
consumers must use ordered tags instead. Other NPC/character paths still using
terminal-stream search remain provisional and are not upgraded by this change.

## Original source binding

| Input | SHA-256 |
| --- | --- |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Comparison Core.dll | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |
| Owned Engine.u | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| Owned Core.u | `de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0` |
| Owned GamePlay.u | `714639cdad265a7caeaf0f91ce76bb50492390eaa3faea15ed5a28a3e830b64a` |

`qualify_class_default_prefix` extends the existing native class-registration
check. Twelve retained body ranges match the pinned comparison Core byte for
byte. Named exports and seven thunks bind the expression/dependency serializers;
28 instruction anchors bind consumed fields, memory increments and array calls.
The matched jump/index tables at `10132148..10132212` independently check the
supported token groups against the Python reader's sets.

| Serializer | Original addresses, exclusive end |
| --- | --- |
| UObject | `1015e820..1015ea8f` |
| UField | `10131210..10131287` |
| UStruct | `10131450..1013158b` |
| UState | `101316e0..1013176d` |
| UClass | `101351c0..10135425` |
| UStruct.SerializeExpr, normal path | `10131b90..10132108` |
| Four-word field | `10130dc0..10130e30` |
| Dependency array / record | `101342f0..101343a6` / `10131b40..10131b77` |
| Name array | `10132470..10132526` |
| Object / script-reference archive wrapper | `1012a9f0..1012aa01` / `10130f10..10130f21` |

The enclosing registration check retains the earlier initial-field, version
gate and state-prefix bindings. These are source correspondence checks, not
native execution of complete archive factories, linking, class construction or
configuration. Supplemental correspondence does not authenticate its archive.

## Reproduce and inspect

The portable parser tests use authored bytes only and run without a client:

```sh
python3 tools/l2lib/tests/test_classdata.py
python3 tools/release/smoke_core.py
```

The standalone **Elbera Tools Core source build** includes this reader and its
portable tests. The existing published Core 0.1.0 archive retains its original
contents. Put the kit's `tools` directory on your Python import path:

```python
from l2lib import load_package
from l2lib.classdata import read_class_default_prefix

package, _ = load_package('/path/to/your/Engine.u')
export = next(e for e in package.exports
              if package.class_name_of(e) == 'Class'
              and package.export_name(e) == 'Mover')
prefix = read_class_default_prefix(package, export)
print(prefix['defaultsOffset'], prefix['script']['memoryBytes'])
```

Original-input checks require the **full repository**, owned packages/maps,
the pinned Engine/Core edition and comparison files, Capstone 5.0.7 and Node:

```sh
python3 tools/ui/check_static_actor_bounds_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check
python3 tools/world/check_static_collision_records.py 17_25 22_22 --check
```

Omit `--check` on the record checker for the local `savedActorClasses` receipt:
source package fingerprints, each class and exact parent, prefix fields and
hashes, byte-for-byte prefix reconstruction, and ordered default tags including
array indices. The two-map census covers **26 distinct classes and ancestors**.
Round trips check lossless retention; the original serializer bindings supply
the layout evidence. Neither alone is proof of complete client loading.

Saved/default data is not current actor state. Mover motion, brush/volume
collision dispatch, level startup and live world queries still require their
own source recovery and integration. This change does not repair map rendering
or claim a playable, fully faithful client. Original inputs and raw receipts
remain private and are excluded from source/tool releases.

## Saved actor flags in the world loader

The full-repository world exporter now follows each actor's exact class ancestry
to recover the **82 declared Actor Boolean fields** used by the collision
components. Their original four word layouts are shared with the existing
typed-copy/property evidence. Only their declared masks become known; padding
is not filled in. Missing declared defaults use the separately qualified
zero-plus-parent class-default path. Each field retains the class that last
overrode it, or its explicit zero-initialization origin.

The reader rejects cyclic or unrelated ancestry and subclasses redeclaring a
consumed field. It retains ordered map overrides, including repeated tags,
the exact saved frame, the property-stream span and any opaque native tail.
Each map's TerrainInfo has a **262,773-byte** tail after its properties; this
record hashes that tail without interpreting or discarding it.

The source bundles contain **1,237** Boolean records for Talking Island and
**2,406** for Giran. Talking Island's count includes three static exports absent
from the saved actor array. The **3,640 saved actors** have these true saved
`bCollideActors` values; these counts are not current collision membership:

| Class | Talking Island | Giran |
| --- | ---: | ---: |
| StaticMeshActor | 951 | 1,891 |
| WaterVolume | 1 | 8 |
| BlockingVolume | 3 | 13 |
| MusicVolume | 12 | 16 |
| Mover | 0 | 10 |

`check_static_collision_records.py` independently reads final Boolean values
with the generic packed-property decoder, checks the retained prefix and source
spans, rereads ordered tags and origins, and runs the complete bundle through
the actual browser source-loader module. The commands above exercise this
path. Deliberately changed bits, ancestry, origins, stream hashes, tail spans
and tag order are rejected in local original-input checks.

`prepareStaticWorldSource` preserves the verified subset as
`actorForReference(ref).savedGroups`. It is separate from `prepared` actor state;
unimplemented classes remain unprepared. Older bundles without these records
retain an unresolved subset, rather than invented false flags. Updated private
bundles are connected to the actual scene loader. Offline Giran reports all
2,406 saved Boolean records and still reports collision unavailable.

The native registration checker also binds **32 virtual slots across eight
native actor classes** in the pinned Engine copies. Mover has its own PostLoad;
brush and volume classes use ABrush.PostLoad and ABrush.GetPrimitive. These are
method-identity checks, not execution of those subclass routines. They prevent
silently treating the existing static-prop lifecycle as suitable for every actor.

This world extraction/verification remains a full-repository tool; the standalone
Core preview includes the class-prefix decoder, not the world exporter. Complete
subclass construction, PostLoad, primitive providers, startup and live queries
are still required. No map rendering or Online movement repair is claimed.

## Linked scalar-property offsets

The saved export table is not property iteration order. The declaration
inspector now reports `fieldChain` separately from its existing `fields` array.
It starts at the class's serialized child reference, follows each UField's
`Next`, includes intervening functions/states and stops before a foreign owner.
Cycles, imported links, nonempty tagged headers and unknown kinds are explicit
errors. Each bounded prefix has its own source hash; reading a function link
does not decode or execute that function's remaining body.

`l2lib.propertylayout.property_offsets` implements only the original class
scalar-offset stage. Inputs are properties in that linked order and a supplied
parent `PropertiesSize`. It preserves byte packing, four-byte scalar alignment,
twelve-byte string headers and packed Boolean offsets/masks. A Boolean after
another Boolean can reuse its word even when a static array dimension exceeds
one; the native branch does not test `ArrayDim == 1`. After bit 31, the next
Boolean starts a new word. Unknown kinds, nonpositive dimensions and arithmetic
outside the admitted nonwrapping signed range fail without a guessed layout.

The original Core comparison binds these ranges (exclusive ends):

| Routine | Range | Scope |
| --- | --- | --- |
| `UStruct.Link` | `10135e30..10135f12` | Recompute-offset prefix; deliberately stops before property lists |
| `UByteProperty.Link` | `10170af0..10170b4b` | Complete ordinary body |
| `UIntProperty.Link` | `10170d40..10170da1` | Complete ordinary body |
| `UBoolProperty.Link` | `10173250..101732f1` | Complete ordinary body |
| `UFloatProperty.Link` | `10171510..10171571` | Complete ordinary body |
| `UObjectProperty.Link` | `10171630..101716b6` | Complete ordinary body; ClassProperty shares its dispatch |
| `UNameProperty.Link` | `101719f0..10171a51` | Complete ordinary body |
| `UStrProperty.Link` | `10171c10..10171c83` | Complete ordinary body |
| Property and Boolean casts | `10132a00..10132a22`, `101329d0..101329f2` | Complete bodies over supplied reflection |
| Size, parent and packing getters | `1010b310..1010b314`, `10115a20..10115a24`, `1010b570..1010b576` | Complete bound UClass dispatch bodies |

The existing class-prefix and property-declaration qualifiers bind saved
child/Next serialization. Additional nonproperty serializer prefixes establish
their first inherited call, with exact ranges/hashes retained in the local
receipt. Loading `UStruct.Serialize` passes `1` to virtual Link; the bound
UClass → UState → UStruct calls forward that argument. This source comparison
does not execute the complete serializer, UState/UClass Link or archive I/O.

The interpreter executes **224 authored cases: 153,363 instructions across 374
addresses**, including padding, scalar/static-array sizes, skipped nonproperty
fields, Boolean rollover and static Boolean arrays. Archive Preload is an
explicit successful, already-completed provider. Current parent size and
reflection are supplied; original casts and property virtual calls execute.
Python compares offsets, element sizes, masks and final size, not property-flag
changes or cleanup/reference lists. The interpreter stops mid-method at the
documented boundary and does not report a full Link return.

The optional original-input check adds **four cases: 1,610 instructions across
312 addresses** using the pinned Engine/Core/GamePlay packages. Volume,
BlockingVolume and MusicVolume totals match their separately qualified native
registration sizes. Volume's `LocationName` offset agrees with the original
constructor's string no-init call. WaterVolume's own fields use the explicitly
supplied native PhysicsVolume parent size; PhysicsVolume's nested-structure
layout remains **unsupported**. This does not certify that parent's complete
reflection or admit any saved volume to live world startup.

Inputs use the Core fingerprints documented above and the Engine/package
fingerprints in [the volume evidence](native-static-actor-bounds-evidence.md#volume-construction-and-property-declarations).
No client bytes or original declaration payloads are bundled with the tool.
Private-data reproduction from the full repository:

```sh
python3 tools/world/inspect_actor_declarations.py --check
python3 tools/ui/check_property_layout_native.py \
  --comparison-core /local/reference/system/Core.dll \
  --comparison-engine /local/reference/system/engine.dll \
  --original-volumes --output tmp/local-property-offsets.json
```

Omit `--original-volumes` and `--comparison-engine` for only the authored
native cases; those still need the two pinned Core images and Capstone.
The portable fixtures require neither original files nor Capstone:

```sh
python3 tools/l2lib/tests/test_declarations.py
python3 tools/l2lib/tests/test_propertylayout.py
python3 tools/release/build_core.py --check
```

Current standalone Core source builds include the reader/helper and portable
fixtures: **23 selected files / 53 checks**. The full native verifier and world
inspector remain full-repository tools. Existing published ZIPs are unchanged.
Source/default string storage, configuration, nested fields, complete class
loading and volume/world startup remain outstanding; no map repair is claimed.
