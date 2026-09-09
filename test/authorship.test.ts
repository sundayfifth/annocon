import { describe, expect, it } from 'vitest'

import { placedByUs, placementFingerprint, shapeFingerprint } from '../src/core/authorship.js'
import type { DrawnShape, DrawnVertex } from '../src/core/drawnShape.js'

/** A three-point elbow, chained the way the drawing code chains one. */
const elbow: ReadonlyArray<DrawnVertex> = [
  { x: 0, y: 0, strokeCap: 'ROUND' },
  { x: 100, y: 0, cornerRadius: 20 },
  { x: 100, y: 80, strokeCap: 'ARROW_EQUILATERAL' }
]

const chain = (count: number) =>
  Array.from({ length: Math.max(0, count - 1) }, (_unused, i) => ({ start: i, end: i + 1 }))

/** The same vertices, as a whole shape sitting somewhere on the canvas. */
const on = (vertices: ReadonlyArray<DrawnVertex>, x: number, y: number): DrawnShape => ({
  x,
  y,
  vertices,
  segments: chain(vertices.length)
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

describe('placementFingerprint', () => {
  const at = (x: number, y: number, width = 220) => ({ x, y, width })

  it('gives the same answer for the same placement', () => {
    expect(placementFingerprint(at(100, 200))).toBe(placementFingerprint(at(100, 200)))
  })

  it('changes when the card is moved on either axis', () => {
    expect(placementFingerprint(at(101, 200))).not.toBe(placementFingerprint(at(100, 200)))
    expect(placementFingerprint(at(100, 201))).not.toBe(placementFingerprint(at(100, 200)))
  })

  /** Dragging a card's side edge is a deliberate width, and has to be noticed. */
  it('changes when the card is made wider or narrower', () => {
    expect(placementFingerprint(at(100, 200, 260))).not.toBe(placementFingerprint(at(100, 200)))
  })

  /**
   * Height is the text's business, not the person's — it follows the words
   * and the type size. Including it would report a re-flow as a hand edit.
   */
  it('says nothing about height, which is never written', () => {
    expect(Object.keys(at(100, 200))).not.toContain('height')
  })

  /**
   * The plugin's own writes come back with the drift of a float round trip.
   * A fingerprint that changed on its own would claim every card in the file
   * as dragged.
   */
  it('ignores sub-unit drift', () => {
    expect(placementFingerprint(at(100.4, 199.7))).toBe(placementFingerprint(at(100, 200)))
  })

  it('separates placements a whole unit apart', () => {
    expect(placementFingerprint(at(100, 200))).not.toBe(placementFingerprint(at(101, 200)))
  })

  it('handles negative coordinates', () => {
    expect(placementFingerprint(at(-400, -50))).toBe(placementFingerprint(at(-400, -50)))
    expect(placementFingerprint(at(-400, -50))).not.toBe(placementFingerprint(at(-401, -50)))
  })
})

describe('placedByUs', () => {
  const placement = { x: 100, y: 200, width: 220 }

  it('is true where the card has not moved since we put it there', () => {
    expect(placedByUs(placementFingerprint(placement), placement)).toBe(true)
  })

  it('is false once a person has moved or resized it', () => {
    const remembered = placementFingerprint(placement)
    expect(placedByUs(remembered, { ...placement, y: 260 })).toBe(false)
    expect(placedByUs(remembered, { ...placement, width: 260 })).toBe(false)
  })

  /**
   * A card placed before any of this was recorded. `false` is the safe way
   * round: it is read as a person's move, and a card sitting where its record
   * already says it should be produces no change to write — so the first sync
   * after this simply re-reads what was already true and fingerprints it.
   */
  it('is false when nothing was remembered', () => {
    expect(placedByUs('', placement)).toBe(false)
  })

  /** Never true by accident: an unparseable leftover is not a match either. */
  it('is false for a remembered value that is not a fingerprint', () => {
    expect(placedByUs('nonsense', placement)).toBe(false)
  })
})

