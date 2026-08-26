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
  connectorAxisOf,
  connectorCurveTangents,
  connectorRoutePoints,
  connectorStubClearance,
  createConnectorRecord,
  frameGapMidpoint,
  parseConnectorRecord,
  resolveConnectorGeometry,
  serialiseConnectorRecord
} from '../core/connector.js'
import { findEnclosingFrame } from './frames.js'
import { withSuppressedNodeChange, withSuppressedNodeChangeAsync } from './pluginData.js'

const CONNECTOR_KEY = 'connector'
const BROKEN_COLOR = '#E5484D'

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

/** Every connector whose record references `nodeId` on either end. */
export function findConnectorsInvolving(nodeId: string): ReadonlyArray<VectorNode> {
  return findAllConnectors().filter((node) => {
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
  ancestor: SceneNode & ChildrenMixin
): ReadonlyArray<VectorNode> {
  const descendantIds = new Set(ancestor.findAll().map((node) => node.id))
  if (descendantIds.size === 0) return []
  return findAllConnectors().filter((node) => {
    const record = getConnectorRecord(node)
    if (record === null) return false
    return anchorIn(record.start, descendantIds) || anchorIn(record.end, descendantIds)
  })
}

interface EndpointBoxes {
  readonly rect: Rect | null
  /** The enclosing frame's box, if the node sits inside one — used to route the connector clear of it before bending. */
  readonly frameRect: Rect | null
}

const NO_ENDPOINT: EndpointBoxes = { rect: null, frameRect: null }

async function boxesOf(nodeId: string): Promise<EndpointBoxes> {
  const node = await figma.getNodeByIdAsync(nodeId)
  if (node === null || !('absoluteBoundingBox' in node)) return NO_ENDPOINT
  const frame = findEnclosingFrame(node)
  return { rect: node.absoluteBoundingBox, frameRect: frame?.absoluteBoundingBox ?? null }
}

/** Renders (or updates) one connector node from its record. */
export async function syncConnector(node: VectorNode): Promise<void> {
  const record = getConnectorRecord(node)
  if (record === null) return

  const [startBoxes, endBoxes] = await Promise.all([
    record.start.kind === 'free' ? Promise.resolve(NO_ENDPOINT) : boxesOf(record.start.nodeId),
    record.end.kind === 'free' ? Promise.resolve(NO_ENDPOINT) : boxesOf(record.end.nodeId)
  ])
  const geometry = resolveConnectorGeometry(record, startBoxes.rect, endBoxes.rect)

  try {
    await syncConnectorBody(node, record, geometry, startBoxes, endBoxes)
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
  endBoxes: EndpointBoxes
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

    if (record.lineStyle === 'CURVE') {
      await positionCurve(
        node,
        start,
        end,
        geometry.startSide,
        geometry.endSide,
        startClearance,
        endClearance,
        record
      )
    } else {
      await positionPolyline(
        node,
        start,
        end,
        geometry.startSide,
        geometry.endSide,
        startClearance,
        endClearance,
        preferredMid,
        record
      )
    }
    figma.currentPage.appendChild(node)
  })
}

async function positionPolyline(
  node: VectorNode,
  start: Point,
  end: Point,
  startSide: ResolvedMagnet | null,
  endSide: ResolvedMagnet | null,
  startClearance: number,
  endClearance: number,
  preferredMid: number | null,
  record: ConnectorRecord
): Promise<void> {
  const points = connectorRoutePoints(
    start,
    end,
    record.lineStyle,
    startSide,
    endSide,
    startClearance,
    endClearance,
    preferredMid
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
): Promise<void> {
  const { tangentStart, tangentEnd } = connectorCurveTangents(
    start,
    end,
    startSide,
    endSide,
    startClearance,
    endClearance
  )
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
}

/** Creates a connector between two nodes and renders it immediately. */
export async function createConnector(start: SceneNode, end: SceneNode): Promise<VectorNode> {
  const node = figma.createVector()
  node.name = 'Connector'
  const record = createConnectorRecord(start.id, end.id)
  writeConnectorRecord(node, record)
  await syncConnector(node)
  return node
}

/** Applies a style change (colour, opacity, weight, either end's cap, line style, or corner radius) and re-renders. */
export async function updateConnectorStyle(
  node: VectorNode,
  changes: Partial<
    Pick<
      ConnectorRecord,
      'color' | 'opacity' | 'strokeWeight' | 'startCap' | 'endCap' | 'lineStyle' | 'cornerRadius'
    >
  >
): Promise<void> {
  const record = getConnectorRecord(node)
  if (record === null) return
  writeConnectorRecord(node, { ...record, ...changes })
  await syncConnector(node)
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

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const CHUNK_SIZE = 20

/** Re-renders every connector on the current page. */
export async function reconcileAllConnectors(): Promise<{ synced: number }> {
  const connectors = findAllConnectors()
  let synced = 0
  for (const connector of connectors) {
    await syncConnector(connector)
    synced += 1
    if (synced % CHUNK_SIZE === 0) await yieldToMainThread()
  }
  return { synced }
}
