/**
 * Comparing what is on the canvas against what we are about to draw.
 *
 * The scene layer reads a node's vector network; deciding whether that
 * network already says what the next write would say is a judgement about
 * numbers, and it belongs where it can be tested. It is also the judgement
 * a drag leans on hardest: on a page of connectors this runs per line per
 * frame, and every wrong "no" is a redundant write to the document.
 */

import type { Point } from './anchor.js'
import type { ManualVertex } from './connector.js'

/**
 * One point of a drawn polyline, in the node's own coordinates.
 *
 * `Cap` is left to the caller so a connector's own cap union survives the
 * round trip through here — this layer has no business knowing which strings
 * Figma accepts, and `DrawnVertex` below is the loose form for reading a
 * network back off a node.
 */
export interface CappedVertex<Cap extends string> {
  readonly x: number
  readonly y: number
  readonly strokeCap?: Cap
  readonly cornerRadius?: number
}

/** A vertex read off the canvas, whose cap is whatever string the document had. */
export type DrawnVertex = CappedVertex<string>

/** One link of a drawn polyline, by index into its vertices. */
export interface DrawnSegment {
  readonly start: number
  readonly end: number
}

/** A shape as it currently sits on the canvas: where the node is, and what it holds. */
export interface DrawnShape {
  readonly x: number
  readonly y: number
  readonly vertices: ReadonlyArray<DrawnVertex>
  readonly segments: ReadonlyArray<DrawnSegment>
}

/**
 * Whether `drawn` already carries exactly `vertices`, at exactly this origin.
 *
 * Deliberately strict: every way of answering "yes" wrongly leaves a line
 * looking like something it is not, while answering "no" wrongly costs one
 * redundant redraw. Rounded to whole units because the numbers make a
 * round trip through Figma and come back with the drift a float round trip
 * leaves.
 */
export function alreadyDrawn(
  drawn: DrawnShape,
  vertices: ReadonlyArray<DrawnVertex>,
  originX: number,
  originY: number
): boolean {
  if (Math.round(drawn.x) !== Math.round(originX)) return false
  if (Math.round(drawn.y) !== Math.round(originY)) return false
  const current = drawn.vertices
  if (current.length !== vertices.length) return false
  const segments = drawn.segments
  if (segments.length !== Math.max(0, vertices.length - 1)) return false
  for (let i = 0; i < vertices.length; i += 1) {
    const was = current[i]
    const now = vertices[i]
    if (typeof was === 'undefined' || typeof now === 'undefined') return false
    if (Math.round(was.x) !== Math.round(now.x)) return false
    if (Math.round(was.y) !== Math.round(now.y)) return false
    if ((was.strokeCap ?? 'NONE') !== (now.strokeCap ?? 'NONE')) return false
    if (Math.round(was.cornerRadius ?? 0) !== Math.round(now.cornerRadius ?? 0)) return false
  }
  // The chain has to be the one the caller builds, or the vertices being
  // right says nothing about the line joining them in that order.
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (typeof segment === 'undefined') return false
    if (segment.start !== i || segment.end !== i + 1) return false
  }
  return true
}

/**
 * A fingerprint of a drawn shape, for spotting an edit that was not ours.
 *
 * Every vertex and every join, not the bounding box: pulling a bend inwards
 * leaves the box exactly as it was — it is defined by the two ends — and the
 * vertex count with it, so a box-and-count fingerprint reports no change and
 * the edit is redrawn over in silence. A connector carries a handful of
 * vertices, so hashing all of them costs nothing worth measuring.
 *
 * Rounded to whole units, because the plugin's own writes come back with the
 * sub-pixel drift of a float round-trip, and a fingerprint that changes on
 * its own would claim every line in the file as hand-drawn.
 */
export function shapeFingerprint(network: {
  readonly vertices: ReadonlyArray<DrawnVertex>
  readonly segments: ReadonlyArray<DrawnSegment>
}): string {
  const vertices = network.vertices
    .map((vertex) => `${Math.round(vertex.x)},${Math.round(vertex.y)}`)
    .join(';')
  const segments = network.segments.map((segment) => `${segment.start}>${segment.end}`).join(';')
  // Vertices and joins only, never the node's position. Vertices are stored
  // relative to the node, so nudging a whole connector with an arrow key —
  // or dropping it onto a frame, which reparents it and rewrites x/y —
  // changes the position and not one thing about the shape. Including
  // position would hand routing over for good on a keystroke that reshaped
  // nothing, which is not what "somebody reshaped this" should mean.
  return `${vertices}|${segments}`
}

