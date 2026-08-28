/**
 * Anchor model — the one thing annotations and connectors share.
 *
 * Both features render a node whose position is *derived* from some other
 * node's box. An `Anchor` is that derivation, expressed without ever touching
 * the `figma` global so it can be unit tested directly.
 *
 * The shape deliberately mirrors FigJam's `ConnectorEndpoint` union so that a
 * future FigJam port is close to a rename.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

/** Absolute-space bounding box, matching `node.absoluteBoundingBox`. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type Magnet = 'AUTO' | 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' | 'CENTER'

/** A magnet with `AUTO` already resolved to a concrete side. */
export type ResolvedMagnet = Exclude<Magnet, 'AUTO'>

const MAGNETS = new Set<string>(['AUTO', 'TOP', 'RIGHT', 'BOTTOM', 'LEFT', 'CENTER'])

/** Shared by `annotation.ts` and `connector.ts` — both decode a `Magnet` out of untrusted pluginData. */
export function isMagnet(value: unknown): value is Magnet {
  return typeof value === 'string' && MAGNETS.has(value)
}

/** Shared by `annotation.ts` and `connector.ts` — both decode a `Point` out of untrusted pluginData. */
export function isPoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y)
  )
}

export type Anchor =
  /** Snaps to the midpoint of a side, like a FigJam magnet. */
  | { readonly kind: 'magnet'; readonly nodeId: string; readonly magnet: Magnet }
  /** Pinned to a fixed relative point in the node's box (0..1 on each axis). */
  | { readonly kind: 'ratio'; readonly nodeId: string; readonly ratio: Point }
  /** Not attached to anything — fixed in canvas space. */
  | { readonly kind: 'free'; readonly point: Point }

/**
 * Whether two boxes occupy exactly the same space.
 *
 * Compared without tolerance on purpose. Figma reports canvas units, not
 * screen pixels, so a drag that looks tiny at a high zoom is still a real
 * move — and the clearances a route is built from are 20 units, small enough
 * that swallowing sub-unit differences would let a box creep across a
 * boundary without anything noticing.
 */
export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function magnetPoint(rect: Rect, magnet: ResolvedMagnet): Point {
  const center = centerOf(rect)
  switch (magnet) {
    case 'TOP':
      return { x: center.x, y: rect.y }
    case 'BOTTOM':
      return { x: center.x, y: rect.y + rect.height }
    case 'LEFT':
      return { x: rect.x, y: center.y }
    case 'RIGHT':
      return { x: rect.x + rect.width, y: center.y }
    case 'CENTER':
      return center
  }
}

export function ratioPoint(rect: Rect, ratio: Point): Point {
  return {
    x: rect.x + rect.width * ratio.x,
    y: rect.y + rect.height * ratio.y
  }
}

interface AxisOffsets {
  /** How far `towards` sits from `rect`'s centre, on each axis. */
  readonly dx: number
  readonly dy: number
  /** How far *past* `rect`'s own edge `towards` sits, on each axis — negative when `towards` is still within that edge. Shared by `resolveMagnet` and `resolveMagnetPreferringSides`, which each turn it into a side by a different rule. */
  readonly horizontalGap: number
  readonly verticalGap: number
}

function axisOffsets(rect: Rect, towards: Point): AxisOffsets {
  const center = centerOf(rect)
  const dx = towards.x - center.x
  const dy = towards.y - center.y
  return {
    dx,
    dy,
    horizontalGap: Math.abs(dx) - rect.width / 2,
    verticalGap: Math.abs(dy) - rect.height / 2
  }
}

/**
 * Picks the side of `rect` that faces `towards`.
 *
 * Compares the gap on each axis rather than raw centre distance, so a wide
 * frame sitting slightly above a narrow one still connects top-to-bottom
 * instead of sideways. Ties resolve horizontally, which reads better for the
 * left-to-right flows this plugin is mostly used for.
 */
export function resolveMagnet(rect: Rect, towards: Point): ResolvedMagnet {
  const { dx, dy, horizontalGap, verticalGap } = axisOffsets(rect, towards)
  if (dx === 0 && dy === 0) {
    // No direction to face — the counterpart sits exactly on our centre. This
    // is the "AUTO with nothing to point at" case; fall back to the tie-break.
    return 'RIGHT'
  }
  if (horizontalGap >= verticalGap) {
    return dx >= 0 ? 'RIGHT' : 'LEFT'
  }
  return dy >= 0 ? 'BOTTOM' : 'TOP'
}

