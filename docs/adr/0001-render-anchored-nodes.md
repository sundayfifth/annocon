# ADR 0001 — Render annotations and connectors as real canvas nodes derived from pluginData anchors

- Status: accepted
- Date: 2026-08-25

## Context

Two features, one hard constraint each.

Annotations: Figma's native annotations are visible in Design mode since April
2025, but only as an overlay behind a global **View → Annotations** toggle. They
do not appear in exports, in presentation mode, or for a teammate who opens the
link without knowing the toggle exists. The spec keeps getting missed.

Connectors: `figma.createConnector()` is FigJam-only, and a Design file has no
primitive that re-routes a line when the nodes it joins move. On top of that,
Figma plugins cannot run in the background — no plugin, no events.

## Decision

Both features render **ordinary Figma nodes** (frames, text, vectors) whose
geometry is *derived* from an `Anchor` record stored in `setPluginData` on the
node that owns it.

`src/core/anchor.ts` is the shared model: a magnet on a side, a fixed ratio
inside the box, or a free canvas point. Its union deliberately mirrors FigJam's
`ConnectorEndpoint` so a future FigJam port is close to a rename.

Geometry always flows one way — record → node. Nothing is ever read back off the
rendered node, because `vectorPaths` round-trips lossily and setting paths moves
and resizes the node.

Re-routing runs on three triggers: live via `figma.currentPage.on('nodechange')`
while the plugin is open, a full page reconciliation every time the plugin
opens, and an explicit re-sync command reachable from the menu and from a
relaunch button on the node itself.

## Consequences

**Good.** Annotations are visible to everyone with no toggle, survive export and
presentation, and can be styled. Connectors keep their relationship in the file
itself, so it survives closing the plugin, branching, version history, and other
collaborators. One anchor model and one reconciliation engine serve both
features, which is what justifies shipping them as a single plugin.

**Bad.** A teammate who moves a frame *without* the plugin open leaves the line
behind until someone re-syncs. No Design-file API avoids this; the UI has to say
so plainly rather than imply FigJam parity.

**Bad.** The rendered nodes are real layers. They show up in the layer panel and
can be moved or deleted by hand, so reconciliation has to treat the canvas as
untrusted and repair whatever it finds.

**Constraining.** `documentAccess: "dynamic-page"` is mandatory for new plugins,
so every node access is async. `@figma/eslint-plugin-figma-plugins` enforces
this at lint time.
