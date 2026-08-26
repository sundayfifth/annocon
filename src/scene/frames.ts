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
