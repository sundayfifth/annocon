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
 * Which way a connector goes around a box parked in its path.
 *
 * `AUTO` takes whichever way is shorter, which is right almost always and
 * arbitrary when the two ways tie. The rest pin it, for the times a person
 * looks at the automatic choice and wants the other one.
 *
 * Only one pair ever applies to a given connector: a route running left to
 * right can go over or under it (`TOP`/`BOTTOM`), one running top to bottom
 * can pass either side of it (`LEFT`/`RIGHT`). Picking one that doesn't
 * apply to this connector's direction is not an error — there is simply
 * nothing for it to pin, so the route falls back to `AUTO`.
 */
export type ConnectorDetour = 'AUTO' | 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT'

export const CONNECTOR_DETOURS: ReadonlyArray<ConnectorDetour> = [
  'AUTO',
  'TOP',
  'BOTTOM',
  'LEFT',
  'RIGHT'
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
  /** Which way an `ELBOW` goes around whatever is in its path. Meaningless for `STRAIGHT`/`CURVE`, which don't avoid anything. */
  readonly detour: ConnectorDetour
  /** An optional label drawn at the midpoint of the route, FigJam/Autoflow-style. Empty string means no label. */
  readonly label: string
  /**
   * Set once somebody has reshaped the line themselves with Figma's own
   * vector tools. From then on the plugin stops deciding where it goes.
   *
   * The one place this codebase's "geometry flows one way" rule is answered
   * by handing the geometry over rather than by owning it: the plugin does
   * not read the shape back, it simply stops writing one. Everything else —
   * colour, weight, caps, the label, and being listed as this pair's
   * connector — carries on as before.
   *
   * The cost, taken deliberately: a hand-drawn line no longer follows its
   * layers. Reshaping is a promise that the shape is right, and there is no
   * honest way to keep that promise while moving the shape around.
   */
  readonly manualGeometry: boolean
  /**
   * The shape somebody drew, with the endpoints it was drawn against.
   *
   * Read off the node once, when the edit is noticed, and written to the
   * record — after which drawing goes back to flowing one way, record to
   * node, like everything else here. Keeping it lets a hand-drawn line
   * follow its layers instead of being stranded the first time one moves.
   *
   * `null` for a line that has not been reshaped, and for one reshaped
   * before this was recorded — which is drawn where it stands and left
   * there, since there is nothing to carry it by.
   */
  readonly manualShape: ManualShape | null
}

export const DEFAULT_CONNECTOR_WEIGHT = 1.5
export const DEFAULT_CONNECTOR_COLOR = '#000000'
export const DEFAULT_CONNECTOR_OPACITY = 1
export const DEFAULT_START_CAP: ConnectorCap = 'CIRCLE_FILLED'
export const DEFAULT_END_CAP: ConnectorCap = 'ARROW_EQUILATERAL'
export const DEFAULT_LINE_STYLE: ConnectorLineStyle = 'ELBOW'
export const DEFAULT_CORNER_RADIUS = 20
export const DEFAULT_DETOUR: ConnectorDetour = 'AUTO'
export const DEFAULT_LABEL = ''

/**
 * The style fields a new connector inherits from whatever was last set —
 * everything in `ConnectorRecord` except its anchors, its label, and its
 * detour.
 *
 * The label is excluded because it is this connector's own words. The detour
 * is excluded for a subtler reason: it is not a style in the way the rest of
 * these are. A colour applies to every connector there will ever be, and
 * looks the same on all of them. "Go below" only means anything while
 * something is in the way — so carried forward, it lies dormant on line
 * after line with nothing to avoid, and then one day a screen lands in the
 * path of one of them and it takes effect, months after the choice was made
 * and nowhere near the connector it was made on. A preference that does
 * nothing until it surprises you is worse than one you have to set twice.
 */
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
    // Always AUTO, never inherited — see `ConnectorStylePrefs`.
    detour: DEFAULT_DETOUR,
    label: DEFAULT_LABEL,
    manualGeometry: false,
    manualShape: null
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const CAP_SET = new Set<string>(CONNECTOR_CAPS)
const LINE_STYLES: ReadonlySet<string> = new Set<ConnectorLineStyle>(['STRAIGHT', 'ELBOW', 'CURVE'])
const DETOURS = new Set<string>(CONNECTOR_DETOURS)

function parseManualVertex(value: unknown): ManualVertex | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (!isPoint(candidate.at)) return null
  return {
    at: candidate.at,
    tangentIn: isPoint(candidate.tangentIn) ? candidate.tangentIn : null,
    tangentOut: isPoint(candidate.tangentOut) ? candidate.tangentOut : null
  }
}

/**
 * All of it or none of it, unlike the tolerant field-by-field decoding
 * elsewhere in this file.
 *
 * A style field that fails to decode falls back to a default and the
 * connector still looks like a connector. Half a shape is not half a line —
 * it is a different line, drawn somewhere its author never put it. Better to
 * answer `null` and let the route go back to being computed.
 */
