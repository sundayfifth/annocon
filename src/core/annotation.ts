/**
 * The annotation record and its layout — pure, so it can be tested without a
 * Figma document.
 *
 * One record per annotated node, stored as JSON in that node's plugin data.
 * Everything drawn on the canvas is derived from it; nothing is ever read back
 * off the rendered nodes.
 */

import {
  type Magnet,
  type Point,
  type Rect,
  centerOf,
  isMagnet,
  isPoint,
  magnetPoint,
  outwardNormal,
  resolveMagnet
} from './anchor.js'

export const ANNOTATION_VERSION = 1

export interface AnnotationRecord {
  readonly v: typeof ANNOTATION_VERSION
  readonly text: string
  /** Which side of the target the badge sits on. `AUTO` follows the card. */
  readonly side: Magnet
  /** Card top-left, relative to the badge centre. */
  readonly cardOffset: Point
  /** id into the file-wide category list (`core/category.ts`), or `null` for none. */
  readonly categoryId: string | null
  /** How big the card is drawn — see `metricsForSize`. */
  readonly size: AnnotationSize
}

/** What the layout maths needs: where the badge sits and how wide the card is. */
export interface LayoutMetrics {
  readonly badgeDiameter: number
  /** Gap between the target's edge and the near edge of the badge. */
  readonly badgeGap: number
  readonly cardWidth: number
}

/**
 * Everything a size decides, layout and appearance together.
 *
 * Kept here rather than as constants in `scene/` so the three sizes are one
 * table that can be read down a column and compared — and so the
 * relationships that make them read as one card at three scales, rather than
 * three differently-proportioned cards, are testable.
 */
export interface CardMetrics extends LayoutMetrics {
  readonly fontSize: number
  readonly categoryFontSize: number
  readonly paddingX: number
  readonly paddingY: number
  readonly itemSpacing: number
  readonly cornerRadius: number
}

/** How big a card is drawn. `M` is what every annotation was before the choice existed. */
export type AnnotationSize = 'S' | 'M' | 'L'

export const ANNOTATION_SIZES: ReadonlyArray<AnnotationSize> = ['S', 'M', 'L']

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = 'M'

/**
 * `M` is the card exactly as it always was, so every existing annotation
 * renders unchanged.
 *
 * The other two are not a single multiplier: type is rounded to whole pixels
 * (a 13.6px card font renders soft), and the card's width tracks its type
 * closely enough to keep roughly the same number of words per line at every
 * size — that ratio is what makes S and L read as the same card seen from
 * further away rather than as three different cards.
 *
 * `L` is sized for reading a whole flow zoomed out, which is the case that
 * asked for this: at `M` the note is legible only once you are close enough
 * that you can no longer see what it is annotating.
 */
const METRICS_BY_SIZE: Readonly<Record<AnnotationSize, CardMetrics>> = {
  S: {
    badgeDiameter: 6,
    badgeGap: 9,
    cardWidth: 96,
    fontSize: 10,
    categoryFontSize: 8,
    paddingX: 9,
    paddingY: 7,
    itemSpacing: 4,
    cornerRadius: 6
  },
  M: {
    // A small marker dot, not a numbered badge — Figma's own native
    // annotations just mark the spot with a dot; the leader line itself
    // already shows which element it points to.
    badgeDiameter: 8,
    badgeGap: 12,
    // Matches MIN_OUTSIDE_CARD_WIDTH — a 120px card plus 20px OUTSIDE_MARGIN
    // on each side lands neatly in a 160px gap between two frames, which is
    // what this was tuned against. A wider default just meant more cards
    // than that needed to shrink to fit, for no benefit.
    cardWidth: 120,
    fontSize: 13,
    categoryFontSize: 10,
    paddingX: 12,
    paddingY: 10,
    itemSpacing: 6,
    cornerRadius: 8
  },
  L: {
    badgeDiameter: 12,
    badgeGap: 18,
    cardWidth: 190,
    fontSize: 20,
    categoryFontSize: 15,
    paddingX: 18,
    paddingY: 15,
    itemSpacing: 9,
    cornerRadius: 12
  }
}

export function metricsForSize(size: AnnotationSize): CardMetrics {
  return METRICS_BY_SIZE[size]
}

