import { describe, expect, it } from 'vitest'

import type { Rect } from '../src/core/anchor.js'
import {
  ANNOTATION_VERSION,
  type AnnotationRecord,
  DEFAULT_CARD_OFFSET,
  annotationLayout,
  annotationLayoutOutsideFrame,
  createAnnotationRecord,
  elbowPoints,
  leaderIntoCard,
  nearestPointOnRect,
  parseAnnotationRecord,
  resolveCardStacking,
  resolveOutsideSide,
  resolveSide,
  serialiseAnnotationRecord
} from '../src/core/annotation.js'

const target: Rect = { x: 100, y: 100, width: 200, height: 100 }
const metrics = { badgeDiameter: 20, badgeGap: 10, cardWidth: 220 }

function record(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return { ...createAnnotationRecord('note'), ...overrides }
}

describe('parseAnnotationRecord', () => {
  it('round-trips a record', () => {
    const original = record({ side: 'LEFT', cardOffset: { x: -40, y: 8 } })
    expect(parseAnnotationRecord(serialiseAnnotationRecord(original))).toEqual(original)
  })

  it('returns null for empty, malformed, or textless data', () => {
    expect(parseAnnotationRecord('')).toBeNull()
    expect(parseAnnotationRecord('{oops')).toBeNull()
    expect(parseAnnotationRecord('null')).toBeNull()
    expect(parseAnnotationRecord('"a string"')).toBeNull()
    expect(parseAnnotationRecord('{"side":"LEFT"}')).toBeNull()
  })

  it('fills in defaults for fields it cannot trust', () => {
    const parsed = parseAnnotationRecord('{"text":"hi","side":"SIDEWAYS","cardOffset":{"x":1}}')
    expect(parsed).toEqual({
      v: ANNOTATION_VERSION,
      text: 'hi',
      side: 'AUTO',
      cardOffset: DEFAULT_CARD_OFFSET,
      categoryId: null
    })
  })

  it('reads a categoryId when present, else defaults to no category', () => {
    expect(parseAnnotationRecord('{"text":"hi","categoryId":"cat-1"}')?.categoryId).toBe('cat-1')
    expect(parseAnnotationRecord('{"text":"hi"}')?.categoryId).toBeNull()
    expect(parseAnnotationRecord('{"text":"hi","categoryId":5}')?.categoryId).toBeNull()
  })

  it('rejects non-finite offsets rather than rendering at NaN', () => {
    const parsed = parseAnnotationRecord('{"text":"hi","cardOffset":{"x":null,"y":0}}')
    expect(parsed?.cardOffset).toEqual(DEFAULT_CARD_OFFSET)
  })

  it('resets an implausibly large offset instead of trusting a corrupted record', () => {
    // e.g. a card offset captured while the card was still parented inside
    // another frame — a relative coordinate read as if it were absolute.
    const parsed = parseAnnotationRecord('{"text":"hi","cardOffset":{"x":48213,"y":-9110}}')
    expect(parsed?.cardOffset).toEqual(DEFAULT_CARD_OFFSET)
  })
})

describe('resolveSide', () => {
  it('respects an explicit side', () => {
    expect(resolveSide(target, record({ side: 'TOP' }))).toBe('TOP')
  })

  it('follows the card so the leader never crosses the target', () => {
    expect(resolveSide(target, record({ cardOffset: { x: 400, y: 0 } }))).toBe('RIGHT')
    expect(resolveSide(target, record({ cardOffset: { x: -400, y: 0 } }))).toBe('LEFT')
    expect(resolveSide(target, record({ cardOffset: { x: 0, y: 400 } }))).toBe('BOTTOM')
    expect(resolveSide(target, record({ cardOffset: { x: 0, y: -400 } }))).toBe('TOP')
  })
})

describe('annotationLayout', () => {
  it('places the badge outside the chosen edge, gap plus radius away', () => {
    const layout = annotationLayout(target, record({ side: 'RIGHT' }), metrics)
    // Right edge is x=300, mid-height y=150. Gap 10 + radius 10 => x=320.
    expect(layout.badgeCenter).toEqual({ x: 320, y: 150 })
  })

  it('draws the leader from the target edge to the badge edge', () => {
    const layout = annotationLayout(target, record({ side: 'BOTTOM' }), metrics)
    expect(layout.leader).toEqual([
      { x: 200, y: 200 },
      { x: 200, y: 210 }
    ])
  })

  it('omits the leader when the badge sits on the target centre', () => {
    const layout = annotationLayout(target, record({ side: 'CENTER' }), metrics)
    expect(layout.badgeCenter).toEqual({ x: 200, y: 150 })
    expect(layout.leader).toBeNull()
  })

  it('positions the card relative to the badge centre', () => {
    const layout = annotationLayout(
      target,
      record({ side: 'RIGHT', cardOffset: { x: 22, y: -10 } }),
      metrics
    )
    expect(layout.cardTopLeft).toEqual({ x: 342, y: 140 })
  })

  it('moves with the target', () => {
    const moved: Rect = { ...target, x: target.x + 500, y: target.y - 40 }
    const before = annotationLayout(target, record({ side: 'RIGHT' }), metrics)
    const after = annotationLayout(moved, record({ side: 'RIGHT' }), metrics)
    expect(after.badgeCenter).toEqual({
      x: before.badgeCenter.x + 500,
      y: before.badgeCenter.y - 40
    })
  })
})