function parseManualShape(value: unknown): ManualShape | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.vertices) || !Array.isArray(candidate.order)) return null
  if (!isPoint(candidate.start) || !isPoint(candidate.end)) return null
  const vertices: Array<ManualVertex> = []
  for (const raw of candidate.vertices) {
    const vertex = parseManualVertex(raw)
    if (vertex === null) return null
    vertices.push(vertex)
  }
  // Two vertices is the least that can describe a line, and the order has to
  // name real ones — an index past the end would draw to nowhere.
  if (vertices.length < 2 || candidate.order.length < 2) return null
  const order: Array<number> = []
  for (const index of candidate.order) {
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length) return null
    order.push(index as number)
  }
  return { vertices, order, start: candidate.start, end: candidate.end }
}

function isDetour(value: unknown): value is ConnectorDetour {
  return typeof value === 'string' && DETOURS.has(value)
}

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
    // Read here rather than in `stylePrefsFrom`, because a connector records
    // its own detour but never hands it on to the next one.
    detour: isDetour(candidate.detour) ? candidate.detour : DEFAULT_DETOUR,
    label: typeof candidate.label === 'string' ? candidate.label : DEFAULT_LABEL,
    manualGeometry: candidate.manualGeometry === true,
    manualShape: parseManualShape(candidate.manualShape)
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

/**
 * Resolves a connector's endpoints given each anchored node's current box
 * (or `null` if it's gone).
 *
 * `startFrame`/`endFrame` are the frames those nodes sit inside, when they
 * are nested in one. They only matter for an `AUTO` magnet, where they turn
 * "which side faces the other end" into "which side gets out of this screen
 * without ploughing through it" — see `resolveMagnetEscapingFrame`.
 */