export const DEFAULT_METRICS: CardMetrics = METRICS_BY_SIZE[DEFAULT_ANNOTATION_SIZE]

export const DEFAULT_CARD_OFFSET: Point = { x: 22, y: -10 }

export interface AnnotationLayout {
  /** Centre of the badge, in the same space as the target rect. */
  readonly badgeCenter: Point
  /**
   * The leader line, as a polyline from the target's edge to the card — two
   * points for a straight run (`annotationLayout`), three for a right-angled
   * elbow (`annotationLayoutOutsideFrame`, see `elbowPoints`). `null` when
   * the endpoints coincide and a line would be a zero-length artefact.
   */
  readonly leader: ReadonlyArray<Point> | null
  readonly cardTopLeft: Point
}

export function createAnnotationRecord(
  text: string,
  size: AnnotationSize = DEFAULT_ANNOTATION_SIZE
): AnnotationRecord {
  return {
    v: ANNOTATION_VERSION,
    text,
    side: 'AUTO',
    cardOffset: DEFAULT_CARD_OFFSET,
    categoryId: null,
    size
  }
}

function isAnnotationSize(value: unknown): value is AnnotationSize {
  return typeof value === 'string' && (ANNOTATION_SIZES as ReadonlyArray<string>).includes(value)
}

/**
 * Decodes a record out of plugin data.
 *
 * Deliberately tolerant: the string comes from a document that other versions
 * of this plugin — and users editing by hand — may have touched. A record we
 * cannot read at all is `null`; one that is merely incomplete gets defaults.
 */
export function parseAnnotationRecord(raw: string): AnnotationRecord | null {
  if (raw === '') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.text !== 'string') {
    return null
  }
  return {
    v: ANNOTATION_VERSION,
    text: candidate.text,
    side: isMagnet(candidate.side) ? candidate.side : 'AUTO',
    // Every annotation written before sizes existed reads back as M, which
    // is the size it was drawn at — nothing on canvas moves.
    size: isAnnotationSize(candidate.size) ? candidate.size : DEFAULT_ANNOTATION_SIZE,
    cardOffset:
      isPoint(candidate.cardOffset) && isSaneCardOffset(candidate.cardOffset)
        ? candidate.cardOffset
        : DEFAULT_CARD_OFFSET,
    categoryId: typeof candidate.categoryId === 'string' ? candidate.categoryId : null
  }
}

export function serialiseAnnotationRecord(record: AnnotationRecord): string {
  return JSON.stringify(record)
}

// A card offset this large can only be corruption, not a real preference —
// e.g. a card offset accidentally captured while the card was still parented
// inside some other frame (relative coordinates read as absolute) before
// that bug was fixed. Bounding it here means an already-corrupted record
// self-heals the next time it's synced, instead of staying broken forever.
const MAX_SANE_CARD_OFFSET = 4000

function isSaneCardOffset(point: Point): boolean {
  return Math.abs(point.x) <= MAX_SANE_CARD_OFFSET && Math.abs(point.y) <= MAX_SANE_CARD_OFFSET
}

/**
 * Resolves the side the badge sits on.
 *
 * `AUTO` follows the card: the badge moves to whichever edge faces where the
 * card has been dragged, so the leader line never crosses back over the target.
 */
export function resolveSide(
  target: Rect,
  record: AnnotationRecord
): Exclude<Magnet, 'AUTO'> {
  if (record.side !== 'AUTO') {
    return record.side
  }
  const center = centerOf(target)
  const towards = {
    x: center.x + record.cardOffset.x,
    y: center.y + record.cardOffset.y
  }
  return resolveMagnet(target, towards)
}

export function annotationLayout(
  target: Rect,
  record: AnnotationRecord,
  metrics: LayoutMetrics = DEFAULT_METRICS
): AnnotationLayout {
  const side = resolveSide(target, record)
  const edge = magnetPoint(target, side)
  const normal = outwardNormal(side)
  const radius = metrics.badgeDiameter / 2
  const badgeCenter = {
    x: edge.x + normal.x * (metrics.badgeGap + radius),
    y: edge.y + normal.y * (metrics.badgeGap + radius)
  }
  const badgeEdge = {
    x: badgeCenter.x - normal.x * radius,
    y: badgeCenter.y - normal.y * radius
  }
  const leader =
    edge.x === badgeEdge.x && edge.y === badgeEdge.y
      ? null
      : ([edge, badgeEdge] as const)
  return {
    badgeCenter,
    leader,
    cardTopLeft: {
      x: badgeCenter.x + record.cardOffset.x,
      y: badgeCenter.y + record.cardOffset.y
    }
  }
}

