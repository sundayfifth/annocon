/**
 * A line somebody reshaped by hand — the one place this plugin stops deciding
 * where a connector goes.
 *
 * Reshaping is a promise that the shape is right, so the plugin hands the
 * geometry over rather than owning it: it does not read the shape back on
 * every sync, it simply stops computing one. Everything else — colour,
 * weight, caps, the label, being listed as this pair's connector — carries on
 * as before, which is why this is a module beside the router rather than a
 * mode inside it. Nothing here routes, and nothing in the router reaches in.
 *
 * `connector.ts` depends on this in one direction only: a `ConnectorRecord`
 * carries a `ManualShape | null`, and decoding one goes through
 * `parseManualShape`. Nothing here imports the router back.
 */

import type { Point } from './anchor.js'
import { isPoint } from './anchor.js'

/** One vertex of a hand-drawn shape: where it is, and how the curve leaves it. */
export interface ManualVertex {
  readonly at: Point
  /** Bezier handles, relative to `at` — `null` for a plain corner. */
  readonly tangentIn: Point | null
  readonly tangentOut: Point | null
}

/**
 * A shape somebody drew, and where its two ends were when they drew it.
 *
 * `order` is the vertices' indices as the line actually visits them, which
 * is not the order they sit in the network: adding a point mid-line with the
 * pen tool appends it to the end of the vertex list. Redrawing in list order
 * would jump the line from one end to the other and back.
 */
export interface ManualShape {
  readonly vertices: ReadonlyArray<ManualVertex>
  readonly order: ReadonlyArray<number>
  readonly start: Point
  readonly end: Point
}

/**
 * Moves a hand-drawn shape to follow endpoints that have since moved.
 *
 * Each point is carried by a blend of how far the two ends moved, weighted
 * by how far along the line that point sits. One rule covers both cases
 * worth caring about, which is why it is this rule and not two:
 *
 * - Both ends moved the same way — dragging a group of screens somewhere
 *   else — and every blend is that same amount, so the whole line slides and
 *   the drawn shape is preserved exactly.
 * - One end moved, and the ends stay on their layers while the middle is
 *   carried in proportion, so a bend a third of the way down still looks a
 *   third of the way down.
 *
 * It does not re-route: the shape is the person's, and this only carries it.
 * Move an endpoint far enough and the drawn shape will stop making sense —
 * that is what the button back to automatic routing is for.
 */
export function shiftManualShape(
  points: ReadonlyArray<Point>,
  was: { start: Point; end: Point },
  now: { start: Point; end: Point }
): ReadonlyArray<Point> {
  if (points.length === 0) return []
  // Tangents are deliberately left untouched by this: they are relative to
  // their own vertex, so a shape that is carried keeps its curvature exactly.

  const startDelta = { x: now.start.x - was.start.x, y: now.start.y - was.start.y }
  const endDelta = { x: now.end.x - was.end.x, y: now.end.y - was.end.y }

  const lengths: Array<number> = [0]
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    total += Math.hypot(to.x - from.x, to.y - from.y)
    lengths.push(total)
  }

  return points.map((point, index) => {
    // A zero-length line has no "along" to speak of; treat every point as
    // being at the start, which makes this the plain translation it should be.
    const t = total === 0 ? 0 : (lengths[index] ?? 0) / total
    return {
      x: point.x + startDelta.x + (endDelta.x - startDelta.x) * t,
      y: point.y + startDelta.y + (endDelta.y - startDelta.y) * t
    }
  })
}

/**
 * Points a walked shape the same way round as the record does.
 *
 * A vector network lists its vertices in whatever order the editor left them
 * in, so walking one from end to end can come out back to front — starting
 * at the vertex nearest the connector's `end` rather than its `start`. Left
 * unchecked that costs twice over: the two ends get each other's arrowheads,
 * and `shiftManualShape` carries each end by the *other* end's movement, so
 * moving one screen drags the line away from it instead of with it.
 *
 * Reversing a walk swaps every vertex's two tangents with it: `tangentIn`
 * and `tangentOut` are recorded relative to the direction of travel.
 */
export function orientedTowards(
  drawn: { vertices: ReadonlyArray<ManualVertex>; order: ReadonlyArray<number> },
  start: Point,
  end: Point
): { vertices: ReadonlyArray<ManualVertex>; order: ReadonlyArray<number> } {
  const first = drawn.vertices[drawn.order[0] ?? -1]
  const last = drawn.vertices[drawn.order[drawn.order.length - 1] ?? -1]
  if (typeof first === 'undefined' || typeof last === 'undefined') return drawn
  const asDrawn = squaredDistance(first.at, start) + squaredDistance(last.at, end)
  const reversed = squaredDistance(first.at, end) + squaredDistance(last.at, start)
  if (asDrawn <= reversed) return drawn
  return {
    order: [...drawn.order].reverse(),
    vertices: drawn.vertices.map((vertex) => ({
      at: vertex.at,
      tangentIn: vertex.tangentOut,
      tangentOut: vertex.tangentIn
    }))
  }
}

function squaredDistance(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function parseManualVertex(value: unknown): ManualVertex | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (!isPoint(candidate.at)) return null
  return {
    at: candidate.at,
    tangentIn: isPoint(candidate.tangentIn) ? candidate.tangentIn : null,
    tangentOut: isPoint(candidate.tangentOut) ? candidate.tangentOut : null
  }
}

/**
 * All of it or none of it, unlike the tolerant field-by-field decoding
 * elsewhere in this file.
 *
 * A style field that fails to decode falls back to a default and the
 * connector still looks like a connector. Half a shape is not half a line —
 * it is a different line, drawn somewhere its author never put it. Better to
 * answer `null` and let the route go back to being computed.
 */
export function parseManualShape(value: unknown): ManualShape | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.vertices) || !Array.isArray(candidate.order)) return null
  if (!isPoint(candidate.start) || !isPoint(candidate.end)) return null
  const vertices: Array<ManualVertex> = []
  for (const raw of candidate.vertices) {
    const vertex = parseManualVertex(raw)
    if (vertex === null) return null
    vertices.push(vertex)
  }
  // Two vertices is the least that can describe a line, and the order has to
  // name real ones — an index past the end would draw to nowhere.
  if (vertices.length < 2 || candidate.order.length < 2) return null
  const order: Array<number> = []
  for (const index of candidate.order) {
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length) return null
    order.push(index as number)
  }
  return { vertices, order, start: candidate.start, end: candidate.end }
}
