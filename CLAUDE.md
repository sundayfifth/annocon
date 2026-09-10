# annotate-connect

Figma plugin for Design files. Two things:

1. **Annotate** — notes that render as real nodes on the canvas, so anyone sees
   them without opening Dev Mode or flipping View → Annotations, and they survive
   export and presentation mode.
2. **Connect** — FigJam-style connectors between layers whose attachment lives in
   the file itself, with tunable stroke weight, colour, dash, and independent
   head/tail arrow styles.

Both are the same idea underneath: a rendered node whose position is derived from
an anchor on some other node. See `docs/adr/0001-render-anchored-nodes.md`.

## Stack

TypeScript · create-figma-plugin (esbuild) · Preact + `@create-figma-plugin/ui` ·
Vitest · eslint + `@figma/eslint-plugin-figma-plugins`

Manifest is generated from the `figma-plugin` key in `package.json`:
`editorType: ["figma"]`, `documentAccess: "dynamic-page"`, `networkAccess: none`.

## Running it

```
npm run build      # or: npm run watch
```

Then in the Figma **desktop app** (required — plugins cannot be developed in the
browser): Plugins → Development → Import plugin from manifest… → pick the
generated `manifest.json`.

```
npm run typecheck
npm run lint
npm test
```

## Docs

Project docs — specs, PRDs, research notes, ADRs — live under `docs/`.

Open questions that block design decisions are tracked in `docs/spikes.md`.
Manual verification steps are in `docs/qa-checklist.md`.

## Development rules

- `documentAccess` is `dynamic-page`, so **every** node access is async:
  `getNodeByIdAsync`, `setVectorNetworkAsync`, `setCurrentPageAsync`,
  `getMainComponentAsync`. The Figma eslint rules catch the sync ones — do not
  silence them.
- Prefer `figma.currentPage.on('nodechange')` over `figma.on('documentchange')`.
  The latter requires `loadAllPagesAsync()` first, which is expensive on real
  files.
- **`src/core/**` must stay pure** — no reference to the `figma` global. It is
  the only layer that can be unit tested, so every decision worth testing
  belongs there, not in `src/scene/**`. Keep `src/scene/**` as thin as it can be.
- Geometry flows one way: pluginData record → rendered node. Never read geometry
  back off a node; `vectorPaths` round-trips lossily and setting it moves and
  resizes the node.
- **Never write a value the node already holds.** Not an optimisation — a
  correctness rule. Figma reports a write as a change whether or not anything
  changed, so an unconditional write is an event, and an event we cannot
  attribute wakes a pass that writes again. `alreadyDrawn`, `samePolyline` and
  `placeCard` are this rule; text properties reasserted every sync were how it
  got broken, and a card being re-placed on every sync is how the plugin spent
  a day waking itself in a loop. It is also what stops a sync interrupting
  somebody: re-applying a font to a text node discards what they are typing
  into it.
- Our own writes come back through `nodechange`, and are told from a person's
  edits **by content, never by timing**. Three mechanisms, in the order a
  change meets them: the property filter in `core/nodeChanges.ts` drops what
  no feature acts on (a `pluginData` echo, a reparent); `unchangedSinceOurWrite`
  on the same change asks each feature whether the node still holds what we
  last wrote, using the fingerprints in `core/authorship.ts`; `scene/removals.ts`
  names nodes we deleted, since a deletion leaves no content to compare. Add a
  write that a person could also make by hand and it needs one of these — a
  flag raised around the write does not work, which is why there is no longer
  one.
- **A write that is not dropped by the property filter must be attributable
  before it is acted on, not after.** Stopping a pass from acting wrongly is
  not the same as stopping it from being woken, and only the second one ends
  the loop. When measuring which writes are safe, enumerate the ones that get
  *through* the filter — three do, and they are the three written on every
  sync — rather than the ones it stops.
- **When a value on a node and a value in a record disagree, decide which one
  changed before writing either way.** A card whose text differs from its
  record is either a record edited in the panel, or a person typing on the
  canvas right now; the same difference, opposite correct responses. The
  fingerprint of what we last wrote is what tells them apart.
- Treat the canvas as untrusted: users move and delete the rendered nodes by
  hand, so reconciliation repairs whatever it finds instead of assuming.
- Chunk long work. The plugin runs on the editor's main thread — a slow loop
  hangs the tab and the user cannot even click Cancel.
- Test behaviour others depend on, not implementation.
- Commit in small steps that actually work.
- Run `npm run typecheck && npm test` after every change, before reporting it
  done. Not on request — every time.
- Let npm regenerate `package-lock.json` — never hand-fix it — and **write it
  with `npx npm@10.9.9 install`**, whatever npm you otherwise run. `vitest`'s
  bundled `vite` peer-depends on `esbuild ^0.27 || ^0.28` while
  `@create-figma-plugin/build` pins `0.25.1`, so the lock has to carry a second
  `esbuild` nested under `vitest`. Measured, one version at a time:

  | npm | writes both entries |
  |:--|:--|
  | 10.9.9 (what CI's Node 22 ships) | yes |
  | 11.3.0 | yes |
  | 11.6.2 | **no** |
  | 11.12.1 | **no** |

  A lock missing the nested entry still installs for whoever wrote it and then
  fails `npm ci` on CI, which is how `f9df652` shipped with red CI. `engines`
  is the guard and has been wrong once already — it said `<11.12` when the
  break starts at 11.6.2, so npm 11.6.2 wrote a bad lock without a word.
  It now says `<11.4`; if you widen it, measure first rather than assuming the
  next version is fine. `.nvmrc` is 22 to match CI.
- **Check CI after pushing.** The lock break above was invisible locally —
  `npm ci` passed on the machine that wrote it.

## Notes

Real tool — other people on the team use this, so the standards apply.

Plugins cannot run in the background, so connectors re-route live only while the
plugin is open. Otherwise: reconciliation on open, plus an explicit re-sync
command. Say this plainly in the UI; do not imply FigJam parity.

Not published. Distribution is `npm run build` + import the manifest in the
desktop app. Going public would face Figma's "recreating core Figma
functionality" review criterion.