export const OUTSIDE_MARGIN = 20
/** Never shrink an outside card narrower than this to fit a tight gap between frames. */
export const MIN_OUTSIDE_CARD_WIDTH = 120
/** How far into the card's top edge the leader points, so it reads as "pointing at this card" rather than at a bare corner. */
export const CARD_LEADER_INSET = 10

/**
 * A leader routed as a right-angled elbow — horizontal first, then vertical
 * — instead of a straight diagonal. A card that's been pushed down to avoid
 * overlapping its neighbour (`resolveCardStacking`) can end up well below
 * where it "naturally" would sit; a straight line to it reads as messy and
 * arbitrary, where a horizontal run out from the target followed by a clean
 * vertical drop reads as deliberate routing, the way FigJam or dev-mode
 * connectors do it.
 *
 * Degrades to a plain two-point line when the points already share an axis
 * (no bend needed), and to `null` when they coincide.
 */
export function elbowPoints(from: Point, to: Point): ReadonlyArray<Point> | null {
  if (from.x === to.x && from.y === to.y) return null
  if (from.x === to.x || from.y === to.y) return [from, to]
  return [from, { x: to.x, y: from.y }, to]
}

/** How far short of the card `leaderIntoCard`'s final approach starts — see there. */
export const CARD_APPROACH_STUB = 10

/**
 * The "entering the card" counterpart to `elbowPoints`, for a leader
 * approaching a vertical edge of the card horizontally (`to.x` is that
 * edge's x) — same horizontal-out-then-vertical-drop shape, except the
 * vertical run stops `stub` px short of the card instead of running flush
 * along its edge. A vertical run positioned exactly at the card's own edge
 * reads as the leader travelling *alongside* the card for however long that
 * drop is, not entering it — floating it `stub` px off the card and closing
 * the rest with one short, plainly perpendicular final segment is what
 * actually reads as docking into it.
 *
 * `laneOffset` (default 0, i.e. no lane) pushes the vertical run — but not
 * `to` itself, which always stays flush on the card's real edge — further
 * out still. Every leader routed to the same side of the same frame shares
 * the same `to.x`, so with no offset their vertical runs (and the final
 * stub's start point) would all land on the same x; several leaders whose
 * vertical spans overlap would then render as one merged line instead of
 * several distinct ones. Giving each one in a group a different
 * `laneOffset` (see `applyCardStacking`) is what keeps them apart.
 *
 * Degrades to a plain `elbowPoints` bend when there isn't `stub + laneOffset`
 * px of horizontal run to spare (the target is basically already at the
 * card's x) or when `from` and `to` already share a y — nothing for the
 * stub to buy in either case.
 */
export function leaderIntoCard(
  from: Point,
  to: Point,
  stub: number = CARD_APPROACH_STUB,
  laneOffset = 0
): ReadonlyArray<Point> {
  const reach = stub + laneOffset
  if (from.y === to.y || Math.abs(to.x - from.x) <= reach) {
    return elbowPoints(from, to) ?? [from, to]
  }
  const sign = to.x >= from.x ? 1 : -1
  const stubX = to.x - sign * reach
  const raw: ReadonlyArray<Point> = [
    from,
    { x: stubX, y: from.y },
    { x: stubX, y: to.y },
    to
  ]
  const points: Array<Point> = []
  for (const point of raw) {
    const prev = points[points.length - 1]
    if (typeof prev !== 'undefined' && prev.x === point.x && prev.y === point.y) continue
    points.push(point)
  }
  return points
}

/**
 * The closest point on `rect`'s boundary to `from`. Assumes `from` sits
 * outside `rect`, which is always true here — a target and its own card
 * never overlap. Used to aim a leader at wherever a card's edge actually
 * faces the target, regardless of which direction `cardOffset` happens to
 * place the card in (the near-target layout has no fixed "outside which
 * side" the way the outside-frame layout does).
 */
