/**
 * Shared by Annotate and Connect — both route around the enclosing frame a
 * node sits inside, and both put their rendered nodes back on the page.
 *
 * The rules themselves live in `core/nodeTree.ts`, which walks `parent` links
 * and never touches the `figma` global. What is left here is the part that
 * genuinely needs a document: the page to append to, and the mutation itself.
 */

import { enclosingFrameOf, needsRaising } from '../core/nodeTree.js'

/**
 * Puts a rendered node back on the page, and does nothing when it is already
 * there.
 *
 * Every sync brings its nodes back to the page, because a person can drag one
 * onto a frame and Figma reparents it into that frame — after which the
 * node's `x`/`y` mean something else and every position written would land
 * somewhere wrong. Almost always, though, the node never left.
 *
 * Appending unconditionally is not free even then: appending a node to the
 * parent it is already in moves it to the front of the layer order. On a
 * reconcile that is three reorders per note and two per line, which shows up
 * as the layers panel scrolling under the reader while the plugin opens, and
 * costs Figma real work to apply.
 */
export function ensureOnPage(node: SceneNode): void {
  if (node.parent === figma.currentPage) return
  figma.currentPage.appendChild(node)
}

/**
 * Makes sure `node` draws over `under`, without touching the layer order when
 * it already does. `needsRaising` holds the rule and the reasons.
 */
export function raiseAbove(node: SceneNode, under: SceneNode | null): void {
  if (!needsRaising(node, under)) return
  // Not null, and in the same parent as `node`: `needsRaising` said so.
  node.parent?.appendChild(node)
}

/**
 * The outermost frame `node` sits inside, as a real `FrameNode` so its box can
 * be read. `enclosingFrameOf` holds the rule.
 *
 * The cast is this layer's to make: the walk deals in the structural node
 * `core` can be tested against, and only a caller holding a real document
 * knows that a node reporting `type === 'FRAME'` is a `FrameNode`.
 */
export function findEnclosingFrame(node: SceneNode): FrameNode | null {
  const frame = enclosingFrameOf(node)
  return frame === null ? null : (frame as FrameNode)
}