/**
 * A polyline ready to be written to a node: where the node goes, and what it
 * holds in its own coordinates.
 */
export interface PlacedPolyline<Cap extends string> {
  readonly x: number
  readonly y: number
  readonly vertices: ReadonlyArray<CappedVertex<Cap>>
  readonly segments: ReadonlyArray<DrawnSegment>
}

/** How a connector's line ends and bends are drawn. Leaders pass none of it. */
export interface PolylineEnds<Cap extends string> {
  readonly startCap: Cap
  readonly endCap: Cap
  readonly cornerRadius: number
}

/**
 * Turns absolute canvas points into a node position plus vertices relative to
 * it — the one rule both features write a line through.
 *
 * A vector node's `x`/`y` and its vertices say the same thing twice: the
 * vertices are measured from the node's own origin, so the origin has to be
 * the top-left corner of the points or the line is drawn at an offset from
 * where it was routed. Taking the minimum on each axis is what makes the two
 * agree, and doing it in two places is what let them disagree.
 *
 * `ends` decorates the vertices for a connector: only the true first and last
 * get a cap, because a bend is a corner rather than an end, and only the bends
 * in between get corner rounding, because a cap is drawn past the end of the
 * line so rounding an end vertex has no visible effect. A leader passes `null`
 * and gets bare points.
 *
 * No points is not reachable from either caller — every route is at least two
 * — but `Math.min()` of nothing is `Infinity`, which would be written to the
 * document as a position rather than caught. Answered as an empty line at the
 * origin instead.
 */
export function polylineAtOrigin<Cap extends string = never>(
  points: ReadonlyArray<Point>,
  ends: PolylineEnds<Cap> | null = null
): PlacedPolyline<Cap | 'NONE'> {
  if (points.length === 0) return { x: 0, y: 0, vertices: [], segments: [] }
  const x = Math.min(...points.map((point) => point.x))
  const y = Math.min(...points.map((point) => point.y))
  const lastIndex = points.length - 1
  return {
    x,
    y,
    vertices: points.map((point, index) => {
      const at = { x: point.x - x, y: point.y - y }
      if (ends === null) return at
      const isEnd = index === 0 || index === lastIndex
      return {
        ...at,
        strokeCap: index === 0 ? ends.startCap : index === lastIndex ? ends.endCap : 'NONE',
        ...(isEnd ? {} : { cornerRadius: ends.cornerRadius })
      }
    }),
    segments: points.slice(1).map((_point, index) => ({ start: index, end: index + 1 }))
  }
}

/** A polyline as it would be written: points, and the links between them. */
export interface DrawnNetwork {
  readonly vertices: ReadonlyArray<DrawnVertex>
  readonly segments: ReadonlyArray<DrawnSegment>
}

/**
 * Whether `drawn` already carries exactly this line, in this place.
 *
 * The leader's counterpart to `alreadyDrawn`, and looser in one way on
 * purpose: a leader has no caps or corner rounding to compare, and its
 * segments are compared as given rather than required to be a simple chain,
 * because a leader is written from a network the caller has already built.
 *
 * Strict everywhere it matters, though: a wrong "yes" leaves a leader
 * pointing at nothing, a wrong "no" costs one redundant redraw. Compared
 * against what is on the node rather than a note of what we last drew, so a
 * line somebody else has altered is still repaired — the canvas stays
 * untrusted.
 */
export function samePolyline(
  drawn: DrawnShape,
  x: number,
  y: number,
  network: DrawnNetwork
): boolean {
  if (Math.round(drawn.x) !== Math.round(x) || Math.round(drawn.y) !== Math.round(y)) return false
  if (drawn.vertices.length !== network.vertices.length) return false
  if (drawn.segments.length !== network.segments.length) return false
  for (let i = 0; i < network.vertices.length; i += 1) {
    const was = drawn.vertices[i]
    const now = network.vertices[i]
    if (typeof was === 'undefined' || typeof now === 'undefined') return false
    if (Math.round(was.x) !== Math.round(now.x)) return false
    if (Math.round(was.y) !== Math.round(now.y)) return false
  }
  for (let i = 0; i < network.segments.length; i += 1) {
    const was = drawn.segments[i]
    const now = network.segments[i]
    if (typeof was === 'undefined' || typeof now === 'undefined') return false
    if (was.start !== now.start || was.end !== now.end) return false
  }
  return true
}

