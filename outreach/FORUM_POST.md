# Collaborator call — copy-paste posts

Three versions below. **BBCode** for elitepvpers / L2 forums, **Markdown** for
Discord, GitHub Discussions and Reddit, and a **short version** for places with
a character limit.

Two things to edit before posting:

- **Contact line** — a Discord handle or forum DM is expected; the posts have a
  `[EDIT: your contact]` placeholder. A post with no contact reads as a
  showcase, not a recruitment.
- **Screenshots** — every one of these platforms weights images heavily. Attach
  3–5. Suggested set: a town exterior, the retail UI with a window open, a
  combat moment, and one build-plane shot (the toolchain output or a
  side-by-side against umodel). The last one is what convinces engineers.

A note on where to post: elitepvpers' L2 section skews server-operator, so the
framing there is "engine port + toolchain", not "come play". For r/gamedev,
r/threejs and Hacker News, lead with the reverse-engineering and drop the L2
community shorthand — those readers care about the UE2 decoding and the
browser rendering, not about Interlude.

**Do not** post download links to client assets, converted or otherwise. The
project's whole legal position is bring-your-own-client, and a single asset
mirror in a recruitment thread would undo it. The posts below say this
explicitly; keep that paragraph in.

---

## 1. BBCode — elitepvpers and most L2 forums

```bbcode
[SIZE=4][B]Lineage 2 Interlude, running in a browser — looking for collaborators[/B][/SIZE]

I have been porting Lineage 2 Interlude to the browser. Not a remake, not a
reimplementation: the real client assets, decoded, rendered with three.js, and
connected to a real aCis server that cannot tell a browser from a retail client.

No plugin, no download, no install. You open a tab and you are in Giran.

[B]What actually works right now[/B]

[LIST]
[*][B]The whole world.[/B] All 100 map tiles converted, 163,953 static prop
placements, BSP building geometry decoded from the maps (332,717 triangles),
each tile carrying its own sun, fog and ambient colour pulled from the retail
map data.
[*][B]The creatures.[/B] 772 glTF models built from the retail meshes — 495
monsters/NPCs, 14 player models, 180 weapons and shields. 99.7% of spawned NPC
instances render their real model.
[*][B]The protocol.[/B] Full Interlude login + game handshake (RSA, Blowfish,
XOR streams) bridged to JSON over WebSocket. Movement, chat, combat, skills,
inventory, party, trade, shops. The server is unmodified aCis — the browser is
just another client to it.
[*][B]The UI.[/B] Retail windows rebuilt from Interface.xdat at mined,
client-exact geometry — not redrawn by eye. Inventory, character sheet, skill
bar, chat, status, target.
[*][B]Sound.[/B] 5,128 effects and 250 music tracks pulled out of the encrypted
.uax banks, with 172,253 ambient emitters placed from the retail map actors.
[*][B]The tables.[/B] 29,812 skill records and 2,083 system messages decoded
from the encrypted .dat files, so the client shows the game's own text.
[/LIST]

[B]The rule the project runs on[/B]

Never invent a value. Every number comes from the client binary, the server's
own reply, or a umodel cross-check. When something cannot be decoded, it gets
documented as a gap instead of filled with a plausible guess.

That is not a slogan — it is enforced. Tools refuse to emit output they cannot
tie back to source data, and a repo-wide audit classifies all 8,192 numeric and
colour literals in the codebase as sourced, authored, or unsourced. 2,225 are
still unsourced and that number is published in the README, because a codebase
nobody has measured cannot claim fidelity.

If you have worked on L2 emulation you already know why this matters. Most
ports drift: someone eyeballs a colour, guesses an offset, and five years later
nobody can tell which values were measured. This one is designed so that never
happens quietly.

[B]Where I need help[/B]

[LIST]
[*][B]UE2 / reverse engineering[/B] — .unr, .ukx, .utx, .uax internals,
UnrealScript bytecode, the remaining undecoded property tails. If you have
stared at UE2 package formats, you will be useful on day one.
[*][B]three.js / WebGL[/B] — BSP lightmaps, particle systems, shader work,
draw-call batching across a 300m draw distance.
[*][B]Java / aCis[/B] — server side, custom mods, and closing the gap between
what the server sends and what a retail client expects.
[*][B]Node / protocol[/B] — the gateway codec, packet coverage, edge cases.
[*][B]UI fidelity[/B] — pixel work against the mined xdat geometry. Tedious,
visible, and satisfying.
[*][B]Testers who know Interlude cold[/B] — genuinely valuable. Half the real
bugs this project has fixed were found by someone saying "that animation is
wrong" or "the floor looks off in Giran". You do not need to write code to
move this forward.
[/LIST]

[B]Legal, because it matters[/B]

The code is MIT. [B]No game assets are distributed[/B] — not by me, not in the
repo. The toolchain extracts and converts from [I]your own[/I] legally obtained
Interlude client at build time. Converted output is gitignored and regenerable.
Lineage 2 and its assets are © NCSoft. This is a preservation and engineering
project, not a server launch, and I am not running a public game.

Please do not post asset mirrors in this thread.

[B]Repo[/B]
[URL]https://github.com/elberacasa/Lineage2Elbera[/URL]

The README has the full numbers, the architecture, and an honest limitations
section listing everything that does not work yet.

Contact: [EDIT: your contact]

Happy to answer technical questions in-thread — especially the "how did you
decode X" kind.
```

