# Elbera Tools: live skill progression checkpoint

On 2026-09-26 the existing local human fighter was advanced from level 2 to
level 5 through ordinary combat. No account, character, experience, skill,
inventory or database rows were seeded or edited for this checkpoint.

Auto-learning is a **server policy**, not an original-client progression rule
implemented in the browser. Both local source and built `players.properties`
already had `AutoLearnSkills = True`; they were left unchanged. The browser
must also retain the original acquisition windows for servers and skill types
that use trainers. A successful automatic grant does not certify paid training.

## What was observed

The character began at level 2, EXP 145, SP 10, with skills 194@1, 1320@1
and 1322@1. Five Elder Keltir kills were performed through the gateway's
ordinary movement/target/attack requests. These reached level 4, EXP 2770,
SP 60. A sixth fight, against a Bearded Keltir, was selected and started by
clicking its rendered model in the browser. The server awarded 175 EXP and
10 SP and the open Skill window updated immediately at level 5.

| Newly granted skill | Received level | Visible original metadata |
| --- | --- | --- |
| 3, Power Strike | 3 | MP 11, range 40, description power 30 |
| 16, Mortal Blow | 3 | MP 10, range 40, description power 88 |
| 56, Power Shot | 3 | MP 21, range 700, description power 78 |
| 226, Relax | 1 | MP 2, recovery description |
| 141, Weapon Mastery | 1 | Passive, attack-power description |
| 142, Armor Mastery | 1 | Passive, defense description |

These are the received skill levels and decoded original descriptions, not
browser-computed damage or costs. The current server class tree has levels
1, 2 and 3 of each of those attacks available at character level 5; its
auto-learn path grants the highest available level. Mortal Blow and Power
Shot showed the current weapon restriction while Power Strike remained usable.

Clicking the newly granted Relax skill produced the server's “You use Relax”
message, a sitting character, and the recovery tutorial. The server then
deactivated it because HP was full, as its `EffectRelax` implementation
requires. This tests acceptance and posture/tutorial routing; it does not
measure recovery ticks or prove offensive skill damage/animation parity.

Leaving Online cleared the Skill window to zero cells. Reloading the browser
and reconnecting restored all nine exact skill ID/level rows, including the
six new grants. The browser reported no errors or warnings in these checks.

A separate connection with the reusable Elbera Tools playtest client confirmed
level 5, EXP 2945 and SP 70 with the same nine skills. After a source-geodata
walk of 100 units, the tool observed the server's origin at the destination.
Its initial pre-entry NPC omission was found and fixed; a fresh connection
then retained 37 nearby NPCs. A manually requested Power Strike level 3
produced `skillCast` (864 ms), `skillLaunch`, and MP reduction from 66 to 55
against an actual Elder Keltir. The subsequent ordinary combat ended with
the mob's death and EXP 3470 / SP 80. This is an offensive-skill protocol
check, separate from the browser Relax/posture test and native visual parity.

The Relax test also exposed lost SystemMessage parameter types: the abort
line displayed `226` instead of the skill's name. After retaining the wire
skill ID/level pair and resolving exact original text, a fresh browser session
displayed `Relax has been aborted.` The private `skill-message-live.png`
captures that correction; no browser errors or warnings were reported.

## Source and evidence boundaries

The local server's `PlayerStatus.addLevel` invokes `Player.giveSkills`.
With the configured policy enabled, `rewardSkills` adds available skills,
stores the paid-tree entries, and sends a complete `SkillList`. That snapshot
arrives before the updated `UserInfo`; the browser must not infer its contents
from a displayed character level. Reconnecting is the live persistence check.

| Local interoperability input | SHA-256 |
| --- | --- |
| Source and built `players.properties` | `a0343c07dde0881b4f10002a191792f7ddb400c825a1c19908b1351a9b0c2bc3` |
| `humanFighter.xml` | `3327bdbba8c05794b6d8dcfad3aa8475dc32227b1b71fa00682ae731143dd2ba` |
| Skills `0200-0299.xml` | `b73885cc2b9b1d33b071ac8e6b596f50aedf300fa85ed142425ab71105e758f3` |

Original text provenance is documented in
[exact-level skill text](skill-level-text-evidence.md). Native packet and
signed target-colour evidence is documented in
[skill-state evidence](native-skill-state-evidence.md). Emulator skill trees,
spawn locations and rewards are interoperability inputs, not official-client
fidelity proof.

Private receipts stay ignored under `tmp/restart-audit/`: the controlled
journey log, `auto-learn-live-level5.png`, `auto-learn-relax-live.png`, and
`auto-learn-reconnect-level5.png`, plus `progression-tool.jsonl`. One intermediate protocol walk stopped
because the next server origin showed no progress; the subsequent combat
auto-approach succeeded. This checkpoint does not certify that route or all
world navigation. It also does not cover class change, all race/class trees,
successful paid training, long-term persistence across a server restart, or
complete native UI and casting fidelity.
