import { describe, expect, it } from 'vitest'

import {
  type DrawnShape,
  type DrawnVertex,
  alreadyDrawn,
  shapeFingerprint
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
