# elitepvpers hero post — the viral version

vBulletin BBCode. Everything between the `=== COPY BELOW ===` markers pastes
straight into the editor.

## Before you post — read this, it decides whether the thread lands

**The images carry this post.** L2 forums scroll fast and nobody reads a wall
of text from an unknown poster. The formatting below is built around five
images; without them it's a worse version of what you already had. Capture, in
this order of importance:

1. **HERO — Giran, wide, from a player's eye height.** Not a top-down dev view.
   The thing that stops the scroll is a screenshot that looks like *the game*,
   in a browser, with the browser chrome visible. Chrome visible is the whole
   point: it proves the claim instantly.
2. **UI close-up** — inventory or character sheet open over the world. This is
   what separates you from every "L2 in WebGL" tech demo that renders terrain
   and nothing else.
3. **Combat** — mid-swing, with a mob and damage numbers.
4. **Side-by-side vs umodel or the retail client** — your render next to ground
   truth. This is the single most persuasive image for the engineers you want.
5. **Toolchain output** — a terminal showing a `--check` gate passing, or the
   audit report. Sells the discipline.

Upload to imgur (or attach); replace every `PUT_IMAGE_URL_HERE`.

**A GIF beats all five.** Ten seconds of walking through Giran with the UI up
will do more than any paragraph here. If you can record one, put it directly
under the title.

**Title options** (epvp thread titles are searched, so keep "Lineage 2" and
"Interlude" in them):

- `[Release/WIP] Lineage 2 Interlude in the browser — no client, no download. Looking for devs`
- `Lineage 2 Interlude, decoded and running in a browser tab — open source toolchain, looking for collaborators`
- `[Project] Interlude in WebGL: 100 tiles, 772 models, real aCis protocol — need UE2 + three.js help`

**Posting notes.** Reply to your own thread with progress — epvp rewards
active threads, and a dead-looking project attracts nobody. Answer technical
questions in detail; the "how did you decode X" replies are what convert
lurkers into contributors. And do not let anyone post asset mirrors — say it
once in the post and moderate it in replies.

**The accent colours below** (`#B09B79`, `#DCDCDC`) are the real Interlude UI
palette, decoded out of `Interface.xdat`. Worth a quiet mention in replies if
someone asks — it's the kind of detail that signals you actually did the work.

---

=== COPY BELOW ===

