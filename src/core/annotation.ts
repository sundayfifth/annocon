/**
 * The annotation record and its layout — pure, so it can be tested without a
 * Figma document.
 *
 * One record per annotated node, stored as JSON in that node's plugin data.
 * Everything drawn on the canvas is derived from it; nothing is ever read back
 * off the rendered nodes.
 */

import { type Magnet, type Point, type Rect, centerOf, magnetPoint, resolveMagnet } from './anchor.js'

export const ANNOTATION_VERSION = 1

export interface AnnotationRecord {
  readonly v: typeof ANNOTATION_VERSION
  readonly text: string
  /** Which side of the target the badge sits on. `AUTO` follows the card. */
  readonly side: Magnet
  /** Card top-left, relative to the badge centre. */
  readonly cardOffset: Point
}

export interface LayoutMetrics {
  readonly badgeDiameter: number
  /** Gap between the target's edge and the near edge of the badge. */
  readonly badgeGap: number
  readonly cardWidth: number
}

export const DEFAULT_METRICS: LayoutMetrics = {
  badgeDiameter: 20,
  badgeGap: 12,
  cardWidth: 220
}

export const DEFAULT_CARD_OFFSET: Point = { x: 22, y: -10 }

export interface AnnotationLayout {
  /** Centre of the badge, in the same space as the target rect. */
  readonly badgeCenter: Point
  /**
   * Leader line from the target's edge to the badge's edge, or `null` when the
   * two coincide and a line would be a zero-length artefact.
   */
  readonly leader: readonly [Point, Point] | null
  readonly cardTopLeft: Point
}

export function createAnnotationRecord(text: string): AnnotationRecord {
  return {
    v: ANNOTATION_VERSION,
    text,
    side: 'AUTO',
    cardOffset: DEFAULT_CARD_OFFSET
  }
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
    cardOffset: isPoint(candidate.cardOffset) ? candidate.cardOffset : DEFAULT_CARD_OFFSET
  }
}

export function serialiseAnnotationRecord(record: AnnotationRecord): string {
  return JSON.stringify(record)
}

const MAGNETS: ReadonlyArray<Magnet> = ['AUTO', 'TOP', 'RIGHT', 'BOTTOM', 'LEFT', 'CENTER']

function isMagnet(value: unknown): value is Magnet {
  return typeof value === 'string' && MAGNETS.includes(value as Magnet)
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y)
  )
}

/** Unit vector pointing out of the target, away from the chosen side. */
function outwardNormal(side: Exclude<Magnet, 'AUTO'>): Point {
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

/**
 * Numbers annotations in reading order — top to bottom, then left to right.
 *
 * Rows are banded so badges at slightly different heights still count as the
 * same row, which is how a person reads a screen full of annotations. The
 * banding is done as an explicit pass rather than inside a comparator: "within
 * `rowTolerance` of each other" is not transitive, so using it to compare pairs
 * gives an unstable sort.
 */
export function numberInReadingOrder(
  badges: ReadonlyArray<{ readonly id: string; readonly point: Point }>,
  rowTolerance = 24
): Map<string, number> {
  const byPosition = [...badges].sort(
    (a, b) => a.point.y - b.point.y || a.point.x - b.point.x || compareIds(a.id, b.id)
  )

  const rows: Array<Array<{ id: string; point: Point }>> = []
  let bandTop = Number.NEGATIVE_INFINITY
  for (const badge of byPosition) {
    const row = rows[rows.length - 1]
    if (typeof row === 'undefined' || badge.point.y - bandTop > rowTolerance) {
      bandTop = badge.point.y
      rows.push([badge])
      continue
    }
    row.push(badge)
  }

  const numbers = new Map<string, number>()
  let next = 1
  for (const row of rows) {
    row.sort((a, b) => a.point.x - b.point.x || compareIds(a.id, b.id))
    for (const badge of row) {
      numbers.set(badge.id, next)
      next += 1
    }
  }
  return numbers
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
