# Original creation choices and equipment inputs

Elbera Tools reads the owner's original binaries without executing DLLs. The
creation checker pins NWindow SHA-256
`af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7`
and Engine SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Engine is recovered only in memory by the documented DWORD subtraction;
[recovery limits](native-engine-recovery-evidence.md) still apply.

```sh
python3 tools/ui/check_creation_appearance_native.py --check
python3 tools/ui/check_appearance_native.py --check
node tools/ui/test_creation_appearance_native.mjs
python3 tools/dat/extract_charcreate.py
```

The first two checks require the pinned originals and Capstone. The portable
tests need only Python/Node. Extraction additionally requires the original DAT
files, `l2encdec`, and the configured aCis class files. Its generated JSON is
private and ignored; it contains original labels and references.

## Offered choices

NWindow's `NCPawnSetupWnd` initial population at `0x10198e70` appends original
SysString IDs to six selection controls. `NCSelectCtrl` stores its list at
`+0x2f0`; append calls the named Core `FArray::Add(1,4)` and the virtual clear
method at `0x10199ac0` calls named `FArray::Empty(4,0)` and resets selection to
`-1`. This is a UI list, not an inventory of texture filenames.

The sex-selection branch `0x1019964f..0x10199760` rebuilds the style list. The
checker interprets this bounded original instruction slice for all 18 offered
race/occupation/sex combinations, with no native calls or external memory.

| Choice | Original offered indices | SysString IDs |
| --- | --- | --- |
| Male hair style | 0–4 | 179, 180, 181, 182, 186 |
| Female hair style | 0–6 | 179, 180, 181, 182, 186, 187, 803 |
| Hair color, either sex | 0–3 | 179, 180, 181, 182 |
| Face, either sex | 0–2 | 179, 180, 181 |

These are unchanged across the supported races/occupations. The original
English labels are Type A onward. Selection values `+0x1fc/+0x200/+0x204`
become the final three DWORDs of `UCharacterInfo`; the named network request
at `0x10404320`, reached through its original vtable slot `+0x158`, sends them
as hair style, hair color and face on opcode `0x0b`.

`extract_charcreate.py` now joins these options to both signed Hairgrp part
indices. [The hair selector proof](native-hair-selection-evidence.md) binds
the pair to PMS_Hair1/PMS_Hair2. `-1` omits one part; it does not mean “painted
hair” or remove an offered style. The 14 original model rows contain 84 offered
styles, hence 336 style/color combinations; 34 styles omit Hair1 and none omit
Hair2. This count is metadata coverage, not completed rendering coverage.

The exporter preserves source labels and indices in per-sex/occupation
`appearanceDetail`, with `hairStyleOptions`, `hairColors`, `faces` and
`hairParts`. It no longer exports guessed mesh/texture pairs, `paintedOnly`,
or average-color swatches. Configured server class IDs/base stats are explicitly
separate from original-client evidence. The legacy race-wide style maximum is
retained for compatibility; it is not the selected sex's option domain.

## World packet context

The extended appearance-wire checker traces every argument destination in
the original UserInfo and CharInfo format strings, including `S`'s second
argument. Both write a native User item bank starting at `+0x98`.

| Packet | First item-bank fields, zero based | Native slots |
| --- | --- | --- |
| UserInfo | 25–41 | 0–14, 17, 18 |
| CharInfo | 9–20 | 0, 6–14, 17, 18 |

The installed aCis writer identifies the first UserInfo bank as object IDs and
the CharInfo bank as item-template IDs. This is consistent with the native
code: UserInfo sets User `+0x94=1`; named `GetItemClassID` branches on that
field and resolves local object IDs through named `UNetworkHandler::GetItem`
(vtable `+0xa0`), reading Item `+4`. Its remote branch uses the bank directly.

Named `HaveItem` at `0x10480f40` tests `bank[slot] > 0` as a signed integer.
Slots 17/18 are User `+0xdc/+0xe0`, respectively. The gateway's
`appearanceItems` therefore carries UserInfo's first/object-ID bank or
CharInfo's template-ID bank unchanged. `paperdoll` retains the separate
template-ID snapshot. The labels head/hair/face/hairall come from the configured
writer; the native offsets and selectors are separately verified.

`GetPcMeshName` calls `GetItemClassID` with the mesh-part selector. Parts 6/7
use native slots 6/17. For part 8, the remote path uses slot18; the local path
first resolves slot17 and requires the returned item-data fields `+4==1` and
`+0xd4==19`, otherwise it resolves slot18. Accessory keys are subsequently
derived from selected mesh names, not from item IDs. Transporting the bank does
not by itself establish those protected string operations or all gear rules.

## Remaining boundaries

All-zero relevant item slots prove `GetItemClassID(6/7/8)==0`. The next empty
FName construction/comparison steps include erased helpers at `0x104835f3`,
`0x10485f16` and `0x10485f20`. Their exact protected bindings remain unresolved;
the checker does not silently equate zero equipment with a fully proven native
base-table admission.

The original `UL2ConsoleWnd` constructor allocates 18 preview Users at `+0x54`
with stride `0x314`. Its clear-shaped call at `0x10441ac4` is also erased, like
the standalone User constructor's `0x1035895e`. An apparent memset argument
shape is not a recovered import binding. Preview initialization, gear-dependent
tables, Female Dark Elf chest overrides, final attachment/placement and full
native material sampling remain separate work. Correct option lists do not
certify that a selected hairstyle is already faithfully previewed.

The browser creator now reads the per-sex/occupation choices and preserves
their exact indices through creation requests. Colors are original text
choices, not invented swatches or RGB tint operations. A visible note states
that hair selections are not previewed and the displayed model retains its
existing hair. Missing or malformed choice metadata prevents submission;
face preview still requires the exact source-bound face catalog. The actual
creator-method tests cover male/female choice counts, source indices, invalid
selection retirement, unchanged material color and existing asynchronous face
lifecycles. This UI improvement does not close the protected native gaps above.
