/**
 * Connect feature — a line between two nodes that stays attached, per
 * ADR 0001. Pure like `annotation.ts`: the record and the geometry it
 * implies are computable without ever touching the `figma` global.
 *
 * Unlike an annotation, a connector has no single "owner" node — it belongs
 * equally to both ends. So the record lives in pluginData on the connector's
 * own rendered node, not on either endpoint. Deleting the connector node on
 * canvas deletes the record with it; there is nothing left to orphan.
 */

import {
  type Anchor,
  type Point,
  type Rect,
  type ResolvedMagnet,
  isMagnet,
  isPoint,
  outwardNormal,
  resolveAnchorPair
} from './anchor.js'

export const CONNECTOR_VERSION = 1

/**
 * A curated mirror of Figma's `StrokeCap` — the whole set is line-end
 * styles, not just arrowheads, so "cap" rather than "arrowhead" throughout.
 * Kept as our own union (not importing the ambient Figma type) so this file
 * never has a reason to assume anything about the `figma` global exists.
 *
 * Figma's own `'ROUND'`/`'SQUARE'` deliberately left out: those are a subtle
 * line-tip rounding/squaring-off, sized off the stroke weight itself (the
 * same thing CSS/SVG's `stroke-linecap` does) — not a marker shape. At the
 * thin weights a connector actually uses, they render as good as invisible,
 * which just reads as "I picked this and nothing happened." The `_FILLED`
 * caps are real marker shapes with their own visible size regardless of
 * stroke weight, which is what a person picking a "cap" actually expects.
 */
export type ConnectorCap =
  | 'NONE'
  | 'ARROW_LINES'
  | 'ARROW_EQUILATERAL'
  | 'DIAMOND_FILLED'
  | 'TRIANGLE_FILLED'
  | 'CIRCLE_FILLED'

export const CONNECTOR_CAPS: ReadonlyArray<ConnectorCap> = [
  'NONE',
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'DIAMOND_FILLED',
  'TRIANGLE_FILLED',
  'CIRCLE_FILLED'
]

/**
 * `STRAIGHT` is a direct line; `ELBOW` routes with right-angled bends,
 * FigJam/Autoflow-style; `CURVE` is a smooth S-curve that still leaves and
 * arrives perpendicular to each end's side.
 */
export type ConnectorLineStyle = 'STRAIGHT' | 'ELBOW' | 'CURVE'

export interface ConnectorRecord {
  readonly v: typeof CONNECTOR_VERSION
  readonly start: Anchor
  readonly end: Anchor
  readonly strokeWeight: number
  /** Hex colour, e.g. `#7B61FF`. */
  readonly color: string
  /** 0 (invisible) .. 1 (opaque). */
  readonly opacity: number
  readonly startCap: ConnectorCap
  readonly endCap: ConnectorCap
  readonly lineStyle: ConnectorLineStyle
  /** How rounded an `ELBOW` bend is. Meaningless (and unused) for `STRAIGHT`/`CURVE`. */
  readonly cornerRadius: number
  /** An optional label drawn at the midpoint of the route, FigJam/Autoflow-style. Empty string means no label. */
  readonly label: string
}

export const DEFAULT_CONNECTOR_WEIGHT = 1.5
export const DEFAULT_CONNECTOR_COLOR = '#000000'
export const DEFAULT_CONNECTOR_OPACITY = 1
export const DEFAULT_START_CAP: ConnectorCap = 'CIRCLE_FILLED'
export const DEFAULT_END_CAP: ConnectorCap = 'ARROW_EQUILATERAL'
export const DEFAULT_LINE_STYLE: ConnectorLineStyle = 'ELBOW'
export const DEFAULT_CORNER_RADIUS = 20
export const DEFAULT_LABEL = ''

/** The style fields a new connector inherits from whatever was last set — everything in `ConnectorRecord` except its anchors and its (per-connector, never inherited) label. */
export interface ConnectorStylePrefs {
  readonly strokeWeight: number
  readonly color: string
  readonly opacity: number
  readonly startCap: ConnectorCap
  readonly endCap: ConnectorCap
  readonly lineStyle: ConnectorLineStyle
  readonly cornerRadius: number
}

