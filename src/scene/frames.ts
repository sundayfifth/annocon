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

/**
 * The innermost `SECTION` that contains both `a` and `b`, or `null` when no
 * one section contains them both.
 *
 * A connector belongs inside the section its two ends live in, so that moving
 * or duplicating the section takes the line with it the way Figma moves
 * anything else inside — rather than leaving it on the page, where it only
 * catches up if the plugin happens to be open to re-route it.
 *
 * Innermost rather than outermost: with sections nested inside sections, the
 * tightest one that still holds both ends is the one the line is really part
 * of.
 */
export function commonSectionOf(a: SceneNode, b: SceneNode): SectionNode | null {
  const enclosing = new Map<string, SectionNode>()
  for (const section of sectionsAbove(a)) enclosing.set(section.id, section)
  if (enclosing.size === 0) return null
  // `b`'s chain is walked innermost first, so the first hit is the deepest
  // section the two have in common.
  for (const section of sectionsAbove(b)) {
    const shared = enclosing.get(section.id)
    if (typeof shared !== 'undefined') return shared
  }
  return null
}

/** Every `SECTION` above `node`, innermost first. */
function sectionsAbove(node: SceneNode): Array<SectionNode> {
  const sections: Array<SectionNode> = []
  let current: BaseNode | null = node.parent
  while (current !== null && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (current.type === 'SECTION') sections.push(current)
    current = current.parent
  }
  return sections
}

export function topLevelAncestorIdOf(node: SceneNode): string {
  let current: BaseNode = node
  let outermost: BaseNode = node
  while (current.parent !== null && current.parent.type !== 'PAGE' && current.parent.type !== 'DOCUMENT') {
    current = current.parent
    if (!STEPPED_OVER.has(current.type)) outermost = current
  }
  return outermost.id
}
