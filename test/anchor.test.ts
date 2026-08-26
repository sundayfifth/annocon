import { describe, expect, it } from 'vitest'

import {
  type Anchor,
  type Rect,
  anchorNodeId,
  centerOf,
  magnetPoint,
  outwardNormal,
  ratioPoint,
  resolveAnchor,
  resolveAnchorPair,
  resolveMagnet
} from '../src/core/anchor.js'

const box: Rect = { x: 100, y: 200, width: 40, height: 20 }

describe('magnetPoint', () => {
  it('puts each magnet on the midpoint of its side', () => {
    expect(magnetPoint(box, 'TOP')).toEqual({ x: 120, y: 200 })
    expect(magnetPoint(box, 'BOTTOM')).toEqual({ x: 120, y: 220 })
    expect(magnetPoint(box, 'LEFT')).toEqual({ x: 100, y: 210 })
    expect(magnetPoint(box, 'RIGHT')).toEqual({ x: 140, y: 210 })
    expect(magnetPoint(box, 'CENTER')).toEqual(centerOf(box))
  })
})

describe('ratioPoint', () => {
  it('maps 0..1 onto the box', () => {
    expect(ratioPoint(box, { x: 0, y: 0 })).toEqual({ x: 100, y: 200 })
    expect(ratioPoint(box, { x: 1, y: 1 })).toEqual({ x: 140, y: 220 })
    expect(ratioPoint(box, { x: 0.25, y: 0.5 })).toEqual({ x: 110, y: 210 })
  })
})

describe('resolveMagnet', () => {
  it('faces the counterpart on the dominant axis', () => {
    expect(resolveMagnet(box, { x: 900, y: 210 })).toBe('RIGHT')
    expect(resolveMagnet(box, { x: -900, y: 210 })).toBe('LEFT')
    expect(resolveMagnet(box, { x: 120, y: 900 })).toBe('BOTTOM')
    expect(resolveMagnet(box, { x: 120, y: -900 })).toBe('TOP')
  })

  it('compares gaps, not centre distance, so a wide box still goes vertical', () => {
    // 400 wide, 20 tall. The counterpart is 60px below and 150px to the right:
    // centre distance says horizontal, but the horizontal gap is negative
    // (still inside the box) while the vertical gap is positive.
    const wide: Rect = { x: 0, y: 0, width: 400, height: 20 }
    expect(resolveMagnet(wide, { x: 350, y: 70 })).toBe('BOTTOM')
  })

  it('breaks exact ties horizontally', () => {
    const square: Rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(resolveMagnet(square, { x: 250, y: 250 })).toBe('RIGHT')
  })
})

describe('resolveAnchor', () => {
  it('returns a free anchor as-is, with or without a rect', () => {
    const anchor: Anchor = { kind: 'free', point: { x: 7, y: 9 } }
    expect(resolveAnchor(anchor, null, null)).toEqual({ x: 7, y: 9 })
  })

  it('returns null for an orphaned attached anchor', () => {
    const anchor: Anchor = { kind: 'magnet', nodeId: 'a', magnet: 'TOP' }
    expect(resolveAnchor(anchor, null, { x: 0, y: 0 })).toBeNull()
  })

  it('falls back to the box centre when AUTO has no counterpart', () => {
    const anchor: Anchor = { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' }
    // Counterpart == own centre, so the tie-break applies: RIGHT.
    expect(resolveAnchor(anchor, box, null)).toEqual({ x: 140, y: 210 })
  })
})

describe('resolveAnchorPair', () => {
  const left: Rect = { x: 0, y: 0, width: 100, height: 100 }
  const right: Rect = { x: 400, y: 0, width: 100, height: 100 }
  const auto = (nodeId: string): Anchor => ({ kind: 'magnet', nodeId, magnet: 'AUTO' })

  it('turns AUTO into the sides that face each other', () => {
    const pair = resolveAnchorPair(auto('l'), left, auto('r'), right)
    expect(pair.start).toEqual({ x: 100, y: 50 })
    expect(pair.end).toEqual({ x: 400, y: 50 })
  })

  it('is symmetric under swapping the ends', () => {
    const forward = resolveAnchorPair(auto('l'), left, auto('r'), right)
    const backward = resolveAnchorPair(auto('r'), right, auto('l'), left)
    expect(backward.start).toEqual(forward.end)
    expect(backward.end).toEqual(forward.start)
  })

  it('picks vertical sides for a stacked pair', () => {
    const below: Rect = { x: 0, y: 400, width: 100, height: 100 }
    const pair = resolveAnchorPair(auto('l'), left, auto('b'), below)
    expect(pair.start).toEqual({ x: 50, y: 100 })
    expect(pair.end).toEqual({ x: 50, y: 400 })
  })

  it('resolves the surviving side when the other end is orphaned', () => {
    const pair = resolveAnchorPair(auto('l'), left, auto('gone'), null)
    expect(pair.start).not.toBeNull()
    expect(pair.end).toBeNull()
  })

  it('honours a free counterpart when resolving AUTO', () => {
    const free: Anchor = { kind: 'free', point: { x: -300, y: 50 } }
    const pair = resolveAnchorPair(auto('l'), left, free, null)
    expect(pair.start).toEqual({ x: 0, y: 50 })
    expect(pair.end).toEqual({ x: -300, y: 50 })
  })

  it('reports which side each endpoint resolved to, null for a free anchor', () => {
    const pair = resolveAnchorPair(auto('l'), left, auto('r'), right)
    expect(pair.startSide).toBe('RIGHT')
    expect(pair.endSide).toBe('LEFT')

    const free: Anchor = { kind: 'free', point: { x: -300, y: 50 } }
    const withFree = resolveAnchorPair(auto('l'), left, free, null)
    expect(withFree.endSide).toBeNull()
  })
})

describe('outwardNormal', () => {
  it('points away from the box on each side', () => {
    expect(outwardNormal('TOP')).toEqual({ x: 0, y: -1 })
    expect(outwardNormal('BOTTOM')).toEqual({ x: 0, y: 1 })
    expect(outwardNormal('LEFT')).toEqual({ x: -1, y: 0 })
    expect(outwardNormal('RIGHT')).toEqual({ x: 1, y: 0 })
    expect(outwardNormal('CENTER')).toEqual({ x: 0, y: 0 })
  })
})

describe('anchorNodeId', () => {
  it('reports the dependency, or null when free', () => {
    expect(anchorNodeId({ kind: 'magnet', nodeId: 'n1', magnet: 'AUTO' })).toBe('n1')
    expect(anchorNodeId({ kind: 'ratio', nodeId: 'n2', ratio: { x: 0, y: 0 } })).toBe('n2')
    expect(anchorNodeId({ kind: 'free', point: { x: 0, y: 0 } })).toBeNull()
  })
})
