# Encode the UTF-8 environment value for java.util.Properties.load(InputStream).
# Password bytes never enter awk program text, argv or diagnostic messages.
function fail(message) {
    print "DB_PASS: " message > "/dev/stderr"
    failed = 1
    exit 1
}

function continuation(position, byte) {
    if (position > length(password)) fail("invalid UTF-8")
    byte = ord[substr(password, position, 1)]
    if (byte < 128 || byte > 191) fail("invalid UTF-8")
    return byte - 128
}

BEGIN {
    password = ENVIRON["DB_PASS"]
    if (length(password) == 0) fail("must be supplied explicitly and nonempty")
    if (password ~ /[\r\n]/) fail("must not contain line breaks")
    # The caller fixes LC_ALL=C, so substr and this table operate on bytes.
    for (i = 1; i < 256; i++) ord[sprintf("%c", i)] = i
    encoded = ""
    for (i = 1; i <= length(password); i++) {
        byte = ord[substr(password, i, 1)]
        if (byte < 128) {
            code = byte
        } else if (byte >= 194 && byte <= 223) {
            code = (byte - 192) * 64 + continuation(i + 1)
            i++
        } else if (byte >= 224 && byte <= 239) {
            code = (byte - 224) * 4096 + continuation(i + 1) * 64 + continuation(i + 2)
            if (code < 2048 || (code >= 55296 && code <= 57343)) fail("invalid UTF-8")
            i += 2
        } else if (byte >= 240 && byte <= 244) {
            code = (byte - 240) * 262144 + continuation(i + 1) * 4096 + continuation(i + 2) * 64 + continuation(i + 3)
            if (code < 65536 || code > 1114111) fail("invalid UTF-8")
            i += 3
        } else {
            fail("invalid UTF-8")
        }
        if (code <= 65535) {
            encoded = encoded sprintf("\\u%04x", code)
        } else {
            code -= 65536
            encoded = encoded sprintf("\\u%04x\\u%04x", 55296 + int(code / 1024), 56320 + code % 1024)
        }
    }
}

/^[ \t]*Password[ \t]*=/ {
    matches++
    print "Password = " encoded
    next
}
{ print }

END {
    if (!failed && matches != 1) fail("configuration must contain exactly one Password assignment")
}