export const DEFAULT_CONNECTOR_STYLE_PREFS: ConnectorStylePrefs = {
  strokeWeight: DEFAULT_CONNECTOR_WEIGHT,
  color: DEFAULT_CONNECTOR_COLOR,
  opacity: DEFAULT_CONNECTOR_OPACITY,
  startCap: DEFAULT_START_CAP,
  endCap: DEFAULT_END_CAP,
  lineStyle: DEFAULT_LINE_STYLE,
  cornerRadius: DEFAULT_CORNER_RADIUS
}

export function createConnectorRecord(
  startNodeId: string,
  endNodeId: string,
  stylePrefs: ConnectorStylePrefs = DEFAULT_CONNECTOR_STYLE_PREFS
): ConnectorRecord {
  return {
    v: CONNECTOR_VERSION,
    start: { kind: 'magnet', nodeId: startNodeId, magnet: 'AUTO' },
    end: { kind: 'magnet', nodeId: endNodeId, magnet: 'AUTO' },
    ...stylePrefs,
    label: DEFAULT_LABEL
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const CAP_SET = new Set<string>(CONNECTOR_CAPS)
const LINE_STYLES: ReadonlySet<string> = new Set<ConnectorLineStyle>(['STRAIGHT', 'ELBOW', 'CURVE'])

function isCap(value: unknown): value is ConnectorCap {
  return typeof value === 'string' && CAP_SET.has(value)
}

function isLineStyle(value: unknown): value is ConnectorLineStyle {
  return typeof value === 'string' && LINE_STYLES.has(value)
}

/**
 * The style-field half of decoding a connector out of pluginData — shared by
 * `parseConnectorRecord` (which adds the anchors and label on top) and
 * `parseConnectorStylePrefs` (which is only ever the style fields, decoded
 * from `clientStorage` rather than a connector node). Same tolerant,
 * field-by-field fallback either way: a stray or corrupted value degrades to
 * the shipped default for that one field instead of failing the whole decode.
 */
function stylePrefsFrom(candidate: Record<string, unknown>): ConnectorStylePrefs {
  return {
    strokeWeight:
      typeof candidate.strokeWeight === 'number' && candidate.strokeWeight > 0
        ? candidate.strokeWeight
        : DEFAULT_CONNECTOR_WEIGHT,
    color:
      typeof candidate.color === 'string' && HEX_COLOR.test(candidate.color)
        ? candidate.color
        : DEFAULT_CONNECTOR_COLOR,
    opacity:
      typeof candidate.opacity === 'number' && candidate.opacity >= 0 && candidate.opacity <= 1
        ? candidate.opacity
        : DEFAULT_CONNECTOR_OPACITY,
    startCap: isCap(candidate.startCap) ? candidate.startCap : DEFAULT_START_CAP,
    endCap: isCap(candidate.endCap) ? candidate.endCap : DEFAULT_END_CAP,
    lineStyle: isLineStyle(candidate.lineStyle) ? candidate.lineStyle : DEFAULT_LINE_STYLE,
    cornerRadius:
      typeof candidate.cornerRadius === 'number' && candidate.cornerRadius >= 0
        ? candidate.cornerRadius
        : DEFAULT_CORNER_RADIUS
  }
}

/**
 * Decodes a `ConnectorStylePrefs` out of `clientStorage` — the "last style
 * used" a new connector starts from (see `createConnector`).
 */
export function parseConnectorStylePrefs(raw: string): ConnectorStylePrefs {
  if (raw === '') return DEFAULT_CONNECTOR_STYLE_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_CONNECTOR_STYLE_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CONNECTOR_STYLE_PREFS
  return stylePrefsFrom(parsed as Record<string, unknown>)
}

export function serialiseConnectorStylePrefs(prefs: ConnectorStylePrefs): string {
  return JSON.stringify(prefs)
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'free') {
    return isPoint(candidate.point)
  }
  if (candidate.kind === 'magnet') {
    return (
      typeof candidate.nodeId === 'string' &&
      candidate.nodeId !== '' &&
      isMagnet(candidate.magnet)
    )
  }
  if (candidate.kind === 'ratio') {
    return typeof candidate.nodeId === 'string' && candidate.nodeId !== '' && isPoint(candidate.ratio)
  }
  return false
}

/**
 * Decodes a record out of pluginData. Deliberately tolerant, same reasoning
 * as `parseAnnotationRecord`: a record we cannot read at all is `null`; one
 * that is merely incomplete falls back to defaults field by field.
 */
export function parseConnectorRecord(raw: string): ConnectorRecord | null {
  if (raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  if (!isAnchor(candidate.start) || !isAnchor(candidate.end)) return null
  return {
    v: CONNECTOR_VERSION,
    start: candidate.start,
    end: candidate.end,
    ...stylePrefsFrom(candidate),
    label: typeof candidate.label === 'string' ? candidate.label : DEFAULT_LABEL
  }
}

export function serialiseConnectorRecord(record: ConnectorRecord): string {
  return JSON.stringify(record)
}

export interface ConnectorGeometry {
  readonly start: Point | null
  readonly end: Point | null
  /** `false` when either endpoint's node is gone — the connector is dangling. */
  readonly complete: boolean
  /** Which side of its box each endpoint sits on — `null` for a `free`/`ratio` anchor. */
  readonly startSide: ResolvedMagnet | null
  readonly endSide: ResolvedMagnet | null
}

/** Resolves a connector's endpoints given each anchored node's current box (or `null` if it's gone). */
export function resolveConnectorGeometry(
  record: ConnectorRecord,
  startRect: Rect | null,
  endRect: Rect | null
): ConnectorGeometry {
  const resolved = resolveAnchorPair(record.start, startRect, record.end, endRect)
  return {
    start: resolved.start,
    end: resolved.end,
    complete: resolved.start !== null && resolved.end !== null,
    startSide: resolved.startSide,
    endSide: resolved.endSide
  }
}

/**
 * The un-sided elbow bend: turns at the midpoint of whichever axis has the
 * larger gap between the two points, the same "which axis dominates"
 * comparison `resolveMagnet` uses to pick a side. Degrades to a straight
 * line when the two points already share an axis, so a would-be
 * zero-length middle segment never gets drawn.
 *
 * Used directly when a side is unknown (a `free`/`ratio` anchor has none to
 * respect); when both sides are known, `sidedElbow` wraps this with stubs so
 * the route also leaves and arrives perpendicular to each edge.
 */
function dominantAxisElbow(start: Point, end: Point): ReadonlyArray<Point> {
  if (start.x === end.x || start.y === end.y) {
    return [start, end]
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = start.x + dx / 2
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
  }
  const midY = start.y + dy / 2
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
}

/** How far a sided elbow pokes straight out from the edge before it's allowed to turn. */
const ELBOW_STUB = 24

/**
 * Collapses runs of collinear points and drops repeats, so a stub glued to
 * a bend that happens to continue in the same direction doesn't leave a
 * pointless zero-turn vertex in the middle of the route.
 */
function simplifyRoute(points: ReadonlyArray<Point>): ReadonlyArray<Point> {
  const deduped: Array<Point> = []
  for (const point of points) {
    const prev = deduped[deduped.length - 1]
    if (typeof prev !== 'undefined' && prev.x === point.x && prev.y === point.y) continue
    deduped.push(point)
  }
  const collapsed: Array<Point> = []
  for (const point of deduped) {
    const b = collapsed[collapsed.length - 1]
    const a = collapsed[collapsed.length - 2]
    if (typeof a !== 'undefined' && typeof b !== 'undefined') {
      const stillOnAxis = (a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)
      if (stillOnAxis) collapsed.pop()
    }
    collapsed.push(point)
  }
  return collapsed
}

/** How far past a frame's own edge a connector clears it by, on top of `ELBOW_STUB`. */
export const FRAME_CLEARANCE_MARGIN = 20

/**
 * How far an endpoint needs to poke out in `side`'s direction to actually
 * clear `frame` (plus a small margin) before it's allowed to bend — so a
 * connector anchored to something nested inside a frame pokes all the way
 * past the frame's own edge instead of cutting a corner across the frame's
 * own content the moment it clears the target node's tiny box. Falls back
 * to the flat `ELBOW_STUB` when there's no frame to clear, or no side to
 * measure from (a `free`/`ratio` anchor).
 */
export function connectorStubClearance(
  point: Point,
  side: ResolvedMagnet | null,
  frame: Rect | null,
  margin: number = FRAME_CLEARANCE_MARGIN
): number {
  if (side === null || frame === null) return ELBOW_STUB
  switch (side) {
    case 'RIGHT':
      return Math.max(ELBOW_STUB, frame.x + frame.width + margin - point.x)
    case 'LEFT':
      return Math.max(ELBOW_STUB, point.x - (frame.x - margin))
    case 'BOTTOM':
      return Math.max(ELBOW_STUB, frame.y + frame.height + margin - point.y)
    case 'TOP':
      return Math.max(ELBOW_STUB, point.y - (frame.y - margin))
    case 'CENTER':
      return ELBOW_STUB
  }
}

/** Which coordinate a side moves along — `null` for `CENTER`, which has no direction to respect. */
export function connectorAxisOf(side: ResolvedMagnet | null): 'x' | 'y' | null {
  switch (side) {
    case 'LEFT':
    case 'RIGHT':
      return 'x'
    case 'TOP':
    case 'BOTTOM':
      return 'y'
    default:
      return null
  }
}

/** +1 for the sides whose outward normal is positive on their axis (RIGHT, BOTTOM), -1 otherwise. */
function signOf(side: ResolvedMagnet): 1 | -1 {
  return side === 'LEFT' || side === 'TOP' ? -1 : 1
}

/**
 * The always-valid fallback: pokes straight out from each edge by
 * `startClearance`/`endClearance`, then bridges the two stub points with a
 * `dominantAxisElbow`. Correct in every case, including two ends that face
 * away from each other — but can add more bends than the geometry strictly
 * needs, which is why `sidedElbow` only reaches for this when a cleaner
 * route genuinely doesn't fit.
 */
function detourElbow(
  start: Point,
  end: Point,
  startSide: ResolvedMagnet,
  endSide: ResolvedMagnet,
  startClearance: number,
  endClearance: number
): ReadonlyArray<Point> {
  const startOut = outwardNormal(startSide)
  const endOut = outwardNormal(endSide)
  const stubStart = {
    x: start.x + startOut.x * startClearance,
    y: start.y + startOut.y * startClearance
  }
  const stubEnd = { x: end.x + endOut.x * endClearance, y: end.y + endOut.y * endClearance }
  return simplifyRoute([start, ...dominantAxisElbow(stubStart, stubEnd), end])
}

/**
 * An elbow route that respects both ends' sides, using the fewest bends the
 * geometry allows: a single Z (one bend on each side of a shared mid-line)
 * when both ends exit along the same axis, a single corner when they exit
 * along different axes, and only the four-bend `detourElbow` when neither
 * of those actually clears both ends' minimum stub distance — e.g. the two
 * ends face away from each other, or clearing a frame eats the room a
 * simple bend would have used.
 *
 * `preferredMid` (from `frameGapMidpoint`) nudges the shared mid-line to
 * the middle of the gap between the two frames rather than the middle of
 * the two raw points, when that's available and still leaves both ends
 * enough room — purely cosmetic, clamped into whatever range stays valid.
 */
function sidedElbow(
  start: Point,
  end: Point,
  startSide: ResolvedMagnet,
  endSide: ResolvedMagnet,
  startClearance: number,
  endClearance: number,
  preferredMid: number | null
): ReadonlyArray<Point> {
  const startAxis = connectorAxisOf(startSide)
  const endAxis = connectorAxisOf(endSide)
  if (startAxis === null || endAxis === null) {
    return detourElbow(start, end, startSide, endSide, startClearance, endClearance)
  }
  const startSign = signOf(startSide)
  const endSign = signOf(endSide)

  if (startAxis === endAxis) {
    const axis = startAxis
    const minStart = start[axis] + startSign * startClearance
    const minEnd = end[axis] + endSign * endClearance
    let lo = Number.NEGATIVE_INFINITY
    let hi = Number.POSITIVE_INFINITY
    if (startSign > 0) lo = Math.max(lo, minStart)
    else hi = Math.min(hi, minStart)
    if (endSign > 0) lo = Math.max(lo, minEnd)
    else hi = Math.min(hi, minEnd)

    if (lo <= hi) {
      const natural = (start[axis] + end[axis]) / 2
      const mid = Math.min(hi, Math.max(lo, preferredMid ?? natural))
      const p1: Point = axis === 'x' ? { x: mid, y: start.y } : { x: start.x, y: mid }
      const p2: Point = axis === 'x' ? { x: mid, y: end.y } : { x: end.x, y: mid }
      return simplifyRoute([start, p1, p2, end])
    }
  } else {
    const corner: Point = startAxis === 'x' ? { x: end.x, y: start.y } : { x: start.x, y: end.y }
    const startOk =
      startSign > 0
        ? corner[startAxis] >= start[startAxis] + startClearance
        : corner[startAxis] <= start[startAxis] - startClearance
    const endOk =
      endSign > 0
        ? corner[endAxis] >= end[endAxis] + endClearance
        : corner[endAxis] <= end[endAxis] - endClearance
    if (startOk && endOk) {
      return simplifyRoute([start, corner, end])
    }
  }

  return detourElbow(start, end, startSide, endSide, startClearance, endClearance)
}

/**
 * The midpoint of the gap between two frames along `axis`, when they're
 * cleanly side by side (or stacked) on it — e.g. two screens placed next to
 * each other in a flow. `null` when either frame is missing or they overlap
 * on that axis, so there's no simple gap to bisect; the caller falls back
 * to bisecting the two raw points instead.
 */
export function frameGapMidpoint(startFrame: Rect | null, endFrame: Rect | null, axis: 'x' | 'y'): number | null {
  if (startFrame === null || endFrame === null) return null
  const size = axis === 'x' ? 'width' : 'height'
  const startFar = startFrame[axis] + startFrame[size]
  const endFar = endFrame[axis] + endFrame[size]
  if (startFar <= endFrame[axis]) return (startFar + endFrame[axis]) / 2
  if (endFar <= startFrame[axis]) return (endFar + startFrame[axis]) / 2
  return null
}

/**
 * The connector's route as a polyline — two points for `STRAIGHT`, up to six
 * for a sided `ELBOW` in the rare case that needs `detourElbow`'s full
 * stub-then-bend (most sided elbows are a clean 3- or 4-point route).
 *
 * `startSide`/`endSide` come from `ConnectorGeometry` — `null` for a
 * `free`/`ratio` anchor, which has no side to respect, so the route falls
 * back to a plain unsided bend for that case. `startClearance`/`endClearance`
 * default to the flat `ELBOW_STUB`; pass the result of
 * `connectorStubClearance` instead to clear an enclosing frame.
 * `preferredMid` (optional, from `frameGapMidpoint`) is a cosmetic hint for
 * where the bend should land when there's a choice.
 *
 * Deliberately does *not* shortcut to a bare `[start, end]` just because the
 * two points happen to share an x or y — with both sides known, that
 * coincidence says nothing about whether a straight line actually leaves
 * and arrives perpendicular to each side, or clears whatever frame either
 * end is nested in. `dominantAxisElbow` and `sidedElbow` each already
 * collapse to a straight line themselves, exactly when doing so is still
 * correct for the case they're handling.
 */
export function connectorRoutePoints(
  start: Point,
  end: Point,
  lineStyle: ConnectorLineStyle,
  startSide: ResolvedMagnet | null = null,
  endSide: ResolvedMagnet | null = null,
  startClearance: number = ELBOW_STUB,
  endClearance: number = ELBOW_STUB,
  preferredMid: number | null = null
): ReadonlyArray<Point> {
  if (lineStyle !== 'ELBOW') {
    return [start, end]
  }
  if (startSide === null || endSide === null) {
    return dominantAxisElbow(start, end)
  }
  return sidedElbow(start, end, startSide, endSide, startClearance, endClearance, preferredMid)
}

const CURVE_HANDLE_MIN = 32
const CURVE_HANDLE_MAX = 140
const CURVE_HANDLE_RATIO = 0.4

export interface ConnectorCurve {
  /** Bezier control-point offset from `start`, in the direction the line leaves it. */
  readonly tangentStart: Point
  /** Bezier control-point offset from `end`, in the direction the line leaves it (mirrors `tangentStart`). */
  readonly tangentEnd: Point
}

/**
 * The handle vectors for a `CURVE` connector — a single cubic bezier from
 * `start` to `end` that still leaves and arrives perpendicular to each
 * side, the curved counterpart to `sidedElbow`'s stubs. Both handles point
 * *outward* from their own box (Figma's `tangentEnd` is measured the same
 * way as `tangentStart`, not reversed), which is what bends the curve away
 * from the edge before it sweeps toward the other end.
 *
 * Falls back to a handle aimed along the straight line between the points
 * when a side is unknown, so a `free`/`ratio` anchor still gets a gentle,
 * if directionless, curve instead of a hard corner.
 *
 * `startClearance`/`endClearance` (default 0, i.e. no floor) raise a
 * handle's length past the proportional default when it isn't enough to
 * clear an enclosing frame — the curved counterpart to `sidedElbow`'s
 * `startClearance`/`endClearance`, from `connectorStubClearance`. Still
 * capped at `CURVE_HANDLE_MAX`: a wide enough frame would otherwise stretch
 * the handle into a floppy loop instead of a clean curve — better to fall
 * short of clearing a very large frame than to look broken doing it.
 */
export function connectorCurveTangents(
  start: Point,
  end: Point,
  startSide: ResolvedMagnet | null,
  endSide: ResolvedMagnet | null,
  startClearance = 0,
  endClearance = 0
): ConnectorCurve {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const baseHandle = Math.min(CURVE_HANDLE_MAX, Math.max(CURVE_HANDLE_MIN, distance * CURVE_HANDLE_RATIO))
  const forward =
    distance === 0 ? { x: 0, y: 0 } : { x: (end.x - start.x) / distance, y: (end.y - start.y) / distance }
  const startDir = startSide === null ? forward : outwardNormal(startSide)
  const endDir = endSide === null ? { x: -forward.x, y: -forward.y } : outwardNormal(endSide)
  const startLength = Math.min(CURVE_HANDLE_MAX, Math.max(baseHandle, startClearance))
  const endLength = Math.min(CURVE_HANDLE_MAX, Math.max(baseHandle, endClearance))
  return {
    tangentStart: { x: startDir.x * startLength, y: startDir.y * startLength },
    tangentEnd: { x: endDir.x * endLength, y: endDir.y * endLength }
  }
}

/**
 * A point a fraction `t` (0..1) along a polyline, by cumulative segment
 * length rather than by vertex index — a route with a short stub and a long
 * middle run would otherwise put the "midpoint" nowhere near the visual
 * middle. Used to place a connector's label (`ConnectorRecord.label`) on
 * `STRAIGHT`/`ELBOW` routes.
 */
export function pointAlongPolyline(points: ReadonlyArray<Point>, t: number): Point {
  const first = points[0]
  if (typeof first === 'undefined') return { x: 0, y: 0 }
  if (points.length === 1) return first

  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    total += Math.hypot(to.x - from.x, to.y - from.y)
  }
  if (total === 0) return first

  let remaining = Math.min(1, Math.max(0, t)) * total
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (remaining <= length || i === points.length - 2) {
      const ratio = length === 0 ? 0 : remaining / length
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
    }
    remaining -= length
  }
  return first
}

/**
 * The point at parameter `t` (0..1) on the cubic bezier a `CURVE` connector
 * draws — the curved counterpart to `pointAlongPolyline`, for the same
 * label-placement purpose. A parametric midpoint (`t = 0.5`), not a true
 * arc-length one; close enough for where a label sits.
 */
export function pointOnCurve(start: Point, end: Point, curve: ConnectorCurve, t: number): Point {
  const p1 = { x: start.x + curve.tangentStart.x, y: start.y + curve.tangentStart.y }
  const p2 = { x: end.x + curve.tangentEnd.x, y: end.y + curve.tangentEnd.y }
  const mt = 1 - t
  return {
    x: mt * mt * mt * start.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * end.x,
    y: mt * mt * mt * start.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * end.y
  }
}
