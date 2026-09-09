import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type {
  AddCategoryPayload,
  CategoriesChangedHandler,
  CommandFailedHandler,
  CreateConnectorPayload,
  DeleteCategoryPayload,
  RecolorCategoryPayload,
  RenameCategoryPayload,
  SelectionChangedHandler,
  SelectionSummary,
  UiToMain,
  SetAnnotationCategoryPayload,
  SetAnnotationSizePayload,
  SetAnnotationTextPayload,
  UpdateConnectorAnchorPayload,
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
  annotationTargetsBehind,
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
  captureManualReshape,
  collectRouteObstacles,
  connectorsBehindLabels,
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
  restoreAutomaticRoute,
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
  'visible',
  // Reshaping a connector need not change its box at all — pull a bend
  // inwards and the two ends still define the same rectangle with the same
  // number of vertices. Without this, that edit is filtered out here and
  // then quietly redrawn over on the next sync. (`vectorPaths` is not a
  // property Figma reports a change on; `vectorNetwork` is the one.)
  'vectorNetwork'
]

/**
 * What each selected node stands for: a card or leader stands for its note's
 * layer, a label pill for its connector, everything else for itself.
 *
 * Two page scans at most, however much is selected — and none at all when
 * nothing rendered by this plugin is in the selection, which is the ordinary
 * case. Resolving one node at a time scanned once per node, so Select All on
 * a page of annotations paid for a scan per card.
 */
function resolveSelectionOwners(nodes: ReadonlyArray<SceneNode>): Map<string, SceneNode> {
  const owners = new Map<string, SceneNode>(annotationTargetsBehind(nodes))
  for (const [pillId, connector] of connectorsBehindLabels(nodes)) {
    owners.set(pillId, connector)
  }
  return owners
}

