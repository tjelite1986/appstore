# appstore — Claude Code Instructions

## Working rules (every session, local or cloud)

- **Language:** everything written to a file is English: code comments, UI
  strings, API error messages, log output, README, JSON descriptions, commit
  messages. Chat with the owner in Swedish. No emojis unless asked.
- **`docs/` is local-only.** It is a scratch area between the owner and Claude,
  gitignored on purpose. Never commit it and never `git add -f` it. A cloud
  session will not see it; ask the owner to paste what you need.
- **No secrets in git:** `.env`, `.env.*`, dated backups like `.env.bak-*`,
  keys and tokens. Read `git status` before every commit.
- **Target platform:** the owner self-hosts on a Raspberry Pi (linux/arm64,
  Node 20) and an x86 Linux box, as Docker images behind Traefik. Code must
  build and run on linux/arm64 with Node 20. Check that any new native
  dependency ships arm64 builds.
- **Cloud sessions cannot reach production:** no host, no live database, no
  `.env`, no container logs. Deliver work as a branch and a PR whose
  description says how to verify it live. Deploy and live verification are
  done by the owner on the host. Do not claim something works in production.
- **Data safety:** never blanket-`DELETE` or `rm` a database or data directory
  to clean up after a test; remove only what the test created.
- **Keep diffs about the change:** do not reformat code you are not otherwise
  touching. Run `prettier --check` before `prettier --write` on an older file.
- **Archive, don't delete:** don't delete branches; tag them `archive/<name>`
  first.

## Lessons learned

### Catalog and storage
- No hostnames, host paths or channel names in the repo; use env
  (`STORE_ROOT`, `TELEGRAM_CHANNELS`, gitignored `scripts/cron.env`).
- `lib/store.ts` is the only library reader, `lib/storage.ts` the only place
  directory names live. APK files are truth for versions/sizes; meta only
  supplies words.
- Never import, match or publish from the placeholder catalog
  (`PLACEHOLDER_APPS`): the importer uses `realApps()`, index routes answer 503
  on `placeholder`. Why: an unreadable library would have been signed and
  published as an empty repo. New writers/publishers must refuse it too.
- Fillers (`fillFromPlay`, `fillFromApkmb`, importer) write gaps only.
- Never seed a form from the read model when the save merges into the same
  file: displayed fallbacks (`"Unknown"`, `"Other"`) got saved and then
  blocked every gap-only filler. Seed from `storedText()`, send changed fields.
- In edits, empty string = delete the key. Protected fields (`packageName`,
  `signingCert`, `source`) get a 400, never a silent drop.
- State/meta writes are temp file + rename, queued per target, unique temp
  name per write (a shared `.tmp` gave ENOENT). A file that exists but won't
  parse is damage: keep it, never overwrite it with a reconstruction.
- Derive updates, offers and suggestions on read from existing data; store
  only the user's answer. Why: rows already in a terminal state never pass a
  write-time hook. `listReview()` recomputes matches on read for this reason.
- To test write paths for real, point `STORE_ROOT` at a scratch dir.

### Identity, signers, merges
- A package id is not an identity; mods share ids. Merge only when signers
  agree; on mismatch use `family`. `signerConflict` in `lib/merge.ts` is the
  answer, not an obstacle.
- Signer TOFU: first APK pins the cert, a different or `unverifiable` key is
  refused, only an explicit review decision re-pins. Never widen a source to
  get past it.
- GitHub-linked apps (`isLinked`) are fetched once for version + signer, then
  served from GitHub; `relinkGitHub` verifies every new tag. Some apps stay
  mirrored on purpose. Update checks compare `source.releaseTag`, never
  versionName (they rarely match; every release would re-download).
- Play is metadata-only and lookups are approved by a human: a package id
  says which app a build is *of*, not which build. Adding an id already in the
  catalog is refused (duplicates make every future drop ambiguous).

### Shelf shapes
- Keep three shapes apart: `family` (one card; browse collapses, search does
  not), `requires` companions (own listing, hidden by `withoutCompanions`,
  kept in search/detail/indexes), per-ABI files under one version. Merges must
  re-point `family`/`requires` (`repointSlug`).
- One app per package id in F-Droid indexes: `collectShelf` picks a claimant
  (`repoHead` > family head > newer > more versions > slug) and reports losers
  in `x-index-skipped`. Every index format goes through `repoListings()`.