export function resolveConnectorGeometry(
  record: ConnectorRecord,
  startRect: Rect | null,
  endRect: Rect | null,
  startFrame: Rect | null = null,
  endFrame: Rect | null = null
): ConnectorGeometry {
  const resolved = resolveAnchorPair(
    record.start,
    startRect,
    record.end,
    endRect,
    startFrame,
    endFrame
  )
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

/**
 * How far a sided elbow pokes straight out from the edge before it's allowed
 * to turn.
 *
 * Wider than it reads on paper, and wider than the equivalent on an
 * annotation leader, on purpose: a connector between two screens turning 24
 * units out looks cramped against a 375-wide screen, as though it changed
 * its mind immediately. An annotation's leader runs a short distance to a
 * card parked right beside its target and wants the opposite.
 */
export const ELBOW_STUB = 80

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

/**
 * Whether an axis-aligned segment passes through `rect`'s interior.
 *
 * Only correct for horizontal or vertical segments — an elbow route is
 * nothing but those, and for them the segment *is* its own bounding box, so
 * a box-overlap test is exact rather than conservative. A `CURVE` or a
 * diagonal `STRAIGHT` would need real segment/rect intersection; neither has
 * a bend to re-aim, so neither asks this question.
 *
 * Strict on every edge: a route that runs flush along a frame's edge, or
 * clips its corner, is not cutting *through* it. Being lenient here would
 * make the common case — a connector hugging the gap between two screens —
 * report a crossing it does not have, and send the bend off somewhere worse.
 */
function segmentEntersRect(a: Point, b: Point, rect: Rect): boolean {
  return (
    Math.min(a.x, b.x) < rect.x + rect.width &&
    Math.max(a.x, b.x) > rect.x &&
    Math.min(a.y, b.y) < rect.y + rect.height &&
    Math.max(a.y, b.y) > rect.y
  )
}

/**
 * How many of `obstacles` the route cuts through — counted per obstacle, not
 * per segment, so a route that runs the length of one frame scores the same
 * as one that just clips its corner. What matters when choosing between two
 * candidate routes is how many things each one hits, not how hard.
 */
export function routeCrossings(
  points: ReadonlyArray<Point>,
  obstacles: ReadonlyArray<Rect>,
  fromSegment = 0,
  toSegment: number = Number.POSITIVE_INFINITY
): number {
  const last = Math.min(points.length - 2, toSegment)
  let count = 0
  for (const rect of obstacles) {
    for (let i = Math.max(0, fromSegment); i <= last; i += 1) {
      const from = points[i]
      const to = points[i + 1]
      if (typeof from === 'undefined' || typeof to === 'undefined') continue
      if (segmentEntersRect(from, to, rect)) {
        count += 1
        break
      }
    }
  }
  return count
}

/**
 * The boxes a route has to get past, split by how absolute that is.
 *
 * `foreign` is everything else on the page: crossing one is always a defect.
 * `own` is the frames the two endpoints themselves live inside, where the
 * rule is different rather than absent — a connector anchored to something
 * nested in a frame has no choice but to cross that frame on its way out, so
 * the segment that leaves and the segment that arrives are exempt, but
 * everything in between is held to the same standard as any other frame.
 * Without that second half, a route that carefully leaves by the nearest
 * edge is free to turn straight back through the middle of the same screen.
 */
export interface RouteObstacles {
  readonly foreign: ReadonlyArray<Rect>
  readonly own: ReadonlyArray<Rect>
}

const NO_OBSTACLES: RouteObstacles = { foreign: [], own: [] }

function hasObstacles(obstacles: RouteObstacles): boolean {
  return obstacles.foreign.length > 0 || obstacles.own.length > 0
}

/**
 * How bad a route is: every foreign box it crosses, plus every own frame it
 * re-enters after having left.
 *
 * The exemption covers the leaving and arriving segments against *both* own
 * frames rather than pairing each frame with its own end, and that is
 * deliberate. A route has to finish inside the frame it arrives in, so a
 * first segment long enough to reach that frame early has done nothing
 * wrong — charging it would make a plain straight line between two adjacent
 * screens score worse than a detour around them. What is actually a defect
 * is leaving a frame and turning back into it, and every segment in between
 * is still counted, which is exactly what catches that.
 */
export function routeCost(points: ReadonlyArray<Point>, obstacles: RouteObstacles): number {
  return (
    routeCrossings(points, obstacles.foreign) +
    routeCrossings(points, obstacles.own, 1, points.length - 3)
  )
}

/** Every edge of every box, as a candidate coordinate on `axis`. Used to seed the search. */
export function edgesOn(obstacles: RouteObstacles, axis: 'x' | 'y'): ReadonlyArray<[number, number]> {
  const size = axis === 'x' ? 'width' : 'height'
  const across = axis === 'x' ? 'y' : 'x'
  const acrossSize = axis === 'x' ? 'height' : 'width'
  // Sorted, so the order candidates are offered in — and therefore which
  // side a line takes when two routes tie on length — depends on where the
  // boxes are rather than on whether each was bucketed as foreign or as an
  // endpoint's own screen, which is an implementation detail a person cannot
  // see or predict.
  const all = [...obstacles.foreign, ...obstacles.own].sort(
    (a, b) => a[axis] - b[axis] || a[across] - b[across]
  )
  // Finding each box's neighbours compares every box with every other, and
  // this runs twice per connector per frame of a drag. Measured at 121 boxes
  // it costs about 70% more than the flat standoff it replaced. Past this
  // many, the flat one is the better trade: the difference is how pretty a
  // line looks passing a screen, and nothing looks good in a stuttering
  // editor.
  if (all.length > MAX_MEASURED_NEIGHBOURS) {
    return all.map((rect) => [
      rect[axis] - OBSTACLE_CLEARANCE,
      rect[axis] + rect[size] + OBSTACLE_CLEARANCE
    ])
  }
  const edges: Array<[number, number]> = []
  for (const rect of all) {
    const low = rect[axis]
    const high = rect[axis] + rect[size]
    // The nearest box on each side, so the line can sit midway between the
    // two rather than a fixed distance off one and possibly on top of the
    // other.
    let gapBefore = Number.POSITIVE_INFINITY
    let gapAfter = Number.POSITIVE_INFINITY
    for (const other of all) {
      if (other === rect) continue
      // Only a box that overlaps this one across the other axis is in a
      // position to crowd it: a screen in the next column along is not
      // above or below this one however its coordinates compare, and
      // counting it made a screen in an ordinary row report no neighbours
      // at all while a dense board reported the tightest possible ones —
      // backwards from what the widening was for.
      if (
        other[across] >= rect[across] + rect[acrossSize] ||
        other[across] + other[acrossSize] <= rect[across]
      ) {
        continue
      }
      const otherHigh = other[axis] + other[size]
      if (otherHigh <= low) gapBefore = Math.min(gapBefore, low - otherHigh)
      if (other[axis] >= high) gapAfter = Math.min(gapAfter, other[axis] - high)
    }
    edges.push([low - clearanceBeside(gapBefore), high + clearanceBeside(gapAfter)])
  }
  return edges
}

/** One vertex of a hand-drawn shape: where it is, and how the curve leaves it. */
export interface ManualVertex {
  readonly at: Point
  /** Bezier handles, relative to `at` — `null` for a plain corner. */
  readonly tangentIn: Point | null
  readonly tangentOut: Point | null
}

/**
 * A shape somebody drew, and where its two ends were when they drew it.
 *
 * `order` is the vertices' indices as the line actually visits them, which
 * is not the order they sit in the network: adding a point mid-line with the
 * pen tool appends it to the end of the vertex list. Redrawing in list order
 * would jump the line from one end to the other and back.
 */
export interface ManualShape {
  readonly vertices: ReadonlyArray<ManualVertex>
  readonly order: ReadonlyArray<number>
  readonly start: Point
  readonly end: Point
}

/**
 * Moves a hand-drawn shape to follow endpoints that have since moved.
 *
 * Each point is carried by a blend of how far the two ends moved, weighted
 * by how far along the line that point sits. One rule covers both cases
 * worth caring about, which is why it is this rule and not two:
 *
 * - Both ends moved the same way — dragging a group of screens somewhere
 *   else — and every blend is that same amount, so the whole line slides and
 *   the drawn shape is preserved exactly.
 * - One end moved, and the ends stay on their layers while the middle is
 *   carried in proportion, so a bend a third of the way down still looks a
 *   third of the way down.
 *
 * It does not re-route: the shape is the person's, and this only carries it.
 * Move an endpoint far enough and the drawn shape will stop making sense —
 * that is what the button back to automatic routing is for.
 */
export function shiftManualShape(
  points: ReadonlyArray<Point>,
  was: { start: Point; end: Point },
  now: { start: Point; end: Point }
): ReadonlyArray<Point> {
  if (points.length === 0) return []
  // Tangents are deliberately left untouched by this: they are relative to
  // their own vertex, so a shape that is carried keeps its curvature exactly.

  const startDelta = { x: now.start.x - was.start.x, y: now.start.y - was.start.y }
  const endDelta = { x: now.end.x - was.end.x, y: now.end.y - was.end.y }

  const lengths: Array<number> = [0]
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    total += Math.hypot(to.x - from.x, to.y - from.y)
    lengths.push(total)
  }

  return points.map((point, index) => {
    // A zero-length line has no "along" to speak of; treat every point as
    // being at the start, which makes this the plain translation it should be.
    const t = total === 0 ? 0 : (lengths[index] ?? 0) / total
    return {
      x: point.x + startDelta.x + (endDelta.x - startDelta.x) * t,
      y: point.y + startDelta.y + (endDelta.y - startDelta.y) * t
    }
  })
}

