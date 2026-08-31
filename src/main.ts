import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type {
  AddCategoryHandler,
  AddCategoryPayload,
  CategoriesChangedHandler,
  CreateConnectorHandler,
  CreateConnectorPayload,
  DeleteCategoryHandler,
  DeleteCategoryPayload,
  RecolorCategoryHandler,
  RecolorCategoryPayload,
  RenameCategoryHandler,
  RenameCategoryPayload,
  SelectionChangedHandler,
  SelectionSummary,
  SetAnnotationCategoryHandler,
  SetAnnotationCategoryPayload,
  SetAnnotationSizeHandler,
  SetAnnotationSizePayload,
  SetAnnotationTextHandler,
  SetAnnotationTextPayload,
  UpdateConnectorAnchorHandler,
  UpdateConnectorAnchorPayload,
  UpdateConnectorStyleHandler,
  UpdateConnectorStylePayload
} from './messages.js'
import {
  captureCardTextEdit,
  clearAnnotation,
  finalizeLayout,
  findAnnotationTargetsUnder,
  getAnnotationRecord,
  lastKnownOwnerOf,
  lastKnownRoleOf,
  annotationTargetOf,
  ownerIdOf,
  reconcileAllAnnotations,
  removeRenderedNodesForOwner,
  roleOf,
  setAnnotationCategory,
  setAnnotationSize,
  setAnnotationText,
  syncAnnotation,
  updateCardFromDrag
} from './scene/annotationScene.js'
import {
  addCategory,
  deleteCategory,
  ensureDefaultCategories,
  getCategories,
  recolorCategory,
  renameCategory
} from './scene/categoryScene.js'
import {
  boxesChangedInLastScan,
  collectConnectorLabels,
  captureLabelTextEdit,
  collectRouteObstacles,
  connectorBehindLabel,
  createConnector,
  findAllConnectorsOnPage,
  findConnectorBetween,
  findConnectorsInvolving,
  findConnectorsNearBoxes,
  findConnectorsWithEndpointUnder,
  getConnectorRecord,
  lastKnownLabelOwnerOf,
  reconcileAllConnectors,
  removeConnectorLabel,
  syncConnector,
  updateConnectorAnchorSide,
  updateConnectorStyle
} from './scene/connectorScene.js'
import { CHUNK_SIZE, yieldToMainThread } from './scene/chunking.js'
import { isSuppressed } from './scene/pluginData.js'

// `figma.currentPage.selection` is not in click order — Figma returns it in
// layer/z-order regardless of which node was selected first. To let a
// connector's direction follow "the order I selected things", this tracks
// selection incrementally: newly-selected ids are appended to the end,
// deselected ones are dropped, so the array's order reflects click order for
// the common one-at-a-time case (simultaneous multi-select, e.g. a
// rubber-band drag, is best-effort — there's no ordering to recover there).
let selectionOrder: Array<string> = []

function trackSelectionOrder(): void {
  const currentIds = figma.currentPage.selection.map((node) => node.id)
  const currentSet = new Set(currentIds)
  selectionOrder = selectionOrder.filter((id) => currentSet.has(id))
  const trackedSet = new Set(selectionOrder)
  for (const id of currentIds) {
    if (!trackedSet.has(id)) selectionOrder.push(id)
  }
}

/**
 * The property changes worth re-rendering for. Position and size because
 * that is what an anchor is derived from — and `visible`, because a hidden
 * node stops being an obstacle (`collectRouteObstacles`), so toggling the
 * eye on a screen parked between two connected screens has to re-route the
 * lines passing it in both directions.
 */
const POSITIONAL_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'relativeTransform',
  'rotation',
  'visible'
]

