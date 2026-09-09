import { describe, expect, it } from 'vitest'

import {
  type DrawnNetwork,
  type DrawnShape,
  type DrawnVertex,
  alreadyDrawn,
  polylineAtOrigin,
  samePolyline,
  walkDrawnShape
} from '../src/core/drawnShape.js'

/** A three-point elbow, chained the way the drawing code chains one. */
const elbow: ReadonlyArray<DrawnVertex> = [
  { x: 0, y: 0, strokeCap: 'ROUND' },
  { x: 100, y: 0, cornerRadius: 20 },
  { x: 100, y: 80, strokeCap: 'ARROW_EQUILATERAL' }
]

const chain = (count: number) =>
  Array.from({ length: Math.max(0, count - 1) }, (_unused, i) => ({ start: i, end: i + 1 }))

const on = (
  vertices: ReadonlyArray<DrawnVertex>,
  x = 200,
  y = 300,
  segments = chain(vertices.length)
): DrawnShape => ({ x, y, vertices, segments })

describe('polylineAtOrigin', () => {
  /**
   * The rule both features write a line through: a vector node says where the
   * line is twice — once as the node's own position, once as vertices
   * measured from it — and the two have to agree or the line is drawn at an
   * offset from where it was routed.
   */
  it('puts the node at the top-left of the points and measures the rest from there', () => {
    const placed = polylineAtOrigin([
      { x: 140, y: 60 },
      { x: 140, y: 200 },
      { x: 400, y: 200 }
    ])
    expect(placed.x).toBe(140)
    expect(placed.y).toBe(60)
    expect(placed.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 140 },
      { x: 260, y: 140 }
    ])
  })

  /** The corner is what makes this a minimum per axis rather than the first point. */
  it('takes the minimum on each axis independently, not the first or nearest point', () => {
    // No single point is at the top-left corner: the leftmost is the lowest.
    const placed = polylineAtOrigin([
      { x: 300, y: 10 },
      { x: 50, y: 400 }
    ])
    expect(placed).toMatchObject({ x: 50, y: 10 })
    expect(placed.vertices).toEqual([
      { x: 250, y: 0 },
      { x: 0, y: 390 }
    ])
  })

  it('handles negative canvas coordinates', () => {
    const placed = polylineAtOrigin([
      { x: -400, y: -50 },
      { x: -100, y: -50 }
    ])
    expect(placed).toMatchObject({ x: -400, y: -50 })
    expect(placed.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 }
    ])
  })

  it('chains each point to the next', () => {
    const four = polylineAtOrigin([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 }
    ])
    expect(four.segments).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 }
    ])
  })

  it('gives a two-point line one segment, and leaves a leader its bare points', () => {
    const straight = polylineAtOrigin([
      { x: 0, y: 0 },
      { x: 50, y: 0 }
    ])
    expect(straight.segments).toEqual([{ start: 0, end: 1 }])
    // No `ends`: a leader has no caps or rounding to carry.
    expect(straight.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 }
    ])
  })

  describe('with ends, as a connector draws one', () => {
    const ends = { startCap: 'CIRCLE_FILLED', endCap: 'ARROW_EQUILATERAL', cornerRadius: 20 } as const
    const withEnds = (count: number) =>
      polylineAtOrigin(
        Array.from({ length: count }, (_unused, i) => ({ x: i * 10, y: 0 })),
        ends
      ).vertices

    /** A bend is a corner, not an end, so only the true ends are capped. */
    it('caps the first and last vertex and nothing in between', () => {
      const caps = withEnds(4).map((vertex) => vertex.strokeCap)
      expect(caps).toEqual(['CIRCLE_FILLED', 'NONE', 'NONE', 'ARROW_EQUILATERAL'])
    })

    /**
     * The mirror image of the caps: a cap is drawn past the end of the line,
     * so rounding an end vertex has no visible effect at all — only the bends
     * in between benefit.
     */
    it('rounds only the bends in between', () => {
      const radii = withEnds(4).map((vertex) => vertex.cornerRadius)
      expect(radii).toEqual([undefined, 20, 20, undefined])
    })

    it('gives a two-point line both caps and no rounding', () => {
      expect(withEnds(2)).toEqual([
        { x: 0, y: 0, strokeCap: 'CIRCLE_FILLED' },
        { x: 10, y: 0, strokeCap: 'ARROW_EQUILATERAL' }
      ])
    })

    /**
     * Degenerate, and reachable only through a caller that has already lost
     * its route: a single vertex is the first and the last at once. Which cap
     * it gets is arbitrary — the start one, because that test runs first —
     * and this is here so the arbitrariness is on the record rather than
     * looking like a rule somebody should preserve or "fix".
     */
    it('gives a lone vertex the start cap, arbitrarily', () => {
      expect(withEnds(1)).toEqual([{ x: 0, y: 0, strokeCap: 'CIRCLE_FILLED' }])
    })
  })

  /**
   * Not reachable from either caller — every route is at least two points —
   * but `Math.min()` of nothing is `Infinity`, and that would be written to
   * the document as a position rather than caught.
   */
  it('answers an empty line at the origin rather than Infinity', () => {
    expect(polylineAtOrigin([])).toEqual({ x: 0, y: 0, vertices: [], segments: [] })
  })
})