describe('resolveOutsideSide', () => {
  const frame: Rect = { x: 0, y: 0, width: 400, height: 100 }
  const targetCenteredAt = (x: number): Rect => ({ x, y: 0, width: 0, height: 0 })

  it('routes right on an exact tie', () => {
    expect(resolveOutsideSide(targetCenteredAt(200), frame)).toBe('RIGHT')
  })

  it('routes right even when left is somewhat shorter — right is the priority', () => {
    expect(resolveOutsideSide(targetCenteredAt(170), frame)).toBe('RIGHT')
  })

  it('routes left once the target sits deep enough in the frame’s own left portion', () => {
    expect(resolveOutsideSide(targetCenteredAt(40), frame)).toBe('LEFT')
  })

  it('routes right when the target already sits near the frame’s right edge', () => {
    expect(resolveOutsideSide(targetCenteredAt(380), frame)).toBe('RIGHT')
  })
})

describe('annotationLayoutOutsideFrame', () => {
  const frame: Rect = { x: 0, y: 0, width: 400, height: 300 }

  it('routes to the right when the target has equal or more room that way', () => {
    const layout = annotationLayoutOutsideFrame(target, frame, record(), metrics)
    // Target's right edge is x=300, mid-height y=150. Badge sits gap(10) +
    // radius(10) further out.
    expect(layout.badgeCenter).toEqual({ x: 320, y: 150 })
    expect(layout.cardTopLeft).toEqual({ x: 420, y: 140 })
    expect(layout.leader).toEqual([
      { x: 300, y: 150 },
      { x: 420, y: 150 }
    ])
  })

  it('routes to the left when the target sits deep in the frame’s own left portion', () => {
    const nearLeftEdge: Rect = { x: -350, y: 100, width: 200, height: 100 }
    const layout = annotationLayoutOutsideFrame(nearLeftEdge, frame, record(), metrics)
    expect(layout.badgeCenter).toEqual({ x: -370, y: 150 })
    expect(layout.cardTopLeft).toEqual({ x: -240, y: 140 })
    expect(layout.leader).toEqual([
      { x: -350, y: 150 },
      { x: -240 + metrics.cardWidth, y: 150 }
    ])
  })

  it('keeps the card outside the frame regardless of the stored side', () => {
    // Unlike annotationLayout, a fixed `side` on the record must not pull the
    // card back next to the target — the frame edge always wins.
    const layout = annotationLayoutOutsideFrame(target, frame, record({ side: 'TOP' }), metrics)
    expect(layout.cardTopLeft.x).toBe(420)
  })

  it('ignores cardOffset.x but still applies cardOffset.y as a vertical nudge', () => {
    const nudged = record({ cardOffset: { x: 999, y: 30 } })
    const layout = annotationLayoutOutsideFrame(target, frame, nudged, metrics)
    expect(layout.cardTopLeft).toEqual({ x: 420, y: 180 })
  })

  it('bends the leader once the card is nudged off the target edge height', () => {
    const nudged = record({ cardOffset: { x: 22, y: -60 } })
    const layout = annotationLayoutOutsideFrame(target, frame, nudged, metrics)
    // cardTopLeft.y = 150 - 60 = 90; the leader targets 10px into the card's
    // top edge (CARD_LEADER_INSET), so y=100 — no longer level with the
    // target edge at y=150, so the line has to bend.
    expect(layout.leader).toEqual([
      { x: 300, y: 150 },
      { x: 420, y: 150 },
      { x: 420, y: 100 }
    ])
  })
})

