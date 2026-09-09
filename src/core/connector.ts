/**
 * Where a connector's line goes — the router, per ADR 0001 and 0002.
 *
 * Pure like `annotation.ts`: a route is computable from two points, the sides
 * they leave by, and the boxes in the way, without ever touching the `figma`
 * global. What a connector *is* — the record, its styles, decoding it out of
 * pluginData — is `connectorRecord.ts`; a hand-drawn line, which this never
 * routes, is `manualShape.ts`.
 */

import {
  type Point,
  type Rect,
  type ResolvedMagnet,
  outwardNormal,
  resolveAnchorPair
} from './anchor.js'
import type { ConnectorDetour, ConnectorLineStyle, ConnectorRecord } from './connectorRecord.js'
import {
  type RouteObstacles,
  NO_OBSTACLES,
  OBSTACLE_CLEARANCE,
  hasObstacles,
  routeCost,
  segmentEntersRect
} from './routeCost.js'

export interface ConnectorGeometry {
  readonly start: Point | null
  readonly end: Point | null
  /** `false` when either endpoint's node is gone — the connector is dangling. */
  readonly complete: boolean
  /** Which side of its box each endpoint sits on — `null` on a side whose node is gone, so never set while `complete`. */
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
 * `sidedElbow` bends its two stub ends with this, so it is on every elbow
 * route; `connectorRoutePoints` also falls back to it whole when a caller
 * does not know a side to respect.
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
const ELBOW_STUB = 80

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

/** Every edge of every box, as a candidate coordinate on `axis`. Used to seed the search. */
function edgesOn(obstacles: RouteObstacles, axis: 'x' | 'y'): ReadonlyArray<[number, number]> {
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
  // Unreachable as things stand — `gridLines` seeds itself with `from` and
  // `to`, so both ends are always on the grid — and no test can cover it
  // without reaching past the public function to break that. Kept because it
  // stops being unreachable the moment the grid is built any other way, and
  // the failure it would prevent is silent: `xs[-1]` is `undefined`, cast to
  // a number, and the search would set off from `NaN`.
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

function clearanceBeside(gap: number): number {
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
  obstacles: RouteObstacles,
  trustFirst = true
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
    // alternatives to a route that is provably fine. `trustFirst` is off
    // when the caller's list is a set of equals rather than a preference
    // with alternatives behind it, as a pinned `detour`'s is: stopping at
    // the first clean one would pick whichever obstacle happened to sort
    // first instead of the shortest way round.
    if (trustFirst && bestCrossings === 0 && points === candidates[0]) break
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
  const across = crossAxisOf(axis)
  // A pinned direction drops every route that doesn't go that way round —
  // not merely ranks them lower — because the scoring below is shortest-wins
  // and the way round a person didn't want is, nearly always, the shorter
  // one. That includes the direct route and the Z-routes: neither passes
  // *around* anything, so neither can express "below", and leaving them in
  // the running is what made the control look dead on any line that was
  // already clear.
  const edge = detourEdgeFor(detour, across)
  const candidates: Array<ReadonlyArray<Point>> = edge === null ? [direct] : []
  if (edge === null) {
    for (const [low, high] of edgesOn(obstacles, axis)) {
      candidates.push(
        zRoute(start, end, axis, clamp(low, lo, hi)),
        zRoute(start, end, axis, clamp(high, lo, hi))
      )
    }
  }
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
  // A pin with nothing on the cross axis to go around has nothing to ask
  // for. Rather than return an empty list, hand back the route that would
  // have been drawn anyway.
  if (candidates.length === 0) candidates.push(direct)
  return candidates
}

/** How far past a frame's own edge a connector clears it by, on top of `ELBOW_STUB`. */
const FRAME_CLEARANCE_MARGIN = 20

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
      // nothing. A pin does not reopen this: "go around" has nothing to ask
      // for when the line is not going around anything, and honouring it
      // here would drag a clear line down to whatever distant box happened
      // to be on the page.
      if (!hasObstacles(obstacles) || routeCost(direct, obstacles) === 0) return direct
      const pinned = detourEdgeFor(detour, crossAxisOf(axis)) !== null
      const chosen = bestRoute(
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
        obstacles,
        !pinned
      )
      // The search walks a grid looking for anything that gets through; it
      // has no notion of which way round it went. Letting it run on a pinned
      // route would quietly undo the pin on precisely the crowded boards
      // where someone bothered to set one — so a person who names a
      // direction gets that direction, even where the search would have
      // found something tidier.
      if (pinned) return chosen
      return orSearched(
        chosen,
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
 * `startSide`/`endSide` come from `ConnectorGeometry`, which only leaves them
 * `null` on a side whose node is gone — and such a connector is dangling and
 * never drawn, so the plugin always passes both. They stay optional because a
 * side is a routing *preference*: a caller with two bare points still gets a
 * sensible bend out of this rather than having to invent one. Everything else
 * is optional too; see `ElbowRouteOptions`.
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
    // `'AUTO'` written out rather than taken from the record's default. They
    // are the same value for the same reason — nothing pinned — but they are
    // not the same decision: this one is "the caller did not say", and it
    // should not move if the default a *new connector* starts from ever does.
    options.detour ?? 'AUTO',
    options.obstacles ?? NO_OBSTACLES
  )
}
