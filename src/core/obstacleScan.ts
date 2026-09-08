/**
 * Reading one page scan against the one before it.
 *
 * The scene layer is what walks the page and measures boxes; what counts as
 * *different* between two of those walks is a decision, and decisions belong
 * here where they can be tested without a document to walk.
 */

import type { Rect } from './anchor.js'
import { sameRect } from './anchor.js'

/**
 * Every rectangle that has to be re-examined because one scan differs from
 * the one before it: boxes that moved or resized (both the space they left
 * and the space they took), boxes that appeared, and boxes that are no
 * longer there.
 *
 * All three cases are the same question asked of the route — is anything
 * different where this line passes — and only the first of them is a *move*.
 * A screen can stop being in the way by being deleted, by being hidden, or
 * by being dragged out of the page entirely, and none of those change a
 * rectangle: the box simply stops being in the list. Reading the difference
 * between two scans catches every one of them without the caller having to
 * know which happened, or a `nodechange` having to describe it.
 *
 * `before` is the older of the two. A deletion is only visible from that
 * side — the node is already gone by the time the change arrives, so `now`
 * has nothing to report and a `RemovedNode` carries no bounding box to ask.
 */
export function boxesChangedBetweenScans(
  before: ReadonlyMap<string, Rect>,
  now: ReadonlyMap<string, Rect>
): ReadonlyArray<Rect> {
  const changed: Array<Rect> = []
  for (const [id, rect] of now) {
    const was = before.get(id)
    if (typeof was === 'undefined') {
      changed.push(rect)
      continue
    }
    // Both rectangles: a move invalidates the lines it has just left alone
    // as well as the ones it has just landed on.
    if (!sameRect(was, rect)) changed.push(was, rect)
  }
  for (const [id, rect] of before) {
    if (!now.has(id)) changed.push(rect)
  }
  return changed
}
