/**
 * Comparing what is on the canvas against what we are about to draw.
 *
 * The scene layer reads a node's vector network; deciding whether that
 * network already says what the next write would say is a judgement about
 * numbers, and it belongs where it can be tested. It is also the judgement
 * a drag leans on hardest: on a page of connectors this runs per line per
 * frame, and every wrong "no" is a redundant write to the document.
 */

/** One point of a drawn polyline, in the node's own coordinates. */
export interface DrawnVertex {
  readonly x: number
  readonly y: number
  readonly strokeCap?: string
  readonly cornerRadius?: number
}

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
