/**
 * Connect feature — draws a `ConnectorRecord` as a real vector node.
 *
 * The record lives in pluginData on the connector's own node (see
 * `core/connector.ts` for why), tagged with `connector` so it's easy to find
 * without scanning every node on the page. Geometry flows one way, same
 * discipline as Annotate: the connector's vertices are always derived from
 * the record plus each endpoint's current box, never read back.
 */

import { type Anchor, type Magnet, type Point, type Rect, type ResolvedMagnet, sameRect } from '../core/anchor.js'
import {
  type ConnectorRecord,
  type ConnectorStylePrefs,
  type ElbowRouteOptions,
  type ManualShape,
  type ManualVertex,
  type RouteObstacles,
  ROUTE_SEARCH_MARGIN,
  boxCouldAffectRoute,
  connectorAxisOf,
  connectorCurveTangents,
  connectorRoutePoints,
  connectorStubClearance,
  createConnectorRecord,
  frameGapMidpoint,
  parseConnectorRecord,
  parseConnectorStylePrefs,
  pointAlongPolyline,
  obstaclesInPlay,
  orientedTowards,
  pointOnCurve,
  resolveConnectorGeometry,
  serialiseConnectorRecord,
  shiftManualShape,
  serialiseConnectorStylePrefs
} from '../core/connector.js'
import { ownerIdOf } from './annotationScene.js'
import { CHUNK_SIZE, yieldToMainThread } from './chunking.js'
import { findEnclosingFrame, topLevelAncestorIdOf } from './frames.js'
import { removeOrphansByOwnerKey } from './orphans.js'
import { withSuppressedNodeChange, withSuppressedNodeChangeAsync } from './pluginData.js'

const CONNECTOR_KEY = 'connector'
const BROKEN_COLOR = '#E5484D'
const LABEL_OWNER_KEY = 'connectorLabelOwner'
const LAST_STYLE_KEY = 'lastConnectorStyle'
/**
 * The shape this plugin last drew, as `x,y,width,height,vertexCount`.
 *
 * How a person reshaping a line is told from this plugin drawing one.
 * Suppression cannot answer it: it releases a tick after the write, and a
 * sync's awaits mean the `nodechange` for a vector write can land after the
 * window has closed. Comparing against what we drew does not depend on when
 * an event turns up — the same test that tells a dragged card width from a
 * re-rendered one.
 */
const DRAWN_AS_KEY = 'connectorDrawnAs'

/**
 * The style (colour, weight, opacity, caps, line style, corner radius —
 * everything but the anchors and the label, which is per-connector rather
 * than a preference) a person last set on any connector, in `clientStorage`
 * so it's remembered across files and even across plugin sessions, not just
 * in memory. Without this every new connector reset to the shipped
 * defaults, so picking grey once meant picking grey again for every
 * connector after it.
 */
async function loadLastConnectorStyle(): Promise<ConnectorStylePrefs> {
  const raw: unknown = await figma.clientStorage.getAsync(LAST_STYLE_KEY)
  return parseConnectorStylePrefs(typeof raw === 'string' ? raw : '')
}

async function saveLastConnectorStyle(prefs: ConnectorStylePrefs): Promise<void> {
  await figma.clientStorage.setAsync(LAST_STYLE_KEY, serialiseConnectorStylePrefs(prefs))
}

export function getConnectorRecord(node: SceneNode): ConnectorRecord | null {
  return parseConnectorRecord(node.getPluginData(CONNECTOR_KEY))
}

export function isConnector(node: SceneNode): boolean {
  return node.getPluginData(CONNECTOR_KEY) !== ''
}

function writeConnectorRecord(node: SceneNode, record: ConnectorRecord): void {
  withSuppressedNodeChange(() => {
    node.setPluginData(CONNECTOR_KEY, serialiseConnectorRecord(record))
  })
}

function findAllConnectors(): Array<VectorNode> {
  return figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [CONNECTOR_KEY] } })
    .filter((node): node is VectorNode => node.type === 'VECTOR')
}

/**
 * The same full-page scan `findConnectorsInvolving`/`findConnectorsWithEndpointUnder`
 * do internally by default, exposed so a caller touching several nodes in one
 * batch (`resyncTouched`) can scan once and pass the result to each call via
 * their `known` parameter, instead of paying for the scan once per node.
 */
export function findAllConnectorsOnPage(): ReadonlyArray<VectorNode> {
  return findAllConnectors()
}

/** Every connector whose record references `nodeId` on either end. */
export function findConnectorsInvolving(
  nodeId: string,
  known?: ReadonlyArray<VectorNode>
): ReadonlyArray<VectorNode> {
  return (known ?? findAllConnectors()).filter((node) => {
    const record = getConnectorRecord(node)
    if (record === null) return false
    return anchorRefersTo(record.start, nodeId) || anchorRefersTo(record.end, nodeId)
  })
}

function anchorRefersTo(anchor: ConnectorRecord['start'], nodeId: string): boolean {
  return anchor.kind !== 'free' && anchor.nodeId === nodeId
}

/**
 * An existing connector already strung between `aId` and `bId` (either
 * direction), if there is one — so re-selecting the same pair reselects it
 * instead of stacking a duplicate line on top.
 */
export function findConnectorBetween(aId: string, bId: string): VectorNode | null {
  return (
    findAllConnectors().find((node) => {
      const record = getConnectorRecord(node)
      if (record === null) return false
      return (
        (anchorRefersTo(record.start, aId) && anchorRefersTo(record.end, bId)) ||
        (anchorRefersTo(record.start, bId) && anchorRefersTo(record.end, aId))
      )
    }) ?? null
  )
}

function anchorIn(anchor: ConnectorRecord['start'], ids: ReadonlySet<string>): boolean {
  return anchor.kind !== 'free' && ids.has(anchor.nodeId)
}

/**
 * Every connector with an endpoint nested inside `ancestor` (not `ancestor`
 * itself — `findConnectorsInvolving` already covers that case). Needed for
 * the same reason as `findAnnotationTargetsUnder`: a connector's endpoint
 * node doesn't fire its own position change when only an ancestor frame
 * moves, so this is how a connector notices its anchor's frame was dragged.
 */
