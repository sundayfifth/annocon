/**
 * What a batch of `nodechange` events is asking the plugin to do.
 *
 * This is the filter every live update runs through, and it is the first and
 * largest of the three things that tell this plugin's own writes from a
 * person's. A change to our own `pluginData`, or to a node's `parent`, never
 * gets past `positional` below, so those echoes stop here and no other
 * mechanism has to think about them. `core/authorship.ts` handles the two
 * writes that reach this filter looking exactly like an edit, and
 * `scene/removals.ts` handles deletions, which have no content left to judge.
 *
 * A timing-based flag used to sit in front of all of this, dropping any batch
 * that arrived while a write was in flight. `unchangedSinceOurWrite` is what
 * replaced it — the same job, asked of the node's content rather than of a
 * clock.
 *
 * Structural change type, like `TreeNode` and `OwnedNode` elsewhere in core:
 * the scene layer reads Figma's `NodeChangeEvent` and hands the parts of it
 * that matter through.
 */

/** The roles Annotate gives its rendered nodes, plus `null` for anything else. */
export type ObservedRole = 'badge' | 'card' | 'leader' | null

/** One `nodechange`, reduced to what the filter reads. */
export interface ObservedChange {
  readonly type: 'CREATE' | 'DELETE' | 'PROPERTY_CHANGE'
  readonly nodeId: string
  /** Figma's `NodeChangeProperty` names. Empty for a create or delete. */
  readonly properties: ReadonlyArray<string>
  /** Figma's `NodeType`. */
  readonly nodeType: string
  /**
   * Whether the node still has a box to read.
   *
   * A node deleted in the same batch comes back as a `RemovedNode` with
   * nothing on it, and reading anything off one throws.
   */
  readonly hasBox: boolean
  /** What this node is to Annotate, from its own pluginData. */
  readonly role: ObservedRole
  /** The layer this node is a rendered part of, or `null` when it is not one of ours. */
  readonly ownerId: string | null
  /**
   * Whether this node still holds exactly what this plugin last wrote to it.
   *
   * The scene layer answers it by comparing content — a card against the
   * placement it was given, a connector against the shape it was drawn as, a
   * card's text against the words in its record. `false` for anything not
   * rendered by this plugin, which is most of a page.
   *
   * This is the whole of what the removed suppress flag used to do, done
   * without a clock: a write of ours must not merely be ignored downstream,
   * it must not wake a pass at all. The three properties that reach this
   * filter looking exactly like a person's edit — a card's position, a card's
   * words, a connector's vertices — are also the three the plugin writes on
   * every sync, so a pass that acts on them lays out again, writes again, and
   * wakes itself.
   */
  readonly unchangedSinceOurWrite: boolean
}

/**
 * The properties worth re-routing for.
 *
 * Deliberately not every property Figma reports. `pluginData` is the one this
 * plugin writes constantly and must never chase; `parent` changes every time
 * a rendered node is put back on the page. Neither appears here, so neither
 * reaches anything below.
 */
const POSITIONAL: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'relativeTransform',
  'rotation',
  'visible',
  // Reshaping a connector need not change its box at all — pull a bend
  // inwards and the two ends still define the same rectangle with the same
  // number of vertices. Without this, that edit is filtered out here and then
  // quietly redrawn over on the next sync. (`vectorPaths` is not a property
  // Figma reports a change on; `vectorNetwork` is the one.)
  'vectorNetwork'
])

/** What one change turns into. A change can be more than one of these at once. */
export interface ChangeEffects {
  /** The node is gone, and whatever referred to it has to be repaired. */
  readonly deleted: boolean
  /** Something a connector or a note is anchored to has moved. */
  readonly movedTarget: boolean
  /** A note card was moved by hand, so its owner's stored offset has to catch up. */
  readonly draggedCardOwnerId: string | null
  /** Somebody typed into a card or a label pill on the canvas. */
  readonly editedText: boolean
}

const NOTHING: ChangeEffects = {
  deleted: false,
  movedTarget: false,
  draggedCardOwnerId: null,
  editedText: false
}

/**
 * What one `nodechange` means, or nothing at all.
 *
 * A text edit is decided separately from everything else, and not instead of
 * it: `characters` is not a position, and what has to happen next — read the
 * words back into the record — is not a re-render. One change can be both,
 * and a batch that moves a card while its text changes is exactly that.
 *
 * A badge or a leader that moved is ignored outright. Those are locked and
 * repositioned only by this plugin's own sync, so reacting to them would be
 * chasing our own writes — attributed by asking what the node *is*, which
 * needs no clock.
 */
export function classifyChange(change: ObservedChange): ChangeEffects {
  if (change.type === 'DELETE') return { ...NOTHING, deleted: true }
  if (change.type !== 'PROPERTY_CHANGE') return NOTHING
  // Our own write coming back. Checked before anything else a property could
  // mean, because every meaning below would be acting on what we just did.
  if (change.unchangedSinceOurWrite) return NOTHING

  const editedText =
    change.properties.includes('characters') && change.nodeType === 'TEXT' && change.hasBox

  if (!change.properties.some((property) => POSITIONAL.has(property))) {
    return { ...NOTHING, editedText }
  }
  if (!change.hasBox) return { ...NOTHING, editedText }

  if (change.role === 'card') {
    return { ...NOTHING, editedText, draggedCardOwnerId: change.ownerId }
  }
  if (change.role === 'badge' || change.role === 'leader') {
    return { ...NOTHING, editedText }
  }
  return { ...NOTHING, editedText, movedTarget: true }
}

/** Everything a batch of changes adds up to. */
export interface BatchEffects {
  readonly deletedIds: ReadonlySet<string>
  readonly movedTargetIds: ReadonlySet<string>
  readonly draggedCardOwnerIds: ReadonlySet<string>
  readonly editedTextNodeIds: ReadonlyArray<string>
}

/** Whether a batch asks for any work at all — most do not, so most cost nothing after this. */
export function isEmptyBatch(effects: BatchEffects): boolean {
  return (
    effects.deletedIds.size === 0 &&
    effects.movedTargetIds.size === 0 &&
    effects.draggedCardOwnerIds.size === 0 &&
    effects.editedTextNodeIds.length === 0
  )
}

export function classifyBatch(changes: ReadonlyArray<ObservedChange>): BatchEffects {
  const deletedIds = new Set<string>()
  const movedTargetIds = new Set<string>()
  const draggedCardOwnerIds = new Set<string>()
  const editedTextNodeIds: Array<string> = []
  for (const change of changes) {
    const effects = classifyChange(change)
    if (effects.deleted) deletedIds.add(change.nodeId)
    if (effects.movedTarget) movedTargetIds.add(change.nodeId)
    if (effects.draggedCardOwnerId !== null) draggedCardOwnerIds.add(effects.draggedCardOwnerId)
    if (effects.editedText) editedTextNodeIds.push(change.nodeId)
  }
  return { deletedIds, movedTargetIds, draggedCardOwnerIds, editedTextNodeIds }
}