/**
 * Points a walked shape the same way round as the record does.
 *
 * A vector network lists its vertices in whatever order the editor left them
 * in, so walking one from end to end can come out back to front — starting
 * at the vertex nearest the connector's `end` rather than its `start`. Left
 * unchecked that costs twice over: the two ends get each other's arrowheads,
 * and `shiftManualShape` carries each end by the *other* end's movement, so
 * moving one screen drags the line away from it instead of with it.
 *
 * Reversing a walk swaps every vertex's two tangents with it: `tangentIn`
 * and `tangentOut` are recorded relative to the direction of travel.
 */
export function orientedTowards(
  drawn: { vertices: ReadonlyArray<ManualVertex>; order: ReadonlyArray<number> },
  start: Point,
  end: Point
): { vertices: ReadonlyArray<ManualVertex>; order: ReadonlyArray<number> } {
  const first = drawn.vertices[drawn.order[0] ?? -1]
  const last = drawn.vertices[drawn.order[drawn.order.length - 1] ?? -1]
  if (typeof first === 'undefined' || typeof last === 'undefined') return drawn
  const asDrawn = squaredDistance(first.at, start) + squaredDistance(last.at, end)
  const reversed = squaredDistance(first.at, end) + squaredDistance(last.at, start)
  if (asDrawn <= reversed) return drawn
  return {
    order: [...drawn.order].reverse(),
    vertices: drawn.vertices.map((vertex) => ({
      at: vertex.at,
      tangentIn: vertex.tangentOut,
      tangentOut: vertex.tangentIn
    }))
  }
}

function squaredDistance(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

/**
 * The most a search will do — cell count times obstacle count, which
 * approximates the total number of "does this edge cross that box" checks
 * A* ends up making. Past this it costs more than it is worth on a thread
 * that also has to redraw the editor, and the ordinary route — least-bad,
 * but instant — is the better trade.
 *
 * Not a cap on obstacle count. A real board is grid-aligned — screens line
 * up in columns and rows — so dozens of them collapse onto a handful of
 * shared edges, and the grid built from those edges stays small regardless
 * of how many screens produced it. A raw count cap rejects exactly the
 * boards this is for: the busiest ones, which are also the most likely to
 * be tidy grids. Genuinely scattered obstacles, which never share an edge,
 * still hit this budget quickly because their grid grows with every one of
 * them.
 */
const MAX_SEARCH_COST = 250000

/** Turning costs something, so a route with the same length but fewer corners wins. */
const TURN_PENALTY = 40

/**
 * Finds a right-angled route that crosses nothing, by searching the space
 * rather than by aiming at one box at a time.
 *
 * The ordinary rules generate a handful of candidates, each aimed at one
 * obstacle's edge, and pick the best. That is fast, and on an ordinary page
 * it is right — but it cannot solve a wall with a gap in it, because no
 * single box's edge lines up with the gap. On a board of a few hundred
 * screens there is often no candidate that crosses nothing at all, and the
 * least-bad one goes through three of them.
 *
 * So: build a grid from the boxes' own edges — every obstacle contributes
 * one line a clearance outside each of its four sides — and walk it with
 * A*. Compressing the coordinates this way keeps the grid small (a few
 * dozen lines each way rather than thousands of pixels) while still
 * containing an optimal orthogonal route, since a route only ever needs to
 * turn where something's edge is.
 *
 * Takes the points it is given as they are: a caller that wants the line to
 * leave a screen by a particular side hands in the point it should leave
 * from, not the anchor itself.
 *
 * `null` when there is no way through at all, or when there are more boxes
 * than are worth searching — the caller keeps the route it already had.
 */
export function findRouteAround(
  start: Point,
  end: Point,
  obstacles: ReadonlyArray<Rect>
): ReadonlyArray<Point> | null {
  const xs = gridLines(obstacles, 'x', start.x, end.x)
  const ys = gridLines(obstacles, 'y', start.y, end.y)
  if (xs.length * ys.length * obstacles.length > MAX_SEARCH_COST) return null

  const startCell = { x: xs.indexOf(start.x), y: ys.indexOf(start.y) }
  const endCell = { x: xs.indexOf(end.x), y: ys.indexOf(end.y) }
  if (startCell.x < 0 || startCell.y < 0 || endCell.x < 0 || endCell.y < 0) return null

  const at = (cell: { x: number; y: number }): Point => ({
    x: xs[cell.x] as number,
    y: ys[cell.y] as number
  })
  const blocked = (from: Point, to: Point): boolean =>
    obstacles.some((rect) => segmentEntersRect(from, to, rect))
  const key = (cell: { x: number; y: number }): number => cell.y * xs.length + cell.x

  const came = new Map<number, { cell: { x: number; y: number }; from: number | null }>()
  const best = new Map<number, number>()
  const open: Array<{ cell: { x: number; y: number }; cost: number; guess: number }> = [
    { cell: startCell, cost: 0, guess: 0 }
  ]
  best.set(key(startCell), 0)
  came.set(key(startCell), { cell: startCell, from: null })

  while (open.length > 0) {
    // A plain scan for the cheapest open cell. The grid is small by
    // construction, and a heap would be more machinery than the sizes here
    // repay.
    let pick = 0
    for (let i = 1; i < open.length; i += 1) {
      if ((open[i] as { guess: number }).guess < (open[pick] as { guess: number }).guess) pick = i
    }
    const current = open.splice(pick, 1)[0] as { cell: { x: number; y: number }; cost: number }
    if (current.cell.x === endCell.x && current.cell.y === endCell.y) {
      return simplifyRoute(walkBack(came, key(endCell), at))
    }
    const here = at(current.cell)
    const previous = came.get(key(current.cell))?.from
    const cameHorizontally =
      typeof previous === 'number' ? (previous % xs.length) !== current.cell.x : null

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const next = { x: current.cell.x + (dx as number), y: current.cell.y + (dy as number) }
      if (next.x < 0 || next.y < 0 || next.x >= xs.length || next.y >= ys.length) continue
      const there = at(next)
      if (blocked(here, there)) continue
      const goingHorizontally = dx !== 0
      const turn = cameHorizontally !== null && cameHorizontally !== goingHorizontally ? TURN_PENALTY : 0
      const cost = current.cost + Math.hypot(there.x - here.x, there.y - here.y) + turn
      if (cost >= (best.get(key(next)) ?? Number.POSITIVE_INFINITY)) continue
      best.set(key(next), cost)
      came.set(key(next), { cell: next, from: key(current.cell) })
      const guess = cost + Math.abs(there.x - end.x) + Math.abs(there.y - end.y)
      open.push({ cell: next, cost, guess })
    }
  }
  return null
}

