import { describe, expect, it } from 'vitest'

import {
  type DrawnNetwork,
  type DrawnShape,
  type DrawnVertex,
  alreadyDrawn,
  samePolyline,
  shapeFingerprint,
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

describe('shapeFingerprint', () => {
  const net = (
    vertices: ReadonlyArray<DrawnVertex>,
    segments = chain(vertices.length)
  ) => ({ vertices, segments })

  it('gives the same answer for the same shape', () => {
    expect(shapeFingerprint(net(elbow))).toBe(shapeFingerprint(net(elbow)))
  })

  // The bug the whole vertex-by-vertex hash exists for: pulling a bend
  // inwards leaves the bounding box exactly as it was — it is defined by the
  // two ends — and the vertex count with it. A box-and-count fingerprint
  // reports no change, and the person's edit is silently redrawn over.
  it('changes when a bend moves but the two ends do not', () => {
    const pulledIn = elbow.map((vertex, i) => (i === 1 ? { ...vertex, x: 60 } : vertex))
    expect(shapeFingerprint(net(pulledIn))).not.toBe(shapeFingerprint(net(elbow)))
  })

  // Vertices are stored relative to the node, so nudging a whole connector
  // with an arrow key — or dropping it on a frame, which reparents it and
  // rewrites x/y — changes the position and nothing about the shape.
  // Including position would hand routing over for good on a keystroke that
  // reshaped nothing.
  it('says nothing about where the node sits', () => {
    // Passed a whole `DrawnShape`, position and all, it still answers only
    // about the network — so a connector nudged with an arrow key, or
    // dropped on a frame (which reparents it and rewrites x/y), does not
    // read as reshaped.
    const here = on(elbow, 0, 0)
    const moved = on(elbow, 4000, -900)
    expect(shapeFingerprint(moved)).toBe(shapeFingerprint(here))
    expect(shapeFingerprint(here)).toBe(shapeFingerprint(net(elbow)))
  })

  it('survives the sub-pixel drift of a round trip through Figma', () => {
    const drifted = elbow.map((vertex) => ({ ...vertex, x: vertex.x + 0.3, y: vertex.y - 0.2 }))
    expect(shapeFingerprint(net(drifted))).toBe(shapeFingerprint(net(elbow)))
  })

  it('changes when a point is added', () => {
    const longer = [...elbow, { x: 160, y: 80 }]
    expect(shapeFingerprint(net(longer))).not.toBe(shapeFingerprint(net(elbow)))
  })

  it('changes when the points are rewired without moving', () => {
    const rewired = [
      { start: 0, end: 2 },
      { start: 2, end: 1 }
    ]
    expect(shapeFingerprint(net(elbow, rewired))).not.toBe(shapeFingerprint(net(elbow)))
  })

  it('ignores caps and corner rounding, which are style rather than shape', () => {
    const restyled = elbow.map((vertex) => ({ ...vertex, strokeCap: 'NONE', cornerRadius: 0 }))
    expect(shapeFingerprint(net(restyled))).toBe(shapeFingerprint(net(elbow)))
  })

  it('handles an empty network', () => {
    expect(shapeFingerprint(net([]))).toBe('|')
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
