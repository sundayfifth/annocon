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

/** The innermost `SECTION` `node` sits inside, or `null` when it is not in one. */
export function sectionOf(node: SceneNode): SectionNode | null {
  return sectionsAbove(node)[0] ?? null
}

/**
 * Moves `node` into `container` without moving it on screen.
 *
 * Reparenting keeps the node's `x`/`y` numbers while changing what they are
 * measured against, so the node jumps by the difference between the two
 * origins. Rather than assume what that difference is — which would mean
 * betting on how a section measures its children — this reads back where the
 * node actually landed and nudges it by however far it moved. Correct for a
 * page (where the difference is zero) and for a section either way round,
 * without depending on knowing which.
 *
 * Appending is not skipped when the node is already there: re-appending to
 * the same parent is what raises a node to the front of the stacking order,
 * which several callers rely on.
 */
export function reparentInPlace(node: SceneNode, container: SectionNode | PageNode): void {
  // Nothing to do, and doing it anyway is expensive: re-appending a node to
  // the parent it is already in moves it to the front of the stacking order,
  // which reorders the layer tree. On every frame of a drag that churns the
  // layers panel continuously and costs far more than the move it is not
  // making.
  if (node.parent === container) return
  const wasAt = absolutePositionOf(node)
  container.appendChild(node)
  placeAt(node, wasAt)
}

/**
 * Puts a node's own origin at an absolute point, whatever it is parented to.
 *
 * `x`/`y` are measured against the parent, so writing an absolute coordinate
 * into them is only correct while the parent is the page. Rather than
 * convert — which would mean knowing how each kind of parent measures its
 * children — this writes, reads back where the node actually landed, and
 * nudges it by the difference. A no-op's worth of work when the parent is
 * the page, and correct when it is not.
 */
export function placeAt(node: SceneNode, at: { x: number; y: number }): void {
  const now = absolutePositionOf(node)
  node.x += at.x - now.x
  node.y += at.y - now.y
}

/**
 * Where a node's own box sits on the canvas: the absolute twin of its
 * `x`/`y`, and the only measure the two can be compared against.
 *
 * Not `absoluteTransform`, which gives the origin of the node's *coordinate
 * space* — the right answer for reading a vertex, and the wrong one here. On
 * a vector the two differ by however far the geometry sits from the node's
 * box, so mixing them up moves a line by that much every time it is
 * positioned. Which is exactly what it did.
 */
export function absolutePositionOf(node: SceneNode): { x: number; y: number } {
  const box = node.absoluteBoundingBox
  return box === null ? { x: node.x, y: node.y } : { x: box.x, y: box.y }
}

/**
 * The origin of a node's own coordinate space on the canvas — what a vertex
 * inside it is measured from. For positioning, `absolutePositionOf` is the
 * one to use.
 */
export function absoluteOriginOf(node: SceneNode): { x: number; y: number } {
  const transform = node.absoluteTransform
  return { x: transform[0]?.[2] ?? node.x, y: transform[1]?.[2] ?? node.y }
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