describe('alreadyDrawn', () => {
  it('says yes to the shape that is already there', () => {
    expect(alreadyDrawn(on(elbow), elbow, 200, 300)).toBe(true)
  })

  // The saving this exists for: a section dragged across the page carries
  // every connector inside it, so each line's shape relative to its own
  // origin has not changed at all. Only the origin moved.
  it('says no when only the origin moved', () => {
    expect(alreadyDrawn(on(elbow), elbow, 260, 300)).toBe(false)
    expect(alreadyDrawn(on(elbow), elbow, 200, 340)).toBe(false)
  })

  it('ignores sub-pixel drift in the origin', () => {
    // The numbers make a round trip through Figma and come back changed in
    // the last decimal; treating that as a difference would redraw every
    // line on every frame of every drag.
    expect(alreadyDrawn(on(elbow, 200.4, 299.6), elbow, 200, 300)).toBe(true)
  })

  it('ignores sub-pixel drift in the vertices', () => {
    const drifted = elbow.map((vertex) => ({ ...vertex, x: vertex.x + 0.4 }))
    expect(alreadyDrawn(on(drifted), elbow, 200, 300)).toBe(true)
  })

  it('says no when a point has actually moved', () => {
    const moved = elbow.map((vertex, i) => (i === 1 ? { ...vertex, x: 140 } : vertex))
    expect(alreadyDrawn(on(moved), elbow, 200, 300)).toBe(false)
  })

  it('says no when the number of points differs', () => {
    expect(alreadyDrawn(on(elbow.slice(0, 2)), elbow, 200, 300)).toBe(false)
    expect(alreadyDrawn(on([...elbow, { x: 200, y: 80 }]), elbow, 200, 300)).toBe(false)
  })

  // Caps are what make one end a dot and the other an arrow. A shape that
  // matches point for point but not cap for cap is a different line.
  it('says no when an arrowhead changed', () => {
    const swapped = elbow.map((vertex, i) =>
      i === 2 ? { ...vertex, strokeCap: 'ARROW_LINES' } : vertex
    )
    expect(alreadyDrawn(on(swapped), elbow, 200, 300)).toBe(false)
  })

  it('treats a missing cap and an explicit NONE as the same thing', () => {
    const bare: ReadonlyArray<DrawnVertex> = [{ x: 0, y: 0 }, { x: 50, y: 0 }]
    const spelled: ReadonlyArray<DrawnVertex> = [
      { x: 0, y: 0, strokeCap: 'NONE' },
      { x: 50, y: 0, strokeCap: 'NONE' }
    ]
    expect(alreadyDrawn(on(spelled), bare, 200, 300)).toBe(true)
    expect(alreadyDrawn(on(bare), spelled, 200, 300)).toBe(true)
  })

  it('says no when a corner rounding changed', () => {
    const sharper = elbow.map((vertex, i) => (i === 1 ? { ...vertex, cornerRadius: 4 } : vertex))
    expect(alreadyDrawn(on(sharper), elbow, 200, 300)).toBe(false)
  })

  it('treats a missing corner radius and an explicit 0 as the same thing', () => {
    const bare: ReadonlyArray<DrawnVertex> = [{ x: 0, y: 0 }, { x: 50, y: 0 }]
    const spelled: ReadonlyArray<DrawnVertex> = [
      { x: 0, y: 0, cornerRadius: 0 },
      { x: 50, y: 0, cornerRadius: 0 }
    ]
    expect(alreadyDrawn(on(spelled), bare, 200, 300)).toBe(true)
  })

  // The vertices being right says nothing about the line joining them in
  // that order — a reshaped line can keep every point and rewire the path
  // between them, and that has to read as different.
  it('says no when the points are chained in a different order', () => {
    const rewired = [
      { start: 0, end: 2 },
      { start: 2, end: 1 }
    ]
    expect(alreadyDrawn(on(elbow, 200, 300, rewired), elbow, 200, 300)).toBe(false)
  })

  it('says no when the chain is the wrong length for the points', () => {
    expect(alreadyDrawn(on(elbow, 200, 300, chain(2)), elbow, 200, 300)).toBe(false)
    expect(alreadyDrawn(on(elbow, 200, 300, chain(4)), elbow, 200, 300)).toBe(false)
  })

  it('handles an empty shape without claiming a chain it does not have', () => {
    expect(alreadyDrawn(on([], 0, 0, []), [], 0, 0)).toBe(true)
    expect(alreadyDrawn(on([], 0, 0, []), elbow, 0, 0)).toBe(false)
  })
})

