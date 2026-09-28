# Original PlaySound and quest audio evidence

Elbera Tools preserves the original `0x98` packet and four original stereo quest
sounds. **Browser quest playback remains unsupported in this checkpoint.** The
packet decoder and lossless export do not certify the original audio lifecycle.
An optional pinned comparison now binds the radius and controller type-query
imports in exactly corresponding code. Calls after scene-node construction,
the full voice lifetime and mixer behavior still require recovery/integration.

## Reproduce

Supplied local Interlude `Engine.dll`, `Core.dll`, `ALAudio.dll` and `ItemSound.uax` are
required for source checks. These tools read originals, decode only in memory,
and never execute the client or access an account.

```sh
python3 tools/ui/check_playsound_native.py --check
python3 tools/audio/export_quest_sounds.py
python3 tools/audio/export_quest_sounds.py --check
python3 -m unittest discover -s tools/ui -p test_playsound_native.py
python3 -m unittest discover -s tools/audio -p test_quest_sounds.py
node --test gateway/test/playsound-packets.test.js
```

To check the additional bindings, supply both matching comparison images:

```sh
python3 tools/ui/check_playsound_native.py --check \
  --comparison-engine /path/to/comparison/engine.dll \
  --comparison-core /path/to/comparison/Core.dll
```

Both paths are required together. Unsupported fingerprints fail before any
comparison; the original-only command retains its original unresolved result.
See the [supplemental binding check](#supplemental-binding-check).

The exporter compares every output byte with a fresh extraction in `--check`.
Its default private receipt is `tmp/restart-audit/quest-sounds.json`. Original
containers, generated audio, metadata and receipts remain ignored; only the
tools and synthetic tests belong in public source control.

## Packet and mode evidence

The pinned Engine registers opcode `0x98` at `0x10837b0b`; the decoder at
`0x104108e0` uses original format `dSdddddd`. Its eight values reach the named
`UGameEngine::OnPlaySound` through vtable slot `+0x648`.

The gateway preserves them as:

```js
{ op: 'playSound', soundType, sound, objectFlag, objectId, x, y, z, delay }
```

Malformed/trailing packet bytes are rejected before emission. Unknown modes
and values are retained. The bridge forwards transient sounds only from the
current entered session; it does not replay sounds received before entry or
after session replacement. These are browser session boundaries, not claims
about native queuing.

In the original mode-zero branch (`0x1049dfd4`), the source actor is the current
viewport controller's pawn and the supplied position is that pawn's Location.
The handler consumes but ignores packet object flag, object ID, XYZ and delay
in this branch. It calls the audio driver's `PlaySoundW` with volume `1`, pitch
`1`, slot `0` and flags `0`. The radius comes from pointer slot `0x11d8dc10`,
unresolved in the owned image alone. The optional matched comparison binds it
to Core's original `GAudioDefaultRadius`, whose retained value is `80`.
Modes one and two have
separate paths and are outside this implementation.

## Exact original stereo assets

The four unique original Sound exports are grouped under `ItemSound.Quest`.
The configured server uses the short references in this table; matching each
unique package/leaf is checked, without inventing a general name resolver.

| Wire reference | Original export | Frames | WAV bytes |
| --- | --- | ---: | ---: |
| `ItemSound.quest_accept` | `ItemSound.Quest.quest_accept` | 38,208 | 152,876 |
| `ItemSound.quest_middle` | `ItemSound.Quest.quest_middle` | 55,936 | 223,788 |
| `ItemSound.quest_finish` | `ItemSound.Quest.quest_finish` | 157,440 | 629,804 |
| `ItemSound.quest_itemget` | `ItemSound.Quest.quest_itemget` | 46,464 | 185,900 |

All four contain complete PCM WAV containers at export byte nine: two channels,
22,050 Hz, 16 bits. The exporter preserves all **1,192,368 bytes**, including
both channels. `/audio/quest-sounds.json` records full original references,
source bank/export/WAV SHA-256 hashes, format, frames and URLs of the form
`/audio/quest/quest_finish.wav`. It provides no mono fallback.

The original `FWaveModInfo::ReadWaveInfo` binds the channel and sample-width
fields. `UALAudioSubsystem::RegisterSound` reads them at `0x10009381` and
`0x100093a4`; the stereo/16-bit branch chooses OpenAL format `0x1103` and uploads
it at `0x100093eb`. OpenAL specifies that multichannel buffers bypass its 3D
spatialization. This does **not** bypass an application's manual gain changes.
See [OpenAL 1.1 specification, §5.3.1](https://www.openal.org/documentation/openal-1.1-specification.pdf).

The historical general SFX exporter downmixes originals to mono. That changes
the source channel semantics and remains a separate fidelity gap.

## Playback boundary and next source check

The initial driver call compares the supplied pawn position with the viewport
pawn position, yielding zero distance at that call. The driver also retains
the source actor and refreshes its position during `Update` (`0x1000de82`).
However, per-frame manual attenuation uses the supplied scene node's `+0x1bc`
position (`0x1000cfb5`, `0x1000e1fd`); stereo alone does not prove constant gain.

The follow-up trace corrects the constructor location: `0x1058f1d7` is in the
viewport-reset branch. Ordinary `UGameEngine::Draw` constructs the player node
at `[ebp-0x424]` at **`0x1058fefe`**, immediately before passing that same address
to audio vtable `+0x74` (`0x1058ff8b`), the named `Update`. The scene's `Render`
call follows at `0x1058ffd4`. The constructor receives the viewport controller,
delegates to `FCameraSceneNode`, and its controller/pawn branch copies
Pawn.Location into node `+0x1bc` (`0x10655730–0x1065574f`), separately from camera
coordinates at `+0x194`. The controller class identity is named, but the helper's
type-query call at `0x1056b250` is six recovered NOPs in the owned image.
The optional comparison binds that call to Core's `UObject::IsA`. A complete
indirect-write/callback audit remains outside this proof.

The following driver details are now independently pinned:

- The APawn vtable's `+0x2f8` is named `AActor::IsAAmbientSound`; it returns zero.
  Ordinary pawn sounds therefore bypass the ambient initial zero-gain branch.
- Plain PCM registration supplies buffer flags zero. Combined with the handler's
  flags zero, the voice follows its actor and reaches the ordinary manual-gain
  branch. This branch jumps directly to `AL_GAIN`, bypassing fade-state gain
  handling. It does not become an ambient sound because the WAV is stereo.
- Both initial and per-frame dry gain use
  `clamp(volume * (R*50 - distance) / (R*50), 0, 1)`. The multiplier is bound by
  ALAudio's named import to the original Core export, whose value is `50`.
  At zero distance, **finite nonzero R cancels**. No particular radius value
  needs to be invented for that conditional algebraic result.
- The native assertion is the literal **`Radius`**, not `Radius > 0`.
  Instructions `0x1000a72f–0x1000a739` reject zero but also admit negative and
  unordered values. It is not proof that the unresolved input is finite.
- Reflected `UseEAX` is driver field `+0xe4`. Initialization leaves `EAXSet`
  null when disabled or unavailable. When present, the same ordinary sound
  submits separate radius-dependent values through EAX: the initial smoothed
  radius is `max(R,1)`, then its ratio to R enters the filter calculation.
  Consequently the dry-gain reduction does not prove EAX equivalence. No
  occlusion/obstruction property names are assigned to the numeric EAX calls
  without their separate API binding.
- `SetSoundVolume` rescales the stored gain of existing ordinary SFX voices
  (`0x10006e08–0x10006e14`) and updates `AL_GAIN`. Source gain one does not mean
  bypassing the user's mixer.

The portable gain tests are exact-real algebra witnesses and regression checks
for the nonzero assertion. They are explicitly **not** native floating-point
emulation, execution evidence, or proof of the missing radius import. The
conditional dry-stereo contract requires the same valid pawn at both snapshots,
finite nonzero R, ordinary flags-zero PCM, and no EAX processing. Those
conditions have not all been established from the current recovered inputs, so
the verifier reports `conditional-reduction-only` and browser playback remains
disabled. The optional comparison closes the two import identities within its
documented correspondence boundary. It does not close the remaining conditions.

No invented radius, positional adapter, gain constant or generic UI-sound
fallback has been added. Full mixer behavior, EAX/reverb, alternate viewports,
voice allocation/stealing and modes one/two remain outside this checkpoint. The verifier pins
source identities and instructions; it does not claim that the original client
was executed or that browser audio parity has been demonstrated.

## Radius and camera binding inventory

The follow-up verifier now checks **205 instruction anchors**. An independent
word subtraction and reverse-addition round trip from the pinned raw Engine
reproduces the zero pointer at `0x11d8dc10` and six NOP bytes at `0x1056b250`.
The shared decoder therefore did not manufacture these missing values/calls.
This does not establish who produced the bytes or whether/how startup restores
them; see [the recovery boundary](native-engine-recovery-evidence.md).

All 29 literal occurrences of the radius-slot address in the recovered image
decode as direct pointer loads. Unknown byte shapes fail the inventory check
instead of being omitted. The named `APlayerController::execClientHearSound`
also loads this slot when its radius argument is zero (`0x106a11af–0x106a11cb`),
then passes that value to audio slot `+0x80` (`0x106a121b`). This establishes a
default-radius role shared with mode-zero quest sound, not a finite value or
named provider. Literal loads do not exclude indirect/computed initialization
or later runtime writes.

The raw ordinary PE import directory lists only `KERNEL32.dll` and
`COMCTL32.dll`. It contains no Core binding for the slot or camera helper.
Core's separately named `GAudioDefaultRadius` and the driver's named import
do not prove that this Engine slot points to that export. Assigning its value
here would still be an unsupported substitution.

The original-only receipt retains the raw-roundtrip hashes and 29-address
inventory in `bindingBoundary`; its status remains `unresolved`. That result
is distinct from the optional correspondence check below. Neither check
executes or repairs the owned binary.

## Supplemental binding check

A fresh ordinary browser fight on 28 September produced two unhandled
`playSound` events, making this an observed beginner-flow gap. The recorded
warnings did not expose the sound references; they do not identify which of
the four quest assets, or another sound, the server requested.

The verifier compares these additional pinned inputs:

| Comparison input | SHA-256 |
| --- | --- |
| Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Core.dll | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

Three blocks, totaling 417 bytes, match after only explicit named class/global
relocations, named imported calls at erased sites, and unchanged direct-call
targets are accounted for:

| Owned interval (end excluded) | What the correspondence establishes |
| --- | --- |
| `0x1049dfd4..0x1049e0af` | Complete mode-zero lookup and driver dispatch; named Sound lookup/load/type imports and default-radius pointer |
| `0x1056b240..0x1056b262` | Controller cast helper uses the named controller class and `UObject::IsA` |
| `0x106556d1..0x10655775` | Camera node's separate audio-position choice and call to the matched cast helper |

The comparison radius IAT slot `0x11d8dc0c` names
`Core.?GAudioDefaultRadius@@3MA`. Both original Core files export identical
four-byte Float32 `80` data. The verifier checks that data through each named
export. It does not infer the radius from how the game sounds. The helper
thunk at `0x10312445` is also checked, so a nearby `IsA` occurrence cannot stand
in for the camera's actual call. Undeclared surrounding-byte differences fail.

The receipt reports `matched-supplemental-bindings` separately from the still
conditional dry-gain result. This is correspondence evidence, not archive
authentication or proof of how the protected owned client restores its imports.
No client files or decoded bytes are published.

The next integration dependency is the state between camera-node construction
and audio update. Named `FCameraSceneNode::UpdateMatrices` follows the audio
position stores, and Draw calls `UViewport::IsDepthComplexity` and render-interface
slot `+0x10` before Audio.Update. Their effects and any indirect writes must be
accounted for before claiming that every update retains the same pawn snapshot.
Original voice lifetime, source loading, mixer controls and EAX processing also
remain separate. Browser playback is not enabled by this binding check alone.
