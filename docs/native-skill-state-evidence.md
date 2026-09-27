# Elbera Tools — learned-skill state and signed target difference

This checkpoint keeps learned skills authoritative to the connected server.
It does not change auto-learning, progression, skill costs or database state.
Trainer offers and learned-skill snapshots are separate protocols.

## Original client evidence

Reproduce with `python3 tools/ui/check_skill_state_native.py --check`.
Private input: `assets/interlude/system/engine.dll`, SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
The shared `Image` helper decodes the original code in memory; no decoded
binary is saved. Image base is `0x10300000`; subtract it from the listed VAs
for RVAs. Recovery details are in [native-terrain-evidence.md](native-terrain-evidence.md).

| Packet | Original dispatch and body | Evidence |
| --- | --- | --- |
| SkillList `0x58` | registration `0x108373b3`, stub `0x1030a399`, body `0x10415450` | Header format `d`, loop format `dddc`: 13 bytes per row. Dispatch at `0x104154b4` precedes the count-controlled row callbacks at virtual offset `0x464`. |
| MyTargetSelected `0xa6` | registration `0x10837ca4`, stub `0x1030951b`, body `0x10427590` | Format `dhd`; `movsx esi, word ptr [esp+0x1c]` at `0x104276b6` sign-extends the H before the UI callback. |

The local aCis writer emits only `dh` for MyTargetSelected. The gateway
preserves that compatibility and sign-extends H; it does not require the
original additional D. A received `0xffff` therefore becomes `-1`, matching
the browser's signed con-color ladder. The missing native D is a protocol
parity gap, not evidence that the original format was shorter.

The native verifier proves the indicated instruction/dataflow relationships.
Packed Engine import calls have been erased; this is static evidence, not an
executed original-client trace. It does not prove full category, shortcut,
cast-bar or scheduler parity.

## Server lifecycle and browser behavior

In the current server source, `PlayerStatus.addLevel()` calls `giveSkills()`
before sending UserInfo. With auto-learning enabled, `giveSkills()` delegates
to `rewardSkills()`, then sends SkillList containing all currently granted
skills, their levels and passive/disabled flags. This is evidence of this
server's rules, not an assertion about official server configuration.

The gateway validates the complete 13-byte row count before publishing any
snapshot. Pre-entry snapshots retain the latest list, including an empty
list; subsequent UserInfo updates do not trigger another world entry.
The browser replaces its live learned-skill state on every snapshot. Its
panel and shortcuts use the received level for exact-level metadata. A
saved shortcut retains its skill ID; unavailable, removed and passive skills
cannot be invoked through that slot. No new shortcut is assigned on a grant.

Connection changes clear skill/cooldown/cast state and visible shortcuts.
Saved bindings remain local and can be reloaded for the same character;
they never restore learned levels or grant authority. Empty character names
do not read or write a shared default shortcut store. The local cast bar
starts when its packet arrives; asynchronous metadata can only name that
same live cast, never revive a cancelled cast or start one in another session.

Local shortcut persistence remains a parity gap: this checkpoint does not
implement the original server shortcut list/register/delete protocol or
resolve character-name collisions across independent game servers.

## Portable regression checks

```
node --test gateway/test/skill-list.test.js editor/world/test/skill-state.test.mjs editor/world/test/online-session.test.mjs
```

Synthetic wire fixtures cover snapshot replacement, empty/pre-entry lists,
malformed lengths, independent sessions and signed target words. Actual
browser methods run with controlled metadata/DOM fixtures to cover upgrades,
removals, disabled/passive flags, exact-level shortcut metadata, reconnect
cooldown clearing and stale asynchronous work. No live character, private
asset or database is needed. Root's live progression check is separate.