function walkBack(
  came: Map<number, { cell: { x: number; y: number }; from: number | null }>,
  from: number,
  at: (cell: { x: number; y: number }) => Point
): Array<Point> {
  const points: Array<Point> = []
  let step = came.get(from)
  while (typeof step !== 'undefined') {
    points.push(at(step.cell))
    step = step.from === null ? undefined : came.get(step.from)
  }
  return points.reverse()
}

/**
 * The lines a route may turn on: one a clearance outside each of an
 * obstacle's four sides, plus the two endpoints' own coordinates.
 *
 * A route only ever needs to turn where something's edge is, so this holds
 * an optimal orthogonal route while being a few dozen values instead of
 * tens of thousands of pixels.
 */
function gridLines(
  obstacles: ReadonlyArray<Rect>,
  axis: 'x' | 'y',
  from: number,
  to: number
): ReadonlyArray<number> {
  const size = axis === 'x' ? 'width' : 'height'
  const lines = new Set<number>([from, to])
  for (const rect of obstacles) {
    lines.add(rect[axis] - OBSTACLE_CLEARANCE)
    lines.add(rect[axis] + rect[size] + OBSTACLE_CLEARANCE)
  }
  return [...lines].sort((a, b) => a - b)
}

/**
 * Narrows a page's worth of boxes down to the ones that could plausibly
 * matter for this connector: those overlapping the span between its two
 * ends, with `margin` of slack for a route that bulges outside it.
 *
 * Purely a performance filter, and the reason it can be one is that every
 * candidate route is generated *from* an obstacle's own edges — a box the
 * route could never reach contributes candidates that are never chosen, so
 * dropping it cannot change the answer, only how long it takes to get there.
 * On a real file this is the difference between scoring ~100 boxes per
 * connector per frame of a drag and scoring a handful.
 */
export function obstaclesInPlay(
  obstacles: ReadonlyArray<Rect>,
  start: Point,
  end: Point,
  margin: number
): ReadonlyArray<Rect> {
  const minX = Math.min(start.x, end.x) - margin
  const maxX = Math.max(start.x, end.x) + margin
  const minY = Math.min(start.y, end.y) - margin
  const maxY = Math.max(start.y, end.y) + margin
  return obstacles.filter(
    (rect) =>
      rect.x < maxX && rect.x + rect.width > minX && rect.y < maxY && rect.y + rect.height > minY
  )
}

/**
 * How far outside the box spanned by a connector's two ends a route is
 * allowed to bulge, and so how far out anything hunting for obstacles has to
 * look. Generous enough to cover a detour that goes around a full screen
 * sitting just past one end, which is the widest useful candidate the router
 * ever generates.
 */
export const ROUTE_SEARCH_MARGIN = 1200

