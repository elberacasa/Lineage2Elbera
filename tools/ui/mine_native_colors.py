#!/usr/bin/env python3
"""Mine the UI text colours that live in NWindow.dll, not in Interface.xdat.

    python3 tools/ui/mine_native_colors.py            report
    python3 tools/ui/mine_native_colors.py --emit     write assets/gamedata/native_colors.json
    python3 tools/ui/mine_native_colors.py --check    re-verify, exit 1 on drift

WHY THIS EXISTS
---------------
`tools/xdat/parse_xdat.py` recovers 650 control colours from Interface.xdat,
and every one of them belongs to a `TextBox` record -- verified here, not
assumed (see `--check` gate 0). Three roles the port paints every frame have
NO xdat record at all:

  * a Button's label     -- 352 Button records, 0 with a colour, and
                            `NWindow/ButtonHandle.uc` exposes no colour API
                            (SetButtonName / SetTexture only). The colour is
                            chosen in native code, per draw, from the button's
                            enabled state.
  * an item slot's count -- drawn by NCItemWnd's own render over the icon, not
                            by any control the xdat declares.
  * a TextBox whose record carries no colour (8 of the 658) -- falls back to
                            the field initialiser in NCTextBox's ctor.

Those three are what this tool decodes. It is the same instrument
`docs/ui-mined-native.md` used for the chat channel table: NWindow.dll is a
plain unpacked PE32 (image base 0x10000000, FileAlignment == SectionAlignment
== 0x1000, so **file offset == RVA** -- asserted below), and the values are
inline immediates in the draw paths.

EVIDENCE CHAIN
--------------
0. File offset == RVA.  `.?AVNCItemWnd@@` sits at file offset 0x34c6bc and
   `docs/ui-mined-native.md` cites its VA as 0x1034c6bc. Asserted.

1. NCButton's paint, 0x100034b0.  Reached from NCButton vtable slot 99
   (0x10005e00, RTTI-resolved: TypeDescriptor 0x1034c19c -> COL 0x1029c750
   -> vtable 0x1022fd2c) via a direct call at 0x10005f83. The paint resolves
   the label (NameID at this+0x308 through the string table, else the literal
   at this+0x2fc), then computes the colour:

       10003593: 8b 06              mov  eax, [esi]          ; vtable
       10003595: 8b ce              mov  ecx, esi            ; this
       10003597: 8b 50 6c           mov  edx, [eax+0x6c]     ; slot 27
       1000359a: ff d2              call edx                 ; IsEnableWindow()
       1000359c: 8b d8              mov  ebx, eax
       1000359e: f7 db              neg  ebx
       100035a0: 1b db              sbb  ebx, ebx            ; -1 if enabled else 0
       100035a2: 81 e3 1e 3c 46 00  and  ebx, 0x00463C1E
       100035a8: 81 c3 a0 a0 a0 ff  add  ebx, 0xFFA0A0A0

   and ebx is pushed as the colour argument of the label draw at 0x1000365e
   (`push ebx` between the FString pointer and the x/y pair, call 0x100036b2).

   Slot 27 is IsEnableWindow, not an inference: the exported
   `?execIsEnableWindow@UWindowHandle@@` (0x10133c10) dispatches through the
   *same* slot -- `mov eax,[edx+0x6c]; call eax` at 0x10133c80 -- and
   `NWindow/WindowHandle.uc:32` declares `native final function bool
   IsEnableWindow()`. Its target for every NCWnd subclass is 0x10002a20,
   a two-instruction getter returning this->field_0xBC.

   So the two branches are exact:
       enabled   0xFFA0A0A0 + 0x00463C1E = 0xFFE6DCBE -> #E6DCBE
       disabled  0xFFA0A0A0             = 0xFFA0A0A0 -> #A0A0A0

2. NCItemWnd's slot count, 0x1003118d.  Inside the render (vtable slot 99 =
   0x10030d90, the address `docs/ui-mined-native.md` §1a already cites), 20
   bytes after the 34x34 slot-art push at 0x1003115d that the same doc cites:

       1003118d: 68 dc dc dc ff     push 0xFFDCDCDC

   pushed as the 4th argument of the badge helper 0x10064790, which reads it
   back at 0x10064849 / 0x100648c0 / 0x10064934 / 0x100649ac -- one per
   digit-count branch of its `switch(wcslen(s))` -- and hands it to the draw.
   It is the only colour immediate anywhere in NCItemWnd's render.

3. NCTextBox's default, 0x10052aca.  The ctor/init writes

       10052aca: c7 86 48 03 00 00 dc dc dc ff   mov dword [esi+0x348], 0xFFDCDCDC

   and field 0x348 is the text colour, not an inference: the exported
   `?execGetTextColor@UTextBoxHandle@@` (0x10131690) tail-calls 0x10051650,
   whose body is `mov eax,[ecx+0x348]` at 0x10051682 -- i.e. GetTextColor
   returns exactly this field. `NWindow/TextBoxHandle.uc:6-7` declares the
   Set/Get pair.

BYTE ORDER
----------
The dword is AARRGGBB, established in `docs/ui-mined-native.md` §2 against the
chat channel constants (0xFFFF7200 renders as orange #FF7200 for SHOUT; under
the other order it would be #0072FF, a blue). This tool re-reads one of those
constants -- the default-grey push at 0x1014191a -- as a live control: it must
decode to #DCDCDC, the same value gate 3 recovers independently from
NCTextBox's field initialiser. Two unrelated sites agreeing on one colour is
the byte-order check.

WHAT THIS TOOL DOES NOT CLAIM
-----------------------------
It does not touch the 33 ItemWindow records that `parse_xdat.py`'s type gate
discards and that all decode to an identical #FFD8F1; that uniformity is
evidence the signature is matching something that is not a colour, and
nothing here adopts it.

It does not claim these are the only native colours. It claims that these four
are decoded, and it fails loudly if any of them stops reading back.
"""