/**
 * Same idea as `resolveMagnet`, but treats a left/right exit as the default
 * rather than a coin flip against whichever axis has the bigger raw gap —
 * used for a connector's `AUTO` side, where a side exit reads as "routed
 * around the frame's edge" and a top/bottom one reads as "cutting across
 * whatever else is on this screen" (see `connectorStubClearance`, which
 * only really pays off for a side exit). Only falls back to vertical when
 * there's no real horizontal separation to route through at all — the
 * counterpart sits within this box's own horizontal extent, so a sideways
 * exit would be a nonsensical detour rather than a shortcut.
 *
 * Deliberately not used by `resolveSide` (Annotate's own side-resolution,
 * for the badge/leader's anchor) — that one docks to wherever a person
 * actually dragged the card, which has nothing to do with routing around a
 * frame's edge.
 */
export function resolveMagnetPreferringSides(rect: Rect, towards: Point): ResolvedMagnet {
  const { dx, dy, horizontalGap } = axisOffsets(rect, towards)
  if (dx === 0 && dy === 0) {
    return 'RIGHT'
  }
  if (horizontalGap >= 0 || dy === 0) {
    return dx >= 0 ? 'RIGHT' : 'LEFT'
  }
  return dy >= 0 ? 'BOTTOM' : 'TOP'
}

/**
 * How much worse a pixel spent crossing your own frame is than a pixel spent
 * routing around outside it.
 *
 * Above 1 because the two are not the same kind of ugly: travelling through
 * empty canvas is invisible, while cutting across a screen's own content
 * reads as a mistake. 3 is a judgement call, not a measurement — high enough
 * that a node tucked in a corner leaves by its nearest edge instead of
 * ploughing the length of the frame to face its counterpart, low enough that
 * a node in the middle of a frame still leaves on the side it is heading.
 */
const FRAME_EXIT_PENALTY = 3

const ESCAPE_SIDES: ReadonlyArray<ResolvedMagnet> = ['RIGHT', 'LEFT', 'BOTTOM', 'TOP']

/** How far past `rect`'s own edge the route still has to travel, inside `frame`, to leave by `side`. */
function frameExitCost(rect: Rect, frame: Rect, side: ResolvedMagnet): number {
  switch (side) {
    case 'RIGHT':
      return Math.max(0, frame.x + frame.width - (rect.x + rect.width))
    case 'LEFT':
      return Math.max(0, rect.x - frame.x)
    case 'BOTTOM':
      return Math.max(0, frame.y + frame.height - (rect.y + rect.height))
    case 'TOP':
      return Math.max(0, rect.y - frame.y)
    case 'CENTER':
      return 0
  }
}

/** Where the route crosses `frame`'s edge on its way out of `side` — the first point that is actually outside. */
function frameExitPoint(rect: Rect, frame: Rect, side: ResolvedMagnet): Point {
  const point = magnetPoint(rect, side)
  switch (side) {
    case 'RIGHT':
      return { x: frame.x + frame.width, y: point.y }
    case 'LEFT':
      return { x: frame.x, y: point.y }
    case 'BOTTOM':
      return { x: point.x, y: frame.y + frame.height }
    case 'TOP':
      return { x: point.x, y: frame.y }
    case 'CENTER':
      return point
  }
}

/**
 * Picks the side for an anchor that sits *inside* a frame, balancing the two
 * things that fight each other there: getting out of the frame without
 * dragging a line across its content, and not then having to travel the long
 * way round to reach the counterpart.
 *
 * `resolveMagnetPreferringSides` only asks the second question, which is
 * right for a node that *is* a top-level frame and wrong for anything nested
 * in one. A button in the bottom-left corner of a screen whose counterpart
 * is far to the right gets `RIGHT` from that rule — and then the connector
 * runs the entire width of its own screen, straight through the content, to
 * get out. Nothing downstream can repair that: `connectorStubClearance` is
 * what makes the line poke all the way clear of the frame before bending,
 * and the frame has to be crossed *somehow* to reach a node inside it. The
 * only thing actually in our gift is which edge it crosses, and how much of
 * the frame that costs.
 *
 * Falls back to `resolveMagnetPreferringSides` with no frame to escape.
 */
export function resolveMagnetEscapingFrame(
  rect: Rect,
  frame: Rect | null,
  towards: Point
): ResolvedMagnet {
  if (frame === null) return resolveMagnetPreferringSides(rect, towards)
  let best: ResolvedMagnet = 'RIGHT'
  let bestCost = Number.POSITIVE_INFINITY
  // Ordered so that a tie resolves horizontally, the same bias
  // `resolveMagnet` documents — left-to-right flows are what this is for.
  for (const side of ESCAPE_SIDES) {
    const exit = frameExitPoint(rect, frame, side)
    const cost =
      FRAME_EXIT_PENALTY * frameExitCost(rect, frame, side) +
      Math.abs(towards.x - exit.x) +
      Math.abs(towards.y - exit.y)
    if (cost < bestCost) {
      bestCost = cost
      best = side
    }
  }
  return best
}

