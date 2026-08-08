# Visual log

Newest first. Each row pairs a retired screenshot with the fix that made it
obsolete. See `CONVENTION.md` for how to add one.

| Retired | Image | Replaced because |
|---|---|---|
| _(pending)_ | `world-giran.jpg` | Awaiting recapture after: the extractor recovered 6,782 prop placements that were never in the data (incl. `Giran_V_Plaza_Stair01`), the geodata cell-index transpose was fixed (148M cells returned wrong heights), and the walk raster made prop surfaces walkable. The current image predates all three. |
| _(pending)_ | `retail-ui.jpg`, `character-sheet.jpg`, `hotbar-cast.jpg` | Awaiting recapture after: the large UI font regained its outline (coverage was read from the wrong channel, 26.8% of the outline mass was being discarded), UI colours were bound to their xdat records instead of an authored gold retail never uses, and the shortcut bar regained its background plate. |

## How to capture a replacement

`editor/world/` carries the shot tooling. `stage_shots.js` is the working
reference: it launches headless Chrome with `--use-angle=swiftshader` (NOT
`--use-gl`, which fails here), waits on the real `enterWorld` packet rather
than a sleep, and — importantly — aims cameras **analytically** and verifies
the framing by projecting the subject to screen coordinates.

Do not hard-code camera positions that "look reasonable". An earlier attempt
did exactly that and produced a black frame and the underside of a roof; the
tool was deleted rather than shipped. Verify every frame before accepting it:
subject inside the viewport, and a pixel-variance check to catch the
mostly-one-flat-colour failure that means the camera is inside geometry.
