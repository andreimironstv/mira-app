# Mira branding layer

Mira's desktop app is a fork of [block/buzz-app](https://github.com/block/buzz-app).
Branding is a thin layer reapplied after each merge, so upstream updates keep
flowing without conflicts on every rename.

## Getting upstream updates

```sh
node rebrand/sync.mjs      # merge upstream/main, reapply branding, commit locally
git push
```

Do not run a plain `git merge upstream/main`. Sync resolves branding conflicts in
favor of upstream, then reapplies the brand. If a conflicting file holds any other
Mira change, it stops before merging and lists the file.

## What is here

| Path | Purpose |
|------|---------|
| `apply.mjs` | Applies the brand. `--check` fails if something is unbranded (runs in CI) |
| `sync.mjs` | Merges upstream and reapplies the brand |
| `overlay/` | Files that replace the upstream file at the same path |
| `brand/` | Source logos and the paths derived from them |
| `tools/generate_assets.py` | Regenerates `overlay/` and `brand/` from the PDFs |

## Deliberately still "buzz"

Crate and package names, identifiers, asset file names, `BUZZ_*` variables, the
`buzz` CLI, the `buzz://` scheme, and developer docs. `xyz.block.buzz.app` also
stays, because it is where old Buzz keeps the data this app can import.

## Mira's own values

- **App ID:** `ro.miraai.mira.desktop`.
- **Hosted services:** `account.mira-ai.ro` and `<name>.workspace.mira-ai.ro`,
  served by mira-cloud. Set the relay's real NIP-11 key in `apply.mjs` after the
  first deployment; it is all zeros until then, which matches no relay.
- **Updates:** builds use this fork's release feed and `brand/updater.pub`. The
  matching private key is in the repository's `TAURI_SIGNING_PRIVATE_KEY` secret.
  Losing it means shipped apps can no longer verify updates, so keep a backup.
