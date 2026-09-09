/**
 * The two decisions behind "which rendered node belongs to which owner",
 * separated from the page scans that feed them.
 *
 * `scene/ownership.ts` is the rest of that index — the scans, the deletions,
 * and the session cache of who owned a node that no longer exists. What is
 * here is the part that is a judgement about a list rather than a request to
 * the document, so it can be tested directly.
 *
 * The node type is structural, like `TreeNode` in `nodeTree.ts`: a real
 * `SceneNode` satisfies it, and this layer stays unable to reach the `figma`
 * global.
 */

/** Anything carrying pluginData and an id — every rendered node, and a fake one in a test. */
export interface OwnedNode {
  readonly id: string
  getPluginData(key: string): string
}

/** The owner written in `ownerKey`, or `null` when the node is not tagged. */
export function ownerIdOf(node: OwnedNode, ownerKey: string): string | null {
  const value = node.getPluginData(ownerKey)
  return value === '' ? null : value
}

/**
 * Groups `nodes` by the owner each names, dropping the untagged.
 *
 * Kept as one pass building lists rather than a map of single nodes, because
 * more than one node per owner is exactly the case that has to be noticed:
 * two badges for the same note means an earlier sync left a duplicate behind,
 * and the caller clears both rather than picking one.
 */
export function groupByOwner<N extends OwnedNode>(
  nodes: ReadonlyArray<N>,
  ownerKey: string
): Map<string, Array<N>> {
  const byOwner = new Map<string, Array<N>>()
  for (const node of nodes) {
    const ownerId = ownerIdOf(node, ownerKey)
    if (ownerId === null) continue
    const list = byOwner.get(ownerId)
    if (typeof list === 'undefined') byOwner.set(ownerId, [node])
    else list.push(node)
  }
  return byOwner
}

/**
 * The owner behind each node of `nodes`, keyed by that node's own id.
 *
 * Two passes rather than a lookup per node: collect what is being asked
 * about, then walk the owners once. A selection of fifty cards would
 * otherwise search the owners fifty times.
 *
 * `findOwners` is a thunk, and the contract is that it is **not called** when
 * nothing in `nodes` is tagged — which is every ordinary selection, and the
 * reason this can run on `selectionchange` without scanning the page each
 * time somebody clicks a layer.
 */
export function resolveOwnersBehind<Owner extends { readonly id: string }>(
  nodes: ReadonlyArray<OwnedNode>,
  ownerKey: string,
  findOwners: () => ReadonlyArray<Owner>
): Map<string, Owner> {
  const wanted = groupByOwner(nodes, ownerKey)
  const resolved = new Map<string, Owner>()
  if (wanted.size === 0) return resolved
  for (const owner of findOwners()) {
    const asking = wanted.get(owner.id)
    if (typeof asking === 'undefined') continue
    for (const node of asking) resolved.set(node.id, owner)
  }
  return resolved
}
