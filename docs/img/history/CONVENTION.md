# Screenshot history — the visual log

The README links images by **stable filename** (`docs/img/world-giran.jpg`).
Those links must never change, or every historical README revision breaks.

So when a screenshot is replaced with a better one:

1. **Archive the outgoing image first**, into this directory, renamed with the
   date it is being retired:

   ```
   docs/img/world-giran.jpg  ->  docs/img/history/world-giran-2026-08-08.jpg
   ```

2. **Then** write the new capture to the original stable path.

3. Add a row to `VISUAL-LOG.md` (in this directory) saying what changed and
   *why* — the technical reason, not "looks better". The point of the log is
   that each pair is evidence of a specific fix.

Never delete an archived image. Storage is cheap; a before/after that proves
the geodata transpose or the missing font outline is not reproducible once the
bug is gone.

## Why this exists

This project's progress is mostly invisible in a single screenshot — a wrong
value looks fine until you put the corrected one beside it. The archive turns
"trust me, this improved" into something a reader can check:

- Giran's plaza before and after the extractor recovered 6,782 prop placements
  (the staircase in the newer shot did not exist in the data at all).
- Any UI window before and after its colours were bound to the xdat records
  instead of hard-coded.
- Town floors before and after the walk raster, where the character stands on
  the pavement instead of inside it.

That pairing is also the most persuasive material the project has for outreach
and for the README itself.

## Naming

```
<stable-basename>-<YYYY-MM-DD>.<ext>
```

The date is when the image was **retired**, not when it was taken — so sorting
the directory gives the order in which the project improved.

If two versions are retired on the same day, append `-2`, `-3`.