/** Unit vector pointing out of a box, away from the given side. `CENTER` has no direction. */
export function outwardNormal(side: ResolvedMagnet): Point {
  switch (side) {
    case 'TOP':
      return { x: 0, y: -1 }
    case 'BOTTOM':
      return { x: 0, y: 1 }
    case 'LEFT':
      return { x: -1, y: 0 }
    case 'RIGHT':
      return { x: 1, y: 0 }
    case 'CENTER':
      return { x: 0, y: 0 }
  }
}

interface ResolvedAnchorPoint {
  readonly point: Point | null
  /** The side of the box the point landed on — `null` for a `free`/`ratio` anchor, which has no "side". */
  readonly side: ResolvedMagnet | null
}

function resolveAnchorDetailed(
  anchor: Anchor,
  rect: Rect | null,
  towards: Point | null,
  frame: Rect | null
): ResolvedAnchorPoint {
  if (anchor.kind === 'free') {
    return { point: anchor.point, side: null }
  }
  if (rect === null) {
    return { point: null, side: null }
  }
  if (anchor.kind === 'ratio') {
    return { point: ratioPoint(rect, anchor.ratio), side: null }
  }
  const magnet =
    anchor.magnet === 'AUTO'
      ? resolveMagnetEscapingFrame(rect, frame, towards ?? centerOf(rect))
      : anchor.magnet
  return { point: magnetPoint(rect, magnet), side: magnet }
}

/**
 * Resolves an anchor to a point in canvas space.
 *
 * `rect` is the anchored node's box, or `null` when that node is gone — an
 * orphaned anchor, which callers surface rather than silently drop.
 * `towards` is the counterpart point, needed only to resolve `AUTO`.
 */
export function resolveAnchor(
  anchor: Anchor,
  rect: Rect | null,
  towards: Point | null,
  frame: Rect | null = null
): Point | null {
  return resolveAnchorDetailed(anchor, rect, towards, frame).point
}

/** The node id an anchor depends on, or `null` for a free anchor. */
export function anchorNodeId(anchor: Anchor): string | null {
  return anchor.kind === 'free' ? null : anchor.nodeId
}

/** A pair of resolved endpoints; `null` on a side whose node is missing. */
export interface ResolvedPair {
  readonly start: Point | null
  readonly end: Point | null
  /** Which side of its box each endpoint sits on — `null` for a `free`/`ratio` anchor. Used to route a connector out perpendicular to the edge instead of flush against it. */
  readonly startSide: ResolvedMagnet | null
  readonly endSide: ResolvedMagnet | null
}

/**
 * Resolves both ends of a connector together.
 *
 * `AUTO` on either side needs to know where the *other* side is, so the pair
 * is resolved in two passes: first seed each side from the opposite box's
 * centre, then re-resolve with the real opposite point. Two passes is enough —
 * a third never changes the chosen side in practice, and stopping at two keeps
 * this deterministic.
 *
 * Only Connect calls this (via `resolveConnectorGeometry`) — it resolves
 * `AUTO` with `resolveMagnetPreferringSides`, not the plainer `resolveMagnet`
 * Annotate's own `resolveSide` uses, since a side exit is what actually
 * routes around a frame here. That bias is currently baked in with no way to
 * ask for the other one; fine while this is Connect's only caller, but
 * revisit (a strategy parameter, most likely) if something else ever needs
 * `Anchor` resolution with `resolveMagnet`'s plainer behaviour instead.
 */
export function resolveAnchorPair(
  start: Anchor,
  startRect: Rect | null,
  end: Anchor,
  endRect: Rect | null,
  startFrame: Rect | null = null,
  endFrame: Rect | null = null
): ResolvedPair {
  const seed = (anchor: Anchor, rect: Rect | null): Point | null =>
    anchor.kind === 'free' ? anchor.point : rect === null ? null : centerOf(rect)

  const startSeed = seed(start, startRect)
  const endSeed = seed(end, endRect)

  const firstStart = resolveAnchorDetailed(start, startRect, endSeed, startFrame)
  const firstEnd = resolveAnchorDetailed(end, endRect, startSeed, endFrame)

  const finalStart = resolveAnchorDetailed(start, startRect, firstEnd.point ?? endSeed, startFrame)
  const finalEnd = resolveAnchorDetailed(end, endRect, firstStart.point ?? startSeed, endFrame)

  return {
    start: finalStart.point,
    end: finalEnd.point,
    startSide: finalStart.side,
    endSide: finalEnd.side
  }
}
