/**
 * Telling this plugin's own writes from a person's edits, by what is on the
 * node rather than by when the write happened.
 *
 * Both features render nodes a person can also reach: a connector's line can
 * be reshaped with Figma's vector tools, a note's card can be dragged and
 * resized. Every `nodechange` for one of those has to be attributed before it
 * is acted on, or the plugin either overwrites a deliberate edit or records
 * its own write as one.
 *
 * There used to be two answers to that one question. `withSuppressedNodeChange`
 * raised a flag for the duration of a write and released it a tick later, so
 * anything arriving inside the window was ours — a guess about timing, and
 * wrong whenever a write's event landed after a long async block had
 * finished. Fingerprinting is the other, and the one that survived: remember
 * what was written, and compare. It does not care when the event turns up, or
 * whether one turns up at all.
 *
 * Only two writes need it. Everything else this plugin does to a node is
 * either dropped by the property filter in `core/nodeChanges.ts`, recognised
 * by the node's own role, or — for a deletion, which leaves no content to
 * compare — remembered by id in `scene/removals.ts`.
 *
 * Rounded to whole units throughout, because the plugin's own writes come
 * back with the sub-pixel drift of a float round trip, and a fingerprint that
 * changes on its own would claim every node in the file as hand-edited.
 */

import type { DrawnSegment, DrawnVertex } from './drawnShape.js'

/**
 * A fingerprint of a drawn shape, for spotting an edit that was not ours.
 *
 * Every vertex and every join, not the bounding box: pulling a bend inwards
 * leaves the box exactly as it was — it is defined by the two ends — and the
 * vertex count with it, so a box-and-count fingerprint reports no change and
 * the edit is redrawn over in silence. A connector carries a handful of
 * vertices, so hashing all of them costs nothing worth measuring.
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

/** Where a card was put, and how wide — the three numbers a sync writes. */
export interface Placement {
  readonly x: number
  readonly y: number
  readonly width: number
}

/**
 * A fingerprint of where a card was placed, for spotting a drag that was
 * not ours.
 *
 * The exact opposite of `shapeFingerprint` on the one question they differ
 * on, and for the same underlying reason — each names what its own feature
 * has handed over. A connector's shape is the person's to change and its
 * position is not, so shape is fingerprinted and position ignored. A card is
 * the other way round: its position and width are what a person adjusts by
 * hand, and its height is the text's business, so height is left out.
 *
 * Absolute coordinates, never `x`/`y` off the node. A card is deliberately
 * draggable, so Figma will reparent it into any frame it is dropped on, after
 * which its `x`/`y` mean something else entirely — the same trap
 * `updateCardFromDrag` documents for the offset it computes.
 */
export function placementFingerprint(placement: Placement): string {
  return [placement.x, placement.y, placement.width].map(Math.round).join(',')
}

/**
 * Whether a card is still exactly where this plugin last put it.
 *
 * `remembered` is empty for a card placed before any of this was recorded.
 * That answers `false` — treated as a person's move — which is the safe way
 * round: a card sitting where its record says it should be produces no
 * change to write, so the first sync after this simply re-reads what was
 * already true and fingerprints it.
 *
 * The empty check is explicit even though the comparison below would answer
 * `false` anyway, since a fingerprint is never the empty string. No test can
 * tell the two apart, so the reason is written here instead: an unrecorded
 * card is a case with its own meaning, not a string that happens not to
 * match.
 */
export function placedByUs(remembered: string, current: Placement): boolean {
  return remembered !== '' && remembered === placementFingerprint(current)
}