```bbcode
[CENTER][SIZE=7][B][COLOR=#B09B79]E L B E R A[/COLOR][/B][/SIZE]

[SIZE=4][COLOR=#DCDCDC]Lineage 2 Interlude. In a browser tab.
No client. No download. No plugin.[/COLOR][/SIZE]

[IMG]PUT_HERO_IMAGE_URL_HERE[/IMG]

[SIZE=3][I][COLOR=#9A9A9A]Yes — that is a browser. Yes — that is Giran.[/COLOR][/I][/SIZE]
[/CENTER]

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]WHAT THIS IS[/COLOR][/B][/SIZE][/CENTER]

Not a remake. Not a reimplementation. Not "inspired by".

This is [B]the real Interlude client[/B] — its maps, its meshes, its textures,
its sounds, its encrypted tables — decoded and rendered with three.js, talking
to [B]a real, unmodified aCis server[/B] over WebSocket.

[COLOR=#B09B79][B]The server cannot tell a browser from a retail client.[/B][/COLOR]
Same login handshake. Same RSA, Blowfish and XOR streams. Same packets. To
aCis, a browser is just another player connecting.

You open a tab. You are standing in Giran.

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]SEE IT[/COLOR][/B][/SIZE][/CENTER]

[CENTER]
[IMG]PUT_UI_SCREENSHOT_URL_HERE[/IMG]
[SIZE=2][COLOR=#9A9A9A]The retail UI — rebuilt from Interface.xdat at mined, client-exact geometry. Not redrawn by eye.[/COLOR][/SIZE]

[IMG]PUT_COMBAT_SCREENSHOT_URL_HERE[/IMG]
[SIZE=2][COLOR=#9A9A9A]Real combat, real formulas — aCis is doing the maths, exactly as it always did.[/COLOR][/SIZE]

[IMG]PUT_SIDEBYSIDE_URL_HERE[/IMG]
[SIZE=2][COLOR=#9A9A9A]Left: the port. Right: ground truth. Every conversion is checked against the original.[/COLOR][/SIZE]
[/CENTER]

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]BY THE NUMBERS[/COLOR][/B][/SIZE][/CENTER]

[CENTER][SIZE=3]
[COLOR=#B09B79][B]100[/B][/COLOR] map tiles converted — [I]the entire Interlude world grid[/I]
[COLOR=#B09B79][B]163,953[/B][/COLOR] static prop placements
[COLOR=#B09B79][B]332,717[/B][/COLOR] triangles of BSP building geometry, decoded from the maps
[COLOR=#B09B79][B]772[/B][/COLOR] glTF models — 495 monsters/NPCs, 14 player models, 180 weapons
[COLOR=#B09B79][B]99.7%[/B][/COLOR] of spawned NPCs render their real retail model
[COLOR=#B09B79][B]30,177[/B][/COLOR] textures exported from the client
[COLOR=#B09B79][B]5,128 + 250[/B][/COLOR] sound effects and music tracks, out of the encrypted .uax banks
[COLOR=#B09B79][B]172,253[/B][/COLOR] ambient sound emitters placed from the retail map actors
[COLOR=#B09B79][B]29,812[/B][/COLOR] skill records decoded from the encrypted .dat tables
[COLOR=#B09B79][B]2,083[/B][/COLOR] system messages — the client shows the game's own text, not ids
[COLOR=#B09B79][B]107[/B][/COLOR] automated verification suites
[/SIZE][/CENTER]

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]THE RULE THIS PROJECT RUNS ON[/COLOR][/B][/SIZE][/CENTER]

[CENTER][SIZE=5][B][COLOR=#DCDCDC]"Never invent a value."[/COLOR][/B][/SIZE][/CENTER]

Every number comes from the client binary, the server's own reply, or a umodel
cross-check. When something [I]cannot[/I] be decoded, it gets documented as a
gap — [B]never filled in with something plausible[/B].

If you have worked on L2 emulation you know exactly why this matters. Most
ports drift. Someone eyeballs a colour, guesses an offset, ships it, and five
years later nobody alive can tell which values were measured and which were
invented. The port becomes folklore.

And this is not a slogan — [B]it is enforced in code[/B]:

[LIST]
[*]Tools [B]refuse to emit output[/B] they cannot tie back to source data. The
inventory-slot miner will not write a single file unless it reproduces every
anchor the client's own UI definition declares.
[*]A repo-wide audit classifies [B]all 8,192[/B] numeric and colour literals in
the codebase as sourced, authored, or unsourced.
[*][B]2,225 are still unsourced — and that number is published in the README.[/B]
[/LIST]

[COLOR=#B09B79]Publishing what is [I]not[/I] finished is the point.[/COLOR] A
codebase nobody has measured cannot claim fidelity.

[SPOILER="Three things that rule caught recently — click if you like war stories"]
[B]The font lost its outline and nobody noticed for months.[/B]
Retail's UI font stores its dark outline in the alpha channel. The port
computed glyph coverage as max(R,G,B) — which is 255 on the white glyph core
and [B]0 on every outline level[/B]. Measured coverage surviving: 78% for the
small font, [B]26.8% for the large one[/B]. The large font had no outline at
all. Every label in the game was subtly wrong, and it looked fine until
somebody actually measured the texels.

[B]An entire staircase in Giran did not exist.[/B]
The map extractor located each object's property list by scanning and scoring
candidates — and a scan that re-syncs deeper into the data can parse perfectly,
end in exactly the right place, and carry [I]more[/I] fields than the real list
while missing the one that says which mesh to draw. It silently dropped
[B]6,782 placements[/B] across the world, including the plaza staircase people
walk up every day. Deriving the offset instead of scanning recovered all of
them.

[B]The sky was invented.[/B]
A hand-picked blue gradient nobody could source. The real colour decodes
cleanly out of the map data: a colour modifier tinting a 32x32 pure-white chip,
so the modifier's colour [I]is[/I] the rendered colour — no residual unknown.
It was never a hard problem. It was just never checked.
[/SPOILER]

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]WHAT DOES NOT WORK YET[/COLOR][/B][/SIZE][/CENTER]

Posting this honestly because you will find out in ten minutes anyway, and
because a project that hides its gaps is a project you should not contribute to.

[LIST]
[*]BSP lightmaps are not rendered yet — buildings are lit, but not the way
retail lights them.
[*]Some creature animations still fall back where the retail clip exists and
the extractor missed it.
[*]Footstep audio is decoded and built but not yet wired to the animation
notifies.
[*]A handful of NPCs cannot be built from the data at all, and are documented
rather than faked.
[*]2,225 literals still unsourced, as above.
[/LIST]

The README carries a full [B]Honest limitations[/B] section. It is longer than
this list.

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]I NEED HELP[/COLOR][/B][/SIZE][/CENTER]

This is too big for one person. If any of this is your thing, I want to hear
from you:

[LIST]
[*][B][COLOR=#DCDCDC]UE2 / reverse engineering[/COLOR][/B] — .unr, .ukx, .utx,
.uax internals, UnrealScript bytecode, the undecoded property tails. If you
have stared at UE2 package formats, you are useful on day one.
[*][B][COLOR=#DCDCDC]three.js / WebGL[/COLOR][/B] — BSP lightmaps, particles,
shaders, batching across a 300m draw distance.
[*][B][COLOR=#DCDCDC]Java / aCis[/COLOR][/B] — server side, and the gaps
between what the server sends and what a retail client expects.
[*][B][COLOR=#DCDCDC]Node / protocol[/COLOR][/B] — the gateway codec and packet
coverage.
[*][B][COLOR=#DCDCDC]UI pixel work[/COLOR][/B] — against mined xdat geometry.
Tedious, extremely visible, very satisfying.
[*][B][COLOR=#DCDCDC]Testers who know Interlude cold[/COLOR][/B] —
[COLOR=#B09B79]genuinely the most valuable thing on this list.[/COLOR] Half the
real bugs fixed here were found by someone saying "that animation is wrong" or
"the floor looks off in Giran". [B]You do not need to write a line of code to
move this forward.[/B]
[/LIST]

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]LEGAL — READ THIS[/COLOR][/B][/SIZE][/CENTER]

[LIST]
[*]The [B]code[/B] is MIT. Tools, gateway, web client, deploy scripts — all of it.
[*][B]No game assets are distributed.[/B] Not by me, not in the repo. The
toolchain extracts and converts from [I]your own[/I] legally obtained Interlude
client at build time. Converted output is gitignored and regenerable.
[*]Lineage 2 and all its assets are [B]© NCSoft Corporation[/B].
[*]This is a [B]preservation and engineering project[/B]. I am not running a
public server and this is not a server advertisement.
[/LIST]

[COLOR=#FF6B6B][B]Please do not post asset mirrors or client packs in this
thread.[/B][/COLOR] The bring-your-own-client position is the entire legal
footing of this project. I will ask for them to be removed.

[HR][/HR]

[CENTER][SIZE=4][B][COLOR=#B09B79]LINKS[/COLOR][/B][/SIZE][/CENTER]

[CENTER]
[SIZE=4][B][URL="https://github.com/elberacasa/Lineage2Elbera"]github.com/elberacasa/Lineage2Elbera[/URL][/B][/SIZE]

[SIZE=2][COLOR=#9A9A9A]Full numbers · architecture · the honest limitations section · every tool documented[/COLOR][/SIZE]

[B]Contact:[/B] [EDIT: your Discord / DM]
[/CENTER]

[HR][/HR]

[CENTER][SIZE=3][I][COLOR=#DCDCDC]Interlude is twenty years old. It should not need
a 2004 executable to exist.[/COLOR][/I][/SIZE]

[SIZE=2][COLOR=#9A9A9A]Ask me anything technical in-thread — especially the "how did you decode X" kind.[/COLOR][/SIZE][/CENTER]
```

=== COPY ABOVE ===

---

## If the forum strips `[HR]` or `[SPOILER]`

Some vBulletin installs disable them. Fallbacks:

- `[HR][/HR]` → a centred line of `─────────────────────────────`
- `[SPOILER="x"]…[/SPOILER]` → `[QUOTE]…[/QUOTE]`, or just inline it; the war
  stories are strong enough to leave visible if the post isn't too long.

Preview before submitting — epvp's editor sometimes eats nested colour inside
size inside bold. If a tag misbehaves, drop the innermost one first.
