#!/bin/sh
# Write only the configured Java Password property. No database/server actions.
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
    echo "Password writer requires one existing configuration file" >&2
    exit 1
fi
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
configuration=$1
umask 077
temporary=$(mktemp "${configuration}.password.XXXXXX")
trap 'rm -f "$temporary"' 0
trap 'exit 1' HUP INT TERM
# Failure leaves the original untouched. The replacement is private to its
# owner, the same user that subsequently starts Java in these Docker images.
LC_ALL=C awk -f "$directory/java-password.awk" "$configuration" > "$temporary"
mv -f "$temporary" "$configuration"