describe('samePolyline', () => {
  const leader: DrawnNetwork = {
    vertices: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }],
    segments: chain(3)
  }
  const drawnAs = (network: DrawnNetwork, x = 100, y = 50): DrawnShape => ({
    x,
    y,
    vertices: network.vertices,
    segments: network.segments
  })

  it('says yes to the line that is already there', () => {
    expect(samePolyline(drawnAs(leader), 100, 50, leader)).toBe(true)
  })

  it('says no when the leader would move', () => {
    expect(samePolyline(drawnAs(leader), 130, 50, leader)).toBe(false)
    expect(samePolyline(drawnAs(leader), 100, 90, leader)).toBe(false)
  })

  it('ignores sub-pixel drift in both the position and the points', () => {
    const drifted: DrawnNetwork = {
      vertices: leader.vertices.map((vertex) => ({ ...vertex, y: vertex.y + 0.4 })),
      segments: leader.segments
    }
    expect(samePolyline(drawnAs(drifted, 100.3, 49.8), 100, 50, leader)).toBe(true)
  })

  // A leader that reports "already right" while pointing somewhere else is
  // the failure that matters: the card ends up connected to nothing, and
  // nothing ever redraws it.
  it('says no when a point has moved', () => {
    const moved: DrawnNetwork = {
      vertices: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 90 }],
      segments: leader.segments
    }
    expect(samePolyline(drawnAs(moved), 100, 50, leader)).toBe(false)
  })

  it('says no when the line gained or lost a bend', () => {
    const straight: DrawnNetwork = {
      vertices: leader.vertices.slice(0, 2),
      segments: chain(2)
    }
    expect(samePolyline(drawnAs(straight), 100, 50, leader)).toBe(false)
    expect(samePolyline(drawnAs(leader), 100, 50, straight)).toBe(false)
  })

  it('says no when the points are joined differently', () => {
    const rewired: DrawnNetwork = {
      vertices: leader.vertices,
      segments: [
        { start: 0, end: 2 },
        { start: 2, end: 1 }
      ]
    }
    expect(samePolyline(drawnAs(rewired), 100, 50, leader)).toBe(false)
  })

  // Unlike `alreadyDrawn`, a leader has no caps or rounding to compare, and
  // its segments are taken as given rather than required to be a chain.
  it('does not care about caps or corner rounding', () => {
    const styled: DrawnNetwork = {
      vertices: leader.vertices.map((vertex) => ({
        ...vertex,
        strokeCap: 'ARROW_LINES',
        cornerRadius: 12
      })),
      segments: leader.segments
    }
    expect(samePolyline(drawnAs(styled), 100, 50, leader)).toBe(true)
  })

  it('handles an empty line', () => {
    const nothing: DrawnNetwork = { vertices: [], segments: [] }
    expect(samePolyline(drawnAs(nothing, 0, 0), 0, 0, nothing)).toBe(true)
    expect(samePolyline(drawnAs(nothing, 0, 0), 0, 0, leader)).toBe(false)
  })
})