/**
 * Whether a box now sitting at `box` could change the route a connector whose
 * rendered node occupies `routeBounds` is currently drawing.
 *
 * This is the *invalidation* question, as opposed to `obstaclesInPlay`'s
 * *scoring* question: not "which boxes does this route have to consider" but
 * "did this box moving mean some route has to be worked out again". Both have
 * to agree, or a connector sits un-resynced while a box it genuinely routes
 * around is dragged past it — so this deliberately tests against the rendered
 * node's own bounding box, which always contains both endpoints and, once a
 * route has bent around something, the bulge as well. That makes it a superset
 * of the span `obstaclesInPlay` filters on, and a superset is the safe side to
 * be on: too many re-syncs only costs time, too few leaves a stale line on the
 * canvas.
 *
 * The bulge is also what makes a drag *away* work without remembering where
 * the box used to be. A route already bent around a box has a bounding box
 * wrapped around that same region, so the box stays within `margin` of it long
 * enough for the re-sync that straightens the line back out.
 */
export function boxCouldAffectRoute(routeBounds: Rect, box: Rect, margin: number): boolean {
  return (
    box.x < routeBounds.x + routeBounds.width + margin &&
    box.x + box.width > routeBounds.x - margin &&
    box.y < routeBounds.y + routeBounds.height + margin &&
    box.y + box.height > routeBounds.y - margin
  )
}

/**
 * The least a re-aimed route passes clear of an obstacle's edge.
 *
 * A floor rather than the answer — see `clearanceBeside`.
 */
export const OBSTACLE_CLEARANCE = 20

/**
 * How far outside a box a route should run: half the gap to whatever is next
 * along, capped at the stub width and floored at the minimum clearance.
 *
 * Half the gap puts the line down the middle of the space it has, which is
 * where it looks like it belongs and where it cannot crowd either side. The
 * cap stops it drifting hundreds of units out just because that part of the
 * board is empty; the floor keeps it off the edge where two screens nearly
 * touch. A fixed 20 was the old answer, and read as cramped beside a
 * 375-wide screen — the same complaint that widened the stub.
 */
/** Past this many boxes, standoffs go back to the flat minimum — see `edgesOn`. */
const MAX_MEASURED_NEIGHBOURS = 60

export function clearanceBeside(gap: number): number {
  if (!Number.isFinite(gap)) return ELBOW_STUB
  return Math.max(OBSTACLE_CLEARANCE, Math.min(ELBOW_STUB, gap / 2))
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** The other axis — the one a same-axis pair's route has to travel along to get anywhere. */
function crossAxisOf(axis: 'x' | 'y'): 'x' | 'y' {
  return axis === 'x' ? 'y' : 'x'
}

function pointOn(axis: 'x' | 'y', along: number, across: number): Point {
  return axis === 'x' ? { x: along, y: across } : { x: across, y: along }
}

/**
 * The Z-route: one shared crossing at `mid` on `axis`, a bend on each side
 * of it. The default shape for a same-axis pair, and the one whose bend is a
 * free parameter worth searching over.
 *
 * Collapses to a bare straight line whenever the two ends already sit at the
 * same position on the cross axis — which is exactly why it is not enough on
 * its own: two screens lined up in a row have no bend left to move, however
 * much is sitting between them. That case needs `detourRoute`.
 */
function zRoute(start: Point, end: Point, axis: 'x' | 'y', mid: number): ReadonlyArray<Point> {
  const across = crossAxisOf(axis)
  return simplifyRoute([
    start,
    pointOn(axis, mid, start[across]),
    pointOn(axis, mid, end[across]),
    end
  ])
}

/**
 * The go-around route: out of each end far enough to clear it, then all the
 * way over to `offset` on the cross axis, across, and back in. Six points
 * before simplification.
 *
 * This is the shape that gets a connector *past* something rather than
 * merely bending somewhere else — the answer to a screen parked directly
 * between the two ends. Collapses back to the straight line when `offset`
 * already matches both ends, so it costs nothing to offer as a candidate
 * even when the direct route is fine.
 */
function detourRoute(
  start: Point,
  end: Point,
  axis: 'x' | 'y',
  startSign: 1 | -1,
  endSign: 1 | -1,
  startClearance: number,
  endClearance: number,
  offset: number
): ReadonlyArray<Point> {
  const across = crossAxisOf(axis)
  const startOut = start[axis] + startSign * startClearance
  const endOut = end[axis] + endSign * endClearance
  return simplifyRoute([
    start,
    pointOn(axis, startOut, start[across]),
    pointOn(axis, startOut, offset),
    pointOn(axis, endOut, offset),
    pointOn(axis, endOut, end[across]),
    end
  ])
}

function routeLength(points: ReadonlyArray<Point>): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (typeof from === 'undefined' || typeof to === 'undefined') continue
    total += Math.hypot(to.x - from.x, to.y - from.y)
  }
  return total
}

/**
 * Picks between candidate routes: fewest obstacles crossed wins, then the
 * shortest, then the one with the fewest bends, then whichever came first.
 *
 * The ordering is what keeps this from quietly redesigning routes that were
 * already fine. Every Z-route whose bend lands between the two ends has the
 * same length as every other, and a `detourRoute` that actually goes around
 * something is always longer than the direct one — so with nothing in the
 * way, the caller's own preferred route is passed in first and wins every
 * tie-break, and the shape is bit-for-bit what it was before obstacles
 * existed.
 */
