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
