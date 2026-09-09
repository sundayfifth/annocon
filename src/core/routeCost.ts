/**
 * The boxes a route has to get past, and how badly a given route fails to.
 *
 * Separated from the router because these are what a route is *judged* by,
 * not how one is chosen: every candidate the elbow router generates and every
 * cell the search expands is scored through here, and both need the same
 * answer to mean the same thing. `obstacleScan.ts` needs it too — it decides
 * which of the page's boxes are worth handing to a connector at all — and
 * used to reach back into the router for it, which is the dependency this
 * removes.
 *
 * Nothing here picks a route. Nothing here knows what an elbow is.
 */

import type { Point, Rect } from './anchor.js'

/**
 * The least a re-aimed route passes clear of an obstacle's edge.
 *
 * A floor rather than the answer — see `clearanceBeside`.
 */
export const OBSTACLE_CLEARANCE = 20

/**
 * Whether an axis-aligned segment passes through `rect`'s interior.
 *
 * Only correct for horizontal or vertical segments — an elbow route is
 * nothing but those, and for them the segment *is* its own bounding box, so
 * a box-overlap test is exact rather than conservative. A `CURVE` or a
 * diagonal `STRAIGHT` would need real segment/rect intersection; neither has
 * a bend to re-aim, so neither asks this question.
 *
 * Strict on every edge: a route that runs flush along a frame's edge, or
 * clips its corner, is not cutting *through* it. Being lenient here would
 * make the common case — a connector hugging the gap between two screens —
 * report a crossing it does not have, and send the bend off somewhere worse.
 */
export function segmentEntersRect(a: Point, b: Point, rect: Rect): boolean {
  return (
    Math.min(a.x, b.x) < rect.x + rect.width &&
    Math.max(a.x, b.x) > rect.x &&
    Math.min(a.y, b.y) < rect.y + rect.height &&
    Math.max(a.y, b.y) > rect.y
  )
}

/**
 * How many of `obstacles` the route cuts through — counted per obstacle, not
 * per segment, so a route that runs the length of one frame scores the same
 * as one that just clips its corner. What matters when choosing between two
 * candidate routes is how many things each one hits, not how hard.
 */
export function routeCrossings(
  points: ReadonlyArray<Point>,
  obstacles: ReadonlyArray<Rect>,
  fromSegment = 0,
  toSegment: number = Number.POSITIVE_INFINITY
): number {
  const last = Math.min(points.length - 2, toSegment)
  let count = 0
  for (const rect of obstacles) {
    for (let i = Math.max(0, fromSegment); i <= last; i += 1) {
      const from = points[i]
      const to = points[i + 1]
      if (typeof from === 'undefined' || typeof to === 'undefined') continue
      if (segmentEntersRect(from, to, rect)) {
        count += 1
        break
      }
    }
  }
  return count
}

/**
 * The boxes a route has to get past, split by how absolute that is.
 *
 * `foreign` is everything else on the page: crossing one is always a defect.
 * `own` is the frames the two endpoints themselves live inside, where the
 * rule is different rather than absent — a connector anchored to something
 * nested in a frame has no choice but to cross that frame on its way out, so
 * the segment that leaves and the segment that arrives are exempt, but
 * everything in between is held to the same standard as any other frame.
 * Without that second half, a route that carefully leaves by the nearest
 * edge is free to turn straight back through the middle of the same screen.
 */
export interface RouteObstacles {
  readonly foreign: ReadonlyArray<Rect>
  readonly own: ReadonlyArray<Rect>
}

export const NO_OBSTACLES: RouteObstacles = { foreign: [], own: [] }

export function hasObstacles(obstacles: RouteObstacles): boolean {
  return obstacles.foreign.length > 0 || obstacles.own.length > 0
}

/**
 * How bad a route is: every foreign box it crosses, plus every own frame it
 * re-enters after having left.
 *
 * The exemption covers the leaving and arriving segments against *both* own
 * frames rather than pairing each frame with its own end, and that is
 * deliberate. A route has to finish inside the frame it arrives in, so a
 * first segment long enough to reach that frame early has done nothing
 * wrong — charging it would make a plain straight line between two adjacent
 * screens score worse than a detour around them. What is actually a defect
 * is leaving a frame and turning back into it, and every segment in between
 * is still counted, which is exactly what catches that.
 */
export function routeCost(points: ReadonlyArray<Point>, obstacles: RouteObstacles): number {
  return (
    routeCrossings(points, obstacles.foreign) +
    routeCrossings(points, obstacles.own, 1, points.length - 3)
  )
}

/**
 * Narrows a page's worth of boxes down to the ones that could plausibly
 * matter for this connector: those overlapping the span between its two
 * ends, with `margin` of slack for a route that bulges outside it.
 *
 * Purely a performance filter, and the reason it can be one is that every
 * candidate route is generated *from* an obstacle's own edges — a box the
 * route could never reach contributes candidates that are never chosen, so
 * dropping it cannot change the answer, only how long it takes to get there.
 * On a real file this is the difference between scoring ~100 boxes per
 * connector per frame of a drag and scoring a handful.
 */
export function obstaclesInPlay(
  obstacles: ReadonlyArray<Rect>,
  start: Point,
  end: Point,
  margin: number
): ReadonlyArray<Rect> {
  const minX = Math.min(start.x, end.x) - margin
  const maxX = Math.max(start.x, end.x) + margin
  const minY = Math.min(start.y, end.y) - margin
  const maxY = Math.max(start.y, end.y) + margin
  return obstacles.filter(
    (rect) =>
      rect.x < maxX && rect.x + rect.width > minX && rect.y < maxY && rect.y + rect.height > minY
  )
}

/**
 * How far outside the box spanned by a connector's two ends a route is
 * allowed to bulge, and so how far out anything hunting for obstacles has to
 * look. Generous enough to cover a detour that goes around a full screen
 * sitting just past one end, which is the widest useful candidate the router
 * ever generates.
 */
export const ROUTE_SEARCH_MARGIN = 1200

/**
 * Whether a box now sitting at `box` could change the route a connector whose
 * rendered node occupies `routeBounds` is currently drawing.
 *
 * This is the *invalidation* question, as opposed to `obstaclesInPlay`'s
 * *scoring* question: not "which boxes does this route have to consider" but
 * "did this box moving mean some route has to be worked out again". Both have
 * to agree, or a connector sits un-resynced while a box it genuinely routes
 * around is dragged past it — so this deliberately tests against the rendered
 * node's own bounding box, which always contains both endpoints and, once a
 * route has bent around something, the bulge as well. That makes it a superset
 * of the span `obstaclesInPlay` filters on, and a superset is the safe side to
 * be on: too many re-syncs only costs time, too few leaves a stale line on the
 * canvas.
 *
 * The bulge is also what makes a drag *away* work without remembering where
 * the box used to be. A route already bent around a box has a bounding box
 * wrapped around that same region, so the box stays within `margin` of it long
 * enough for the re-sync that straightens the line back out.
 */
export function boxCouldAffectRoute(routeBounds: Rect, box: Rect, margin: number): boolean {
  return (
    box.x < routeBounds.x + routeBounds.width + margin &&
    box.x + box.width > routeBounds.x - margin &&
    box.y < routeBounds.y + routeBounds.height + margin &&
    box.y + box.height > routeBounds.y - margin
  )
}
