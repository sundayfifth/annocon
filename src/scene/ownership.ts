/**
 * Shared by Annotate and Connect — one implementation of "a rendered node
 * tagged with the id of the thing it belongs to".
 *
 * Both features render nodes that are not the thing they describe: a note's
 * badge, card and leader belong to the annotated layer, a connector's label
 * pill belongs to the line. Both answer the same set of questions about that
 * relationship, and both used to answer them with their own copy of the code
 * — down to the same `typeof list === 'undefined' ? set([node]) : push`.
 *
 * The copies had already drifted. Removing a duplicate label pill did not
 * clear the connector's owner cache and did not check `removed` first, while
 * the annotation side did both; the connector side knew to clear the cache in
 * two other places, so it was not a decision, just a path someone missed.
 * That is what keeps happening while there are two of these.
 *
 * `ownership(key)` is one index per pluginData key, so the two features stay
 * separate data with shared behaviour. `Meta` is whatever else that feature
 * needs remembered per node — Annotate keeps a role there, Connect keeps
 * nothing.
 *
 * The judgements about a list of nodes live in `core/ownerIndex.ts`, where
 * they can be tested; what is here is the page scans, the deletions, and the
 * session cache, none of which can be.
 */

import { groupByOwner, ownerIdOf as ownerIdIn, resolveOwnersBehind } from '../core/ownerIndex.js'

export interface Ownership<Meta> {
  /**
   * Writes the owner into the node's pluginData and remembers it for this
   * session. Both, because pluginData is the durable answer and the cache is
   * the only one still available after the node is deleted.
   */
  tag(node: SceneNode, ownerId: string, meta: Meta): void
  /** The owner from the node itself — `null` when it is not one of ours. */
  ownerIdOf(node: SceneNode): string | null
  /**
   * The owner a now-deleted node used to belong to.
   *
   * A deleted node's pluginData is gone by the time `nodechange` reports the
   * DELETE — Figma hands back a `RemovedNode` (id/type/removed) and nothing
   * queryable. Without the cache, deleting a card, a leader or a label pill
   * by hand leaves the record that produced it with nothing able to trace
   * back to who owned it: the note's other nodes dangle, and a deleted label
   * is recreated by the next sync because `record.label` was never cleared.
   *
   * `null` when `nodeId` was never ours, or simply is not remembered — a
   * fresh plugin session that has not touched this node yet. Session-only on
   * purpose: reconciliation on open rebuilds all of it from the page anyway.
   */
  lastKnownOwnerOf(nodeId: string): string | null
  /** What was remembered alongside the owner — see `lastKnownOwnerOf` for when this is `null`. */
  lastKnownMetaOf(nodeId: string): Meta | null
  /**
   * Every tagged node on the page, grouped by owner, in one scan.
   *
   * Opening the plugin reconciles the whole page, and asking per owner meant
   * a scan of everything per note — on a file with fifty notes, fifty scans
   * before the panel appeared, which is what "it takes a while to open" was.
   * The same cost turns up mid-drag on the connector side, where a screen
   * dragged past a line re-syncs it.
   */
  collectByOwner(): Map<string, Array<SceneNode>>
  /** The tagged nodes for one owner. Prefer `collectByOwner` when asking about more than one. */
  findFor(ownerId: string): Array<SceneNode>
  /** Deletes a node and forgets it, and does nothing to one already gone. */
  remove(node: BaseNode | null): void
  /**
   * The single node of a set, having deleted every node of an ambiguous one.
   *
   * Older, broken syncs — one that threw partway through, before this plugin
   * healed that class of bug itself — could leave two nodes tagged for the
   * same owner in the same role. There is no reliable way to tell which of
   * them is the good one, and picking a winner risks keeping the broken one
   * and deleting the correct one, so ambiguity clears the slate and the
   * caller draws a fresh one.
   */
  soleNode<T extends SceneNode>(nodes: ReadonlyArray<T>): T | null
  /**
   * The owner behind each node of `nodes`, keyed by that node's own id.
   *
   * Lets selecting a rendered node stand for selecting what it describes:
   * someone who has just dragged a card, or clicked a line's label, is
   * otherwise holding the one thing the panel has nothing to say about.
   *
   * Takes the whole selection and answers it from one pass over
   * `findOwners()`, because Select All on a page of notes would otherwise ask
   * once per card. `findOwners` is a thunk rather than a list so that an
   * ordinary selection — nothing of ours in it — costs no scan at all.
   * Synchronous throughout, which `selectionchange` needs, so the owners are
   * found by scanning rather than by taking each id to `getNodeByIdAsync`.
   */
  ownersBehind<Owner extends SceneNode>(
    nodes: ReadonlyArray<SceneNode>,
    findOwners: () => ReadonlyArray<Owner>
  ): Map<string, Owner>
  /**
   * Deletes every tagged node whose owner is not in `liveOwnerIds`, and
   * answers how many.
   *
   * The sweep for whatever was orphaned without the plugin catching it live:
   * a note's layer deleted while the plugin was closed, or a `nodechange`
   * that never arrived. Runs off the caller's list of what is still alive
   * rather than checking each owner itself, because the caller has just
   * enumerated them anyway.
   */
  removeOrphans(liveOwnerIds: ReadonlySet<string>): number
}

interface Remembered<Meta> {
  readonly ownerId: string
  readonly meta: Meta
}

export function ownership<Meta = undefined>(ownerKey: string): Ownership<Meta> {
  const remembered = new Map<string, Remembered<Meta>>()

  const ownerIdOf = (node: SceneNode): string | null => ownerIdIn(node, ownerKey)

  const taggedOnPage = (): ReadonlyArray<SceneNode> =>
    figma.currentPage.findAllWithCriteria({ pluginData: { keys: [ownerKey] } })

  const remove = (node: BaseNode | null): void => {
    if (node === null || node.removed) return
    node.remove()
    // A no-op for anything that was never tagged — a badge's text child, say,
    // which callers pass through here for the `removed` check alone.
    remembered.delete(node.id)
  }

  return {
    tag(node, ownerId, meta) {
      node.setPluginData(ownerKey, ownerId)
      remembered.set(node.id, { ownerId, meta })
    },
    ownerIdOf,
    lastKnownOwnerOf(nodeId) {
      return remembered.get(nodeId)?.ownerId ?? null
    },
    lastKnownMetaOf(nodeId) {
      const found = remembered.get(nodeId)
      return typeof found === 'undefined' ? null : found.meta
    },
    collectByOwner() {
      return groupByOwner(taggedOnPage(), ownerKey)
    },
    findFor(ownerId) {
      return taggedOnPage().filter((node) => node.getPluginData(ownerKey) === ownerId)
    },
    remove,
    soleNode(nodes) {
      if (nodes.length <= 1) return nodes[0] ?? null
      for (const node of nodes) remove(node)
      return null
    },
    removeOrphans(liveOwnerIds) {
      let removed = 0
      for (const node of taggedOnPage()) {
        const ownerId = ownerIdOf(node)
        if (ownerId === null || liveOwnerIds.has(ownerId)) continue
        // Through `remove`, so the session cache forgets them too. The
        // standalone sweep this replaces did not, which left the index
        // claiming an owner for a node that no longer existed.
        remove(node)
        removed += 1
      }
      return removed
    },
    ownersBehind(nodes, findOwners) {
      return resolveOwnersBehind(nodes, ownerKey, findOwners)
    }
  }
}