---

## 2. Markdown — Discord, GitHub Discussions, Reddit

```markdown
## Lineage 2 Interlude, running in a browser — looking for collaborators

I've been porting Lineage 2 Interlude to the browser. Not a remake and not a
reimplementation: the real client assets, decoded, rendered with three.js, and
connected to a real aCis server that can't tell a browser from a retail client.

No plugin, no download. You open a tab and you're in Giran.

### What works right now

- **The whole world** — all 100 map tiles converted, 163,953 static prop
  placements, 332,717 triangles of BSP building geometry decoded from the maps,
  each tile carrying its own sun, fog and ambient colour from the retail data.
- **The creatures** — 772 glTF models built from retail meshes (495
  monsters/NPCs, 14 player models, 180 weapons and shields). 99.7% of spawned
  NPC instances render their real model.
- **The protocol** — full Interlude login + game handshake (RSA, Blowfish, XOR
  streams) bridged to JSON over WebSocket. Movement, chat, combat, skills,
  inventory, party, trade, shops. The server is unmodified aCis.
- **The UI** — retail windows rebuilt from `Interface.xdat` at mined,
  client-exact geometry rather than redrawn by eye.
- **Sound** — 5,128 effects and 250 music tracks out of the encrypted `.uax`
  banks, 172,253 ambient emitters placed from the retail map actors.
- **The tables** — 29,812 skill records and 2,083 system messages decoded from
  the encrypted `.dat` files.

### The rule the project runs on

**Never invent a value.** Every number comes from the client binary, the
server's own reply, or a umodel cross-check. What can't be decoded gets
documented as a gap rather than filled with something plausible.

It's enforced, not aspirational. Several tools refuse to emit output they can't
tie back to source data — the inventory-slot miner won't write unless it
reproduces every anchor the xdat declares — and a repo-wide audit classifies all
8,192 numeric and colour literals as sourced, authored, or unsourced. 2,225 are
still unsourced, and that number is in the README, because a codebase nobody has
measured can't claim fidelity.

Concretely, that rule keeps paying off. Recent finds: the large UI font had lost
its entire outline because someone computed glyph coverage as `max(R,G,B)` when
the outline lives in the alpha channel; the extractor was silently dropping
6,782 prop placements including an entire staircase in Giran; and the sky colour
turned out to be invented when the real one decodes cleanly out of the map data.

### Where I need help

- **UE2 / reverse engineering** — `.unr`, `.ukx`, `.utx`, `.uax` internals,
  UnrealScript bytecode, the remaining undecoded property tails.
- **three.js / WebGL** — BSP lightmaps, particles, shaders, batching.
- **Java / aCis** — server side and protocol gaps.
- **Node** — the gateway codec and packet coverage.
- **UI fidelity** — pixel work against mined xdat geometry.
- **Testers who know Interlude cold** — genuinely valuable. Half the real bugs
  fixed here were found by someone saying "that animation is wrong" or "the
  floor looks off in Giran". No code required.

### Legal

Code is MIT. **No game assets are distributed.** The toolchain extracts and
converts from *your own* legally obtained Interlude client at build time;
converted output is gitignored and regenerable. Lineage 2 and its assets are
© NCSoft. This is a preservation and engineering project, not a server launch.

Please don't post asset mirrors.

**Repo:** https://github.com/elberacasa/Lineage2Elbera
The README has full numbers, architecture, and an honest limitations section.

Contact: [EDIT: your contact]
```

---

## 3. Short version — character-limited platforms

```
Lineage 2 Interlude running in a browser — real client assets decoded and
rendered with three.js, talking to an unmodified aCis server over WebSocket.
No plugin, no download.

Done: 100 map tiles, 163,953 prop placements, 772 glTF models, 99.7% of NPCs
rendering their real mesh, 5,128 sound effects, retail UI rebuilt from
Interface.xdat at mined geometry, full login+game protocol.

The rule: never invent a value. Everything comes from the client binary, the
server's reply, or a umodel cross-check — and what can't be decoded is
documented as a gap, not guessed. A repo-wide audit tracks all 8,192 literals
and publishes how many are still unsourced.

Looking for: UE2 reverse engineers, three.js devs, aCis/Java, Node protocol
work, UI pixel work, and testers who know Interlude cold.

Code is MIT. No game assets distributed — bring your own client.

https://github.com/elberacasa/Lineage2Elbera
Contact: [EDIT: your contact]
```
