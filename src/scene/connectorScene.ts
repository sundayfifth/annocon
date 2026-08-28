/**
 * Connect feature — draws a `ConnectorRecord` as a real vector node.
 *
 * The record lives in pluginData on the connector's own node (see
 * `core/connector.ts` for why), tagged with `connector` so it's easy to find
 * without scanning every node on the page. Geometry flows one way, same
 * discipline as Annotate: the connector's vertices are always derived from
 * the record plus each endpoint's current box, never read back.
 */

import type { Anchor, Magnet, Point, Rect, ResolvedMagnet } from '../core/anchor.js'
import {
  type ConnectorRecord,
  type ConnectorStylePrefs,
  type ElbowRouteOptions,
  type RouteObstacles,
  connectorAxisOf as connectorAxisOfSide,
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
  pointOnCurve,
  routeCrossings,
  resolveConnectorGeometry,
  serialiseConnectorRecord,
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
 * A connector's optional label — `connectorLabelOwner` pluginData points
 * back at the connector's own node id, the same "tag, then query" shape
 * Annotate uses for its card/leader. A vector node can't have children in
 * Figma, so this has to be its own top-level node rather than nested inside
 * the connector.
 */
function findConnectorLabel(connectorId: string): FrameNode | null {
  const found = figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [LABEL_OWNER_KEY] } })
    .filter(
      (node): node is FrameNode =>
        node.type === 'FRAME' && node.getPluginData(LABEL_OWNER_KEY) === connectorId
    )
  if (found.length <= 1) return found[0] ?? null
  // Same dedupe-and-recreate reasoning as annotation's rendered nodes — no
  // reliable way to tell which duplicate is "correct", so clear the slate.
  for (const node of found) node.remove()
  return null
}

// A deleted label's pluginData is gone by the time `nodechange` reports the
// DELETE — same reasoning as annotation's `ownerIdByRenderedNodeId`. Without
// this, a person deleting a label pill directly (a real, selectable,
// unlocked node) while the plugin is open has no way to trace back to which
// connector it belonged to, so `record.label` never gets cleared and the
// next sync recreates the very pill that was just deleted.
const labelOwnerByRenderedNodeId = new Map<string, string>()

/** The connector a now-deleted label used to belong to — see `labelOwnerByRenderedNodeId`. */
export function lastKnownLabelOwnerOf(labelId: string): string | null {
  return labelOwnerByRenderedNodeId.get(labelId) ?? null
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
    pill.locked = true
    pill.setPluginData(LABEL_OWNER_KEY, connectorId)
    labelOwnerByRenderedNodeId.set(pill.id, connectorId)
  }
  pill.name = trimmed
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
 * How far outside the box spanned by the two endpoints a route is allowed to
 * bulge, and so how far out `obstaclesInPlay` still has to look. Generous
 * enough to cover a detour that goes around a full screen sitting just past
 * one end, which is the widest useful candidate the router ever generates.
 */
const ROUTE_SEARCH_MARGIN = 1200

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
  /** Only for the route diagnostic — nothing about routing depends on it. */
  readonly name: string
  readonly rect: Rect
}

/**
 * The types that count as "another screen in the way". Deliberately only
 * top-level page children, and only container-ish types: the point is to
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
  'INSTANCE',
  'SECTION'
])

/**
 * Every top-level box on the page a connector should route around.
 *
 * Our own rendered nodes are skipped: an annotation card and a connector's
 * label pill are both `FRAME`s sitting at the top level, and treating them
 * as obstacles would have connectors swerving around their own labels.
 *
 * Exported so a caller syncing several connectors in one batch
 * (`reconcileAllConnectors`, `resyncTouched`) can scan the page once and
 * hand the same list to each `syncConnector`, rather than rescanning per
 * connector.
 */