export function findConnectorsWithEndpointUnder(
  ancestor: SceneNode & ChildrenMixin,
  known?: ReadonlyArray<VectorNode>
): ReadonlyArray<VectorNode> {
  const descendantIds = new Set(ancestor.findAll().map((node) => node.id))
  if (descendantIds.size === 0) return []
  return (known ?? findAllConnectors()).filter((node) => {
    const record = getConnectorRecord(node)
    if (record === null) return false
    return anchorIn(record.start, descendantIds) || anchorIn(record.end, descendantIds)
  })
}

/**
 * Every connector whose route could be changed by one of `boxes` having just
 * moved — the third way a connector goes stale, alongside its own endpoint
 * moving and its endpoint's frame moving.
 *
 * The two `findConnectors*` helpers above both answer "is this connector
 * attached to the node that moved", which is the only question that existed
 * before an elbow route depended on the boxes it passes. A screen parked
 * between two connected screens is attached to nothing: drag it into a line's
 * path and, without this, no connector is ever asked to re-route, so the line
 * stays cutting straight through until something else happens to sync it.
 *
 * Deliberately keyed off each connector's rendered bounding box rather than
 * its record — see `boxCouldAffectRoute`. Cheap enough to run per drag frame:
 * no `getNodeByIdAsync`, no route computed, just a rectangle test per
 * connector against a page scan the caller already had to do.
 */
export function findConnectorsNearBoxes(
  boxes: ReadonlyArray<Rect>,
  known?: ReadonlyArray<VectorNode>
): ReadonlyArray<VectorNode> {
  if (boxes.length === 0) return []
  return (known ?? findAllConnectors()).filter((node) => {
    const record = getConnectorRecord(node)
    // Only an ELBOW bends around anything; the other two ignore obstacles
    // entirely, so nothing a box does can change where they are drawn.
    if (record === null || record.lineStyle !== 'ELBOW') return false
    const bounds = node.absoluteBoundingBox
    if (bounds === null) return false
    return boxes.some((box) => boxCouldAffectRoute(bounds, box, ROUTE_SEARCH_MARGIN))
  })
}

/**
 * A connector's optional label — `connectorLabelOwner` pluginData points
 * back at the connector's own node id, the same "tag, then query" shape
 * Annotate uses for its card/leader. A vector node can't have children in
 * Figma, so this has to be its own top-level node rather than nested inside
 * the connector.
 */
function findConnectorLabel(
  connectorId: string,
  known?: LabelIndex
): FrameNode | null {
  const found = known?.get(connectorId) ?? findLabelsFor(connectorId)
  if (found.length <= 1) return found[0] ?? null
  // Same dedupe-and-recreate reasoning as annotation's rendered nodes — no
  // reliable way to tell which duplicate is "correct", so clear the slate.
  for (const node of found) node.remove()
  return null
}

function findLabelsFor(connectorId: string): ReadonlyArray<FrameNode> {
  return figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [LABEL_OWNER_KEY] } })
    .filter(
      (node): node is FrameNode =>
        node.type === 'FRAME' && node.getPluginData(LABEL_OWNER_KEY) === connectorId
    )
}

/** Every label pill on the page, grouped by the connector it belongs to. */
export type LabelIndex = ReadonlyMap<string, ReadonlyArray<FrameNode>>

/**
 * One page scan for every label on it, instead of one scan per connector.
 *
 * Syncing a connector asks whether it has a label, and asking used to mean
 * `findAllWithCriteria` over the whole page — affordable when only the
 * handful of connectors attached to what moved were being synced, much less
 * so now that a screen dragged past a line re-syncs it too. A drag delivers
 * a `nodechange` per frame, so this is the one cost in the loop that grows
 * with both the size of the file and the number of lines near the drag.
 */
export function collectConnectorLabels(): LabelIndex {
  const byConnector = new Map<string, Array<FrameNode>>()
  for (const node of figma.currentPage.findAllWithCriteria({
    pluginData: { keys: [LABEL_OWNER_KEY] }
  })) {
    if (node.type !== 'FRAME') continue
    const ownerId = node.getPluginData(LABEL_OWNER_KEY)
    if (ownerId === '') continue
    const existing = byConnector.get(ownerId)
    if (typeof existing === 'undefined') byConnector.set(ownerId, [node])
    else existing.push(node)
  }
  return byConnector
}

// A deleted label's pluginData is gone by the time `nodechange` reports the
// DELETE — same reasoning as annotation's `ownerIdByRenderedNodeId`. Without
// this, a person deleting a label pill directly (a real, selectable,
// unlocked node) while the plugin is open has no way to trace back to which
// connector it belonged to, so `record.label` never gets cleared and the
// next sync recreates the very pill that was just deleted.
const labelOwnerByRenderedNodeId = new Map<string, string>()

/**
 * The connector each label pill in `nodes` belongs to, keyed by the pill's id.
 *
 * Lets a selection of the pill stand for a selection of its line, so clicking
 * the label on the canvas opens that connector for editing rather than
 * selecting a frame the panel has nothing to say about. Whole-selection and
 * single-scan for the same reason as `annotationTargetsBehind`.
 */
export function connectorsBehindLabels(
  nodes: ReadonlyArray<SceneNode>
): Map<string, VectorNode> {
  const wanted = new Map<string, Array<string>>()
  for (const node of nodes) {
    const ownerId = node.getPluginData(LABEL_OWNER_KEY)
    if (ownerId === '') continue
    const asking = wanted.get(ownerId)
    if (typeof asking === 'undefined') wanted.set(ownerId, [node.id])
    else asking.push(node.id)
  }
  const resolved = new Map<string, VectorNode>()
  if (wanted.size === 0) return resolved
  for (const connector of findAllConnectors()) {
    const asking = wanted.get(connector.id)
    if (typeof asking === 'undefined') continue
    for (const id of asking) resolved.set(id, connector)
  }
  return resolved
}

/** The connector a now-deleted label used to belong to — see `labelOwnerByRenderedNodeId`. */
export function lastKnownLabelOwnerOf(labelId: string): string | null {
  return labelOwnerByRenderedNodeId.get(labelId) ?? null
}