function summariseSelection(): Array<SelectionSummary> {
  trackSelectionOrder()
  const nodesById = new Map(figma.currentPage.selection.map((node) => [node.id, node]))
  const selected = selectionOrder
    .map((id) => nodesById.get(id))
    .filter((node): node is SceneNode => typeof node !== 'undefined')
  const owners = resolveSelectionOwners(selected)
  const orderedNodes = selected
    // A selected card, leader or label pill stands for the thing it belongs
    // to — see `annotationTargetOf` / `connectorBehindLabel`. Both scan the
    // page, but only after reading the node's own pluginData, so a selection
    // of ordinary layers costs nothing; it is Select All on a page full of
    // cards that would otherwise pay for a scan per card.
    .map((node) => owners.get(node.id) ?? node)
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
              manualGeometry: connectorRecord.manualGeometry,
              labelColor: connectorRecord.labelColor,
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

/**
 * Reports a command that did not apply, to the person and to the panel.
 *
 * Every handler below used to bail with a bare `return`. Nothing said so, and
 * the panel went on showing the value that was typed — `useAdoptedFromOutside`
 * in the UI only takes a value that *changed* elsewhere, and a command that
 * was dropped changed nothing, so re-sending the selection is not enough on
 * its own to clear it. Hence both: `figma.notify`, which is how this plugin
 * already tells someone a sync failed, and a message the panel can act on.
 */
function commandFailed(command: keyof UiToMain, reason: string): void {
  figma.notify(reason, { error: true })
  emit<CommandFailedHandler>('COMMAND_FAILED', { command, reason })
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

/**
 * The layer a command names, or `null` having said why not.
 *
 * A command carries an id the panel read some moments ago, and the document
 * has moved on since — most often because the layer was deleted while the
 * message was in flight.
 */
// The return type is inferred rather than written: `'absoluteBoundingBox' in
// node` narrows `BaseNode` to exactly the node types that have a box, and
// naming that union by hand would either be wrong or need rewriting whenever
// Figma adds a node type.
async function layerFor(command: keyof UiToMain, id: string) {
  const node = await figma.getNodeByIdAsync(id)
  if (node === null || !('absoluteBoundingBox' in node)) {
    commandFailed(command, "That layer is gone, so the change wasn't applied.")
    return null
  }
  return node
}

/** The same for a connector, which additionally has to still be the vector we drew. */
async function connectorFor(command: keyof UiToMain, id: string): Promise<VectorNode | null> {
  const node = await figma.getNodeByIdAsync(id)
  if (node === null || node.type !== 'VECTOR') {
    commandFailed(command, "That connector is gone, so the change wasn't applied.")
    return null
  }
  return node
}

async function handleSetAnnotationText({ targetId, text }: SetAnnotationTextPayload): Promise<void> {
  const node = await layerFor('SET_ANNOTATION_TEXT', targetId)
  if (node === null) return
  await setAnnotationText(node, text)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

async function handleSetAnnotationSize({ targetId, size }: SetAnnotationSizePayload): Promise<void> {
  const node = await layerFor('SET_ANNOTATION_SIZE', targetId)
  if (node === null) return
  await setAnnotationSize(node, size)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

async function handleRestoreAutoRoute(connectorId: string): Promise<void> {
  const node = await connectorFor('RESTORE_AUTO_ROUTE', connectorId)
  if (node === null) return
  await restoreAutomaticRoute(node)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

function broadcastCategories(): void {
  emit<CategoriesChangedHandler>('CATEGORIES_CHANGED', getCategories())
}

async function handleSetAnnotationCategory({
  targetId,
  categoryId
}: SetAnnotationCategoryPayload): Promise<void> {
  const node = await layerFor('SET_ANNOTATION_CATEGORY', targetId)
  if (node === null) return
  await setAnnotationCategory(node, categoryId)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

function handleAddCategory({ name, color }: AddCategoryPayload): void {
  // The panel guards this too, so this is the second line of defence rather
  // than the one a person normally meets. Reported all the same: a command
  // that does nothing has to say so from wherever it is refused.
  if (name.trim() === '') {
    commandFailed('ADD_CATEGORY', 'A category needs a name.')
    return
  }
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
  if (
    start === null ||
    end === null ||
    !('absoluteBoundingBox' in start) ||
    !('absoluteBoundingBox' in end)
  ) {
    commandFailed('CREATE_CONNECTOR', "One of those layers is gone, so no connector was drawn.")
    return
  }

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
  const node = await connectorFor('UPDATE_CONNECTOR_STYLE', targetId)
  if (node === null) return
  await updateConnectorStyle(node, changes)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

async function handleUpdateConnectorAnchor({
  targetId,
  side,
  magnet
}: UpdateConnectorAnchorPayload): Promise<void> {
  const node = await connectorFor('UPDATE_CONNECTOR_ANCHOR', targetId)
  if (node === null) return
  await updateConnectorAnchorSide(node, side, magnet)
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
}

/** Fire-and-forget async work: log instead of letting a rejection vanish silently. */
function fireAndForget(promise: Promise<unknown>): void {
  promise.catch((error: unknown) => {
    console.error(error)
  })
}

/**
 * Commands that read a record and write it back, one at a time per record.
 *
 * Every one of these handlers is `await getNodeByIdAsync` → read the record →
 * write `{ ...record, ...changes }`. Two arriving in the same tick — clicking
 * a colour swatch closes the flyout and blurs the number field beside it, so
 * this is one gesture, not a stress test — both `await`, both read the record
 * *before* either change, and the second write throws the first away. The
 * colour is simply lost, with nothing to say so.
 *
 * Chaining per record rather than one global queue: two different connectors
 * have nothing to serialise against each other, and a queue that made them
 * wait would turn a multi-select edit into a slow one for no reason.
 *
 * A failed edit must not wedge the queue behind it, so the chain continues
 * from whether the previous one *settled*, not whether it succeeded.
 */
const editsInFlight = new Map<string, Promise<unknown>>()

/** Category commands all rewrite the one list on `figma.root`, so they share a lane. */
const CATEGORY_LIST_KEY = 'categories'

function queueEdit(recordKey: string, work: () => Promise<void>): void {
  const settled = (editsInFlight.get(recordKey) ?? Promise.resolve()).then(
    () => undefined,
    () => undefined
  )
  const next = settled.then(work)
  editsInFlight.set(recordKey, next)
  fireAndForget(
    next.finally(() => {
      // Only if nothing has queued behind it — otherwise this would drop the
      // tail of a chain that is still running.
      if (editsInFlight.get(recordKey) === next) editsInFlight.delete(recordKey)
    })
  )
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
  for (const id of deletedIds) waiting.deletedIds.add(id)
  for (const id of movedTargetIds) waiting.movedTargetIds.add(id)
  for (const id of draggedCardOwnerIds) waiting.draggedCardOwnerIds.add(id)
  waiting.editedTextNodes.push(...editedTextNodes)
  scheduleResync()
}

/**
 * What has changed since the last pass, waiting to be dealt with.
 *
 * A drag delivers a change every frame, and a pass over one is not cheap: it
 * scans the page for connectors, for their labels, and for the boxes a route
 * has to avoid. Firing one off per event meant dozens running at once, each
 * doing all of that, each interleaving with the others at every `await` —
 * which is both most of the cost and most of the reason a drag looked like it
 * was lagging behind rather than merely slow.
 *
 * So changes are collected here and dealt with by one pass at a time. Nothing
 * is dropped: whatever arrives while a pass is running is picked up by the
 * next one.
 */
const waiting = {
  deletedIds: new Set<string>(),
  movedTargetIds: new Set<string>(),
  draggedCardOwnerIds: new Set<string>(),
  editedTextNodes: [] as Array<TextNode>
}

/**
 * How long changes are allowed to gather before a pass runs.
 *
 * Short enough that a line still tracks a screen being dragged — this is
 * about twenty passes a second, and the drag itself only produces sixty —
 * long enough that a burst becomes one pass instead of three.
 */
const RESYNC_COALESCE_MS = 40

let resyncTimer: ReturnType<typeof setTimeout> | null = null
let resyncRunning = false

function scheduleResync(): void {
  if (resyncTimer !== null || resyncRunning) return
  resyncTimer = setTimeout(() => {
    resyncTimer = null
    fireAndForget(drainResyncQueue())
  }, RESYNC_COALESCE_MS)
}

async function drainResyncQueue(): Promise<void> {
  if (resyncRunning) return
  resyncRunning = true
  try {
    while (
      waiting.deletedIds.size > 0 ||
      waiting.movedTargetIds.size > 0 ||
      waiting.draggedCardOwnerIds.size > 0 ||
      waiting.editedTextNodes.length > 0
    ) {
      // Taken before the pass, so anything arriving during it lands in a
      // fresh set and is handled by the next turn of this loop rather than
      // being lost or handled twice.
      const batch: TouchedNodes = {
        deletedIds: waiting.deletedIds,
        movedTargetIds: waiting.movedTargetIds,
        draggedCardOwnerIds: waiting.draggedCardOwnerIds,
        editedTextNodes: waiting.editedTextNodes
      }
      waiting.deletedIds = new Set()
      waiting.movedTargetIds = new Set()
      waiting.draggedCardOwnerIds = new Set()
      waiting.editedTextNodes = []
      await resyncTouched(batch)
    }
  } finally {
    resyncRunning = false
  }
}

/**
 * Throws away anything gathered but not yet dealt with.
 *
 * Only for a page change: a pass drains the queue against
 * `figma.currentPage`, so once that is a different page the queued ids
 * belong to nodes the pass would route past the wrong page's frames.
 * A pass already running cannot be cancelled, but emptying the queue stops
 * it after the batch it is on.
 */
function discardPendingResync(): void {
  if (resyncTimer !== null) {
    clearTimeout(resyncTimer)
    resyncTimer = null
  }
  waiting.deletedIds = new Set()
  waiting.movedTargetIds = new Set()
  waiting.draggedCardOwnerIds = new Set()
  waiting.editedTextNodes = []
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

  // Fetched once and shared by both passes below. They cannot be merged into
  // one — a reshape has to be recorded before *any* connector is re-synced,
  // since a batch that moves a screen and reshapes its connector together
  // would otherwise re-draw the connector first and overwrite the edit — but
  // there is no reason to ask Figma for the same node twice, on a thread
  // where a multi-select drag already costs one lookup per node per frame.
  const movedNodes = new Map<string, SceneNode>()
  for (const id of movedTargetIds) {
    const node = await figma.getNodeByIdAsync(id)
    if (node !== null && 'absoluteBoundingBox' in node) movedNodes.set(id, node)
    await maybeYield()
  }

  let capturedAReshape = false
  for (const node of movedNodes.values()) {
    // Held from the loop above rather than fetched fresh, and both loops
    // yield the thread — so a node can be deleted out from under this map
    // between being looked up and being used. Reading anything off a removed
    // node throws, the same reason the edited-text loop below checks it.
    if (node.removed) {
      await maybeYield()
      continue
    }
    if (await captureManualReshape(node)) {
      touched = true
      capturedAReshape = true
    }
    await maybeYield()
  }

  for (const id of movedTargetIds) {
    const cached = movedNodes.get(id) ?? null
    // Same reasoning as the reshape loop above: a cached node may have been
    // deleted while this batch was yielding.
    const node = cached !== null && cached.removed ? null : cached
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
  if (capturedAnEdit || capturedAReshape) {
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  }

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

/**
 * What to do with each message the UI can send.
 *
 * Typed as the whole of `UiToMain`, which is what makes it a list rather than
 * a habit: adding a message to that map without a line here does not compile.
 * Registered by walking this object below, so there is no second list of
 * names to keep in step either.
 */
const HANDLERS: { [Name in keyof UiToMain]: (payload: UiToMain[Name]) => void } = {
  SET_ANNOTATION_TEXT: (payload) => {
    queueEdit(payload.targetId, () => handleSetAnnotationText(payload))
  },
  SET_ANNOTATION_CATEGORY: (payload) => {
    queueEdit(payload.targetId, () => handleSetAnnotationCategory(payload))
  },
  SET_ANNOTATION_SIZE: (payload) => {
    queueEdit(payload.targetId, () => handleSetAnnotationSize(payload))
  },
  // Not queued, unlike the other three category commands: `addCategory` is
  // synchronous from read to write, so there is no `await` for a second
  // command to interleave at and nothing to serialise against. The three
  // below are queued because each one's work is async.
  ADD_CATEGORY: handleAddCategory,
  RENAME_CATEGORY: (payload) => {
    queueEdit(CATEGORY_LIST_KEY, () => handleRenameCategory(payload))
  },
  RECOLOR_CATEGORY: (payload) => {
    queueEdit(CATEGORY_LIST_KEY, () => handleRecolorCategory(payload))
  },
  DELETE_CATEGORY: (payload) => {
    queueEdit(CATEGORY_LIST_KEY, () => handleDeleteCategory(payload))
  },
  // Not queued: it has no existing record to read-modify-write, so there is
  // nothing for a second command to race against.
  CREATE_CONNECTOR: (payload) => {
    fireAndForget(handleCreateConnector(payload))
  },
  UPDATE_CONNECTOR_STYLE: (payload) => {
    queueEdit(payload.targetId, () => handleUpdateConnectorStyle(payload))
  },
  UPDATE_CONNECTOR_ANCHOR: (payload) => {
    queueEdit(payload.targetId, () => handleUpdateConnectorAnchor(payload))
  },
  RESTORE_AUTO_ROUTE: ({ connectorId }) => {
    queueEdit(connectorId, () => handleRestoreAutoRoute(connectorId))
  }
}

export default function main(): void {
  // One `on` per entry, so the list of names lives in exactly one place.
  //
  // The cast is the price of walking the object rather than writing the calls
  // out: `name` and `HANDLERS[name]` are correlated here, but TypeScript
  // checks the two arguments independently and sees a union of names against
  // a union of handlers. The declaration of `HANDLERS` above is what types
  // each pair, and it is the thing that fails to compile if a message has no
  // handler — this loop only has to reach every entry.
  const register = on as (name: string, handler: (payload: never) => void) => void
  for (const name of Object.keys(HANDLERS) as Array<keyof UiToMain>) {
    register(name, HANDLERS[name])
  }

  figma.on('selectionchange', () => {
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  })

  listenForNodeChanges(figma.currentPage)

  // Every scan in `src/scene/**` reads `figma.currentPage`, so a page switch
  // otherwise leaves the plugin listening to the page nobody is looking at
  // and reconciling nothing on the one they are — live re-routing stops, with
  // nothing to say it has. Categories are not re-seeded: they live on
  // `figma.root`, so they are already there.
  figma.on('currentpagechange', () => {
    listenForNodeChanges(figma.currentPage)
    discardPendingResync()
    fireAndForget(reconcileEverything())
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  })

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
 * The page `handleNodeChange` is registered on. `nodechange` is a page-level
 * event — a listener registered on one page never fires for another — and
 * there is no way to ask Figma which page a listener sits on, so it is
 * tracked here.
 */
let listeningTo: PageNode | null = null

/** Moves `handleNodeChange` onto `page`, dropping the previous registration
 * rather than accumulating one per page visited. */
function listenForNodeChanges(page: PageNode): void {
  if (listeningTo !== null) listeningTo.off('nodechange', handleNodeChange)
  page.on('nodechange', handleNodeChange)
  listeningTo = page
}

/**
 * Menu + relaunch-button command. Runs without a UI and closes immediately,
 * so it is safe to fire from the properties panel on a stale connector.
 */
export function resyncPage(): void {
  // Same ordering `main()` explains at length: the first synchronous stretch
  // of `reconcileEverything` already reaches `getCategories()`, so on a file
  // with an unseeded list the defaults have to be in place before it starts.
  // Running without a UI does not exempt this path — it is the one people
  // reach for on exactly those files.
  ensureDefaultCategories()
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