import argparse
import json
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DLL = os.path.join(REPO, 'assets/interlude/system/NWindow.dll')
XDAT_JSON = os.path.join(REPO, 'assets/gamedata/interface.json')
OUT = os.path.join(REPO, 'assets/gamedata/native_colors.json')

# SOURCED: PE OptionalHeader.ImageBase, decoded from NWindow.dll
# (objdump -x reports ImageBase 10000000).
IMAGE_BASE = 0x10000000


def rgb(dword):
    """AARRGGBB -> '#RRGGBB'. See BYTE ORDER above."""
    if (dword >> 24) & 0xFF != 0xFF:
        raise ValueError(f'0x{dword:08X} is not opaque; not a UI text colour')
    return '#%06X' % (dword & 0xFFFFFF)


class Probe:
    def __init__(self, data):
        self.d = data
        self.fail = []
        self.note = []

    def expect(self, rva, pattern, what):
        """Assert the exact instruction bytes at `rva`. `pattern` may carry
        None wildcards for immediate slots."""
        got = self.d[rva:rva + len(pattern)]
        if len(got) != len(pattern):
            self.fail.append(f'{what}: RVA 0x{rva:X} past end of image')
            return None
        for i, want in enumerate(pattern):
            if want is not None and got[i] != want:
                self.fail.append(
                    f'{what}: RVA 0x{rva + i:X} expected {want:02x} got {got[i]:02x} '
                    f'(run: objdump -d --start-address=0x{IMAGE_BASE + rva:X} '
                    f'--stop-address=0x{IMAGE_BASE + rva + len(pattern):X} NWindow.dll)')
                return None
        return got

    def u32(self, rva):
        return struct.unpack_from('<I', self.d, rva)[0]


def gate0_xdat_has_no_button_colour():
    """The premise of the whole tool: the xdat cannot answer these three
    questions, so the native decode is not redundant with it."""
    if not os.path.exists(XDAT_JSON):
        return ['assets/gamedata/interface.json absent -- '
                'run tools/xdat/parse_xdat.py'], {}
    doc = json.load(open(XDAT_JSON))
    types, coloured = {}, {}

    def walk(n):
        t = n.get('type')
        types[t] = types.get(t, 0) + 1
        if n.get('color'):
            coloured[t] = coloured.get(t, 0) + 1
        for c in n.get('children') or []:
            walk(c)

    for w in doc['windows']:
        walk(w)

    fails = []
    if coloured.get('Button'):
        fails.append(f'Interface.xdat now carries {coloured["Button"]} Button '
                     f'colours -- the native button decode is no longer the '
                     f'only source and this tool must be revisited')
    if coloured.get('ItemWindow'):
        fails.append(f'Interface.xdat now carries {coloured["ItemWindow"]} '
                     f'ItemWindow colours -- re-check them before the native '
                     f'slot-count value keeps being used')
    stray = {t: n for t, n in coloured.items() if t != 'TextBox'}
    if stray:
        fails.append(f'colours appeared on non-TextBox records: {stray}')
    return fails, {'buttons': types.get('Button', 0),
                   'textboxes': types.get('TextBox', 0),
                   'textboxes_coloured': coloured.get('TextBox', 0),
                   'itemwindows': types.get('ItemWindow', 0)}