describe('walkDrawnShape', () => {
  /** Three points in a row, but listed out of order — as a pen-tool edit leaves them. */
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 0 }
  ]

  it('returns null for a shape with fewer than two points', () => {
    expect(walkDrawnShape({ vertices: [], segments: [] }, 0, 0)).toBeNull()
    expect(walkDrawnShape({ vertices: [{ x: 0, y: 0 }], segments: [] }, 0, 0)).toBeNull()
  })

  // The trap the whole function exists for. Adding a point mid-line with the
  // pen tool appends it to the *end* of the vertex list, so anything that
  // reads the list in order jumps out to the far end and back — and a label
  // placed "halfway along" lands somewhere the line never goes.
  it('walks the path the segments describe, not the order the points are listed in', () => {
    const run = walkDrawnShape(
      { vertices: points, segments: [{ start: 0, end: 2 }, { start: 2, end: 1 }] },
      0,
      0
    )
    expect(run?.order).toEqual([0, 2, 1])
  })

  it('places the points on the canvas using the origin it is given', () => {
    const run = walkDrawnShape(
      { vertices: points, segments: [{ start: 0, end: 2 }, { start: 2, end: 1 }] },
      1000,
      -40
    )
    expect(run?.vertices[0]?.at).toEqual({ x: 1000, y: -40 })
    expect(run?.vertices[1]?.at).toEqual({ x: 1100, y: -40 })
  })

  it('can start from either end of the run', () => {
    const run = walkDrawnShape(
      { vertices: points, segments: [{ start: 1, end: 2 }, { start: 2, end: 0 }] },
      0,
      0
    )
    // Whichever end it starts at, the sequence has to be a real walk.
    expect(run?.order).toHaveLength(3)
    expect(new Set(run?.order)).toEqual(new Set([0, 1, 2]))
    expect(run?.order[1]).toBe(2)
  })

  // Someone who has cut a connector in two, or closed it into a loop, is
  // holding something a single run cannot carry. Guessing would be worse
  // than leaving it be.
  it('returns null for a closed loop', () => {
    const loop = walkDrawnShape(
      {
        vertices: points,
        segments: [
          { start: 0, end: 1 },
          { start: 1, end: 2 },
          { start: 2, end: 0 }
        ]
      },
      0,
      0
    )
    expect(loop).toBeNull()
  })

  it('returns null for a line cut into two pieces', () => {
    const cut = walkDrawnShape(
      {
        vertices: [...points, { x: 200, y: 0 }],
        segments: [{ start: 0, end: 1 }, { start: 2, end: 3 }]
      },
      0,
      0
    )
    expect(cut).toBeNull()
  })

  it('returns null when a branch leaves a point with three neighbours', () => {
    const branched = walkDrawnShape(
      {
        vertices: [...points, { x: 50, y: 90 }],
        segments: [
          { start: 0, end: 2 },
          { start: 2, end: 1 },
          { start: 2, end: 3 }
        ]
      },
      0,
      0
    )
    expect(branched).toBeNull()
  })

  it('carries each point\'s curve handles, facing the way the walk goes', () => {
    const run = walkDrawnShape(
      {
        vertices: points,
        segments: [
          { start: 0, end: 2, tangentStart: { x: 10, y: 5 }, tangentEnd: { x: -10, y: 5 } },
          { start: 2, end: 1 }
        ]
      },
      0,
      0
    )
    // The first point has nothing behind it and a handle ahead of it.
    expect(run?.vertices[0]?.tangentIn).toBeNull()
    expect(run?.vertices[0]?.tangentOut).toEqual({ x: 10, y: 5 })
    // The middle point of the walk is vertex 2, whose handle faces back.
    expect(run?.vertices[2]?.tangentIn).toEqual({ x: -10, y: 5 })
    // The last point has nothing ahead of it.
    expect(run?.vertices[1]?.tangentOut).toBeNull()
  })

  it('leaves handles null on a shape drawn without any', () => {
    const run = walkDrawnShape(
      { vertices: points, segments: [{ start: 0, end: 2 }, { start: 2, end: 1 }] },
      0,
      0
    )
    for (const vertex of run?.vertices ?? []) {
      expect(vertex.tangentIn).toBeNull()
      expect(vertex.tangentOut).toBeNull()
    }
  })
})
