# Owner's rule: official data fidelity

The goal is to port Lineage 2 Interlude faithfully to the browser. Always stay
true to official game data. Never invent game values, geometry, placements,
stats, timings, rules or asset meanings to make something look or work better.
Decode, decrypt, extract or investigate the original data as needed.

The goal is the full browser port. A working map checkpoint, demo, beginner
loop or small invited playtest is a milestone, not completion of that goal.

The browser must function as the full original game client: skills, class-
specific animations, effects, mobs, progression and every dialog/menu are in
scope. UI appearance and interaction must match official Interlude. A generic
browser dialog, approximate layout, shared fallback animation, or disabled
menu is an explicit parity gap, not an acceptable finished substitute.

Tie recovered values and rules to their source, client edition and reproducible
evidence. An older agent's comments, a passing self-referential test, another
browser port or an emulator is not proof of official behavior. Use them as
comparisons, not as replacements for official evidence.

Keep unknowns explicit. Missing source data stays missing; do not fabricate
replacements. Distinguish confirmed source data from provisional rendering or
compatibility behavior. Existing unsupported assumptions are investigation
targets, not precedents. Preserve private inputs and do not push them publicly.

# Elbera Tools

Preserve reusable decoders, native-evidence verifiers, inspection pages and
regression tools as **Elbera Tools**, intended for a future L2 community
release. Prefer improving an existing tool over throwaway duplicate scripts.
Document inputs, edition/source fingerprints, a reproducible command, what
the tool actually proves and its limits. Keep portable synthetic tests usable
without private game files, and label checks that require those files.

Tool code, test fixtures and evidence descriptions must remain separable from
original client files, decompiled scripts, generated game assets, credentials,
databases and local playtest evidence. Do not publish or push without the
owner's authorization. Existing tool paths need not be renamed for branding.

The owner has requested professional GitHub progress updates and separate
Elbera Tools delivery. Keep public documentation current at meaningful
milestones, correct inherited overclaims, and show actual tool layouts with
curated screenshots. Publish only reviewed code, documentation, tool source
and deliberately selected screenshots; keep private inputs, generated assets,
accounts and raw local receipts out of new commits and release bundles.

Official screenshots, manuals and archived references may supplement visual
and interaction checks. Record their edition/source; they do not replace
decoded values or justify invented behavior. Full fidelity remains the goal,
pixel by pixel, mechanic by mechanic, skill by skill and byte for byte.
