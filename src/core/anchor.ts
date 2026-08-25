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

export type Anchor =
  /** Snaps to the midpoint of a side, like a FigJam magnet. */
  | { readonly kind: 'magnet'; readonly nodeId: string; readonly magnet: Magnet }
  /** Pinned to a fixed relative point in the node's box (0..1 on each axis). */
  | { readonly kind: 'ratio'; readonly nodeId: string; readonly ratio: Point }
  /** Not attached to anything — fixed in canvas space. */
  | { readonly kind: 'free'; readonly point: Point }

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

/**
 * Picks the side of `rect` that faces `towards`.
 *
 * Compares the gap on each axis rather than raw centre distance, so a wide
 * frame sitting slightly above a narrow one still connects top-to-bottom
 * instead of sideways. Ties resolve horizontally, which reads better for the
 * left-to-right flows this plugin is mostly used for.
 */
export function resolveMagnet(rect: Rect, towards: Point): ResolvedMagnet {
  const center = centerOf(rect)
  const dx = towards.x - center.x
  const dy = towards.y - center.y
  if (dx === 0 && dy === 0) {
    // No direction to face — the counterpart sits exactly on our centre. This
    // is the "AUTO with nothing to point at" case; fall back to the tie-break.
    return 'RIGHT'
  }
  const horizontalGap = Math.abs(dx) - rect.width / 2
  const verticalGap = Math.abs(dy) - rect.height / 2
  if (horizontalGap >= verticalGap) {
    return dx >= 0 ? 'RIGHT' : 'LEFT'
  }
  return dy >= 0 ? 'BOTTOM' : 'TOP'
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
  towards: Point | null
): Point | null {
  if (anchor.kind === 'free') {
    return anchor.point
  }
  if (rect === null) {
    return null
  }
  if (anchor.kind === 'ratio') {
    return ratioPoint(rect, anchor.ratio)
  }
  const magnet =
    anchor.magnet === 'AUTO'
      ? resolveMagnet(rect, towards ?? centerOf(rect))
      : anchor.magnet
  return magnetPoint(rect, magnet)
}

/** The node id an anchor depends on, or `null` for a free anchor. */
export function anchorNodeId(anchor: Anchor): string | null {
  return anchor.kind === 'free' ? null : anchor.nodeId
}

/** A pair of resolved endpoints; `null` on a side whose node is missing. */
export interface ResolvedPair {
  readonly start: Point | null
  readonly end: Point | null
}

/**
 * Resolves both ends of a connector together.
 *
 * `AUTO` on either side needs to know where the *other* side is, so the pair
 * is resolved in two passes: first seed each side from the opposite box's
 * centre, then re-resolve with the real opposite point. Two passes is enough —
 * a third never changes the chosen side in practice, and stopping at two keeps
 * this deterministic.
 */
export function resolveAnchorPair(
  start: Anchor,
  startRect: Rect | null,
  end: Anchor,
  endRect: Rect | null
): ResolvedPair {
  const seed = (anchor: Anchor, rect: Rect | null): Point | null =>
    anchor.kind === 'free' ? anchor.point : rect === null ? null : centerOf(rect)

  const startSeed = seed(start, startRect)
  const endSeed = seed(end, endRect)

  const firstStart = resolveAnchor(start, startRect, endSeed)
  const firstEnd = resolveAnchor(end, endRect, startSeed)

  return {
    start: resolveAnchor(start, startRect, firstEnd ?? endSeed),
    end: resolveAnchor(end, endRect, firstStart ?? startSeed)
  }
}