function summariseSelection(): Array<SelectionSummary> {
  trackSelectionOrder()
  const nodesById = new Map(figma.currentPage.selection.map((node) => [node.id, node]))
  const orderedNodes = selectionOrder
    .map((id) => nodesById.get(id))
    .filter((node): node is SceneNode => typeof node !== 'undefined')
    // A selected card, leader or label pill stands for the thing it belongs
    // to — see `annotationTargetOf` / `connectorBehindLabel`.
    .map((node) => annotationTargetOf(node) ?? connectorBehindLabel(node) ?? node)
  // Selecting a layer together with its own card resolves to that layer
  // twice, and two entries is what Connect reads as "two things to join" —
  // it would offer to string a connector between a layer and itself.
  const seen = new Set<string>()
  const uniqueNodes = orderedNodes.filter((node) => {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    return true
  })

  return uniqueNodes.map((node) => {
    const record = getAnnotationRecord(node)
    const connectorRecord = getConnectorRecord(node)
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      // Groups, sections and boolean operations have no `annotations`
      // property, so the native dual-write has to be skipped for them.
      supportsNativeAnnotation: 'annotations' in node,
      annotationText: record?.text ?? null,
      annotationSize: record?.size ?? null,
      categoryId: record?.categoryId ?? null,
      connectorStyle:
        connectorRecord === null
          ? null
          : {
              color: connectorRecord.color,
              opacity: connectorRecord.opacity,
              strokeWeight: connectorRecord.strokeWeight,
              startCap: connectorRecord.startCap,
              endCap: connectorRecord.endCap,
              lineStyle: connectorRecord.lineStyle,
              cornerRadius: connectorRecord.cornerRadius,
              detour: connectorRecord.detour,
              startMagnet: connectorRecord.start.kind === 'magnet' ? connectorRecord.start.magnet : 'AUTO',
              endMagnet: connectorRecord.end.kind === 'magnet' ? connectorRecord.end.magnet : 'AUTO',
              label: connectorRecord.label
            }
    }
  })
}

interface ReconcileResult {
  readonly annotationsSynced: number
  readonly orphansRemoved: number
  readonly connectorsSynced: number
}

async function reconcileEverything(): Promise<ReconcileResult> {
  const [annotations, connectors] = await Promise.all([
    reconcileAllAnnotations(),
    reconcileAllConnectors()
  ])
  return {
    annotationsSynced: annotations.synced,
    orphansRemoved: annotations.orphansRemoved,
    connectorsSynced: connectors.synced
  }
}

