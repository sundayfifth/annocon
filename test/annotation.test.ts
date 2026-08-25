import { describe, expect, it } from 'vitest'

import type { Rect } from '../src/core/anchor.js'
import {
  ANNOTATION_VERSION,
  type AnnotationRecord,
  DEFAULT_CARD_OFFSET,
  annotationLayout,
  createAnnotationRecord,
  numberInReadingOrder,
  parseAnnotationRecord,
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
      cardOffset: DEFAULT_CARD_OFFSET
    })
  })

  it('rejects non-finite offsets rather than rendering at NaN', () => {
    const parsed = parseAnnotationRecord('{"text":"hi","cardOffset":{"x":null,"y":0}}')
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

describe('numberInReadingOrder', () => {
  const at = (id: string, x: number, y: number) => ({ id, point: { x, y } })

  it('numbers top to bottom, left to right', () => {
    const numbers = numberInReadingOrder([
      at('c', 10, 500),
      at('b', 300, 10),
      at('a', 10, 10)
    ])
    expect([...numbers]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
  })

  it('treats near-equal heights as one row', () => {
    const numbers = numberInReadingOrder([at('right', 900, 18), at('left', 10, 0)], 24)
    expect(numbers.get('left')).toBe(1)
    expect(numbers.get('right')).toBe(2)
  })

  it('starts a new row once the tolerance is exceeded', () => {
    const numbers = numberInReadingOrder([at('below', 10, 100), at('above', 900, 0)], 24)
    expect(numbers.get('above')).toBe(1)
    expect(numbers.get('below')).toBe(2)
  })

  it('does not let a drifting band swallow a whole column', () => {
    // Each badge is 20px below the previous: within tolerance pairwise, so
    // banding from the *previous badge* would collapse all four into one row
    // and number them purely right-to-left (d, c, b, a). Banding from the
    // row's top instead breaks them into two rows of two.
    const numbers = numberInReadingOrder(
      [at('a', 500, 0), at('b', 400, 20), at('c', 300, 40), at('d', 200, 60)],
      24
    )
    expect([...numbers]).toEqual([
      ['b', 1],
      ['a', 2],
      ['d', 3],
      ['c', 4]
    ])
  })

  it('is deterministic for badges at the identical point', () => {
    const first = numberInReadingOrder([at('z', 0, 0), at('y', 0, 0)])
    const second = numberInReadingOrder([at('y', 0, 0), at('z', 0, 0)])
    expect([...first]).toEqual([...second])
  })

  it('returns an empty map for no badges', () => {
    expect(numberInReadingOrder([]).size).toBe(0)
  })
})