describe('elbowPoints', () => {
  it('returns a straight two-point line when the points already share an axis', () => {
    expect(elbowPoints({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
    expect(elbowPoints({ x: 0, y: 0 }, { x: 0, y: 100 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 }
    ])
  })

  it('bends once — horizontal then vertical — when the points share neither axis', () => {
    expect(elbowPoints({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 }
    ])
  })

  it('returns null when the points coincide', () => {
    expect(elbowPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull()
  })
})

describe('leaderIntoCard', () => {
  it('floats the vertical run stub px short of the card, then closes with a straight final approach', () => {
    expect(leaderIntoCard({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual([
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 50 },
      { x: 100, y: 50 }
    ])
  })

  it('mirrors the same shape approaching from the right', () => {
    expect(leaderIntoCard({ x: 100, y: 0 }, { x: 0, y: 50 })).toEqual([
      { x: 100, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 0, y: 50 }
    ])
  })

  it('honours a custom stub distance', () => {
    expect(leaderIntoCard({ x: 0, y: 0 }, { x: 100, y: 40 }, 20)).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
      { x: 100, y: 40 }
    ])
  })

  it('falls back to a plain elbow bend when the points already share a y', () => {
    expect(leaderIntoCard({ x: 0, y: 50 }, { x: 100, y: 50 })).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 }
    ])
  })

  it('falls back to a plain elbow bend when there is no room for the stub', () => {
    expect(leaderIntoCard({ x: 95, y: 0 }, { x: 100, y: 50 })).toEqual([
      { x: 95, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 }
    ])
  })

  it('pushes the vertical run further out by laneOffset, without moving the point that touches the card', () => {
    expect(leaderIntoCard({ x: 0, y: 0 }, { x: 100, y: 50 }, 10, 8)).toEqual([
      { x: 0, y: 0 },
      { x: 82, y: 0 },
      { x: 82, y: 50 },
      { x: 100, y: 50 }
    ])
  })

  it('folds laneOffset into the same no-room fallback as stub', () => {
    expect(leaderIntoCard({ x: 90, y: 0 }, { x: 100, y: 50 }, 5, 10)).toEqual([
      { x: 90, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 }
    ])
  })
})

describe('nearestPointOnRect', () => {
  const rect: Rect = { x: 100, y: 100, width: 50, height: 30 }

  it('clamps straight onto the nearest edge when aligned on one axis', () => {
    expect(nearestPointOnRect(rect, { x: 120, y: 50 })).toEqual({ x: 120, y: 100 }) // above
    expect(nearestPointOnRect(rect, { x: 200, y: 110 })).toEqual({ x: 150, y: 110 }) // right
  })

  it('clamps to the nearest corner when the point is diagonal', () => {
    expect(nearestPointOnRect(rect, { x: 50, y: 50 })).toEqual({ x: 100, y: 100 })
    expect(nearestPointOnRect(rect, { x: 300, y: 300 })).toEqual({ x: 150, y: 130 })
  })
})

describe('resolveCardStacking', () => {
  it('leaves cards alone when none overlap', () => {
    const positions = resolveCardStacking(
      [
        { id: 'a', top: 0, height: 40 },
        { id: 'b', top: 100, height: 40 }
      ],
      16
    )
    expect(positions.get('a')).toBe(0)
    expect(positions.get('b')).toBe(100)
  })

  it('pushes a later card down to clear the one above it, plus the gap', () => {
    const positions = resolveCardStacking(
      [
        { id: 'a', top: 0, height: 40 },
        { id: 'b', top: 20, height: 40 }
      ],
      16
    )
    expect(positions.get('a')).toBe(0)
    expect(positions.get('b')).toBe(56) // 0 + 40 + 16
  })

  it('cascades through a chain of overlaps', () => {
    const positions = resolveCardStacking(
      [
        { id: 'a', top: 0, height: 40 },
        { id: 'b', top: 10, height: 40 },
        { id: 'c', top: 20, height: 40 }
      ],
      10
    )
    expect(positions.get('a')).toBe(0)
    expect(positions.get('b')).toBe(50) // 0 + 40 + 10
    expect(positions.get('c')).toBe(100) // 50 + 40 + 10
  })

  it('never moves a card up, even if that would pack tighter', () => {
    const positions = resolveCardStacking(
      [
        { id: 'a', top: 200, height: 40 },
        { id: 'b', top: 0, height: 20 }
      ],
      10
    )
    // b is processed first (lower natural top) and keeps its position; a
    // starts well clear of b already, so it also keeps its natural position.
    expect(positions.get('b')).toBe(0)
    expect(positions.get('a')).toBe(200)
  })

  it('is deterministic for cards with the identical natural top', () => {
    const first = resolveCardStacking(
      [
        { id: 'z', top: 0, height: 40 },
        { id: 'y', top: 0, height: 40 }
      ],
      10
    )
    const second = resolveCardStacking(
      [
        { id: 'y', top: 0, height: 40 },
        { id: 'z', top: 0, height: 40 }
      ],
      10
    )
    expect([...first]).toEqual([...second])
  })
})

