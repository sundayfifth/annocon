# Spikes

Things the Figma docs do not settle, which the architecture depends on.

The five Phase 0 spikes are all closed; the probes that answered them have been
removed. S6 is open — its probe lives in `src/spikes.ts`, behind the
**Spike: drag probe (S6)** menu command.

| # | Question | Status |
| --- | --- | --- |
| S1 | Does `node.annotations = [...]` succeed from `editorType: ["figma"]`, and does the View → Annotations overlay show it? | **closed — yes** |
| S2 | Do per-vertex `strokeCap`s survive `setVectorNetworkAsync`, giving a different head and tail? How much does the node move? | **closed — yes** |
| S3 | Is `nodechange` delivered *during* a drag, or only on drop? | **closed — during** |
| S4 | Does the main-thread sandbox expose `setTimeout` / `setInterval`? | **closed — yes** |
| S5 | Does `create-figma-plugin` emit `documentAccess: "dynamic-page"`? | **closed — no** |
| S6 | Fast enough for a draggable handle? How far apart do drag events arrive, and how long does `syncConnector` take per event? | **open** |

## S6 — open

Blocks the "FigJam-style drag handle" question: whether a connector can carry
handle nodes a person drags to nudge the route (e.g. past a frame the elbow
currently cuts straight through).

S3 already answered *whether* events arrive during a drag. S6 asks whether they
arrive fast enough, and — the part S3 never measured — whether our own re-route
finishes inside the gap between them. If `syncConnector` costs more than the gap,
we are the bottleneck no matter how fast Figma delivers, and the handle trails
the cursor in steps.

**How to run it**

1. Scratch file, two frames with a connector between them.
2. Select one of the frames (exactly one node, and it must have a connector).
3. Plugins → Development → ANNOCON → **Spike: drag probe (S6)**.
4. Drag the frame around continuously for the full 10 seconds.
5. The report lands as a text node in the middle of the viewport.

Worth running twice: once on a near-empty file, once on a file with a realistic
number of nodes — `syncConnector` does a full-page `findAllWithCriteria` scan
for the connector's label, so its cost is expected to grow with file size.

**Thresholds** (median gap + median sync, i.e. what a person actually feels):

| Perceived | Verdict |
| --- | --- |
| ≤ 33ms | direct manipulation — build the handle |
| 33–100ms | usable but visibly steppy |
| > 100ms | the line trails the cursor; a panel control beats a handle |

- **Result:** _(paste the probe's report here)_

## S5 — closed

`create-figma-plugin` does not know the field. `readConfigAsync` destructures the
keys it recognises and sweeps everything else into `rest`
(`node_modules/@create-figma-plugin/common/lib/read-config-async.js`), and
`buildManifestAsync` spreads `rest` into the manifest verbatim
(`node_modules/@create-figma-plugin/build/lib/utilities/build-manifest-async.js`).

So `documentAccess` and `networkAccess` must be declared by us in the
`figma-plugin` key of `package.json` — which they are. Verified in the generated
`manifest.json` after `npm run build`.

## S1 — closed

Confirmed on an `INSTANCE` node from `editorType: ["figma"]`: assignment
succeeded and read back correctly.

- **Result:** dual-write native annotations alongside the rendered nodes, so
  Dev Mode and the Inspect panel keep working.
- **Still to verify by eye:** toggling View → Annotations and confirming the
  badge actually renders on canvas (the probe only checked the property
  read/write, not the overlay).

## S2 — closed

Confirmed: caps read back as `["NONE","ARROW_EQUILATERAL"]` — different head
and tail on the same vertex network. `node.strokeCap` itself came back as
`Symbol(figma.mixed)`, which makes sense once the two vertices disagree.

- **Result:** one `VectorNode` per connector, caps set on the first and last
  vertex. No separate composed nodes needed.
- **Position drift:** none — `x`/`y` after `setVectorNetworkAsync` matched the
  vertices as given (`{"x":0,"y":0}`), size `200x120`. Worth re-checking with a
  vector that doesn't start at the origin, since auto-fit could still shift
  non-zero-origin geometry.

## S4 — closed

Confirmed: `setTimeout` and `setInterval` are both available on the main
thread. No need to drive debouncing from the UI iframe.

## S3 — closed

Confirmed: 32 positional `nodechange` events over a 6223ms drag — events stream
continuously during the drag, not just on drop.

- **Result:** live re-routing as designed. Connectors can re-route on every
  `nodechange`, not just after drop, and the UI can honestly promise FigJam-like
  live tracking while the plugin is open.