/**
 * Takes text typed straight into a label pill on the canvas and makes it the
 * connector's label.
 *
 * Without it, typing into the pill — which the pill being clickable rather
 * invites — is undone by the next sync, since the pill is drawn from
 * `record.label`. Same reasoning as `captureCardTextEdit`.
 */
export async function captureLabelTextEdit(text: TextNode): Promise<boolean> {
  const pill = text.parent
  if (pill === null || pill.type !== 'FRAME') return false
  const connectorId = pill.getPluginData(LABEL_OWNER_KEY)
  if (connectorId === '') return false
  const connector = findAllConnectors().find((node) => node.id === connectorId)
  if (typeof connector === 'undefined') return false
  const record = getConnectorRecord(connector)
  if (record === null || record.label === text.characters) return false
  await updateConnectorStyle(connector, { label: text.characters })
  return true
}

/**
 * A fingerprint of the shape on the node, for spotting an edit that was not
 * ours.
 *
 * Every vertex and every join, not the bounding box: pulling a bend inwards
 * leaves the box exactly as it was — it is defined by the two ends — and the
 * vertex count with it, so a box-and-count fingerprint reports no change and
 * the edit is redrawn over in silence. A connector carries a handful of
 * vertices, so hashing all of them costs nothing worth measuring.
 *
 * Rounded to whole units, because the plugin's own writes come back with the
 * sub-pixel drift of a float round-trip, and a fingerprint that changes on
 * its own would claim every line in the file as hand-drawn.
 */
function shapeFingerprint(node: VectorNode): string {
  const network = node.vectorNetwork
  const vertices = network.vertices
    .map((vertex) => `${Math.round(vertex.x)},${Math.round(vertex.y)}`)
    .join(';')
  const segments = network.segments.map((segment) => `${segment.start}>${segment.end}`).join(';')
  // Vertices and joins only, never the node's position. Vertices are stored
  // relative to the node, so nudging a whole connector with an arrow key —
  // or dropping it onto a frame, which reparents it and rewrites x/y —
  // changes the position and not one thing about the shape. Including
  // position would hand routing over for good on a keystroke that reshaped
  // nothing, which is not what "somebody reshaped this" should mean.
  return `${vertices}|${segments}`
}

/** Records the shape just drawn, so the next change to it can be attributed. */
function rememberDrawnShape(node: VectorNode): void {
  node.setPluginData(DRAWN_AS_KEY, shapeFingerprint(node))
}

/**
 * Notices that somebody has reshaped a connector with Figma's own tools and
 * hands its geometry over for good.
 *
 * Returns `false` for a shape that matches what this plugin drew — every
 * ordinary sync — so the caller can carry on.
 */
export async function captureManualReshape(node: SceneNode): Promise<boolean> {
  if (node.type !== 'VECTOR') return false
  const record = getConnectorRecord(node)
  if (record === null) return false
  const remembered = node.getPluginData(DRAWN_AS_KEY)
  // Nothing remembered means this line predates the fingerprint. Treating
  // that as an edit would hand over every old connector in the file the
  // first time anything moved, so it is left alone and fingerprinted on its
  // next sync.
  if (remembered === '' || remembered === shapeFingerprint(node)) return false

  // Read once, here, and kept on the record — after this, drawing goes back
  // to flowing one way like everything else. Reading the node on every sync
  // instead is what the project's own rule warns against, and what made the
  // handles loop.
  const [startBoxes, endBoxes] = await Promise.all([
    record.start.kind === 'free' ? Promise.resolve(NO_ENDPOINT) : boxesOf(record.start.nodeId),
    record.end.kind === 'free' ? Promise.resolve(NO_ENDPOINT) : boxesOf(record.end.nodeId)
  ])
  const geometry = resolveConnectorGeometry(
    record,
    startBoxes.rect,
    endBoxes.rect,
    startBoxes.frameRect,
    endBoxes.frameRect
  )
  const drawn = drawnShapeOf(node)
  const manualShape =
    geometry.start === null || geometry.end === null || drawn === null
      ? null
      : {
          ...orientedTowards(drawn, geometry.start, geometry.end),
          start: geometry.start,
          end: geometry.end
        }

  writeConnectorRecord(node, { ...record, manualGeometry: true, manualShape })
  if (!record.manualGeometry) {
    figma.notify('เส้นนี้ถูกปรับเอง ปลั๊กอินจะเลื่อนตาม layer ให้ แต่จะไม่คำนวณเส้นทางใหม่')
  }
  return true
}

/**
 * The shape on the node: its vertices with their curve handles, and the
 * order the line actually visits them.
 *
 * The vertex list is not the path. Adding a point mid-line with the pen tool
 * appends it to the end of the list, so redrawing in list order would jump
 * the line out to the far end and back. The segments say what joins what, so
 * the path is walked from them.
 *
 * Coordinates are made absolute against the node's *bounding box* rather
 * than its `x`/`y`: dropping a connector onto a frame reparents it, after
 * which `x`/`y` mean "relative to that frame" and would put the stored shape
 * a whole frame origin away from where it is.
 *
 * `null` when the shape is not a single open run — a person who has cut a
 * connector into two pieces, or closed it into a loop, is holding something
 * this cannot carry, and guessing at it would be worse than leaving it be.
 */
