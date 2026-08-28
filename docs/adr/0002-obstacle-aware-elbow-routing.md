# ADR 0002 — Choose an elbow's shape by scoring candidate routes against the page's top-level boxes

- Status: accepted
- Date: 2026-08-28

## Context

An `ELBOW` connector routed purely from its two endpoints and their sides. It
cleared the frame each end was *nested in* (`connectorStubClearance`) and
preferred to bend in the gap between those two frames (`frameGapMidpoint`), but
it knew nothing about any other frame on the page. A screen parked between two
connected screens got a line straight through it.

The obvious fix is the FigJam one: a draggable handle on the connector, so a
person nudges the route past the obstruction by hand. Two problems with reaching
for that first. Figma plugins cannot draw on the canvas, so a handle has to be a
real scene node — visible to collaborators, selectable, deletable, and left
stranded in the file if the plugin dies. And it is manual: twenty connectors in
a flow is twenty nudges, thrown away the next time a frame moves.

Whether a plugin-owned handle can even feel like direct manipulation is an open
question, measured by spike S6 (`docs/spikes.md`).

## Decision

Route around obstacles automatically, in `src/core/`, before considering handles
at all.

`connectorRoutePoints` takes an optional list of boxes to avoid. When the list is
empty — and for `STRAIGHT` and `CURVE`, which have no bend to re-aim — nothing
changes. When it is not, a sided elbow enumerates candidate routes and scores
each one, rather than computing a single route from a formula:

- **Candidates.** For a same-axis pair: the Z-route the connector would have
  drawn anyway, plus one Z-route just outside each edge of each obstacle, plus a
  six-point `detourRoute` just outside each obstacle's near and far edge on the
  cross axis. For a mixed-axis pair: the single corner, plus the existing
  `detourElbow`. A route only changes shape as a bend crosses an obstacle
  boundary, so one candidate per boundary covers every distinct outcome.
- **Scoring.** Fewest obstacles crossed, then shortest, then fewest bends, then
  first offered — and the route the connector would have drawn anyway is always
  offered first. Every Z-route whose bend lands between the two ends has the same
  length as every other, so with nothing in the way the old route wins every
  tie-break and the output is unchanged.

`ConnectorRecord.detour` pins which way round, for when the shorter way is not
the one a person wants: `AUTO` (the default) scores by length, `TOP`/`BOTTOM`
and `LEFT`/`RIGHT` drop the other way's candidates entirely rather than merely
ranking them lower. Only one pair applies to a given connector — which one
depends on where its two ends currently sit, and so changes as they move — so a
pinned direction belonging to the other axis degrades to `AUTO` instead of being
an error. It is a style preference like the rest, inherited by the next
connector via `ConnectorStylePrefs`.

Both candidate families are needed because they fail in opposite cases. A
Z-route can slide its crossing into a clear gap, but two screens lined up in a
row collapse every Z-route to the same straight line — there is no bend left to
move. A `detourRoute` can always go around, but pays extra length for it.

**An endpoint's own frame is an obstacle too, for every segment except the one
that leaves and the one that arrives.** A connector anchored to something nested
inside a frame has to cross that frame to get out — but only once, and only on
the way. Dropping those frames entirely, as a first cut did, let a route leave by
the nearest edge and then turn straight back through the middle of the same
screen.

**An `AUTO` magnet on a nested anchor picks the side that gets *out* of its frame
cheapest, not the side facing the counterpart** (`resolveMagnetEscapingFrame`).
The old rule gave a control in a screen's bottom-left corner the side `RIGHT`
whenever its counterpart was to the right, and the connector then ran the full
width of its own screen, through the content, to leave. Which edge it crosses is
the only part of that actually in our gift, so that is what the rule now decides,
scoring `3 × (distance to the frame edge) + (distance from there to the
counterpart)`. The weight is a judgement call: crossing your own screen's content
reads as a mistake, travelling through empty canvas does not.

**Obstacles are filtered to the span between the two endpoints** plus a generous
margin (`obstaclesInPlay`). This cannot change the answer — every candidate route
is generated from an obstacle's own edges, so a box the route could never reach
only ever contributes candidates that lose — but on a real file it is the
difference between scoring ~100 boxes per connector per frame of a drag and
scoring a handful.

**Obstacles are the page's top-level container nodes only** — frames, sections,
components, instances — minus each endpoint's own top-level ancestor and minus
our own rendered nodes (annotation cards and connector labels are frames too).
Not every layer: the point is to route around *screens*, and a deep `findAll`
per connector per frame of a drag is not affordable on the main thread.

## Consequences

**Good.** Connectors dodge the other screens on the page with no per-connector
fiddling, and keep dodging them when things move. The whole decision lives in
`src/core/connector.ts`, which never touches the `figma` global, so it is unit
tested directly. `src/scene/` only had to learn how to collect the boxes.

**Bad.** Avoidance is coarse. It only sees top-level boxes, so a connector
routes around a whole screen rather than through an empty region of it, and
ignores anything nested. `FRAME_EXIT_PENALTY` and `ROUTE_SEARCH_MARGIN` are both
tuned by eye rather than measured. It considers one obstacle boundary at a time, so a
dense page can leave it with no clear candidate; it then picks the least-bad
route rather than searching harder. And routes now shift when unrelated frames
move, which is correct but is a change in behaviour on existing files.

**Deferred.** Real pathfinding (a visibility graph, or A* over a grid) would
handle the dense cases, at a cost we have no evidence is affordable on the
editor's main thread. A manual handle is still on the table as an override for
whatever the automatic version gets wrong — that is what S6 is for. Neither is
worth building until this one has been used on real files.
