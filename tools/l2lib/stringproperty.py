"""Original Interlude FString loading over an isolated saved property payload.

The signed count selects byte widening or little-endian UTF-16 code units.
Keep storage units separately from the first-NUL text view; neither embedded
NULs nor unpaired surrogates authorize discarding stored data. This admits
bounded, nonoverflowing, terminated values only. It is not a general archive,
native allocator, property-dispatch or class-initialization implementation.
"""

from .ue2package import L2Error, Reader


def decode_string_property(payload):
    """Decode one complete payload, preserving original loading/count semantics.

    A saved absolute count of one is cleared by the original Empty call, even
    when the sole unit is nonzero. Counts above one must end in NUL under this
    tool's safety admission; original loading itself does not validate that.
    Count/capacity describe the original successful allocation path, not Python
    memory. The caller supplies already-bounded tag bytes, excluding its header.
    """
    if not isinstance(payload, bytes):
        raise L2Error("string property requires an isolated bytes payload")
    # Original FCompactIndex consumes at most five bytes. Keep the shared
    # reader from accepting a longer all-zero continuation as a small count.
    reader = Reader(payload[:5])
    saved_count = reader.compact()
    count = abs(saved_count)
    if count > 0x3FFFFFFF:
        raise L2Error("string allocation size is outside the nonoverflowing profile")
    width = 2 if saved_count < 0 else 1
    if len(payload) - reader.pos != count * width:
        raise L2Error("string payload size does not match its saved count")
    data = payload[reader.pos :]
    units = (
        [int.from_bytes(data[i : i + 2], "little") for i in range(0, len(data), 2)]
        if width == 2
        else list(data)
    )
    if count == 1:
        units = []
    elif count and units[-1] != 0:
        raise L2Error("unterminated string is outside the admitted profile")
    prefix = units[: units.index(0)] if units else []
    value = b"".join(unit.to_bytes(2, "little") for unit in prefix).decode(
        "utf-16le", errors="surrogatepass"
    )
    return dict(
        savedCount=saved_count,
        count=len(units),
        capacity=len(units),
        codeUnits=units,
        value=value,
    )
