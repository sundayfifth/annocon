/**
 * Shared by Annotate and Connect — both route around the enclosing frame a
 * node sits inside, not just the node's own box.
 */

/**
 * The outermost frame `node` sits inside — the "screen" it belongs to, as
 * opposed to a group, section, or component nested deeper inside one.
 * `null` when the node is a top-level page child itself, or isn't inside a
 * frame at all.
 */
export function findEnclosingFrame(node: SceneNode): FrameNode | null {
  let current: BaseNode | null = node.parent
  let outermost: FrameNode | null = null
  while (current !== null && current.type !== 'PAGE') {
    if (current.type === 'FRAME') outermost = current
    current = current.parent
  }
  return outermost
}

/**
 * The box `node` belongs to as far as routing is concerned — `node` itself
 * when it is already one.
 *
 * Broader than `findEnclosingFrame` on purpose: that one deliberately only
 * counts `FRAME`s, because a "screen" is what a connector routes *around*.
 * This answers a different question — which box *is* this node part of — so
 * it follows sections and components too, or a node inside a top-level
 * section reports itself and gets treated as a foreign obstacle by its own
 * connector.
 *
 * `GROUP`s and `SECTION`s are stepped over rather than reported, matching
 * `collectRouteObstacles`, which looks inside them for the screens instead
 * of treating the container as one box. Both are ways of handling several
 * things at once, not things in their own right — people put a flow in a
 * section and still mean the screens. Reporting the container here would
 * name something that is never collected as an obstacle, so a connector's
 * own screen would come back as a foreign box for it to avoid.
 */
const STEPPED_OVER: ReadonlySet<string> = new Set(['GROUP', 'SECTION'])

export function topLevelAncestorIdOf(node: SceneNode): string {
  let current: BaseNode = node
  let outermost: BaseNode = node
  while (current.parent !== null && current.parent.type !== 'PAGE' && current.parent.type !== 'DOCUMENT') {
    current = current.parent
    if (!STEPPED_OVER.has(current.type)) outermost = current
  }
  return outermost.id
}