def mine():
    if not os.path.exists(DLL):
        print(f'FATAL: {DLL} absent', file=sys.stderr)
        sys.exit(2)
    data = open(DLL, 'rb').read()
    p = Probe(data)

    # -- gate 0: file offset == RVA -----------------------------------------
    # docs/ui-mined-native.md cites .?AVNCItemWnd@@ at VA 0x1034c6bc.
    at = data.find(b'.?AVNCItemWnd@@')
    if at != 0x34C6BC:
        p.fail.append(f'file-offset==RVA assumption broken: .?AVNCItemWnd@@ at '
                      f'0x{at:X}, docs/ui-mined-native.md says RVA 0x34C6BC')

    # -- gate 0b: the xdat still cannot answer these ------------------------
    xf, xstats = gate0_xdat_has_no_button_colour()
    p.fail.extend(xf)

    out = {}

    # -- 1. NCButton label --------------------------------------------------
    # RTTI: confirm the vtable we credit the paint to is really NCButton's.
    # SOURCED: MSVC RTTI, decoded. A TypeDescriptor is {vfptr, spare, name},
    # so the record starts 8 bytes before its name; a CompleteObjectLocator
    # holds pTypeDescriptor at +0xC; a vtable's COL pointer sits at slot -1,
    # i.e. 4 bytes before the table. Slot 99 is the paint -- cross-checked
    # against NCItemWnd, whose slot 99 is the render 0x10030d90 that
    # docs/ui-mined-native.md already cites.
    td = data.find(b'.?AVNCButton@@') - 8
    if td != 0x34C19C:
        p.fail.append(f'NCButton TypeDescriptor moved to 0x{td:X} (expected 0x34C19C)')
    col_ref = data.find(struct.pack('<I', IMAGE_BASE + td))
    col = col_ref - 0xC          # decoded: COL.pTypeDescriptor is at +0xC
    vt_ref = data.find(struct.pack('<I', IMAGE_BASE + col))
    vtable = vt_ref + 4          # decoded: the COL pointer is vtable slot -1
    if vtable != 0x22FD2C:       # decoded RVA of NCButton's vtable
        p.fail.append(f'NCButton vtable moved to 0x{vtable:X} (expected 0x22FD2C)')
    elif p.u32(vtable + 99 * 4) != 0x10005E00:   # decoded: slot 99 is the paint
        p.fail.append('NCButton vtable slot 99 no longer 0x10005E00')

    # SOURCED: bytes decoded from NWindow.dll with objdump -d
    # --start-address=0x10003593 --stop-address=0x100035AE
    chain = p.expect(0x3593, [
        0x8B, 0x06,                                # mov eax,[esi]      vtable
        0x8B, 0xCE,                                # mov ecx,esi        this
        0x8B, 0x50, 0x6C,                          # decoded: mov edx,[eax+0x6c] slot 27
        0xFF, 0xD2,                                # decoded: call edx           IsEnableWindow
        0x8B, 0xD8,                                # decoded: mov ebx,eax
        0xF7, 0xDB,                                # decoded: neg ebx
        0x1B, 0xDB,                                # decoded: sbb ebx,ebx
        0x81, 0xE3, None, None, None, None,        # decoded: and ebx,<mask>
        0x81, 0xC3, None, None, None, None,        # decoded: add ebx,<base>
    ], 'NCButton::paint colour chain')

    # slot 27 must be the same slot the exported IsEnableWindow dispatches on
    # SOURCED: decoded at 0x10133c80 -- mov eax,[edx+0x6c]; call eax
    p.expect(0x133C80, [0x8B, 0x42, 0x6C, 0xFF, 0xD0],
             'UWindowHandle::execIsEnableWindow slot-27 dispatch')
    # ...and its NCWnd target must be the field_0xBC getter, not something else
    # SOURCED: decoded at 0x10002a20 -- mov eax,[ecx+0xbc]; ret
    p.expect(0x2A20, [0x8B, 0x81, 0xBC, 0x00, 0x00, 0x00, 0xC3],
             'NCWnd::IsEnableWindow body')
    if p.u32(0x22FD2C + 0x6C) != 0x10002A20:
        p.fail.append('NCButton vtable slot 27 is not the IsEnableWindow getter')

    # the colour must actually reach the label draw
    # SOURCED: decoded at 0x1000365e -- push ebx (0x53)
    p.expect(0x365E, [0x53], 'NCButton::paint pushes the colour (push ebx)')

    # Every button-family class shares this paint, so 'buttonLabel' is not
    # NCButton-only. That matters for TABS: NCTabButton has no colour of its
    # own, which is why retail marks the selected tab with a different TEXTURE
    # rather than a different label colour.
    # SOURCED: vtable RVAs decoded by the same RTTI walk as NCButton above
    family = {'NCExButton': 0x230074, 'NCThumbButton': 0x2302E4,
              'NCPushButton': 0x23055C, 'NCTabButton': 0x2307CC}
    for cls, vt in family.items():
        if p.u32(vt + 99 * 4) != 0x10005E00:
            p.fail.append(f'{cls} no longer shares NCButton\'s slot-99 paint '
                          f'0x10005e00 -- the button-label colour may no longer '
                          f'apply to it')

    if chain:
        mask = struct.unpack_from('<I', chain, 17)[0]
        base = struct.unpack_from('<I', chain, 23)[0]
        try:
            out['buttonLabel'] = {
                'color': rgb((base + mask) & 0xFFFFFFFF),
                'role': 'Button label text, enabled',
                'evidence': 'NWindow.dll NCButton::paint 0x100034b0 -- '
                            f'0x100035a2 and ebx,0x{mask:06X} / '
                            f'0x100035a8 add ebx,0x{base:08X}, taken when '
                            'IsEnableWindow() (vtable slot 27) is true; ebx is '
                            'the colour argument pushed at 0x1000365e. Shared '
                            'by NCExButton/NCThumbButton/NCPushButton/'
                            'NCTabButton, which carry the same slot-99 paint',
            }
            out['buttonLabelDisabled'] = {
                'color': rgb(base),
                'role': 'Button label text, disabled',
                'evidence': 'NWindow.dll NCButton::paint 0x100034b0 -- '
                            f'0x100035a8 add ebx,0x{base:08X} with the mask '
                            'zeroed, taken when IsEnableWindow() is false',
            }
        except ValueError as e:
            p.fail.append(f'NCButton colour: {e}')

    # -- 2. NCItemWnd slot count -------------------------------------------
    # decoded: NCItemWnd vtable RVA 0x23bb94, slot 99 = the render 0x10030d90
    # that docs/ui-mined-native.md §1a cites
    if p.u32(0x23BB94 + 99 * 4) != 0x10030D90:
        p.fail.append('NCItemWnd vtable slot 99 is no longer the documented '
                      'render 0x10030d90')
    # the doc's own landmark: the 34x34 slot-art push, 0x30 bytes earlier
    # SOURCED: decoded at 0x1003115d -- push 0x22; push 0x22 (the 34x34 slot
    # art), the landmark docs/ui-mined-native.md §1a cites
    p.expect(0x3115D, [0x6A, 0x22, 0x6A, 0x22],
             'NCItemWnd render 34x34 slot-art push (docs/ui-mined-native.md §1a)')
    # SOURCED: decoded at 0x1003118d -- push <imm32>
    cnt = p.expect(0x3118D, [0x68, None, None, None, None],
                   'NCItemWnd slot-count colour push')
    # the badge helper must read the 4th argument back as a colour
    # SOURCED: decoded -- each branch of the helper's switch(wcslen(s)) reads
    # the colour argument back with mov ecx,[ebp+0x14]
    for site in (0x64849, 0x648C0, 0x64934, 0x649AC):
        p.expect(site, [0x8B, 0x4D, 0x14],
                 f'badge helper 0x10064790 consumes the colour arg at '
                 f'0x{IMAGE_BASE + site:X}')
    if cnt:
        try:
            out['itemSlotCount'] = {
                'color': rgb(struct.unpack_from('<I', cnt, 1)[0]),
                'role': 'Item slot stack-count badge, drawn over the icon',
                'evidence': 'NWindow.dll NCItemWnd render 0x10030d90 -- '
                            '0x1003118d push <colour>, the 4th argument of the '
                            'badge helper 0x10064790, read back at 0x10064849/'
                            '0x100648c0/0x10064934/0x100649ac',
            }
        except ValueError as e:
            p.fail.append(f'NCItemWnd slot count: {e}')

    # -- 3. NCTextBox default ----------------------------------------------
    # SOURCED: decoded at 0x10051682 -- mov eax,[ecx+0x348]
    p.expect(0x51682, [0x8B, 0x81, 0x48, 0x03, 0x00, 0x00],
             'UTextBoxHandle::GetTextColor reads field 0x348')
    # SOURCED: decoded at 0x10052aca -- mov dword [esi+0x348],<imm32>
    init = p.expect(0x52ACA, [0xC7, 0x86, 0x48, 0x03, 0x00, 0x00,
                              None, None, None, None],
                    'NCTextBox field 0x348 initialiser')
    if init:
        try:
            out['textBoxDefault'] = {
                'color': rgb(struct.unpack_from('<I', init, 6)[0]),
                'role': 'TextBox text, when the record carries no colour',
                'evidence': 'NWindow.dll 0x10052aca mov [esi+0x348],<colour> -- '
                            'field 0x348 is the text colour, since the exported '
                            '?execGetTextColor@UTextBoxHandle@@ (0x10131690) '
                            'returns it via 0x10051682',
            }
        except ValueError as e:
            p.fail.append(f'NCTextBox default: {e}')

    # -- byte-order control -------------------------------------------------
    # docs/ui-mined-native.md §2's default-grey chat push, decoded with the
    # same rgb(); it must agree with the NCTextBox default recovered above.
    # SOURCED: decoded at 0x1014191a -- push <imm32>, the default-grey site
    # docs/ui-mined-native.md §2 tabulates
    ctrl = p.expect(0x14191A, [0x68, None, None, None, None],
                    'chat default-grey push (byte-order control)')
    if ctrl and 'textBoxDefault' in out:
        try:
            got = rgb(struct.unpack_from('<I', ctrl, 1)[0])
        except ValueError as e:
            p.fail.append(f'byte-order control: {e}')
        else:
            if got != out['textBoxDefault']['color']:
                p.fail.append(
                    f'byte-order control failed: the chat default-grey at '
                    f'0x1014191a decodes to {got} but NCTextBox\'s field '
                    f'initialiser gives {out["textBoxDefault"]["color"]}; two '
                    f'unrelated sites must agree or the AARRGGBB reading is wrong')
            else:
                p.note.append(f'byte-order control: chat default-grey at '
                              f'0x1014191a == NCTextBox default == {got}')

    return out, p, xstats


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--emit', action='store_true',
                    help=f'write {os.path.relpath(OUT, REPO)}')
    ap.add_argument('--check', action='store_true',
                    help='re-verify against the DLL and the emitted JSON; '
                         'exit 1 on any drift')
    a = ap.parse_args()

    out, p, xstats = mine()

    print('NWindow.dll native UI colours')
    if xstats:
        print(f'  Interface.xdat cross-check: {xstats["buttons"]} Button records '
              f'carry 0 colours; {xstats["textboxes_coloured"]}/'
              f'{xstats["textboxes"]} TextBox records do; '
              f'{xstats["itemwindows"]} ItemWindow records carry 0')
    for k, v in out.items():
        print(f'  {v["color"]}  {k:20} {v["role"]}')
        print(f'            {v["evidence"]}')
    for n in p.note:
        print(f'  note: {n}')

    payload = {
        '_source': 'assets/interlude/system/NWindow.dll',
        '_tool': 'tools/ui/mine_native_colors.py',
        '_note': 'Colours the UI paints that Interface.xdat does not declare. '
                 'Every entry carries the instruction site it was read from; '
                 're-verify with --check.',
        'colors': out,
    }

    if a.emit:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'w') as f:
            json.dump(payload, f, indent=2, sort_keys=True)   # AUTHORED formatting
            f.write('\n')
        print(f'\nwrote {os.path.relpath(OUT, REPO)}')

    if a.check:
        if not os.path.exists(OUT):
            p.fail.append(f'{os.path.relpath(OUT, REPO)} absent -- '
                          f'run with --emit')
        else:
            have = json.load(open(OUT)).get('colors', {})
            for k, v in out.items():
                if k not in have:
                    p.fail.append(f'{os.path.relpath(OUT, REPO)} is missing '
                                  f'"{k}"')
                elif have[k]['color'] != v['color']:
                    p.fail.append(
                        f'{os.path.relpath(OUT, REPO)} says {k} == '
                        f'{have[k]["color"]} but NWindow.dll says {v["color"]}')
            for k in have:
                if k not in out:
                    p.fail.append(f'{os.path.relpath(OUT, REPO)} carries "{k}", '
                                  f'which this tool no longer decodes')

    print()
    if p.fail:
        print(f'CHECK FAIL ({len(p.fail)})')
        for f in p.fail:
            print('   ' + f)
        return 1 if a.check else 0
    print('CHECK PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
