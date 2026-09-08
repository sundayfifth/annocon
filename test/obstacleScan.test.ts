import { describe, expect, it } from 'vitest'

import type { Point, Rect } from '../src/core/anchor.js'
import type { ConnectorGeometry } from '../src/core/connector.js'
import {
  type RouteObstacle,
  EMPTY_OBSTACLES,
  boxesChangedBetweenScans,
  splitRouteObstacles
} from '../src/core/obstacleScan.js'

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

describe('splitRouteObstacles', () => {
  const geometry = (start: Point | null, end: Point | null): ConnectorGeometry => ({
    start,
    end,
    complete: start !== null && end !== null,
    startSide: 'RIGHT',
    endSide: 'LEFT'
  })
  const at = (id: string, x: number): RouteObstacle => ({
    id,
    rect: { x, y: 0, width: 200, height: 400 }
  })
  const from = at('a', 0)
  const between = at('b', 400)
  const to = at('c', 800)
  const ends = geometry({ x: 200, y: 200 }, { x: 800, y: 200 })

  it('calls a box neither end owns a stranger', () => {
    const split = splitRouteObstacles([from, between, to], ends, 'a', 'c')
    expect(split.foreign).toEqual([between.rect])
  })

  // Dropping the endpoints' own screens entirely is true of the segments that
  // leave and arrive, and false of everything in between: a route leaving by
  // its nearest edge is otherwise free to turn straight back through the
  // middle of that same screen.
  it('keeps each end\'s own screen, sorted apart rather than thrown away', () => {
    const split = splitRouteObstacles([from, between, to], ends, 'a', 'c')
    expect(split.own).toEqual([from.rect, to.rect])
  })

  it('sorts a box both ends share into `own` once, not twice', () => {
    const shared = at('same', 0)
    const split = splitRouteObstacles([shared], ends, 'same', 'same')
    expect(split.own).toEqual([shared.rect])
    expect(split.foreign).toEqual([])
  })

  it('treats an end with no owner as owning nothing', () => {
    const split = splitRouteObstacles([from, between, to], ends, null, null)
    expect(split.own).toEqual([])
    expect(split.foreign).toEqual([from.rect, between.rect, to.rect])
  })

  it('drops what is nowhere near the line', () => {
    const miles = at('far', 90000)
    const split = splitRouteObstacles([between, miles], ends, null, null)
    expect(split.foreign).toEqual([between.rect])
  })

  it('avoids nothing at all when either endpoint is missing', () => {
    const dangling = geometry({ x: 200, y: 200 }, null)
    expect(splitRouteObstacles([from, between, to], dangling, 'a', 'c')).toEqual(EMPTY_OBSTACLES)
  })

  it('keeps two boxes that happen to share a rectangle apart by id', () => {
    // Same numbers, different nodes — a duplicated screen sitting exactly on
    // top of its original. Sorting by value alone would put both in whichever
    // bucket the first one landed in.
    const twin = { id: 'twin', rect: { ...between.rect } }
    const split = splitRouteObstacles([between, twin], ends, 'twin', null)
    expect(split.own).toEqual([twin.rect])
    expect(split.foreign).toEqual([between.rect])
  })
})
