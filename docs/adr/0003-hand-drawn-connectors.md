# ADR 0003 — Let a person reshape a connector, and stop routing it

- Status: accepted
- Date: 2026-09-01

## Context

Obstacle-aware routing (ADR 0002) is right most of the time and wrong often
enough to matter. Its limits are now measured rather than guessed: on a real
board of ~300 screens in columns, a connector running 8000 units down the page
cut through three of them. The router had collected every screen — 295 boxes,
none missed — and had no candidate that crossed nothing, because candidates are
generated one obstacle boundary at a time and no single boundary clears the rest
on a board that dense. Three attempts to reproduce it as a unit test, with
coordinates from the file, all routed cleanly.

Two ways out were tried in order.

**Drag handles** — plugin-drawn controls on the line, FigJam-style — were built
and abandoned. A plugin cannot draw on the canvas, so each handle is a real
node: visible to collaborators, left behind if the plugin dies, and delivered
back through `nodechange` like any other edit. That last part is what broke it.
Redrawing handles after a drag returned as "somebody dragged a handle", which
pinned a point, which redrew the handles, twice through fixes that were not
enough. Suppression cannot settle it: it releases a tick after the write, and a
sync's awaits let the event land after the window has closed.

**The team's own framing** settled it: what they wanted was Autoflow's
flexibility — edit the line with the pen tool, as you would edit any vector.

## Decision

A connector whose shape has been edited by hand stops being routed.

`ConnectorRecord.manualGeometry` records that this has happened.
`manualShape` records the shape itself: its vertices, their curve handles, and
the order the line visits them, with the endpoints it was drawn against.

**Read once, then flow one way again.** The shape is taken off the node when
the edit is noticed, and never read again. Everything after that is drawn from
the record, like every other rendered node here. Reading the canvas on every
sync is what made the handles loop, and the project's own rule against it
(`CLAUDE.md`) was right.

**Told apart from our own drawing by a fingerprint, not by suppression.** The
plugin records the vertices and joins it last drew; a shape that differs was
edited by somebody else. Position is deliberately excluded — nudging a whole
connector with an arrow key, or dropping it onto a frame, changes `x`/`y` and
reshapes nothing. A connector with no fingerprint yet is left alone rather than
claimed, so existing files do not go manual the moment anything moves.

**A hand-drawn line still follows its layers.** Each point is carried by a blend
of how far the two ends moved, weighted by how far along the line it sits. One
rule covers both cases: drag a group of screens and every blend is the same
amount, so the shape slides intact; move one screen and both ends stay on their
layers while the bends are carried in proportion.

**Style stays ours, shape becomes theirs.** Colour, weight, opacity, caps and
the label all still apply. Line style, corner radius and Go around are hidden,
because they describe a route this plugin no longer draws.

## Consequences

**Good.** The routing failure above stops being a dead end: the answer to a line
the router gets wrong is thirty seconds with the pen tool, and the result
survives the screens moving. It is also the escape hatch for everything else
avoidance gets wrong, without a per-case fix for each.

**Bad.** A hand-drawn line does not re-route. Move an endpoint far enough and the
drawn shape stops making sense, and nothing says so beyond the shape looking
wrong — the way back is a button in the panel. The shape is also carried rather
than recomputed, so a line drawn around a screen will not notice that screen
moving away.

Reading geometry off a node at all is a departure from ADR 0001's one-way flow.
It is confined to the single moment an edit is noticed, and everything after
that returns to the rule.

**Deferred.** Real pathfinding is still the fix for dense boards, at a cost we
still have no evidence is affordable on the editor's main thread. This makes
that decision less urgent rather than unnecessary.
