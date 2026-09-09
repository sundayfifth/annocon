/**
 * Remembering which nodes this plugin deleted, so their `nodechange` DELETE
 * can be told from a person deleting one.
 *
 * A DELETE is the one change the property filter (`core/nodeChanges.ts`)
 * cannot judge on content: the node is gone, and Figma hands back only an id.
 * So the content-based answer here is the id itself — we recorded it on the
 * way out.
 *
 * Correctness does not hang on this. Every path that repairs a stranded
 * rendered node looks its owner up in the `Ownership` cache, and that entry
 * is dropped as the node is removed, so a DELETE we caused already finds
 * nothing to repair. What this saves is the work: an unrecognised DELETE
 * wakes a full resync pass, which scans the page.
 *
 * Read once and forgotten, because exactly one DELETE arrives per removal.
 * An id whose event never comes — the plugin closed first — is a string left
 * in a session-lived map, and reconciliation on open starts from an empty one.
 */

const removedByUs = new Set<string>()

/**
 * Deletes a node and records that we were the ones who did it. Does nothing
 * to a node already gone, so a caller need not check first.
 */
export function removeNode(node: BaseNode | null): boolean {
  if (node === null || node.removed) return false
  const { id } = node
  node.remove()
  removedByUs.add(id)
  return true
}

/**
 * Whether this plugin deleted `nodeId`, consuming the answer.
 *
 * Consuming, because an id that is asked about twice is a second DELETE for
 * the same node — which Figma does not send, and which would mean the id had
 * been reused by something we did not delete.
 */
export function takeRemovedByUs(nodeId: string): boolean {
  return removedByUs.delete(nodeId)
}
