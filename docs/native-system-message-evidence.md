# Elbera Tools — typed system messages

The gateway retains each SystemMessage parameter's wire type and both
skill-name values. The browser can resolve the exact original skill record
without inferring the parameter type from a list of message IDs.

Reproduce the static original checks with:

```sh
python3 tools/ui/check_sysmsg_native.py --check
node --test gateway/test/system-message.test.js
```

The native check requires the owner's original `assets/interlude/system/`
Engine.dll and NWindow.dll plus Capstone. It reuses the pinned hashes and
in-memory decoder from `check_tutorial_quest_native.py`; it never executes
or writes decoded binaries. The packet tests use synthetic data only.

## Original evidence

Engine's opcode `0x64` registration at VA `0x10837512` selects stub
`0x1030731f`, whose body is `0x104156d0`. The handler reads the message ID,
parameter count, and each parameter type. The type table at `0x1041598c`
selects `0x10415835` for type 4. Its ASCII format at `0x1087ff44` is `dd`:
two DWORDs, both retained and forwarded in order. The configured server's
`SystemMessage.addSkillName(id, level)` and writer independently identify
these as skill ID and level; this server source establishes interoperability,
while the original proves the two-value native shape.

The handler calls the exported `GL2Console` object's parameter virtual slot
`0x350` and rendering slot `0x354`. In NWindow these resolve to `0x10163f10`
and `0x101640d0`. Type 4's consumer reads both values and passes them to
`0x10164900`; neither value is discarded.

The actual network renderer at `0x101b7cd0` uses **numbered parameters**.
At `0x101b7e98` it reads the third UTF-16 character of the `$s1`-shaped
placeholder, subtracts ASCII `1` at `0x101b7e9d`, and indexes the stored
parameter array at `0x101b7eaf`–`0x101b7ebc`. Repeated or reordered
placeholders therefore refer to the same numbered parameter. This differs
from the separate script `MakeFullSystemMsg` helper and is the appropriate
evidence for received server messages.

## Gateway contract and limits

`sysMsg.params` remains the legacy flattened list, including numeric skill
IDs. `sysMsg.typedParams` is an ordered list of `{type, value}` records.
Type 4's value is `{id, level}`; the other supported types retain their
existing string, number, or location-array values. Malformed counts,
truncated payloads, trailing bytes and unsupported types produce a parser
error rather than a partial message or a guessed type size.

The codec targets the configured aCis writer. Original type 6 uses `Q`,
whereas that writer emits `D`; this change preserves its current `D`
interoperability. Original type 8 exists but is not emitted by this writer
and remains unsupported. These are explicit native-protocol parity gaps.
The checks prove static call/dataflow relationships, not execution of the
original client, every message format, or complete localized grammar.
