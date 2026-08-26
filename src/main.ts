import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type {
  AddCategoryHandler,
  AddCategoryPayload,
  CategoriesChangedHandler,
  CloseHandler,
  CreateConnectorHandler,
  CreateConnectorPayload,
  DeleteCategoryHandler,
  DeleteCategoryPayload,
  RecolorCategoryHandler,
  RecolorCategoryPayload,
  RenameCategoryHandler,
  RenameCategoryPayload,
  ResyncPageHandler,
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
  finalizeLayout,
  findAnnotationTargetsUnder,
  getAnnotationRecord,
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
  createConnector,
  findConnectorBetween,
  findConnectorsInvolving,
  findConnectorsWithEndpointUnder,
  getConnectorRecord,
  reconcileAllConnectors,
  removeConnectorLabel,
  syncConnector,
  updateConnectorAnchorSide,
  updateConnectorStyle
} from './scene/connectorScene.js'
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

const POSITIONAL_PROPERTIES = ['x', 'y', 'width', 'height', 'relativeTransform', 'rotation']

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

function reportReconcile(prefix: string, result: ReconcileResult): void {
  const parts = [
    `${result.annotationsSynced} annotation${result.annotationsSynced === 1 ? '' : 's'} synced`,
    `${result.connectorsSynced} connector${result.connectorsSynced === 1 ? '' : 's'} synced`
  ]
  if (result.orphansRemoved > 0) {
    parts.push(`${result.orphansRemoved} orphan${result.orphansRemoved === 1 ? '' : 's'} removed`)
  }
  figma.notify(`${prefix}: ${parts.join(', ')}.`)
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

function handleRenameCategory({ id, name }: RenameCategoryPayload): void {
  renameCategory(id, name)
  broadcastCategories()
}

function handleRecolorCategory({ id, color }: RecolorCategoryPayload): void {
  recolorCategory(id, color)
  broadcastCategories()
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
  // fewer step, not one fewer step *and* still having to go find it.
  figma.currentPage.selection = [node]
  emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
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

  for (const id of deletedIds) {
    removeRenderedNodesForOwner(id)
    // A cheap no-op if `id` wasn't itself a connector's own id — only
    // meaningful when the connector node just got deleted directly, since
    // its label is a separate top-level node that would otherwise be left
    // stranded, orphaned but not swept up until the next full reconcile.
    removeConnectorLabel(id)
    for (const connector of findConnectorsInvolving(id)) {
      await syncConnector(connector)
    }
    touched = true
  }

  for (const id of movedTargetIds) {
    const node = await figma.getNodeByIdAsync(id)
    if (node !== null && 'absoluteBoundingBox' in node && getAnnotationRecord(node) !== null) {
      await syncAnnotation(node)
      touched = true
    }
    for (const connector of findConnectorsInvolving(id)) {
      await syncConnector(connector)
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
      for (const connector of findConnectorsWithEndpointUnder(node)) {
        await syncConnector(connector)
        touched = true
      }
    }
  }

  for (const ownerId of draggedCardOwnerIds) {
    const node = await figma.getNodeByIdAsync(ownerId)
    if (node === null || !('absoluteBoundingBox' in node)) continue
    await updateCardOffsetFromDrag(node)
    touched = true
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
  on<RenameCategoryHandler>('RENAME_CATEGORY', handleRenameCategory)
  on<RecolorCategoryHandler>('RECOLOR_CATEGORY', handleRecolorCategory)
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

  on<ResyncPageHandler>('RESYNC_PAGE', () => {
    fireAndForget(
      reconcileEverything().then((result) => {
        reportReconcile('Re-sync', result)
      })
    )
  })

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin()
  })

  figma.on('selectionchange', () => {
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  })

  figma.currentPage.on('nodechange', handleNodeChange)

  fireAndForget(reconcileEverything())
  ensureDefaultCategories()

  showUI(
    { height: 440, width: 320 },
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