export function nearestPointOnRect(rect: Rect, from: Point): Point {
  return {
    x: Math.min(Math.max(from.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(from.y, rect.y), rect.y + rect.height)
  }
}

// Right is the priority side — cards read left to right, so keeping them on
// one consistent side makes a page of annotations easier to scan at a
// glance. Left only overrides that when it's clearly the shorter crossing —
// under half the distance right would need — since forcing right on a
// target sitting deep in the frame's own left portion would run the leader
// straight across most of the frame's content just to reach it.
const LEFT_OVERRIDE_RATIO = 0.5

/**
 * Which side of `frame` a card routed outside it should go on.
 *
 * `crossingRight`/`crossingLeft` are how far the leader has to travel
 * *within* `frame`, from the target out to that edge, before it's clear to
 * head for the card outside — the less of that, the less of the frame's own
 * content the line cuts across on the way. Right wins by default (see
 * `LEFT_OVERRIDE_RATIO`); exposed on its own so a caller can work out which
 * side *before* it knows the card's final width (e.g. to check how much
 * room that side actually has).
 */
export function resolveOutsideSide(target: Rect, frame: Rect): 'LEFT' | 'RIGHT' {
  const targetCenter = centerOf(target)
  const crossingRight = frame.x + frame.width - targetCenter.x
  const crossingLeft = targetCenter.x - frame.x
  return crossingLeft < crossingRight * LEFT_OVERRIDE_RATIO ? 'LEFT' : 'RIGHT'
}

/**
 * Same idea as `annotationLayout`, but keeps the card out of the design
 * itself — routed past the edge of the enclosing frame instead of tucked
 * next to the target, so it never sits on top of the UI it's annotating.
 *
 * The badge still docks to the target, same as `annotationLayout`; only the
 * card moves, to whichever side of `frame` gives the leader line less
 * distance to cross. `record.side` is ignored here — the frame's geometry,
 * not the card's history, decides which side the badge faces, since the
 * whole point of this layout is a leader that never has to double back.
 */
export function annotationLayoutOutsideFrame(
  target: Rect,
  frame: Rect,
  record: AnnotationRecord,
  metrics: LayoutMetrics = DEFAULT_METRICS
): AnnotationLayout {
  const side: Exclude<Magnet, 'AUTO'> = resolveOutsideSide(target, frame)

  const edge = magnetPoint(target, side)
  const normal = outwardNormal(side)
  const radius = metrics.badgeDiameter / 2
  const badgeCenter = {
    x: edge.x + normal.x * (metrics.badgeGap + radius),
    y: edge.y + normal.y * (metrics.badgeGap + radius)
  }

  const cardTopLeft = {
    x:
      side === 'RIGHT'
        ? frame.x + frame.width + OUTSIDE_MARGIN
        : frame.x - OUTSIDE_MARGIN - metrics.cardWidth,
    y: badgeCenter.y + record.cardOffset.y
  }
  const cardNearEdge = {
    x: side === 'RIGHT' ? cardTopLeft.x : cardTopLeft.x + metrics.cardWidth,
    y: cardTopLeft.y + CARD_LEADER_INSET
  }
  const leader = elbowPoints(edge, cardNearEdge)

  return { badgeCenter, leader, cardTopLeft }
}

export interface StackableCard {
  readonly id: string
  /** Natural (unstacked) top position. */
  readonly top: number
  readonly height: number
}

/**
 * Pushes cards down just enough that none overlap another on the same side.
 *
 * Cards routed outside their frame (`annotationLayoutOutsideFrame`) are
 * placed independently of each other, so two targets close together —
 * frames stacked with only a small gap between them, say — can land cards
 * that overlap. This keeps each card's natural top when there's room, and
 * only pushes a card down, never up, so earlier cards in the order never
 * move to make way for later ones.
 */
export function resolveCardStacking(
  cards: ReadonlyArray<StackableCard>,
  gap = 16
): Map<string, number> {
  const sorted = [...cards].sort((a, b) => a.top - b.top || compareIds(a.id, b.id))
  const positions = new Map<string, number>()
  let bottom = Number.NEGATIVE_INFINITY
  for (const card of sorted) {
    const top = bottom === Number.NEGATIVE_INFINITY ? card.top : Math.max(card.top, bottom + gap)
    positions.set(card.id, top)
    bottom = top + card.height
  }
  return positions
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