async function handleSetAnnotationText({ targetId, text }: SetAnnotationTextPayload): Promise<void> {
  const node = await figma.getNodeByIdAsync(targetId)
  if (node === null || !('absoluteBoundingBox' in node)) return
  await setAnnotationText(node, text)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

async function handleSetAnnotationSize({ targetId, size }: SetAnnotationSizePayload): Promise<void> {
  const node = await figma.getNodeByIdAsync(targetId)
  if (node === null || !('absoluteBoundingBox' in node)) return
  await setAnnotationSize(node, size)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

function broadcastCategories(): void {
  emit<CategoriesChangedHandler>('CATEGORIES_CHANGED', getCategories())
}

async function handleSetAnnotationCategory({
  targetId,
  categoryId
}: SetAnnotationCategoryPayload): Promise<void> {
  const node = await figma.getNodeByIdAsync(targetId)
  if (node === null || !('absoluteBoundingBox' in node)) return
  await setAnnotationCategory(node, categoryId)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

function handleAddCategory({ name, color }: AddCategoryPayload): void {
  if (name.trim() === '') return
  addCategory(name, color)
  broadcastCategories()
}

async function handleRenameCategory({ id, name }: RenameCategoryPayload): Promise<void> {
  renameCategory(id, name)
  broadcastCategories()
  // Every card pill showing this category's old name needs to catch up —
  // same reasoning as the delete handler below: cheaper to re-sync
  // everything than to hunt down which annotations reference this category.
  await reconcileEverything()
}

async function handleRecolorCategory({ id, color }: RecolorCategoryPayload): Promise<void> {
  recolorCategory(id, color)
  broadcastCategories()
  // Same reasoning as rename — every badge/pill/leader using this
  // category's old colour needs to re-render with the new one.
  await reconcileEverything()
}

async function handleDeleteCategory({ id }: DeleteCategoryPayload): Promise<void> {
  deleteCategory(id)
  broadcastCategories()
  // Badges/pills using this category need to fall back to "no category"
  // visually — cheapest way to guarantee that is a full re-sync rather than
  // hunting down which annotations referenced it.
  await reconcileEverything()
}

async function handleCreateConnector({ startId, endId }: CreateConnectorPayload): Promise<void> {
  const [start, end] = await Promise.all([
    figma.getNodeByIdAsync(startId),
    figma.getNodeByIdAsync(endId)
  ])
  if (start === null || end === null) return
  if (!('absoluteBoundingBox' in start) || !('absoluteBoundingBox' in end)) return

  // Selecting the same pair again (auto-connect fires on every 2-selection,
  // not just the first) reselects the connector that's already there
  // instead of stacking a duplicate line on top of it.
  const existing = findConnectorBetween(startId, endId)
  const node = existing ?? (await createConnector(start, end))
  if (existing === null) figma.notify('Connector created.')

  // Jump straight to its style panel — the point of auto-connecting is one
  // fewer step, not one fewer step *and* still having to go find it. But
  // only when the user is still looking at the same pair that triggered
  // this: this whole handler is fire-and-forget from the UI, so someone
  // can click a third layer while the connector is still being created —
  // snapping selection back to it at that point would yank focus away
  // from whatever they've already moved on to.
  const currentIds = new Set(figma.currentPage.selection.map((selected) => selected.id))
  const stillOnTriggeringPair = currentIds.size === 2 && currentIds.has(startId) && currentIds.has(endId)
  if (stillOnTriggeringPair) {
    figma.currentPage.selection = [node]
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  }
}

async function handleUpdateConnectorStyle({
  targetId,
  ...changes
}: UpdateConnectorStylePayload): Promise<void> {
  const node = await figma.getNodeByIdAsync(targetId)
  if (node === null || node.type !== 'VECTOR') return
  await updateConnectorStyle(node, changes)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

async function handleUpdateConnectorAnchor({
  targetId,
  side,
  magnet
}: UpdateConnectorAnchorPayload): Promise<void> {
  const node = await figma.getNodeByIdAsync(targetId)
  if (node === null || node.type !== 'VECTOR') return
  await updateConnectorAnchorSide(node, side, magnet)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

/** Fire-and-forget async work: log instead of letting a rejection vanish silently. */
function fireAndForget(promise: Promise<unknown>): void {
  promise.catch((error: unknown) => {
    console.error(error)
  })
}

interface TouchedNodes {
  readonly deletedIds: ReadonlySet<string>
  readonly movedTargetIds: ReadonlySet<string>
  readonly draggedCardOwnerIds: ReadonlySet<string>
  /** Text nodes someone typed into on the canvas — a card's own text, or a connector label's. */
  readonly editedTextNodes: ReadonlyArray<TextNode>
}

/**
 * Re-renders annotations and connectors whose endpoint moved, captures a
 * manual card drag as the record's new offset, and cleans up rendered nodes
 * whose target vanished (or marks a connector broken, for the same reason).
 * Ignores everything while our own pluginData writes are in flight — see
 * `withSuppressedNodeChange`.
 */
function handleNodeChange(event: NodeChangeEvent): void {
  if (isSuppressed()) return
  const deletedIds = new Set<string>()
  const movedTargetIds = new Set<string>()
  const draggedCardOwnerIds = new Set<string>()
  const editedTextNodes: Array<TextNode> = []

  for (const change of event.nodeChanges) {
    if (change.type === 'DELETE') {
      deletedIds.add(change.node.id)
      continue
    }
    if (change.type !== 'PROPERTY_CHANGE') continue
    // Someone typed into a card or a label pill on the canvas. Collected
    // before the positional filter below, since `characters` is not a
    // position — and separately from it, because what has to happen next is
    // to read the words back into the record rather than to re-render.
    // `absoluteBoundingBox` narrows a RemovedNode out — a node deleted in
    // this same batch has nothing left to read.
    if (
      change.properties.includes('characters') &&
      change.node.type === 'TEXT' &&
      'absoluteBoundingBox' in change.node
    ) {
      editedTextNodes.push(change.node)
    }
    if (!change.properties.some((property) => POSITIONAL_PROPERTIES.includes(property))) continue
    // A RemovedNode never carries this property; narrows change.node to SceneNode.
    if (!('absoluteBoundingBox' in change.node)) continue

    const role = roleOf(change.node)
    if (role === 'card') {
      const ownerId = ownerIdOf(change.node)
      if (ownerId !== null) draggedCardOwnerIds.add(ownerId)
      continue
    }
    // Badge/leader are locked and repositioned only by our own sync code —
    // reacting to their moves here would just chase our own writes.
    if (role === 'badge' || role === 'leader') continue
    movedTargetIds.add(change.node.id)
  }

  if (
    deletedIds.size === 0 &&
    movedTargetIds.size === 0 &&
    draggedCardOwnerIds.size === 0 &&
    editedTextNodes.length === 0
  ) {
    return
  }
  fireAndForget(resyncTouched({ deletedIds, movedTargetIds, draggedCardOwnerIds, editedTextNodes }))
}

async function resyncTouched({
  deletedIds,
  movedTargetIds,
  draggedCardOwnerIds,
  editedTextNodes
}: TouchedNodes): Promise<void> {
  let touched = false
  // One shared counter across all three loops below — a single nodechange
  // event covering a large multi-select move or delete must still yield
  // periodically, or it can stall the main thread long enough that a
  // person can't even click Cancel (see the project's "chunk long work"
  // rule; every other loop over a whole batch already follows it).
  let processed = 0
  const maybeYield = async (): Promise<void> => {
    processed += 1
    if (processed % CHUNK_SIZE === 0) await yieldToMainThread()
  }
  // Scanned once up front instead of once per touched id inside the loops
  // below (`findConnectorsInvolving`/`findConnectorsWithEndpointUnder`
  // otherwise each re-scan the whole page) — nothing in this function
  // creates or deletes a connector node, so one snapshot stays valid for
  // every id in this batch.
  const allConnectors =
    deletedIds.size > 0 || movedTargetIds.size > 0 ? findAllConnectorsOnPage() : []
  // Same one-scan-per-batch reasoning as `allConnectors` above: every
  // connector in this batch routes around the same set of top-level boxes,
  // and this runs on every frame of a drag, so scanning the page once per
  // connector would be the most expensive thing in the loop. Re-read per
  // batch rather than cached across them, because the node being dragged is
  // itself one of the boxes everything else has to avoid.
  const obstacles = allConnectors.length > 0 ? collectRouteObstacles() : []
  // Scanned once per batch for the same reason as `allConnectors` above:
  // every connector synced below asks whether it has a label, and asking
  // used to be a full-page scan each time.
  const labels = allConnectors.length > 0 ? collectConnectorLabels() : undefined
  // A connector can be reached by more than one of the routes through this
  // function — its endpoint moved *and* it passes near a box that also moved,
  // say, or both its ends were in the same multi-select drag. Re-rendering it
  // twice in one batch draws the identical vector network the second time, so
  // this keeps the extra `setVectorNetworkAsync` out of the drag loop.
  const syncedConnectorIds = new Set<string>()
  const syncConnectorOnce = async (connector: VectorNode): Promise<void> => {
    if (syncedConnectorIds.has(connector.id)) return
    syncedConnectorIds.add(connector.id)
    await syncConnector(connector, obstacles, labels)
  }

  for (const id of deletedIds) {
    removeRenderedNodesForOwner(id)
    // A cheap no-op if `id` wasn't itself a connector's own id — only
    // meaningful when the connector node just got deleted directly, since
    // its label is a separate top-level node that would otherwise be left
    // stranded, orphaned but not swept up until the next full reconcile.
    removeConnectorLabel(id)
    // Cards and leaders are real, selectable, unlocked-or-not nodes — a
    // person can click one directly and hit Delete without touching the
    // target at all. `id` won't match anything as an owner in that case
    // (nothing has `annotationOwner === id`), so `lastKnownOwnerOf` is how
    // this traces back to the target that just lost half its annotation.
    // What happens next depends on *which* piece was deleted: losing the
    // leader alone re-syncs to redraw it (it's derived, not a deliberate
    // choice — deleting a locked dashed line by hand is vanishingly rare
    // and not worth treating as intent). Losing the card is the substance
    // of the annotation, though — a person deleting a visible note card is
    // deleting the note, not asking for it to reappear on next reconcile,
    // so that clears the record too instead of resurrecting it.
    const strandedOwnerId = lastKnownOwnerOf(id)
    if (strandedOwnerId !== null) {
      const strandedRole = lastKnownRoleOf(id)
      const owner = await figma.getNodeByIdAsync(strandedOwnerId)
      if (owner !== null && 'absoluteBoundingBox' in owner && getAnnotationRecord(owner) !== null) {
        if (strandedRole === 'card') {
          clearAnnotation(owner)
        } else {
          await syncAnnotation(owner)
        }
      }
    }
    // Same idea as the card/leader handling above, for a connector's label
    // pill — a real, selectable, unlocked node someone can delete directly
    // without touching the connector line itself. Left unhandled, nothing
    // clears `record.label`, so the next sync (any later nodechange, or the
    // next reconcile) just recreates the very pill that was just deleted.
    const strandedLabelOwnerId = lastKnownLabelOwnerOf(id)
    if (strandedLabelOwnerId !== null) {
      const connector = await figma.getNodeByIdAsync(strandedLabelOwnerId)
      if (connector !== null && connector.type === 'VECTOR' && getConnectorRecord(connector) !== null) {
        await updateConnectorStyle(connector, { label: '' })
      }
    }
    for (const connector of findConnectorsInvolving(id, allConnectors)) {
      await syncConnectorOnce(connector)
    }
    touched = true
    await maybeYield()
  }

  for (const id of movedTargetIds) {
    const node = await figma.getNodeByIdAsync(id)
    if (node !== null && 'absoluteBoundingBox' in node && getAnnotationRecord(node) !== null) {
      await syncAnnotation(node)
      touched = true
    }
    for (const connector of findConnectorsInvolving(id, allConnectors)) {
      await syncConnectorOnce(connector)
      touched = true
    }

    // The moved node's own x/y changing doesn't mean any of its children's
    // x/y changed too — only their *absolute* position moved. Anything
    // anchored to a descendant needs the same re-sync the descendant itself
    // would have gotten had it moved directly.
    if (node !== null && 'absoluteBoundingBox' in node && 'children' in node) {
      for (const descendantTarget of findAnnotationTargetsUnder(node)) {
        await syncAnnotation(descendantTarget)
        touched = true
      }
      for (const connector of findConnectorsWithEndpointUnder(node, allConnectors)) {
        await syncConnectorOnce(connector)
        touched = true
      }
    }
    await maybeYield()
  }

  // Everything above re-routes connectors *attached* to what moved. This
  // re-routes the ones merely in its way: an elbow bends around the boxes on
  // the page, so a screen that lands in a line's path changes that line
  // without touching either of its ends.
  //
  // What changed is read off the difference between this batch's scan and the
  // one before it, rather than from the nodes that reported a change. Two
  // reasons. A node change describes too much: nudging a button inside a
  // screen reports the button, and the screen around it is exactly where it
  // was, so treating that as a move would re-sync every line for half the
  // page on every frame of a drag that changes no route at all. And it
  // describes too little: a screen stops being in the way when it is hidden
  // or deleted just as surely as when it is dragged clear, and neither of
  // those is a rectangle changing — the box simply leaves the list.
  const movedBoxes = boxesChangedInLastScan()
  for (const connector of findConnectorsNearBoxes(movedBoxes, allConnectors)) {
    if (syncedConnectorIds.has(connector.id)) continue
    await syncConnectorOnce(connector)
    touched = true
    await maybeYield()
  }

  let capturedAnEdit = false
  for (const text of editedTextNodes) {
    if (text.removed) continue
    // Whichever it belongs to, or neither — a person editing some unrelated
    // text on the page is none of our business.
    const captured = (await captureCardTextEdit(text)) || (await captureLabelTextEdit(text))
    if (captured) {
      touched = true
      capturedAnEdit = true
    }
    await maybeYield()
  }
  // The panel is showing the words that just changed under it. Without this
  // it keeps the old ones until the selection changes, and typing into the
  // box there would then put them back.
  if (capturedAnEdit) emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())

  for (const ownerId of draggedCardOwnerIds) {
    const node = await figma.getNodeByIdAsync(ownerId)
    if (node === null || !('absoluteBoundingBox' in node)) {
      await maybeYield()
      continue
    }
    await updateCardFromDrag(node)
    touched = true
    await maybeYield()
  }

  if (touched) await finalizeLayout()
}

export default function main(): void {
  on<SetAnnotationTextHandler>('SET_ANNOTATION_TEXT', (payload) => {
    fireAndForget(handleSetAnnotationText(payload))
  })

  on<SetAnnotationCategoryHandler>('SET_ANNOTATION_CATEGORY', (payload) => {
    fireAndForget(handleSetAnnotationCategory(payload))
  })

  on<SetAnnotationSizeHandler>('SET_ANNOTATION_SIZE', (payload) => {
    fireAndForget(handleSetAnnotationSize(payload))
  })

  on<AddCategoryHandler>('ADD_CATEGORY', handleAddCategory)
  on<RenameCategoryHandler>('RENAME_CATEGORY', (payload) => {
    fireAndForget(handleRenameCategory(payload))
  })
  on<RecolorCategoryHandler>('RECOLOR_CATEGORY', (payload) => {
    fireAndForget(handleRecolorCategory(payload))
  })
  on<DeleteCategoryHandler>('DELETE_CATEGORY', (payload) => {
    fireAndForget(handleDeleteCategory(payload))
  })

  on<CreateConnectorHandler>('CREATE_CONNECTOR', (payload) => {
    fireAndForget(handleCreateConnector(payload))
  })

  on<UpdateConnectorStyleHandler>('UPDATE_CONNECTOR_STYLE', (payload) => {
    fireAndForget(handleUpdateConnectorStyle(payload))
  })

  on<UpdateConnectorAnchorHandler>('UPDATE_CONNECTOR_ANCHOR', (payload) => {
    fireAndForget(handleUpdateConnectorAnchor(payload))
  })

  figma.on('selectionchange', () => {
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  })

  figma.currentPage.on('nodechange', handleNodeChange)

  // Must run before `reconcileEverything` starts — calling an async
  // function runs its body synchronously up to its first real `await`, and
  // that first sync stretch already reaches all the way into
  // `syncAnnotationExclusive`'s `getCategories()` lookup for the first
  // annotated target. Seeding the defaults after `fireAndForget` here would
  // still lose that race on a file with an unseeded category list.
  ensureDefaultCategories()
  fireAndForget(reconcileEverything())

  showUI(
    // Trimmed down from 440 — the Connect tab, the tallest one, only needs
    // about this much; any real overflow (a long category list, say) still
    // scrolls rather than clipping.
    { height: 400, width: 320 },
    { selection: summariseSelection(), categories: getCategories() }
  )
}

/**
 * Menu + relaunch-button command. Runs without a UI and closes immediately,
 * so it is safe to fire from the properties panel on a stale connector.
 */
export function resyncPage(): void {
  reconcileEverything()
    .then((result) => {
      figma.closePlugin(
        `Re-synced ${result.annotationsSynced} annotation${result.annotationsSynced === 1 ? '' : 's'} and ${result.connectorsSynced} connector${result.connectorsSynced === 1 ? '' : 's'}, removed ${result.orphansRemoved} orphan${result.orphansRemoved === 1 ? '' : 's'}.`
      )
    })
    .catch((error: unknown) => {
      figma.closePlugin(`Re-sync failed: ${String(error)}`)
    })
}

