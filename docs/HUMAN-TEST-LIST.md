# Human test list — overnight changes, 2026-08-09

Client at **http://127.0.0.1:8083**. Hard-refresh first (Cmd-Shift-R) — several
of these are cached JS.

Ordered so the highest-risk changes come first. **★** marks the ones where I
most want a human eye, because the automated check can only prove the number
moved, not that it *looks* right.

---

## A. The floor — the biggest change, highest regression risk

**★ A1. Climb the Giran plaza staircase.**
Walk east across the plaza steps. You should now *go up them*, not through them.
Before: the character stayed pinned at the bottom for the whole ramp.
Also try walking back **down**.

**★ A2. Click marker lands on the pavement.**
Click anywhere on Giran's stone. The click effect should appear **on the stone**,
where you clicked. Before: it was drawn under the pavement (invisible) and the
destination was a point below the floor.
Compare against clicking on open grass outside town, which always worked.

**★ A3. Town floors generally.** Walk around Giran, Aden, Dion. Report anywhere
you sink into the floor, hover above it, or stutter at a step. 145 known
disagreements remain world-wide (down from 690) — mostly on props.

**A4. Cross a tile border.** Walk from one map tile into the next. *Known
broken in some directions* — 53 tiles were never converted, including all four
south/east neighbours of the spawn town. Tell me which direction you tried.

---

## B. Combat

**★ B1. Attack something far away.**
Target a mob well out of range and attack. Your character should **walk toward
it and then fight**. Before: nothing happened at all — no movement, no message,
no error. This was the "ghost NPC" bug; it affected ~94% of attacks on distant
mobs.

**B2. Attack something in range.** Should be unchanged — damage numbers, HP
ticks. Confirm nothing regressed.

**B3. Soulshots.** Enable a soulshot on the shortcut bar, then **relog**. The
toggle should still be on and the item icon should still be there.
Before: *the entire shortcut bar was wiped on every relog.*

**B4. Monster skill casts.** Find a caster mob and let it cast. It should play a
real strike animation, not stand still. (235 monsters were affected.)

---

## C. Sound

**★ C1. Footsteps.** Walk. **You should hear footsteps for the first time** —
there were literally none before.

**C2. Footsteps change with surface.** Stone in town vs dirt/grass outside vs
water should sound different. Note: *grass vs land is not yet decoded*, so those
two may not differ — that's a known gap, not a bug.

**C3. Footstep timing.** Steps should land with the feet, not drift out of phase.
They're driven by the animation's own keyframes, so this should hold at any speed.

---

## D. Visuals

**★ D1. Town lighting.** Go inside a building, and look at building exteriors.
They should now carry retail's **baked lighting** — shadows and shading that
follow the architecture. Before, buildings were lit only by a global sun.
This is the single biggest "does it look like retail" change.

**★ D2. Text.** Look at any window title, chat, system messages. Text should have
a **dark outline** and read crisply against bright backgrounds. The large font
previously had *no outline at all*.

**D3. UI colours.** Windows should no longer show the fake gold `#c9a959`. Values,
labels and headings should look like retail's greys and tans.
*Known exception:* ClanWnd's four column headers still carry the old gold.

**D4. Sky.** Should be the decoded retail blue. Clouds, stars, sun and moon are
**not implemented yet** — expect a plain sky.

**D5. Name labels.** Walk up to a dropped item or an NPC. The name should stay a
**fixed size** and not grow as you approach. Before, a nearby item's name could
span a third of the screen.

---

## E. UI

**E1. Shortcut bar.** Should have a real **background plate** (retail art), not
bare slots on nothing. Check both horizontal and vertical orientation.

**E2. Alt+T** — character info. Should be the retail `DetailStatusWnd`, drawn on
mined geometry with the correct frame.

**E3. Inventory.** Weight gauge should fill (it reads real server load now), and
the quest tab should show quest items. Paperdoll slots should be in the right
places.

**E4. Emotes.** Try several social emotes. **Each should play its own animation.**
Before, all twelve played the dance clip.

**E5. `/trade`.** Should now do something — it was previously dead code swallowed
as an unknown command.

---

## F. Feel

**F1. Movement speed.** Should be **~9% faster** than you remember — a server
multiplier was being parsed and discarded. Compare against your memory of retail.

**F2. Walk vs run.** Should be a *state* now, not guessed from distance.

**F3. Teleports.** Should jump instantly, not walk you there.

**F4. Load time.** Please time it roughly, cold and warm. It has likely got
*slower* — we added props, a walk raster (~126 MiB) and lightmap atlases
(~35 MB). **We deliberately have not optimised anything yet**, because the
profile isn't finished. Your number is useful data.

---

## How to report back

For anything wrong, the most useful thing is: **where you were, what you did,
what you expected, what happened.** A screenshot into
`editor/world/human_shots/` is ideal — that folder is already the channel for
this and several real bugs this session started as one of your screenshots.

If something on this list *doesn't* work, that's the highest-value thing you can
tell me — every item here is backed by an automated check, so a human-visible
failure means a check is measuring the wrong thing.
