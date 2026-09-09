import { describe, expect, it } from 'vitest'

import { orientedTowards, parseManualShape, shiftManualShape } from '../src/core/manualShape.js'

describe('shiftManualShape', () => {
  /** A hand-drawn line: out, down, along. */
  const shape = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 100 },
    { x: 200, y: 100 }
  ]
  const was = { start: { x: 0, y: 0 }, end: { x: 200, y: 100 } }

  it('leaves the shape alone when neither end moved', () => {
    expect(shiftManualShape(shape, was, was)).toEqual(shape)
  })

  /**
   * The common case, and the one worth getting exactly right: a whole group
   * of screens dragged somewhere else. Both ends move by the same amount, so
   * the shape someone drew is still the right shape — it just belongs 300
   * pixels to the right.
   */
  it('slides the whole line when both ends move the same way', () => {
    const moved = {
      start: { x: 300, y: 40 },
      end: { x: 500, y: 140 }
    }
    expect(shiftManualShape(shape, was, moved)).toEqual([
      { x: 300, y: 40 },
      { x: 350, y: 40 },
      { x: 350, y: 140 },
      { x: 500, y: 140 }
    ])
  })

  it('keeps both ends on their layers when only one moved', () => {
    const moved = { start: { x: 0, y: 0 }, end: { x: 260, y: 100 } }
    const shifted = shiftManualShape(shape, was, moved)
    expect(shifted[0]).toEqual({ x: 0, y: 0 })
    expect(shifted[shifted.length - 1]).toEqual({ x: 260, y: 100 })
  })

  /**
   * The middle is carried along in proportion rather than left behind or
   * dragged the full distance: a bend a third of the way down the line
   * should still look a third of the way down it afterwards.
   */
  it('carries the middle in proportion to how far along it sits', () => {
    const moved = { start: { x: 0, y: 0 }, end: { x: 200, y: 200 } }
    const shifted = shiftManualShape(shape, was, moved)
    const bend = shifted[2] as { x: number; y: number }
    expect(bend.y).toBeGreaterThan(100)
    expect(bend.y).toBeLessThan(200)
  })

  it('survives a shape with one point, or none', () => {
    expect(shiftManualShape([], was, was)).toEqual([])
    expect(shiftManualShape([{ x: 0, y: 0 }], was, { start: { x: 10, y: 10 }, end: { x: 10, y: 10 } })).toEqual([
      { x: 10, y: 10 }
    ])
  })
})

describe('orientedTowards', () => {
  const at = (x: number, y: number) => ({ at: { x, y }, tangentIn: null, tangentOut: null })
  const start = { x: 0, y: 0 }
  const end = { x: 200, y: 100 }

  it('leaves a walk that already runs start-to-end alone', () => {
    const drawn = { vertices: [at(0, 0), at(50, 0), at(200, 100)], order: [0, 1, 2] }
    expect(orientedTowards(drawn, start, end).order).toEqual([0, 1, 2])
  })

  /**
   * A vector network lists its vertices in whatever order the editor left
   * them, so a walk can come out back to front. Uncorrected, the two ends
   * swap arrowheads and each end follows the *other* end's layer.
   */
  it('turns a walk that runs end-to-start around', () => {
    const drawn = { vertices: [at(200, 100), at(50, 0), at(0, 0)], order: [0, 1, 2] }
    expect(orientedTowards(drawn, start, end).order).toEqual([2, 1, 0])
  })

  /** Reversing the direction of travel swaps what "in" and "out" mean. */
  it('swaps a vertex\'s two tangents when it turns one around', () => {
    const drawn = {
      vertices: [
        { at: { x: 200, y: 100 }, tangentIn: { x: 1, y: 1 }, tangentOut: { x: 2, y: 2 } },
        { at: { x: 0, y: 0 }, tangentIn: null, tangentOut: { x: 3, y: 3 } }
      ],
      order: [0, 1]
    }
    const turned = orientedTowards(drawn, start, end)
    expect(turned.vertices[0]).toEqual({
      at: { x: 200, y: 100 },
      tangentIn: { x: 2, y: 2 },
      tangentOut: { x: 1, y: 1 }
    })
    expect(turned.vertices[1]?.tangentIn).toEqual({ x: 3, y: 3 })
  })
})

describe('parseManualShape', () => {
  const vertex = (x: number, y: number) => ({ at: { x, y }, tangentIn: null, tangentOut: null })
  const shape = {
    vertices: [vertex(0, 0), vertex(50, 30)],
    order: [0, 1],
    start: { x: 0, y: 0 },
    end: { x: 50, y: 30 }
  }

  it('round-trips a shape it wrote', () => {
    expect(parseManualShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape)
  })

  it('keeps tangents when they are there, and nulls them when they are not', () => {
    const curved = {
      ...shape,
      vertices: [
        { at: { x: 0, y: 0 }, tangentIn: null, tangentOut: { x: 20, y: 0 } },
        { at: { x: 50, y: 30 }, tangentIn: { x: -20, y: 0 }, tangentOut: null }
      ]
    }
    expect(parseManualShape(JSON.parse(JSON.stringify(curved)))).toEqual(curved)
    expect(parseManualShape({ ...shape, vertices: [{ at: { x: 0, y: 0 } }, { at: { x: 1, y: 1 } }] }))
      .toEqual({ ...shape, end: { x: 50, y: 30 }, vertices: [vertex(0, 0), vertex(1, 1)] })
  })

  /**
   * All of it or none of it, unlike the tolerant field-by-field decoding a
   * style gets. A style field that fails to decode falls back to a default
   * and the connector still looks like a connector; half a shape is not half
   * a line, it is a different line drawn somewhere its author never put it.
   */
  it('refuses the whole shape when any one vertex is unreadable', () => {
    expect(parseManualShape({ ...shape, vertices: [vertex(0, 0), { at: 'nope' }] })).toBeNull()
    expect(parseManualShape({ ...shape, vertices: [vertex(0, 0), null] })).toBeNull()
  })

  it('refuses a shape with no ends recorded', () => {
    expect(parseManualShape({ ...shape, start: undefined })).toBeNull()
    expect(parseManualShape({ ...shape, end: { x: 1 } })).toBeNull()
  })

  /** Two vertices is the least that can describe a line. */
  it('refuses a shape too short to be a line', () => {
    expect(parseManualShape({ ...shape, vertices: [vertex(0, 0)], order: [0] })).toBeNull()
    expect(parseManualShape({ ...shape, order: [0] })).toBeNull()
  })

  /** An index past the end would draw the line to nowhere. */
  it('refuses an order naming a vertex that is not there', () => {
    expect(parseManualShape({ ...shape, order: [0, 2] })).toBeNull()
    expect(parseManualShape({ ...shape, order: [0, -1] })).toBeNull()
    expect(parseManualShape({ ...shape, order: [0, 1.5] })).toBeNull()
  })

  it('refuses anything that is not a shape at all', () => {
    expect(parseManualShape(null)).toBeNull()
    expect(parseManualShape('a string')).toBeNull()
    expect(parseManualShape({})).toBeNull()
    expect(parseManualShape({ ...shape, vertices: 'nope' })).toBeNull()
    expect(parseManualShape({ ...shape, order: 'nope' })).toBeNull()
  })
})
