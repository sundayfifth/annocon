/**
 * A `CURVE` connector, and reading a point off either kind of route.
 *
 * A curve is one cubic bezier segment rather than a polyline: the tangents on
 * its single segment do the work `cornerRadius` does for an elbow. It avoids
 * nothing and bends around nothing, which is why it is here rather than in
 * the router — there is no route to search for, only two handles to size.
 *
 * `pointAlongPolyline` sits beside it because it answers the same question
 * for the other kind of route, and both exist for the same caller: a label
 * has to be placed halfway along whatever the line turned out to be.
 */

import type { Point } from './anchor.js'
import { outwardNormal, type ResolvedMagnet } from './anchor.js'

const CURVE_HANDLE_MIN = 32
const CURVE_HANDLE_MAX = 140
const CURVE_HANDLE_RATIO = 0.4

export interface ConnectorCurve {
  /** Bezier control-point offset from `start`, in the direction the line leaves it. */
  readonly tangentStart: Point
  /** Bezier control-point offset from `end`, in the direction the line leaves it (mirrors `tangentStart`). */
  readonly tangentEnd: Point
}

/**
 * The handle vectors for a `CURVE` connector — a single cubic bezier from
 * `start` to `end` that still leaves and arrives perpendicular to each
 * side, the curved counterpart to `sidedElbow`'s stubs. Both handles point
 * *outward* from their own box (Figma's `tangentEnd` is measured the same
 * way as `tangentStart`, not reversed), which is what bends the curve away
 * from the edge before it sweeps toward the other end.
 *
 * Falls back to a handle aimed along the straight line between the points
 * when a side is unknown, so a `free`/`ratio` anchor still gets a gentle,
 * if directionless, curve instead of a hard corner.
 *
 * `startClearance`/`endClearance` (default 0, i.e. no floor) raise a
 * handle's length past the proportional default when it isn't enough to
 * clear an enclosing frame — the curved counterpart to `sidedElbow`'s
 * `startClearance`/`endClearance`, from `connectorStubClearance`. Still
 * capped at `CURVE_HANDLE_MAX`: a wide enough frame would otherwise stretch
 * the handle into a floppy loop instead of a clean curve — better to fall
 * short of clearing a very large frame than to look broken doing it.
 */
export function connectorCurveTangents(
  start: Point,
  end: Point,
  startSide: ResolvedMagnet | null,
  endSide: ResolvedMagnet | null,
  startClearance = 0,
  endClearance = 0
): ConnectorCurve {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const baseHandle = Math.min(CURVE_HANDLE_MAX, Math.max(CURVE_HANDLE_MIN, distance * CURVE_HANDLE_RATIO))
  const forward =
    distance === 0 ? { x: 0, y: 0 } : { x: (end.x - start.x) / distance, y: (end.y - start.y) / distance }
  const startDir = startSide === null ? forward : outwardNormal(startSide)
  const endDir = endSide === null ? { x: -forward.x, y: -forward.y } : outwardNormal(endSide)
  const startLength = Math.min(CURVE_HANDLE_MAX, Math.max(baseHandle, startClearance))
  const endLength = Math.min(CURVE_HANDLE_MAX, Math.max(baseHandle, endClearance))
  return {
    tangentStart: { x: startDir.x * startLength, y: startDir.y * startLength },
    tangentEnd: { x: endDir.x * endLength, y: endDir.y * endLength }
  }
}

/**
 * A point a fraction `t` (0..1) along a polyline, by cumulative segment
 * length rather than by vertex index — a route with a short stub and a long
 * middle run would otherwise put the "midpoint" nowhere near the visual
 * middle. Used to place a connector's label (`ConnectorRecord.label`) on
 * `STRAIGHT`/`ELBOW` routes.
 */
export function pointAlongPolyline(points: ReadonlyArray<Point>, t: number): Point {
  const first = points[0]
  if (typeof first === 'undefined') return { x: 0, y: 0 }
  if (points.length === 1) return first

  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    total += Math.hypot(to.x - from.x, to.y - from.y)
  }
  if (total === 0) return first

  let remaining = Math.min(1, Math.max(0, t)) * total
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (remaining <= length || i === points.length - 2) {
      const ratio = length === 0 ? 0 : remaining / length
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
    }
    remaining -= length
  }
  return first
}

/**
 * The point at parameter `t` (0..1) on the cubic bezier a `CURVE` connector
 * draws — the curved counterpart to `pointAlongPolyline`, for the same
 * label-placement purpose. A parametric midpoint (`t = 0.5`), not a true
 * arc-length one; close enough for where a label sits.
 */
export function pointOnCurve(start: Point, end: Point, curve: ConnectorCurve, t: number): Point {
  const p1 = { x: start.x + curve.tangentStart.x, y: start.y + curve.tangentStart.y }
  const p2 = { x: end.x + curve.tangentEnd.x, y: end.y + curve.tangentEnd.y }
  const mt = 1 - t
  return {
    x: mt * mt * mt * start.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * end.x,
    y: mt * mt * mt * start.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * end.y
  }
}