function drawnShapeOf(node: VectorNode): { vertices: ReadonlyArray<ManualVertex>; order: ReadonlyArray<number> } | null {
  const network = node.vectorNetwork
  if (network.vertices.length < 2) return null

  // `absoluteTransform`, not the bounding box and not `x`/`y`. A vertex is
  // stored relative to the node's own origin; the bounding box is a
  // different rectangle again — it is grown by the stroke width, so using it
  // shifts every point by half a stroke — and `x`/`y` mean "relative to the
  // parent", which stops being the page the moment somebody drops the
  // connector onto a frame. The transform is the one thing that answers
  // "where is this on the canvas" whatever the node's parent is.
  const transform = node.absoluteTransform
  const absoluteX = transform[0]?.[2] ?? node.x
  const absoluteY = transform[1]?.[2] ?? node.y
  const vertices: Array<ManualVertex> = network.vertices.map((vertex) => ({
    at: { x: vertex.x + absoluteX, y: vertex.y + absoluteY },
    tangentIn: null,
    tangentOut: null
  }))

  // Who is joined to whom, and with what curvature.
  const neighbours = new Map<number, Array<number>>()
  const tangents = new Map<string, Point>()
  for (const segment of network.segments) {
    for (const [from, to] of [
      [segment.start, segment.end],
      [segment.end, segment.start]
    ]) {
      const list = neighbours.get(from as number) ?? []
      list.push(to as number)
      neighbours.set(from as number, list)
    }
    if (typeof segment.tangentStart !== 'undefined') {
      tangents.set(`${segment.start}>${segment.end}`, segment.tangentStart)
    }
    if (typeof segment.tangentEnd !== 'undefined') {
      tangents.set(`${segment.end}>${segment.start}`, segment.tangentEnd)
    }
  }

  // An open run has exactly two ends — vertices joined to one other vertex.
  const ends = [...neighbours].filter(([, list]) => list.length === 1).map(([index]) => index)
  if (ends.length !== 2) return null

  const order: Array<number> = []
  const seen = new Set<number>()
  let current = ends[0] as number
  while (!seen.has(current)) {
    order.push(current)
    seen.add(current)
    const next = (neighbours.get(current) ?? []).find((candidate) => !seen.has(candidate))
    if (typeof next === 'undefined') break
    current = next
  }
  if (order.length !== network.vertices.length) return null

  for (let i = 0; i < order.length; i += 1) {
    const index = order[i] as number
    const previous = i > 0 ? (order[i - 1] as number) : null
    const next = i < order.length - 1 ? (order[i + 1] as number) : null
    const vertex = vertices[index]
    if (typeof vertex === 'undefined') continue
    vertices[index] = {
      at: vertex.at,
      tangentIn: previous === null ? null : tangents.get(`${index}>${previous}`) ?? null,
      tangentOut: next === null ? null : tangents.get(`${index}>${next}`) ?? null
    }
  }
  return { vertices, order }
}

/** Puts a hand-drawn connector back under the plugin's own routing. */
export async function restoreAutomaticRoute(connector: VectorNode): Promise<void> {
  await updateConnectorStyle(connector, { manualGeometry: false, manualShape: null })
}

/**
 * The middle of the line as it is actually drawn, for placing the label on a
 * connector this plugin no longer routes.
 *
 * Reads the node's own vertices, which the "geometry flows one way" rule
 * otherwise forbids — allowed here precisely because the flow has stopped:
 * nothing is written back, and there is no other source for where the middle
 * of a hand-drawn line is.
 */