function bestRoute(
  candidates: ReadonlyArray<ReadonlyArray<Point>>,
  obstacles: RouteObstacles
): ReadonlyArray<Point> {
  let best = candidates[0] ?? []
  let bestCrossings = Number.POSITIVE_INFINITY
  let bestLength = Number.POSITIVE_INFINITY
  let bestBends = Number.POSITIVE_INFINITY
  for (const points of candidates) {
    const crossings = routeCost(points, obstacles)
    const length = routeLength(points)
    const bends = points.length
    const better =
      crossings !== bestCrossings
        ? crossings < bestCrossings
        : length !== bestLength
          ? length < bestLength
          : bends < bestBends
    if (better) {
      best = points
      bestCrossings = crossings
      bestLength = length
      bestBends = bends
    }
    // Callers hand the route they would have drawn anyway in first, and
    // already checked it — but a caller that hasn't should not pay to score
    // alternatives to a route that is provably fine.
    if (bestCrossings === 0 && points === candidates[0]) break
  }
  return best
}

/**
 * Every distinct route worth considering for a same-axis pair, cheapest
 * first.
 *
 * The route only changes shape as a bend crosses an obstacle boundary, so
 * one candidate just outside each edge of each obstacle covers every
 * outcome that exists — there is nothing to gain from a finer sweep. Both
 * families are offered because they fail in opposite cases: a Z-route can
 * slide its crossing into a clear gap but has nothing to move when the two
 * ends line up, and a `detourRoute` can always go around but pays extra
 * length to do it.
 */
/**
 * Which edge of an obstacle a pinned `detour` means on the axis the route
 * actually has room to move along — `'low'` for the smaller coordinate
 * (`TOP` on y, `LEFT` on x), `'high'` for the larger.
 *
 * `null` when nothing is pinned, and equally when what *is* pinned belongs
 * to the other axis: "go around the top" says nothing useful about a
 * connector running top to bottom, so it degrades to `AUTO` rather than
 * pretending to constrain something.
 */
function detourEdgeFor(detour: ConnectorDetour, across: 'x' | 'y'): 'low' | 'high' | null {
  if (across === 'y') {
    if (detour === 'TOP') return 'low'
    if (detour === 'BOTTOM') return 'high'
    return null
  }
  if (detour === 'LEFT') return 'low'
  if (detour === 'RIGHT') return 'high'
  return null
}

function sameAxisCandidates(
  direct: ReadonlyArray<Point>,
  start: Point,
  end: Point,
  axis: 'x' | 'y',
  startSign: 1 | -1,
  endSign: 1 | -1,
  startClearance: number,
  endClearance: number,
  lo: number,
  hi: number,
  detour: ConnectorDetour,
  obstacles: RouteObstacles
): ReadonlyArray<ReadonlyArray<Point>> {
  const candidates: Array<ReadonlyArray<Point>> = [direct]
  const across = crossAxisOf(axis)
  for (const [low, high] of edgesOn(obstacles, axis)) {
    candidates.push(
      zRoute(start, end, axis, clamp(low, lo, hi)),
      zRoute(start, end, axis, clamp(high, lo, hi))
    )
  }
  // A pinned direction drops the other way round entirely rather than merely
  // ranking it lower: the whole point of pinning is to override the
  // shorter-wins scoring that chose the way you didn't want.
  const edge = detourEdgeFor(detour, across)
  for (const [low, high] of edgesOn(obstacles, across)) {
    // `high` first, so `AUTO` goes below (or right) when the two ways round
    // are exactly as long as each other — which they are whenever the box in
    // the way sits squarely between the two ends, i.e. constantly.
    // `bestRoute` breaks that tie on which was offered first, so this is
    // where the default gets decided, and below is the tidier default: a
    // frame's name is drawn *above* it in Figma, so a route that goes over
    // the top runs through the row of frame titles.
    const offsets = edge === null ? [high, low] : edge === 'low' ? [low] : [high]
    for (const offset of offsets) {
      candidates.push(
        detourRoute(start, end, axis, startSign, endSign, startClearance, endClearance, offset)
      )
    }
  }
  return candidates
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
 * `obstacles` then gets the last word over that preference: the mid-line
 * moves off it, still within the valid range, if that spares a screen the
 * route would otherwise cut straight through. See `clearestMid`.
 *
 * Only the same-axis Z shape has a mid-line to move. The single-corner and
 * `detourElbow` shapes below are fully determined by their two endpoints, so
 * there is nothing to re-aim and `obstacles` cannot help them — a route that
 * takes one of those shapes still crosses whatever is in its way.
 */
function sidedElbow(
  start: Point,
  end: Point,
  startSide: ResolvedMagnet,
  endSide: ResolvedMagnet,
  startClearance: number,
  endClearance: number,
  preferredMid: number | null,
  detour: ConnectorDetour,
  obstacles: RouteObstacles
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
      const preferred = clamp(preferredMid ?? natural, lo, hi)
      const direct = zRoute(start, end, axis, preferred)
      // Checked before the alternatives are even built, not just before they
      // are scored. Enumerating candidates allocates a route per obstacle
      // edge, and this runs for every connector on every frame of a drag —
      // on a clear page that is the entire cost of the feature, paid for
      // nothing.
      if (!hasObstacles(obstacles) || routeCost(direct, obstacles) === 0) return direct
      return orSearched(
        bestRoute(
          sameAxisCandidates(
            direct,
            start,
            end,
            axis,
            startSign,
            endSign,
            startClearance,
            endClearance,
            lo,
            hi,
            detour,
            obstacles
          ),
          obstacles
        ),
        start,
        end,
        startSide,
        endSide,
        startClearance,
        endClearance,
        obstacles
      )
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
      const single = simplifyRoute([start, corner, end])
      if (!hasObstacles(obstacles) || routeCost(single, obstacles) === 0) return single
      // The single corner is fully determined by its two endpoints — there
      // is no bend to re-aim, so the only alternative on offer is the
      // longer stub-then-bend route. Worth one comparison: it often clears
      // a box the corner cuts straight across, and `bestRoute` keeps the
      // corner whenever it doesn't.
      return orSearched(
        bestRoute(
          [single, detourElbow(start, end, startSide, endSide, startClearance, endClearance)],
          obstacles
        ),
        start,
        end,
        startSide,
        endSide,
        startClearance,
        endClearance,
        obstacles
      )
    }
  }

  return orSearched(
    detourElbow(start, end, startSide, endSide, startClearance, endClearance),
    start,
    end,
    startSide,
    endSide,
    startClearance,
    endClearance,
    obstacles
  )
}

