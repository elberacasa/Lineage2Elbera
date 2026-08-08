# Elbera's aCis modifications

`server/` is a nested checkout of a third-party aCis rev 409 mirror and is
gitignored by this repo (`.gitignore:26`), so nothing under it is tracked here.
That was fine while the checkout was pristine — but it no longer is. One commit
on top of the mirror carries changes the gateway **depends on**:

- protocol adjustments in `GameClient`, `EnterWorld`, `RequestBypassToServer`
  and `Say2` that make the web gateway work at all
- the offline-shop support and the `.menu` voiced-command handler
- the tuned `players` / `npcs` / `server` / `loginserver` properties

Its upstream is `DEVjEXTREME/L2jaCis-409`, which is not ours to push to, so that
commit lived in exactly one place: this laptop's `server/.git`. A disk failure
would have taken the server half of the protocol contract with it, and no
amount of re-cloning would bring it back.

`elbera-acis.patch` is that commit, exported into the tracked repo.

## Restore onto a fresh clone

```bash
git clone https://github.com/DEVjEXTREME/L2jaCis-409.git server
cd server && git checkout $(cut -d' ' -f1 ../deploy/server-mods/BASE-REV)
git apply ../deploy/server-mods/elbera-acis.patch
```

Then build per `server/BUILD-NOTES.md` (which is itself inside the patch).

## Keep it current

The patch is a snapshot, not a link. After any further change to `server/`,
re-export it:

```bash
cd server && git format-patch $(cut -d' ' -f1 ../deploy/server-mods/BASE-REV)..HEAD \
  --stdout > ../deploy/server-mods/elbera-acis.patch
```

Verify it still describes the working tree — this must print nothing:

```bash
cd server && git apply --check --reverse ../deploy/server-mods/elbera-acis.patch
```
