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
  parseAnnotationRecord,
  resolveCardStacking,
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

  it('routes to the left when the target sits closer to the right edge of the frame', () => {
    const nearRightEdge: Rect = { x: 350, y: 100, width: 200, height: 100 }
    const layout = annotationLayoutOutsideFrame(nearRightEdge, frame, record(), metrics)
    expect(layout.badgeCenter).toEqual({ x: 330, y: 150 })
    expect(layout.cardTopLeft).toEqual({ x: -240, y: 140 })
    expect(layout.leader).toEqual([
      { x: 350, y: 150 },
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