### 18+ gate
- The Adults category *is* the gate. Signed-out is never adult. Gated apps are
  absent (404), not refused: use `catalogFor`/`appFor` for every list and
  slug lookup.
- No write path may reach the default category by omission (`"Other"` is
  ungated). New listings inherit category from same-package apps, gated wins.
- Don't seed a `<select>` with a value missing from its rendered options (a
  hidden Adults slug): it looks empty but submits.

### Security and routes
- Validate each path segment as a single name (no `/`, `\`, `.`, `..`) before
  joining, and confine to the specific subdirectory, not `STORE_ROOT`. Why:
  Next decodes `%2F` inside a segment; a root-only check once served a
  secret file publicly.
- Accounts are local (`users`/`sessions` in `_state/store.db`, `lib/auth.ts`);
  no sign-up page, accounts via `scripts/users.cjs`. Ids were imported from
  the old SSO provider unchanged: never renumber them, the per-user tables
  have no FK and would silently change owner.
- Cookie-auth writes require `Origin` host == request host (`SameSite=lax`
  spans subdomains). Unset admin token means closed. `requireUser` refuses the
  admin token.
- `<img src>` sends no custom headers: a token-gated image proxy breaks;
  inline single previews as `data:`. Never put a token in a query string.
- File type by magic bytes, never extension or `File.type`. Outbound fetches
  use `openGuarded`; image proxies: host allowlist + `redirect: "error"`.
- Share links to `/api/download/<slug>` omit `?v=` on purpose (newest build).
- `lib/serve.ts` uses `Readable.toWeb()`, which threw uncatchable errors on
  client abort in a sibling app; if you touch it, pump by hand.

### Next.js
- Every browser-facing URL needs `withBasePath()` except `<Link>`,
  `router.push`, `next/image`: fetch strings, `src`/`href`, `url(...)`,
  origin-built URLs. Put it inside wrappers (`lib/admin-call.ts`).
  `STORE_BASE_PATH` is build-time. Why: three rounds of prefix 404s.
- Dynamically imported or native packages go in `serverExternalPackages`, or
  standalone output omits them (MODULE_NOT_FOUND only in the container).
- `"use client"` is file-wide: keep state in its own file
  (`components/thumb-image.tsx`). `components/primitives.tsx` stays
  server-safe; its `Button` takes no handlers on purpose, use `buttonClass()`.

### SQLite and caches
- `lib/db.ts` opens lazily (parallel `next build` workers), `busy_timeout`
  before WAL. `catalogFor` returns copies; never flag the shared catalog.
- Read-then-write transactions must be `.immediate()`: a deferred lock
  upgrade returns SQLITE_BUSY without honouring `busy_timeout`.
- Caches keyed on size+mtime (`apk_facts`, `apk_abis`) never expire; cache
  only complete answers, never an I/O error (`probeApkAbis`: null vs `[]`).
- A prune's keep-set comes from the walk that mirrors its delete criterion; a
  constant "dropped N" every run is a bug.

### Destructive operations
- Displaced/discarded files move to `_import/_discarded/`. `lib/prune.ts` is
  the deliberate exception and really deletes; don't make it archive. It skips
  listings with placeholder versions (`compareVersions` ranks `9.9.9` and
  `unknown` above real ones) and always shows a dry run first.

### PWA and F-Droid clients
- `public/sw.js` has no fetch handler on purpose.
- F-Droid icons are names the client composes: write top-level `icon` and
  `localized[...].icon`, serve `icons-<dpi>/` and `<packageName>/en-US/`.
  Leave `repo.icon` empty unless the file exists.
- Keep v0 `index.xml` stable (Obtainium parses it as HTML). Per-account repo
  identity rides in the path: clients send no cookie, header or extra query.
- v1/v2 are signed offline by `scripts/fdroid-sign.sh`; the app builds the
  whole document so catalog rules live in one place. Repo address comes from
  `FDROID_PUBLIC_URL`, never the request host (subscribers keep it forever).

### Telegram feed and jobs
- The feed reads attachments and links; a link must prove it is an APK
  (`readApkInfo`). apkmb product pages are followed to `<page>/download/`
  (`apkmbDownloadLinks`). FILE_MIGRATE and FLOOD_WAIT are not
  failures; they get their own budget. Canonicalise URL dedup keys.
- `scripts/cron.sh` must exit non-zero when every item failed or the session
  is unauthorised; a green timer once hid a dead feed.
