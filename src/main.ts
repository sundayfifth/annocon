import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type { Rect } from './core/anchor.js'
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
  SetAnnotationTextHandler,
  SetAnnotationTextPayload,
  UpdateConnectorAnchorHandler,
  UpdateConnectorAnchorPayload,
  UpdateConnectorStyleHandler,
  UpdateConnectorStylePayload
} from './messages.js'
import {
  clearAnnotation,
  finalizeLayout,
  findAnnotationTargetsUnder,
  getAnnotationRecord,
  lastKnownOwnerOf,
  lastKnownRoleOf,
  ownerIdOf,
  reconcileAllAnnotations,
  removeRenderedNodesForOwner,
  roleOf,
  setAnnotationCategory,
  setAnnotationText,
  syncAnnotation,
  updateCardOffsetFromDrag
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
  collectRouteObstacles,
  createConnector,
  findAllConnectorsOnPage,
  findConnectorBetween,
  findConnectorsInvolving,
  findConnectorsNearBoxes,
  findConnectorsWithEndpointUnder,
  getConnectorRecord,
  lastKnownLabelOwnerOf,
  obstacleRectBeforeLastScan,
  reconcileAllConnectors,
  removeConnectorLabel,
  syncConnector,
  updateConnectorAnchorSide,
  updateConnectorStyle
} from './scene/connectorScene.js'
import { CHUNK_SIZE, yieldToMainThread } from './scene/chunking.js'
import { topLevelAncestorIdOf } from './scene/frames.js'
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

  return orderedNodes.map((node) => {
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

  for (const change of event.nodeChanges) {
    if (change.type === 'DELETE') {
      deletedIds.add(change.node.id)
      continue
    }
    if (change.type !== 'PROPERTY_CHANGE') continue
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

  if (deletedIds.size === 0 && movedTargetIds.size === 0 && draggedCardOwnerIds.size === 0) return
  fireAndForget(resyncTouched({ deletedIds, movedTargetIds, draggedCardOwnerIds }))
}

async function resyncTouched({
  deletedIds,
  movedTargetIds,
  draggedCardOwnerIds
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
  // A connector can be reached by more than one of the routes through this
  // function — its endpoint moved *and* it passes near a box that also moved,
  // say, or both its ends were in the same multi-select drag. Re-rendering it
  // twice in one batch draws the identical vector network the second time, so
  // this keeps the extra `setVectorNetworkAsync` out of the drag loop.
  const syncedConnectorIds = new Set<string>()
  const syncConnectorOnce = async (connector: VectorNode): Promise<void> => {
    if (syncedConnectorIds.has(connector.id)) return
    syncedConnectorIds.add(connector.id)
    await syncConnector(connector, obstacles)
  }
  // Which top-level boxes moved in this batch — an elbow route bends around
  // these, so a connector attached to none of them can still need re-routing
  // when one lands in its path. Collected as ids during the move loop below
  // and resolved to rectangles afterwards, since `obstacles` already holds
  // every top-level box's current rect and a node's own id is the cheapest
  // thing to carry around in the meantime.
  const movedObstacleIds = new Set<string>()
  // Where boxes that no longer exist used to be — collected in the delete
  // loop below, since a deletion frees up space rather than occupying it.
  const vacatedBoxes: Array<Rect> = []

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
    // A deleted screen stops being in anyone's way, which changes the route
    // of every line that was bending around it just as surely as dragging it
    // clear would have. The current scan no longer has it, so this asks where
    // it was as of the scan before.
    const wasAt = obstacleRectBeforeLastScan(id)
    if (wasAt !== null) vacatedBoxes.push(wasAt)
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
    // Moving a layer inside a screen moves the screen's contents, not the
    // screen — so what every *other* connector has to route around is the
    // top-level box this node belongs to, at whatever size it is now.
    if (node !== null && 'absoluteBoundingBox' in node) {
      movedObstacleIds.add(topLevelAncestorIdOf(node))
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
  // re-routes the ones merely in its way: an elbow bends around the top-level
  // boxes on the page, so a screen dragged into (or out of) a line's path
  // changes that line without touching either of its ends.
  const movedBoxes = [
    ...obstacles
      .filter((obstacle) => movedObstacleIds.has(obstacle.id))
      .map((obstacle) => obstacle.rect),
    ...vacatedBoxes
  ]
  for (const connector of findConnectorsNearBoxes(movedBoxes, allConnectors)) {
    if (syncedConnectorIds.has(connector.id)) continue
    await syncConnectorOnce(connector)
    touched = true
    await maybeYield()
  }

  for (const ownerId of draggedCardOwnerIds) {
    const node = await figma.getNodeByIdAsync(ownerId)
    if (node === null || !('absoluteBoundingBox' in node)) {
      await maybeYield()
      continue
    }
    await updateCardOffsetFromDrag(node)
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

