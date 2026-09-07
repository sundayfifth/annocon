# ADR 0004 — Search a compressed grid with A* when the candidate rules cannot find a clear route

- Status: accepted
- Date: 2026-09-07

## Context

ADR 0002 deferred real pathfinding, on the grounds that we had no evidence it
was affordable on the editor's main thread and no evidence the candidate rules
were insufficient. Both halves of that changed.

The insufficiency was reported from a real file and is written up in 0002's own
Consequences: a page of ~300 screens in columns, a connector running 8000 units
down the board, cutting through three of them. Nothing had gone wrong — the
router collected all 295 boxes and scored them correctly. The candidate set was
the problem. Every candidate is generated from *one* obstacle's edge, so the
router can only ever propose "just outside this box". A wall of screens with a
gap in it has no single box whose edge lines up with the gap, so no candidate
crosses nothing, and the least-bad route goes through three screens as designed.

Three attempts to reproduce it as a unit test, with coordinates lifted straight
from the file, all routed cleanly. The rules handle every *shape*; what they
cannot handle is the number of shapes at once. That is not a tuning problem.

The affordability question turned out to be answerable rather than open, because
of what a real board looks like: screens line up in columns and rows, so dozens
of them share a handful of edge coordinates. A grid built from those edges stays
small no matter how many screens produced it.

## Decision

Keep the candidate rules exactly as they are, and add a search that runs **only
when they fail**.

`orSearched` wraps every route the rules return. If `routeCost(chosen) === 0` —
the route already crosses nothing — it returns immediately and no search
happens. Nothing changes on an ordinary page; the cost is one score that was
being computed anyway.

When the chosen route does cross something, `findRouteAround` runs A* over a
**coordinate-compressed grid**: `gridLines` collects one line an
`OBSTACLE_CLEARANCE` outside each of every obstacle's four sides, plus the two
endpoints, per axis. A route only ever needs to turn where something's edge is,
so this grid still contains an optimal orthogonal route while being a few dozen
lines each way instead of thousands of pixels. `TURN_PENALTY = 40` makes a route
with the same length but fewer corners win. `walkBack` reconstructs the path.

The budget is `xs.length * ys.length * obstacles.length > MAX_SEARCH_COST`
(250000) — over that, `findRouteAround` returns `null` and the caller keeps what
it had. **Deliberately not a cap on obstacle count**, which would reject exactly
the boards this exists for: the busiest ones are also the tidiest grids.
Genuinely scattered obstacles share no edges, so their grid grows with every one
of them and they hit the budget on their own.

**The search runs on the endpoints' stub points, not the anchors** — `from` and
`to` are each pushed a clearance along their side's outward normal — so a line
still leaves and arrives perpendicular to the edge it is attached to.

**It searches `obstacles.foreign` only.** The own/foreign split exists because
an endpoint's own frame has to be crossed on the way out; the grid has no notion
of "except on the way", so it is not shown those boxes at all.

**The result is only adopted if it actually scores better**
(`routeCost(full) < routeCost(chosen)`). Because the search ignores the
own-screen exemptions `routeCost` applies, a route it calls clean can still lose
by the rules everything else is judged on, and then the rules win.

**A pinned `detour` skips the search entirely.** The grid finds a way through
without any notion of which way round it went, so letting it run on a pinned
route would quietly undo the pin on precisely the crowded boards where someone
bothered to set one. A person who names a direction gets that direction, even
where the search would have found something tidier.

## Consequences

**Good.** The dense case 0002 documented now routes cleanly. It costs nothing on
pages where the rules already work, because the trigger is a score that was
already being computed. The whole thing is in `src/core/connector.ts`, pure and
unit tested; `src/scene/` learned nothing new.

**Bad.** There are now two routing mechanisms with different notions of what
"clear" means — the rules exempt an endpoint's own frame on the segments that
leave and arrive, the search is simply never told about it — and `orSearched`
exists to arbitrate between them. That comparison is the subtle part of the
module and the place a future routing bug is most likely to live.

`TURN_PENALTY` and `MAX_SEARCH_COST` are tuned by eye, like
`FRAME_EXIT_PENALTY` and `ROUTE_SEARCH_MARGIN` before them. The budget has not
been measured against a frame deadline on a real file; it is an estimate of when
searching stops being worth it, not a measurement of when it stops being
affordable.

Interaction with a pinned detour is a hard exclusion rather than a
direction-aware search. A pinned route on a dense board still gets only the
candidate rules, which is the case least likely to have a clean answer — the
pin buys predictability at the cost of the mechanism that would have helped
most.

**Deferred.** A manual handle, still. ADR 0002's argument against reaching for
it first held up: automatic avoidance now covers the dense case that was the
main reason to want one. A direction-aware search — A* that knows which side of
an obstacle it passed, so it can honour a pin instead of standing down — is the
obvious way to remove the exclusion above, and is worth building only if pinned
routes on dense boards turn out to be something people actually hit.
