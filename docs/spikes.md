# Phase 0 spikes

Five things the Figma docs do not settle, which the architecture depends on.
Run the probes from the plugin's **Spikes** tab against a scratch file and
record the answer here. Delete `src/spikes.ts` once all five are closed.

| # | Question | Status |
| --- | --- | --- |
| S1 | Does `node.annotations = [...]` succeed from `editorType: ["figma"]`, and does the View → Annotations overlay show it? | open |
| S2 | Do per-vertex `strokeCap`s survive `setVectorNetworkAsync`, giving a different head and tail? How much does the node move? | open |
| S3 | Is `nodechange` delivered *during* a drag, or only on drop? | open |
| S4 | Does the main-thread sandbox expose `setTimeout` / `setInterval`? | open |
| S5 | Does `create-figma-plugin` emit `documentAccess: "dynamic-page"`? | **closed — no** |

## S5 — closed

`create-figma-plugin` does not know the field. `readConfigAsync` destructures the
keys it recognises and sweeps everything else into `rest`
(`node_modules/@create-figma-plugin/common/lib/read-config-async.js`), and
`buildManifestAsync` spreads `rest` into the manifest verbatim
(`node_modules/@create-figma-plugin/build/lib/utilities/build-manifest-async.js`).

So `documentAccess` and `networkAccess` must be declared by us in the
`figma-plugin` key of `package.json` — which they are. Verified in the generated
`manifest.json` after `npm run build`.

## S1 — open

Docs never state an `editorType` gate for `annotations`, but Dev Mode plugins
are barred from mutating nodes, while `PageNode.addMeasurement` *is* explicitly
Dev-Mode-only. The two facts point in opposite directions, so this needs an
empirical answer.

- **If it passes:** dual-write native annotations alongside the rendered nodes,
  so Dev Mode and the Inspect panel keep working.
- **If it fails:** drop the dual-write; render nodes only.

## S2 — open

`node.strokeCap` applies to the whole vector network, so an arrow with a plain
tail and an arrow head is only possible per-vertex. Under
`documentAccess: "dynamic-page"` the `vectorNetwork` property is read-only, so
the write has to go through `setVectorNetworkAsync`.

- **If it passes:** one `VectorNode` per connector, caps set on the first and
  last vertex.
- **If it fails:** heads and tails become separate composed nodes — materially
  more work, and worth knowing before phase 5.

Also record how far the node's `x`/`y` drift after the call: `VectorNode`
position and size auto-fit the vertices, so the renderer has to compensate.

## S3 — open

Decides whether "live" re-routing feels like FigJam or snaps on drop. The probe
arms a 10-second window and counts positional `nodechange` events.

- **Many events spread across the drag:** live re-routing as designed.
- **One event at the end:** re-route happens on drop. Not a blocker, but the UI
  copy must say so honestly rather than promising FigJam parity.

## S4 — open

The docs contradict themselves: "How plugins run" describes a sandbox with no
`setTimeout`, while `figma.closePlugin()` documents cancelling `setTimeout` and
`setInterval` timers.

- **If timers exist:** debounce `nodechange` bursts on the main thread.
- **If not:** drive the debounce from the UI iframe, which has full browser APIs.
