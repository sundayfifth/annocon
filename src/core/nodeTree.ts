/**
 * Questions about where a node sits in the layer tree, answered by walking
 * `parent` links and nothing else.
 *
 * Both features ask them: an annotation needs the screen its target belongs to
 * so the card can sit outside it, a connector needs it so the route can clear
 * it, and both need to know whether a rendered node already draws over another
 * before touching the layer order.
 *
 * The node types here are structural rather than Figma's own `SceneNode`, for
 * the same reason `Rect` mirrors `absoluteBoundingBox` and `ConnectorCap`
 * mirrors `StrokeCap`: this layer never assumes the `figma` global exists, and
 * a plain object tree is then all a test needs to stand in for a document.
 * Each interface asks for the least it can, so a caller — and a test — only
 * has to supply the fields the rule actually reads.
 */

/** A node placed somewhere in a tree of parents. `type` is Figma's `NodeType` string, e.g. `'FRAME'`. */
export interface TreeNode {
  readonly id: string
  readonly type: string
  readonly parent: TreeNode | null
}

/**
 * The outermost `FRAME` an node sits inside — the "screen" it belongs to, as
 * opposed to a group, section, or component nested deeper inside one.
 * `null` when the node is a top-level page child itself, or isn't inside a
 * frame at all.
 *
 * Outermost rather than nearest because the question being asked is which
 * screen this is part of, and a screen is the frame someone laid out on the
 * canvas, not the frame that happens to be closest up the chain — a button
 * inside a row inside a card inside a screen belongs to the screen.
 */
export function enclosingFrameOf(node: TreeNode): TreeNode | null {
  let current: TreeNode | null = node.parent
  let outermost: TreeNode | null = null
  while (current !== null && current.type !== 'PAGE') {
    if (current.type === 'FRAME') outermost = current
    current = current.parent
  }
  return outermost
}

/**
 * `GROUP`s and `SECTION`s are stepped over rather than reported, matching
 * `collectRouteObstacles`, which looks inside them for the screens instead of
 * treating the container as one box. Both are ways of handling several things
 * at once, not things in their own right — people put a flow in a section and
 * still mean the screens.
 */
const STEPPED_OVER: ReadonlySet<string> = new Set(['GROUP', 'SECTION'])

/**
 * The box `node` belongs to as far as routing is concerned — `node` itself
 * when it is already one.
 *
 * Broader than `enclosingFrameOf` on purpose: that one deliberately only
 * counts `FRAME`s, because a "screen" is what a connector routes *around*.
 * This answers a different question — which box *is* this node part of — so it
 * follows components too, and reports the node itself when nothing encloses
 * it.
 *
 * Reporting a stepped-over container here would name something that is never
 * collected as an obstacle, so a connector's own screen would come back as a
 * foreign box for it to avoid.
 */
export function topLevelAncestorIdOf(node: TreeNode): string {
  let current: TreeNode = node
  let outermost: TreeNode = node
  while (current.parent !== null && current.parent.type !== 'PAGE' && current.parent.type !== 'DOCUMENT') {
    current = current.parent
    if (!STEPPED_OVER.has(current.type)) outermost = current
  }
  return outermost.id
}

/** A node with siblings, whose order among them decides what draws over what. */
export interface StackedNode {
  readonly removed: boolean
  readonly parent: { readonly children: ReadonlyArray<StackedNode> } | null
}

/**
 * Whether `node` has to be moved in the layer order to draw over `under`.
 *
 * Re-appending is the usual way to raise a node and it works, but it fires
 * whether or not the order was wrong, and on a reconcile that is a reorder per
 * rendered node — which shows up as the layers panel scrolling under the
 * reader while the plugin opens, and costs Figma real work to apply. Asking
 * first costs nothing and keeps the layer tree still.
 *
 * `false` for every case where raising would be meaningless rather than
 * merely unnecessary: nothing to sit over, either node already deleted, or the
 * two in different parents — where the layer order does not decide which
 * draws over the other, so re-appending would move the node without
 * fixing anything.
 *
 * The different-parent check is deliberately explicit even though the
 * comparison below would answer `false` anyway: `indexOf` reports `-1` for a
 * node that is not among these children, and nothing is ever below `-1`. That
 * agreement is a coincidence of how `indexOf` reports a miss, not the rule —
 * no test can tell the two apart, which is why the reason is written here.
 */
export function needsRaising(node: StackedNode, under: StackedNode | null): boolean {
  if (under === null || under.removed || node.removed) return false
  const parent = node.parent
  if (parent === null || parent !== under.parent) return false
  return parent.children.indexOf(node) < parent.children.indexOf(under)
}