export function collectRouteObstacles(): ReadonlyArray<RouteObstacle> {
  const obstacles: Array<RouteObstacle> = []
  for (const node of figma.currentPage.children) {
    if (!OBSTACLE_TYPES.has(node.type)) continue
    if (ownerIdOf(node) !== null) continue
    if (node.getPluginData(LABEL_OWNER_KEY) !== '') continue
    const rect = node.absoluteBoundingBox
    if (rect === null) continue
    obstacles.push({ id: node.id, name: node.name, rect })
  }
  return obstacles
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
  known?: ReadonlyArray<RouteObstacle>
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
    record.lineStyle === 'ELBOW'
      ? splitRouteObstacles(known ?? collectRouteObstacles(), geometry, startBoxes, endBoxes)
      : EMPTY_OBSTACLES

  try {
    await syncConnectorBody(node, record, geometry, startBoxes, endBoxes, obstacles)
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
  obstacles: RouteObstacles
): Promise<void> {
  await withSuppressedNodeChangeAsync(async () => {
    // Same reparent-before-position reasoning as annotation cards — the
    // connector itself is never locked (it must stay selectable so its
    // style panel works), so a person can drag it onto a frame and Figma
    // will auto-reparent it there. Reparent back to the page before
    // writing any x/y below, or those page-absolute coordinates get
    // reinterpreted as relative to whatever frame it drifted into.
    figma.currentPage.appendChild(node)
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

    await ensureConnectorLabel(node.id, findConnectorLabel(node.id), record.label, midpoint)
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
  const points = connectorRoutePoints(
    start,
    end,
    record.lineStyle,
    route.startSide,
    route.endSide,
    route
  )
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
    >
  >
): Promise<void> {
  const record = getConnectorRecord(node)
  if (record === null) return
  const next = { ...record, ...changes }
  writeConnectorRecord(node, next)
  await syncConnector(node)
  // Remembered for the next connector someone creates — see
  // `loadLastConnectorStyle`. The label is deliberately excluded: it's this
  // connector's own text, not a style preference to carry forward.
  await saveLastConnectorStyle({
    strokeWeight: next.strokeWeight,
    color: next.color,
    opacity: next.opacity,
    startCap: next.startCap,
    endCap: next.endCap,
    lineStyle: next.lineStyle,
    cornerRadius: next.cornerRadius,
    detour: next.detour
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
  let synced = 0
  for (const connector of connectors) {
    await syncConnector(connector, obstacles)
    synced += 1
    if (synced % CHUNK_SIZE === 0) await yieldToMainThread()
  }
  removeOrphanConnectorLabels(new Set(connectors.map((connector) => connector.id)))
  return { synced }
}

/**
 * Explains, in words, why a connector took the route it did — which sides it
 * resolved to, which boxes it was given to avoid, and whether the route it
 * settled on still crosses any of them.
 *
 * Exists because the failure this diagnoses is invisible from the canvas: a
 * line cutting through a frame looks the same whether the router never saw
 * that frame (it is nested, so `collectRouteObstacles` never collected it),
 * saw it but had no shape that could clear it, or excluded it deliberately as
 * one of the connector's own endpoint frames. Those want three different
 * fixes, and guessing between them from a screenshot does not work.
 */
export async function explainConnectorRoute(node: VectorNode): Promise<string> {
  const record = getConnectorRecord(node)
  if (record === null) return 'Not a connector — no record on this node.'

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
  const collected = collectRouteObstacles()
  const obstacles = splitRouteObstacles(collected, geometry, startBoxes, endBoxes)
  const nameOf = (rect: Rect): string =>
    collected.find((obstacle) => obstacle.rect === rect)?.name ?? '?'

  const lines = [
    `Route diagnostic — "${node.name}"`,
    '',
    `line style: ${record.lineStyle}   go around: ${record.detour}`,
    `sides: start ${geometry.startSide ?? 'none'} -> end ${geometry.endSide ?? 'none'}`,
    `axis: start ${connectorAxisOfSide(geometry.startSide) ?? 'none'}, end ${connectorAxisOfSide(geometry.endSide) ?? 'none'}` +
      (connectorAxisOfSide(geometry.startSide) !== null &&
      connectorAxisOfSide(geometry.startSide) === connectorAxisOfSide(geometry.endSide)
        ? '  (same axis — full avoidance)'
        : '  (mixed or unsided — limited avoidance)'),
    '',
    `top-level boxes on this page: ${collected.length}`,
    `  near enough to matter: ${obstacles.foreign.length + obstacles.own.length}`,
    `  this connector's own screens (avoided except where it leaves/arrives): ${obstacles.own.map((rect) => `"${nameOf(rect)}"`).join(', ') || 'none'}`,
    `  everything else it must clear: ${obstacles.foreign.length === 0 ? 'NOTHING' : obstacles.foreign.map((rect) => `"${nameOf(rect)}"`).join(', ')}`
  ]

  if (collected.length <= 2) {
    lines.push(
      '',
      'Only a couple of top-level boxes exist, so almost nothing is being',
      'avoided. If the frames you expect it to dodge are nested inside a',
      'section, group, or a bigger frame, the router never sees them — it',
      'only collects direct children of the page.'
    )
  }

  if (geometry.start !== null && geometry.end !== null) {
    const startClearance = connectorStubClearance(geometry.start, geometry.startSide, startBoxes.frameRect)
    const endClearance = connectorStubClearance(geometry.end, geometry.endSide, endBoxes.frameRect)
    const axis = connectorAxisOfSide(geometry.startSide)
    const preferredMid =
      axis !== null && axis === connectorAxisOfSide(geometry.endSide)
        ? frameGapMidpoint(startBoxes.frameRect, endBoxes.frameRect, axis)
        : null
    const points = connectorRoutePoints(
      geometry.start,
      geometry.end,
      record.lineStyle,
      geometry.startSide,
      geometry.endSide,
      { startClearance, endClearance, preferredMid, detour: record.detour, obstacles }
    )
    const crossed = obstacles.foreign.filter((rect) => routeCrossings(points, [rect]) > 0)
    // Same window `routeCost` scores on: re-entering your own screen after
    // having left it counts, crossing it on the way out does not.
    const reentered = obstacles.own.filter(
      (rect) => routeCrossings(points, [rect], 1, points.length - 3) > 0
    )
    lines.push(
      '',
      `chosen route: ${points.length} points`,
      `still crossing: ${crossed.length === 0 ? 'nothing' : crossed.map((rect) => `"${nameOf(rect)}"`).join(', ')}`,
      `re-entering its own screens: ${reentered.length === 0 ? 'nothing' : reentered.map((rect) => `"${nameOf(rect)}"`).join(', ')}`
    )
  }

  return lines.join('\n')
}