function midpointOfDrawnLine(node: VectorNode): Point {
  // Walked, not listed. The vertex list is not the path — a point added
  // mid-line with the pen tool is appended to the end of it — so measuring
  // "halfway along" down the list would zig-zag out to one end and back, and
  // park the label somewhere the line never goes. `drawnShapeOf` answers
  // `null` for a shape it cannot walk (a cut line, a closed loop); there is
  // no better order to fall back on for those than the one on the node.
  const drawn = drawnShapeOf(node)
  const points =
    drawn === null
      ? node.vectorNetwork.vertices.map((vertex) => ({ x: vertex.x + node.x, y: vertex.y + node.y }))
      : drawn.order.map((index) => (drawn.vertices[index] as ManualVertex).at)
  if (points.length === 0) {
    const box = node.absoluteBoundingBox
    return box === null
      ? { x: node.x, y: node.y }
      : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  return pointAlongPolyline(points, 0.5)
}

/** Removes a connector's label, if it has one — used when the connector itself is deleted. */
export function removeConnectorLabel(connectorId: string): void {
  const label = findConnectorLabel(connectorId)
  if (label !== null) {
    label.remove()
    labelOwnerByRenderedNodeId.delete(label.id)
  }
}

const LABEL_FONT: FontName = { family: 'Inter', style: 'Regular' }
const LABEL_PADDING_X = 8
const LABEL_PADDING_Y = 4

/**
 * Renders (or removes) a connector's label at `midpoint` — a small white
 * pill, Autoflow-style, sitting on the route rather than off to one side.
 * Locked and fully derived, same discipline as the badge/leader used to be:
 * its only source of truth is `record.label` plus the route just drawn, so
 * editing it has to go through the plugin, not a direct double-click.
 */
async function ensureConnectorLabel(
  connectorId: string,
  existing: FrameNode | null,
  text: string,
  midpoint: Point
): Promise<void> {
  const trimmed = text.trim()
  if (trimmed === '') {
    if (existing !== null) {
      existing.remove()
      labelOwnerByRenderedNodeId.delete(existing.id)
    }
    return
  }

  const pill = existing ?? figma.createFrame()
  if (existing === null) {
    pill.layoutMode = 'HORIZONTAL'
    pill.primaryAxisSizingMode = 'AUTO'
    pill.counterAxisSizingMode = 'AUTO'
    pill.paddingLeft = LABEL_PADDING_X
    pill.paddingRight = LABEL_PADDING_X
    pill.paddingTop = LABEL_PADDING_Y
    pill.paddingBottom = LABEL_PADDING_Y
    pill.cornerRadius = 6
    pill.strokeWeight = 1
    pill.setPluginData(LABEL_OWNER_KEY, connectorId)
    labelOwnerByRenderedNodeId.set(pill.id, connectorId)
  }
  // Unlocked, unlike the badge and leader, so a person can click the pill on
  // the canvas to edit its line's label. Set every sync rather than only on
  // creation, so pills made while they were locked become clickable too. The
  // position and text stay fully derived and are reasserted below, so
  // nothing done to it by hand survives — clicking it is the point, editing
  // it in place is not.
  pill.locked = false
  // A space, not the label's text: Figma draws a top-level frame's name on
  // the canvas above the frame, so naming the pill after its own words
  // printed every label twice — once in the pill, once in grey above it.
  // Same reasoning as the annotation card's name.
  pill.name = ' '
  pill.fills = [figma.util.solidPaint('#FFFFFF')]
  pill.strokes = [figma.util.solidPaint('#E1E1E6')]

  let label = pill.children.find((child): child is TextNode => child.type === 'TEXT')
  if (typeof label === 'undefined') {
    label = figma.createText()
    await figma.loadFontAsync(LABEL_FONT)
    label.fontName = LABEL_FONT
    label.fontSize = 11
    label.fills = [figma.util.solidPaint('#1E1E24')]
    pill.appendChild(label)
  }
  if (label.characters !== trimmed) {
    await figma.loadFontAsync(LABEL_FONT)
    label.characters = trimmed
  }

  figma.currentPage.appendChild(pill)
  pill.x = midpoint.x - pill.width / 2
  pill.y = midpoint.y - pill.height / 2
}

interface EndpointBoxes {
  readonly rect: Rect | null
  /** The enclosing frame's box, if the node sits inside one — used to route the connector clear of it before bending. */
  readonly frameRect: Rect | null
  /** Which entry in `collectRouteObstacles` this endpoint lives in, so the route isn't asked to avoid its own screen. */
  readonly obstacleId: string | null
}

const NO_ENDPOINT: EndpointBoxes = { rect: null, frameRect: null, obstacleId: null }

async function boxesOf(nodeId: string): Promise<EndpointBoxes> {
  const node = await figma.getNodeByIdAsync(nodeId)
  if (node === null || !('absoluteBoundingBox' in node)) return NO_ENDPOINT
  const frame = findEnclosingFrame(node)
  return {
    rect: node.absoluteBoundingBox,
    frameRect: frame?.absoluteBoundingBox ?? null,
    obstacleId: topLevelAncestorIdOf(node)
  }
}

const EMPTY_OBSTACLES: RouteObstacles = { foreign: [], own: [] }

/**
 * Sorts the page's boxes into the two kinds `RouteObstacles` distinguishes,
 * and drops the ones too far away to matter.
 *
 * The endpoints' own frames used to be dropped entirely, on the grounds that
 * a connector cannot avoid the screens it is attached to. True of the
 * segments that leave and arrive, and false of everything in between — a
 * route that leaves a screen by its nearest edge is otherwise free to turn
 * straight back through the middle of that same screen, which is exactly the
 * shape `resolveMagnetEscapingFrame` was added to stop producing.
 */
function splitRouteObstacles(
  all: ReadonlyArray<RouteObstacle>,
  geometry: ReturnType<typeof resolveConnectorGeometry>,
  startBoxes: EndpointBoxes,
  endBoxes: EndpointBoxes
): RouteObstacles {
  const start = geometry.start
  const end = geometry.end
  if (start === null || end === null) return EMPTY_OBSTACLES
  const ownIds = new Set(
    [startBoxes.obstacleId, endBoxes.obstacleId].filter((id): id is string => id !== null)
  )
  const near = obstaclesInPlay(
    all.map((obstacle) => obstacle.rect),
    start,
    end,
    ROUTE_SEARCH_MARGIN
  )
  const nearRects = new Set(near)
  const foreign: Array<Rect> = []
  const own: Array<Rect> = []
  for (const obstacle of all) {
    if (!nearRects.has(obstacle.rect)) continue
    if (ownIds.has(obstacle.id)) own.push(obstacle.rect)
    else foreign.push(obstacle.rect)
  }
  return { foreign, own }
}

/** A box an elbow route should bend around, tagged with the node it came from so an endpoint's own screen can be told apart. */
export interface RouteObstacle {
  readonly id: string
  readonly rect: Rect
}

/**
 * The types that count as "another screen in the way". Deliberately only
 * the page's own children (groups and sections aside, which are looked
 * inside), and only container-ish types: the point is to
 * route around the *screens* on the page, which is what a person means by
 * "it doesn't dodge anything". Treating every layer as an obstacle would
 * make a route bend around a button inside a frame it was already routing
 * around, and cost a full-page `findAll` per connector per drag frame to
 * discover.
 */
const OBSTACLE_TYPES: ReadonlySet<string> = new Set([
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE'
])

/**
 * Containers that hold screens rather than being one. Descended into, and
 * never themselves an obstacle.
 *
 * A `SECTION` is where a person puts a whole flow, so it is routinely large
 * enough to hold every screen a connector runs between — treated as one box
 * it swallows them all, and a line between two screens inside it has nothing
 * left to avoid. Worse, it is then the top-level ancestor of both endpoints,
 * so the one box on offer is exempt as their own. That is exactly the report:
 * three screens in a section, and the line straight through the middle one.
 *
 * The same reasoning as `GROUP`, and for the same reason it must be mirrored
 * in `topLevelAncestorIdOf`.
 */
const OBSTACLE_CONTAINERS: ReadonlySet<string> = new Set(['GROUP', 'SECTION'])

/**
 * Every box on the page a connector should route around — the page's own
 * children, plus whatever sits inside a group or section at that level.
 *
 * Our own rendered nodes are skipped: an annotation card and a connector's
 * label pill are both `FRAME`s sitting at the top level, and treating them
 * as obstacles would have connectors swerving around their own labels.
 *
 * Hidden nodes are skipped too. `absoluteBoundingBox` answers just the same
 * for a node with the eye turned off, so without this a connector bends
 * around a screen nobody can see — which reads as the line being broken,
 * since the thing explaining its shape is invisible. Parking an old screen
 * out of the way by hiding it is ordinary use, not an edge case.
 *
 * Exported so a caller syncing several connectors in one batch
 * (`reconcileAllConnectors`, `resyncTouched`) can scan the page once and
 * hand the same list to each `syncConnector`, rather than rescanning per
 * connector.
 */
export function collectRouteObstacles(): ReadonlyArray<RouteObstacle> {
  const obstacles: Array<RouteObstacle> = []
  collectObstaclesFrom(figma.currentPage.children, obstacles)
  obstacleRectsBeforeScan = obstacleRectsAtScan
  obstacleRectsAtScan = new Map(obstacles.map((obstacle) => [obstacle.id, obstacle.rect]))
  return obstacles
}

/**
 * Where each box was as of the *previous* scan, so a box that has since been
 * deleted can still say where it used to sit.
 *
 * A `nodechange` for a deletion arrives after the node is gone: it is absent
 * from the scan that batch runs, and a `RemovedNode` carries no
 * `absoluteBoundingBox` to ask. Without the previous scan to consult there is
 * nothing to hand `findConnectorsNearBoxes`, and every line that was bending
 * around the deleted screen would keep bending around thin air until
 * something else re-synced it.
 *
 * Two maps rather than a growing history: one scan back is all a deletion
 * needs, and anything older is a box no batch will ever ask about again.
 */
let obstacleRectsAtScan: ReadonlyMap<string, Rect> = new Map()
let obstacleRectsBeforeScan: ReadonlyMap<string, Rect> = new Map()

/**
 * Every rectangle that has to be re-examined because the last scan differs
 * from the one before it: boxes that moved or resized (both the space they
 * left and the space they took), boxes that appeared, and boxes that are no
 * longer there.
 *
 * All three cases are the same question asked of the route — is anything
 * different where this line passes — and only the first of them is a *move*.
 * A screen can stop being in the way by being deleted, by being hidden, or
 * by being dragged out of the page entirely, and none of those change a
 * rectangle: the box simply stops being in the list. Reading the difference
 * between two scans catches every one of them without the caller having to
 * know which happened, or a `nodechange` having to describe it.
 */
export function boxesChangedInLastScan(): ReadonlyArray<Rect> {
  const changed: Array<Rect> = []
  for (const [id, rect] of obstacleRectsAtScan) {
    const before = obstacleRectsBeforeScan.get(id)
    if (typeof before === 'undefined') {
      changed.push(rect)
      continue
    }
    // Both rectangles: a move invalidates the lines it has just left alone
    // as well as the ones it has just landed on.
    if (!sameRect(before, rect)) changed.push(before, rect)
  }
  for (const [id, rect] of obstacleRectsBeforeScan) {
    if (!obstacleRectsAtScan.has(id)) changed.push(rect)
  }
  return changed
}

/**
 * Walks `nodes`, taking the boxes and descending into groups.
 *
 * Grouping a set of screens is ordinary tidying, and it used to switch
 * avoidance off without a word: the group is not a type worth avoiding, and
 * the screens inside it stopped being page children, so a page full of
 * screens collected nothing at all. Descending only through `GROUP` keeps
 * the ADR's intent — route around *screens*, and never pay for a deep
 * `findAll` on every frame of a drag — while letting a group be what it is,
 * a handle for moving several screens at once rather than a screen itself.
 */
function collectObstaclesFrom(
  nodes: ReadonlyArray<SceneNode>,
  into: Array<RouteObstacle>
): void {
  for (const node of nodes) {
    if (!node.visible) continue
    if (OBSTACLE_CONTAINERS.has(node.type) && 'children' in node) {
      collectObstaclesFrom(node.children, into)
      continue
    }
    if (!OBSTACLE_TYPES.has(node.type)) continue
    if (ownerIdOf(node) !== null) continue
    if (node.getPluginData(LABEL_OWNER_KEY) !== '') continue
    const rect = node.absoluteBoundingBox
    if (rect === null) continue
    into.push({ id: node.id, rect })
  }
}

/**
 * Renders (or updates) one connector node from its record.
 *
 * `known` is the page's obstacle list from `collectRouteObstacles`, for a
 * caller syncing a batch that would otherwise rescan the page per connector.
 * Left out, an `ELBOW` scans for itself; the scan is skipped entirely for
 * the other line styles, which have no bend to re-aim.
 */
export async function syncConnector(
  node: VectorNode,
  known?: ReadonlyArray<RouteObstacle>,
  labels?: LabelIndex
): Promise<void> {
  const record = getConnectorRecord(node)
  if (record === null) return

  const [startBoxes, endBoxes] = await Promise.all([
    record.start.kind === 'free' ? Promise.resolve(NO_ENDPOINT) : boxesOf(record.start.nodeId),
    record.end.kind === 'free' ? Promise.resolve(NO_ENDPOINT) : boxesOf(record.end.nodeId)
  ])
  const geometry = resolveConnectorGeometry(
    record,
    startBoxes.rect,
    endBoxes.rect,
    startBoxes.frameRect,
    endBoxes.frameRect
  )
  const obstacles =
    record.lineStyle === 'ELBOW' && !record.manualGeometry
      ? splitRouteObstacles(known ?? collectRouteObstacles(), geometry, startBoxes, endBoxes)
      : EMPTY_OBSTACLES

  try {
    await syncConnectorBody(node, record, geometry, startBoxes, endBoxes, obstacles, labels)
  } catch (error) {
    // Same reasoning as the annotation sync's catch — a throw partway
    // through used to leave a half-drawn connector with no visible
    // explanation anywhere but the devtools console.
    figma.notify(`Couldn't update connector "${node.name}": ${String(error)}`, { error: true })
    throw error
  }
}

async function syncConnectorBody(
  node: VectorNode,
  record: ConnectorRecord,
  geometry: ReturnType<typeof resolveConnectorGeometry>,
  startBoxes: EndpointBoxes,
  endBoxes: EndpointBoxes,
  obstacles: RouteObstacles,
  labels?: LabelIndex
): Promise<void> {
  await withSuppressedNodeChangeAsync(async () => {
    // Same reparent-before-position reasoning as annotation cards — the
    // connector itself is never locked (it must stay selectable so its
    // style panel works), so a person can drag it onto a frame and Figma
    // will auto-reparent it there. Reparent back to the page before
    // writing any x/y below, or those page-absolute coordinates get
    // reinterpreted as relative to whatever frame it drifted into.
    //
    // Reparenting keeps the node's `x`/`y` *numbers*, which is the same as
    // teleporting it by the old parent's origin. Every path that draws a
    // route writes x/y afterwards and so never notices; the paths that
    // return without drawing — a dangling line, and a hand-drawn one with no
    // recorded shape to carry — would leave the line a whole frame origin
    // from where it was. So the absolute position is put back straight away,
    // and the drawing paths overwrite it as before.
    const before = node.absoluteTransform
    const absoluteX = before[0]?.[2] ?? node.x
    const absoluteY = before[1]?.[2] ?? node.y
    figma.currentPage.appendChild(node)
    node.x = absoluteX
    node.y = absoluteY
    node.opacity = record.opacity
    if (!geometry.complete) {
      // Dangling — an endpoint's node is gone. Flag it visually and leave
      // the vertices exactly where they last were; there is nothing correct
      // to route to on the missing side, and guessing would be worse than a
      // stale-but-honest line.
      node.strokes = [figma.util.solidPaint(BROKEN_COLOR)]
      node.dashPattern = [2, 3]
      return
    }
    node.strokes = [figma.util.solidPaint(record.color)]
    node.dashPattern = []
    node.strokeWeight = record.strokeWeight
    node.strokeJoin = 'ROUND'
    const start = geometry.start
    const end = geometry.end
    if (start === null || end === null) return

    // Reshaped by hand: everything above still applies — colour, weight, the
    // dash on a broken line — and nothing below does. The plugin has handed
    // over where the line goes and kept what it looks like. The label is
    // placed from the shape actually on the node rather than from a route
    // this code no longer computes.
    if (record.manualGeometry) {
      const midpoint =
        record.manualShape === null
          ? midpointOfDrawnLine(node)
          : await drawManualShape(node, record.manualShape, { start, end }, record)
      await ensureConnectorLabel(
        node.id,
        findConnectorLabel(node.id, labels),
        record.label,
        midpoint
      )
      rememberDrawnShape(node)
      return
    }

    // How far each end has to poke out before it's clear of whatever frame
    // it's nested in — not just clear of the target node's own tiny box —
    // so the route never cuts back across the frame it just left.
    const startClearance = connectorStubClearance(start, geometry.startSide, startBoxes.frameRect)
    const endClearance = connectorStubClearance(end, geometry.endSide, endBoxes.frameRect)
    // Purely cosmetic: when both ends exit along the same axis and both
    // sit inside a frame, prefer bending in the middle of the gap between
    // the two frames rather than the middle of the two raw points — reads
    // as "routed between the screens" instead of an arbitrary offset one
    // way or the other.
    const axis = connectorAxisOf(geometry.startSide)
    const preferredMid =
      axis !== null && axis === connectorAxisOf(geometry.endSide)
        ? frameGapMidpoint(startBoxes.frameRect, endBoxes.frameRect, axis)
        : null

    const midpoint =
      record.lineStyle === 'CURVE'
        ? await positionCurve(
            node,
            start,
            end,
            geometry.startSide,
            geometry.endSide,
            startClearance,
            endClearance,
            record
          )
        : await positionPolyline(node, start, end, record, {
            startSide: geometry.startSide,
            endSide: geometry.endSide,
            startClearance,
            endClearance,
            preferredMid,
            detour: record.detour,
            obstacles
          })
    figma.currentPage.appendChild(node)
    // Fingerprinted after every draw, so the next change to this node can be
    // attributed: matching means we drew it, differing means somebody else did.
    rememberDrawnShape(node)

    await ensureConnectorLabel(
      node.id,
      findConnectorLabel(node.id, labels),
      record.label,
      midpoint
    )
  })
}

interface PolylineRoute extends ElbowRouteOptions {
  readonly startSide: ResolvedMagnet | null
  readonly endSide: ResolvedMagnet | null
}

async function positionPolyline(
  node: VectorNode,
  start: Point,
  end: Point,
  record: ConnectorRecord,
  route: PolylineRoute
): Promise<Point> {
  return drawPoints(
    node,
    connectorRoutePoints(start, end, record.lineStyle, route.startSide, route.endSide, route),
    record
  )
}

/**
 * Redraws a hand-drawn shape where its layers are now, and answers with its
 * midpoint.
 *
 * Nothing about the shape is reinterpreted on the way through: the order the
 * line is walked in, the curve handles, and the absence of corner rounding
 * are all as the person left them. Only position is carried, and only by
 * `shiftManualShape`.
 */
async function drawManualShape(
  node: VectorNode,
  shape: ManualShape,
  now: { start: Point; end: Point },
  record: ConnectorRecord
): Promise<Point> {
  const walked = shape.order.map((index) => (shape.vertices[index] as ManualVertex).at)
  const carried = shiftManualShape(walked, shape, now)
  // The curve handles count towards the origin, for the same reason
  // `positionCurve` folds its control points in: a bezier stays inside the
  // convex hull of its control points, so a bend that bulges past the
  // furthest vertex would otherwise be written at a negative coordinate and
  // the whole shape would land offset from where it was drawn. Generous by
  // a little, which costs nothing, rather than short by a little.
  const bounds = carried.flatMap((point, i) => {
    const vertex = shape.vertices[shape.order[i] as number] as ManualVertex
    return [
      point,
      ...(vertex.tangentIn === null
        ? []
        : [{ x: point.x + vertex.tangentIn.x, y: point.y + vertex.tangentIn.y }]),
      ...(vertex.tangentOut === null
        ? []
        : [{ x: point.x + vertex.tangentOut.x, y: point.y + vertex.tangentOut.y }])
    ]
  })
  const originX = Math.min(...bounds.map((point) => point.x))
  const originY = Math.min(...bounds.map((point) => point.y))
  node.x = originX
  node.y = originY

  const lastIndex = carried.length - 1
  await node.setVectorNetworkAsync({
    // Caps on the two ends, as the routed path does — dropping them left a
    // hand-drawn line with no arrowhead. No cornerRadius on any of them,
    // though: a corner the person made sharp stays sharp, and the record's
    // radius describes the route this plugin draws rather than the one it
    // was handed.
    vertices: carried.map((point, i) => ({
      x: point.x - originX,
      y: point.y - originY,
      strokeCap: i === 0 ? record.startCap : i === lastIndex ? record.endCap : ('NONE' as const)
    })),
    segments: carried.slice(1).map((_point, i) => {
      const from = shape.vertices[shape.order[i] as number] as ManualVertex
      const to = shape.vertices[shape.order[i + 1] as number] as ManualVertex
      return {
        start: i,
        end: i + 1,
        ...(from.tangentOut === null ? {} : { tangentStart: from.tangentOut }),
        ...(to.tangentIn === null ? {} : { tangentEnd: to.tangentIn })
      }
    }),
    regions: []
  })
  return pointAlongPolyline(carried, 0.5)
}

/**
 * Writes a polyline onto the node and answers with its midpoint.
 *
 * Shared by the routed path and the hand-drawn one: a shape carried to
 * follow its layers is drawn exactly the way a computed route is, so caps,
 * corner rounding and the node's origin behave identically either way.
 */
async function drawPoints(
  node: VectorNode,
  points: ReadonlyArray<Point>,
  record: ConnectorRecord
): Promise<Point> {
  const originX = Math.min(...points.map((point) => point.x))
  const originY = Math.min(...points.map((point) => point.y))
  node.x = originX
  node.y = originY
  const lastIndex = points.length - 1
  await node.setVectorNetworkAsync({
    vertices: points.map((point: Point, index) => {
      const isEnd = index === 0 || index === lastIndex
      return {
        x: point.x - originX,
        y: point.y - originY,
        // Only the true ends get a cap — a bend is a corner, not a cap.
        // The reverse is true for corner rounding: a cap is drawn past
        // the end of the line, so rounding an end vertex would have no
        // visible effect — only the bends in between benefit from it.
        strokeCap: index === 0 ? record.startCap : index === lastIndex ? record.endCap : 'NONE',
        ...(isEnd ? {} : { cornerRadius: record.cornerRadius })
      }
    }),
    segments: points.slice(1).map((_point, index) => ({ start: index, end: index + 1 })),
    regions: []
  })
  return pointAlongPolyline(points, 0.5)
}

/**
 * A `CURVE` connector is a single cubic bezier segment, not a polyline —
 * `tangentStart`/`tangentEnd` on the one segment do the work `cornerRadius`
 * does for an elbow. The bezier is guaranteed to stay within the convex hull
 * of its four control points, so taking the min over start/end and their
 * tangent-offset points is a safe (if slightly generous) bound for the
 * node's origin.
 */
async function positionCurve(
  node: VectorNode,
  start: Point,
  end: Point,
  startSide: ResolvedMagnet | null,
  endSide: ResolvedMagnet | null,
  startClearance: number,
  endClearance: number,
  record: ConnectorRecord
): Promise<Point> {
  const curve = connectorCurveTangents(start, end, startSide, endSide, startClearance, endClearance)
  const { tangentStart, tangentEnd } = curve
  const controlStart = { x: start.x + tangentStart.x, y: start.y + tangentStart.y }
  const controlEnd = { x: end.x + tangentEnd.x, y: end.y + tangentEnd.y }
  const originX = Math.min(start.x, end.x, controlStart.x, controlEnd.x)
  const originY = Math.min(start.y, end.y, controlStart.y, controlEnd.y)
  node.x = originX
  node.y = originY
  await node.setVectorNetworkAsync({
    vertices: [
      { x: start.x - originX, y: start.y - originY, strokeCap: record.startCap },
      { x: end.x - originX, y: end.y - originY, strokeCap: record.endCap }
    ],
    segments: [{ start: 0, end: 1, tangentStart, tangentEnd }],
    regions: []
  })
  return pointOnCurve(start, end, curve, 0.5)
}

/** Creates a connector between two nodes and renders it immediately, starting from whatever style was last used. */
export async function createConnector(start: SceneNode, end: SceneNode): Promise<VectorNode> {
  const node = figma.createVector()
  node.name = 'Connector'
  const stylePrefs = await loadLastConnectorStyle()
  const record = createConnectorRecord(start.id, end.id, stylePrefs)
  writeConnectorRecord(node, record)
  await syncConnector(node)
  return node
}

/** Applies a style change (colour, opacity, weight, either end's cap, line style, corner radius, or label) and re-renders. */
export async function updateConnectorStyle(
  node: VectorNode,
  changes: Partial<
    Pick<
      ConnectorRecord,
      | 'color'
      | 'opacity'
      | 'strokeWeight'
      | 'startCap'
      | 'endCap'
      | 'lineStyle'
      | 'cornerRadius'
      | 'detour'
      | 'label'
      | 'manualGeometry'
      | 'manualShape'
    >
  >
): Promise<void> {
  const record = getConnectorRecord(node)
  if (record === null) return
  const next = { ...record, ...changes }
  writeConnectorRecord(node, next)
  await syncConnector(node)
  // Remembered for the next connector someone creates — see
  // `loadLastConnectorStyle`. The label and the detour are deliberately
  // excluded: the label is this connector's own text, and the detour is a
  // decision about one line's path, not a preference (see
  // `ConnectorStylePrefs`).
  await saveLastConnectorStyle({
    strokeWeight: next.strokeWeight,
    color: next.color,
    opacity: next.opacity,
    startCap: next.startCap,
    endCap: next.endCap,
    lineStyle: next.lineStyle,
    cornerRadius: next.cornerRadius
  })
}

/**
 * Pins which side of the start or end node the connector exits/enters from,
 * overriding AUTO. Only meaningful for a `magnet`-kind anchor — a `free` or
 * `ratio` anchor has no "side" to pin, so this is a no-op for those.
 */
export async function updateConnectorAnchorSide(
  node: VectorNode,
  side: 'start' | 'end',
  magnet: Magnet
): Promise<void> {
  const record = getConnectorRecord(node)
  if (record === null) return
  const anchor: Anchor = record[side]
  if (anchor.kind !== 'magnet') return
  writeConnectorRecord(node, { ...record, [side]: { ...anchor, magnet } })
  await syncConnector(node)
}

/** Removes any connector label whose owning connector no longer exists. */
function removeOrphanConnectorLabels(liveConnectorIds: ReadonlySet<string>): void {
  removeOrphansByOwnerKey(LABEL_OWNER_KEY, liveConnectorIds)
}

/** Re-renders every connector on the current page. */
export async function reconcileAllConnectors(): Promise<{ synced: number }> {
  const connectors = findAllConnectors()
  const obstacles = collectRouteObstacles()
  const labels = collectConnectorLabels()
  let synced = 0
  for (const connector of connectors) {
    await syncConnector(connector, obstacles, labels)
    synced += 1
    if (synced % CHUNK_SIZE === 0) await yieldToMainThread()
  }
  removeOrphanConnectorLabels(new Set(connectors.map((connector) => connector.id)))
  return { synced }
}
