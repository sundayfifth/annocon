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
- Writing our own `pluginData` echoes back through `nodechange`. Raise the
  suppress flag around every write or the re-route loops.
- Treat the canvas as untrusted: users move and delete the rendered nodes by
  hand, so reconciliation repairs whatever it finds instead of assuming.
- Chunk long work. The plugin runs on the editor's main thread — a slow loop
  hangs the tab and the user cannot even click Cancel.
- Test behaviour others depend on, not implementation.
- Commit in small steps that actually work.

## Notes

Real tool — other people on the team use this, so the standards apply.

Plugins cannot run in the background, so connectors re-route live only while the
plugin is open. Otherwise: reconciliation on open, plus an explicit re-sync
command. Say this plainly in the UI; do not imply FigJam parity.

Not published. Distribution is `npm run build` + import the manifest in the
desktop app. Going public would face Figma's "recreating core Figma
functionality" review criterion.