/**
 * Hands over to the search when the chosen route still crosses something.
 *
 * The ordinary rules are kept as the first answer, not replaced: they are
 * instant, and on a page where they work they are also the prettier route —
 * a search optimises for getting through, and will happily take a long way
 * round that a person would not have drawn. This is the escape hatch for the
 * boards they cannot solve, and it costs nothing on the ones they can, since
 * a route that crosses nothing never reaches here.
 *
 * The search starts from each end's stub point rather than the anchor
 * itself, so the line still leaves and arrives by the sides it was told to.
 */
function orSearched(
  chosen: ReadonlyArray<Point>,
  start: Point,
  end: Point,
  startSide: ResolvedMagnet,
  endSide: ResolvedMagnet,
  startClearance: number,
  endClearance: number,
  obstacles: RouteObstacles
): ReadonlyArray<Point> {
  if (routeCost(chosen, obstacles) === 0) return chosen
  const startNormal = outwardNormal(startSide)
  const endNormal = outwardNormal(endSide)
  const from: Point = {
    x: start.x + startNormal.x * startClearance,
    y: start.y + startNormal.y * startClearance
  }
  const to: Point = {
    x: end.x + endNormal.x * endClearance,
    y: end.y + endNormal.y * endClearance
  }
  const found = findRouteAround(from, to, obstacles.foreign)
  if (found === null) return chosen
  const full = simplifyRoute([start, ...found, end])
  // Only if it is actually better. The search ignores the own-screen
  // exemptions `routeCost` applies, so a route it calls clean can still
  // score worse by the rules everything else is judged on.
  return routeCost(full, obstacles) < routeCost(chosen, obstacles) ? full : chosen
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
 * The tuning knobs an `ELBOW` route accepts on top of its two points and
 * their sides. Grouped rather than trailing positionally: the two clearances
 * are easy to swap by accident, and `null`-padding your way to the last one
 * reads as noise at the call site.
 */
export interface ElbowRouteOptions {
  /** How far the start has to poke out before it may bend. Defaults to the flat `ELBOW_STUB`; pass `connectorStubClearance` to clear an enclosing frame. */
  readonly startClearance?: number
  /** The same, for the end. */
  readonly endClearance?: number
  /** A cosmetic hint (from `frameGapMidpoint`) for where the bend should land when there's a choice. */
  readonly preferredMid?: number | null
  /** Boxes the route should avoid cutting through, split by `RouteObstacles`. Overrides `preferredMid` when the two disagree. */
  readonly obstacles?: RouteObstacles
  /** Which way to go around them. Defaults to `AUTO` — whichever way is shorter. */
  readonly detour?: ConnectorDetour
}

/**
 * The connector's route as a polyline — two points for `STRAIGHT`, up to six
 * for a sided `ELBOW` in the rare case that needs `detourElbow`'s full
 * stub-then-bend (most sided elbows are a clean 3- or 4-point route).
 *
 * `startSide`/`endSide` come from `ConnectorGeometry` — `null` for a
 * `free`/`ratio` anchor, which has no side to respect, so the route falls
 * back to a plain unsided bend for that case. Everything else is optional;
 * see `ElbowRouteOptions`.
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
  options: ElbowRouteOptions = {}
): ReadonlyArray<Point> {
  if (lineStyle !== 'ELBOW') {
    return [start, end]
  }
  if (startSide === null || endSide === null) {
    return dominantAxisElbow(start, end)
  }
  return sidedElbow(
    start,
    end,
    startSide,
    endSide,
    options.startClearance ?? ELBOW_STUB,
    options.endClearance ?? ELBOW_STUB,
    options.preferredMid ?? null,
    options.detour ?? DEFAULT_DETOUR,
    options.obstacles ?? NO_OBSTACLES
  )
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