/** A drawn segment that may carry bezier handles, as a vector network's do. */
export interface TangentSegment extends DrawnSegment {
  readonly tangentStart?: Point
  readonly tangentEnd?: Point
}

export interface TangentNetwork {
  readonly vertices: ReadonlyArray<DrawnVertex>
  readonly segments: ReadonlyArray<TangentSegment>
}

/** A shape walked into path order: every vertex, and the order the line visits them. */
export interface DrawnRun {
  readonly vertices: ReadonlyArray<ManualVertex>
  readonly order: ReadonlyArray<number>
}

/**
 * The shape a vector network describes: its vertices with their curve
 * handles, and the order the line actually visits them.
 *
 * The vertex list is not the path. Adding a point mid-line with the pen tool
 * appends it to the end of the list, so redrawing in list order would jump
 * the line out to the far end and back. The segments say what joins what, so
 * the path is walked from them.
 *
 * `originX`/`originY` place the vertices on the canvas. The caller has to
 * take them from the node's `absoluteTransform`, not its bounding box and
 * not its `x`/`y`: the box is grown by the stroke width, so it shifts every
 * point by half a stroke, and `x`/`y` mean "relative to the parent", which
 * stops being the page the moment somebody drops the connector onto a frame.
 *
 * `null` when the shape is not a single open run — a person who has cut a
 * connector into two pieces, or closed it into a loop, is holding something
 * this cannot carry, and guessing at it would be worse than leaving it be.
 */
export function walkDrawnShape(
  network: TangentNetwork,
  originX: number,
  originY: number
): DrawnRun | null {
  if (network.vertices.length < 2) return null

  const vertices: Array<ManualVertex> = network.vertices.map((vertex) => ({
    at: { x: vertex.x + originX, y: vertex.y + originY },
    tangentIn: null,
    tangentOut: null
  }))

  // Who is joined to whom, and with what curvature.
  const neighbours = new Map<number, Array<number>>()
  const tangents = new Map<string, Point>()
  for (const segment of network.segments) {
    for (const [from, to] of [
      [segment.start, segment.end],
      [segment.end, segment.start]
    ]) {
      const list = neighbours.get(from as number) ?? []
      list.push(to as number)
      neighbours.set(from as number, list)
    }
    if (typeof segment.tangentStart !== 'undefined') {
      tangents.set(`${segment.start}>${segment.end}`, segment.tangentStart)
    }
    if (typeof segment.tangentEnd !== 'undefined') {
      tangents.set(`${segment.end}>${segment.start}`, segment.tangentEnd)
    }
  }

  // An open run has exactly two ends — vertices joined to one other vertex.
  const ends = [...neighbours].filter(([, list]) => list.length === 1).map(([index]) => index)
  if (ends.length !== 2) return null

  const order: Array<number> = []
  const seen = new Set<number>()
  let current = ends[0] as number
  while (!seen.has(current)) {
    order.push(current)
    seen.add(current)
    const next = (neighbours.get(current) ?? []).find((candidate) => !seen.has(candidate))
    if (typeof next === 'undefined') break
    current = next
  }
  if (order.length !== network.vertices.length) return null

  for (let i = 0; i < order.length; i += 1) {
    const index = order[i] as number
    const previous = i > 0 ? (order[i - 1] as number) : null
    const next = i < order.length - 1 ? (order[i + 1] as number) : null
    const vertex = vertices[index]
    if (typeof vertex === 'undefined') continue
    vertices[index] = {
      at: vertex.at,
      tangentIn: previous === null ? null : tangents.get(`${index}>${previous}`) ?? null,
      tangentOut: next === null ? null : tangents.get(`${index}>${next}`) ?? null
    }
  }
  return { vertices, order }
}
