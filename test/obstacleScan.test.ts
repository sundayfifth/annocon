import { describe, expect, it } from 'vitest'

import type { Rect } from '../src/core/anchor.js'
import { boxesChangedBetweenScans } from '../src/core/obstacleScan.js'

const scan = (entries: Record<string, Rect>): ReadonlyMap<string, Rect> =>
  new Map(Object.entries(entries))

const screen = { x: 0, y: 0, width: 400, height: 800 }
const middle = { x: 500, y: 0, width: 400, height: 800 }
const right = { x: 1000, y: 0, width: 400, height: 800 }

describe('boxesChangedBetweenScans', () => {
  it('reports nothing when the two scans agree', () => {
    const before = scan({ a: screen, b: middle })
    const now = scan({ a: { ...screen }, b: { ...middle } })
    // Fresh objects with the same numbers: compared by value, not identity,
    // or every scan would invalidate every line on the page.
    expect(boxesChangedBetweenScans(before, now)).toEqual([])
  })

  it('reports nothing at all on an empty page', () => {
    expect(boxesChangedBetweenScans(scan({}), scan({}))).toEqual([])
  })

  // The bug this whole two-scan comparison exists for: a `nodechange` for a
  // deletion arrives *after* the node is gone, so the box is simply missing
  // from the new scan and there is no bounding box left to ask. Without the
  // previous scan there is nothing to hand the invalidation pass, and every
  // line bending around the deleted screen keeps bending around thin air.
  it('reports where a deleted box used to be', () => {
    const changed = boxesChangedBetweenScans(scan({ a: screen, b: middle }), scan({ a: screen }))
    expect(changed).toEqual([middle])
  })

  // Hiding a screen is indistinguishable from deleting it here, deliberately:
  // both mean "no longer collected", and both have to invalidate the lines
  // that were routing around it. Parking an old screen behind the eye icon is
  // ordinary use, and it used to leave the lines bent around nothing.
  it('reports a hidden box the same way as a deleted one', () => {
    const hidden = boxesChangedBetweenScans(scan({ a: screen, b: middle }), scan({ a: screen }))
    const deleted = boxesChangedBetweenScans(scan({ a: screen, b: middle }), scan({ a: screen }))
    expect(hidden).toEqual(deleted)
    expect(hidden).toEqual([middle])
  })

  it('reports a box that has appeared', () => {
    const changed = boxesChangedBetweenScans(scan({ a: screen }), scan({ a: screen, b: middle }))
    expect(changed).toEqual([middle])
  })

  // Both rectangles, not just the new one. A screen dragged out from between
  // two others has to free the line it was blocking as well as bother
  // whatever it has just landed on top of — reporting only where it ended up
  // left the old route bent around empty space.
  it('reports both the space a moved box left and the space it took', () => {
    const moved = { ...middle, x: 500, y: 900 }
    const changed = boxesChangedBetweenScans(scan({ b: middle }), scan({ b: moved }))
    expect(changed).toEqual([middle, moved])
  })

  it('treats a resize as a move: both the old box and the new one', () => {
    const grown = { ...middle, width: 900 }
    const changed = boxesChangedBetweenScans(scan({ b: middle }), scan({ b: grown }))
    expect(changed).toEqual([middle, grown])
  })

  it('reports a box dragged off the page like any other disappearance', () => {
    const changed = boxesChangedBetweenScans(scan({ a: screen, b: middle }), scan({ b: middle }))
    expect(changed).toEqual([screen])
  })

  it('reports every kind of change in one pass', () => {
    const moved = { ...screen, y: 900 }
    const changed = boxesChangedBetweenScans(
      scan({ a: screen, b: middle, c: right }),
      scan({ a: moved, c: right, d: { x: 2000, y: 0, width: 100, height: 100 } })
    )
    expect(changed).toEqual(
      expect.arrayContaining([screen, moved, { x: 2000, y: 0, width: 100, height: 100 }, middle])
    )
    // The untouched box is the one thing that must not be in the list —
    // it is what stops a busy page re-routing every line on every scan.
    expect(changed).not.toContainEqual(right)
    expect(changed).toHaveLength(4)
  })

  it('reports everything on the very first scan, when there is no previous one', () => {
    const changed = boxesChangedBetweenScans(scan({}), scan({ a: screen, b: middle }))
    expect(changed).toEqual([screen, middle])
  })
})
