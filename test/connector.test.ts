import { describe, expect, it } from 'vitest'

import type { Rect } from '../src/core/anchor.js'
import {
  CONNECTOR_VERSION,
  type ConnectorRecord,
  DEFAULT_CONNECTOR_COLOR,
  DEFAULT_CONNECTOR_OPACITY,
  DEFAULT_CONNECTOR_STYLE_PREFS,
  DEFAULT_CONNECTOR_WEIGHT,
  DEFAULT_CORNER_RADIUS,
  DEFAULT_DETOUR,
  DEFAULT_END_CAP,
  DEFAULT_LABEL,
  DEFAULT_LINE_STYLE,
  DEFAULT_START_CAP,
  ROUTE_SEARCH_MARGIN,
  boxCouldAffectRoute,
  connectorAxisOf,
  connectorCurveTangents,
  connectorRoutePoints,
  connectorStubClearance,
  obstaclesInPlay,
  routeCost,
  routeCrossings,
  createConnectorRecord,
  frameGapMidpoint,
  parseConnectorRecord,
  parseConnectorStylePrefs,
  pointAlongPolyline,
  pointOnCurve,
  resolveConnectorGeometry,
  serialiseConnectorRecord,
  serialiseConnectorStylePrefs
} from '../src/core/connector.js'

const startRect: Rect = { x: 0, y: 0, width: 100, height: 100 }
const endRect: Rect = { x: 400, y: 0, width: 100, height: 100 }

describe('createConnectorRecord', () => {
  it('anchors both ends to the given nodes with AUTO magnets', () => {
    const record = createConnectorRecord('a', 'b')
    expect(record).toEqual({
      v: CONNECTOR_VERSION,
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      strokeWeight: DEFAULT_CONNECTOR_WEIGHT,
      color: DEFAULT_CONNECTOR_COLOR,
      opacity: DEFAULT_CONNECTOR_OPACITY,
      startCap: DEFAULT_START_CAP,
      endCap: DEFAULT_END_CAP,
      lineStyle: DEFAULT_LINE_STYLE,
      cornerRadius: DEFAULT_CORNER_RADIUS,
      detour: DEFAULT_DETOUR,
      label: DEFAULT_LABEL
    })
  })

  it('starts from the given style prefs instead of the shipped defaults, but never inherits a label or a detour', () => {
    const stylePrefs = {
      strokeWeight: 3,
      color: '#8C8C8C',
      opacity: 0.5,
      startCap: 'NONE' as const,
      endCap: 'DIAMOND_FILLED' as const,
      lineStyle: 'CURVE' as const,
      cornerRadius: 8
    }
    const record = createConnectorRecord('a', 'b', stylePrefs)
    expect(record).toEqual({
      v: CONNECTOR_VERSION,
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      ...stylePrefs,
      detour: DEFAULT_DETOUR,
      label: DEFAULT_LABEL
    })
  })
})

describe('parseConnectorStylePrefs / serialiseConnectorStylePrefs', () => {
  it('round-trips a full set of style prefs', () => {
    const prefs = {
      strokeWeight: 4,
      color: '#0091FF',
      opacity: 0.75,
      startCap: 'DIAMOND_FILLED' as const,
      endCap: 'TRIANGLE_FILLED' as const,
      lineStyle: 'STRAIGHT' as const,
      cornerRadius: 12
    }
    expect(parseConnectorStylePrefs(serialiseConnectorStylePrefs(prefs))).toEqual(prefs)
  })

  /**
   * Which way round an obstacle is not a style the way a colour is. A colour
   * applies to every connector there will ever be; "go below" only means
   * anything while something is in the way, so carrying it forward leaves it
   * lying in wait on lines that have nothing to avoid — where it does
   * nothing at all until, one day, it does.
   */
  it('does not carry a pinned detour forward to the next connector', () => {
    const raw = serialiseConnectorStylePrefs({
      ...DEFAULT_CONNECTOR_STYLE_PREFS,
      color: '#8C8C8C'
    })
    expect(raw).not.toContain('detour')
    expect(parseConnectorStylePrefs(JSON.stringify({ detour: 'BOTTOM' }))).toEqual(
      DEFAULT_CONNECTOR_STYLE_PREFS
    )
    expect(createConnectorRecord('a', 'b', parseConnectorStylePrefs(raw)).detour).toBe(
      DEFAULT_DETOUR
    )
  })

  it('falls back to the shipped defaults for empty, malformed, or invalid-field data', () => {
    expect(parseConnectorStylePrefs('')).toEqual(DEFAULT_CONNECTOR_STYLE_PREFS)
    expect(parseConnectorStylePrefs('{oops')).toEqual(DEFAULT_CONNECTOR_STYLE_PREFS)
    expect(parseConnectorStylePrefs('null')).toEqual(DEFAULT_CONNECTOR_STYLE_PREFS)
    expect(
      parseConnectorStylePrefs(JSON.stringify({ color: 'not-a-hex', strokeWeight: -1, lineStyle: 'ZIGZAG' }))
    ).toEqual(DEFAULT_CONNECTOR_STYLE_PREFS)
  })
})

describe('parseConnectorRecord', () => {
  it('round-trips a record', () => {
    const original = createConnectorRecord('a', 'b')
    expect(parseConnectorRecord(serialiseConnectorRecord(original))).toEqual(original)
  })

  it('returns null for empty, malformed, or anchor-less data', () => {
    expect(parseConnectorRecord('')).toBeNull()
    expect(parseConnectorRecord('{oops')).toBeNull()
    expect(parseConnectorRecord('null')).toBeNull()
    expect(parseConnectorRecord('{"start":{"kind":"magnet","nodeId":"a","magnet":"AUTO"}}')).toBeNull()
  })

  it('rejects an anchor missing its nodeId', () => {
    const raw = JSON.stringify({
      start: { kind: 'magnet', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' }
    })
    expect(parseConnectorRecord(raw)).toBeNull()
  })

  it('falls back to defaults for an untrustworthy weight, colour, or opacity', () => {
    const raw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      strokeWeight: -5,
      color: 'not-a-colour',
      opacity: 1.5
    })
    const parsed = parseConnectorRecord(raw)
    expect(parsed?.strokeWeight).toBe(DEFAULT_CONNECTOR_WEIGHT)
    expect(parsed?.color).toBe(DEFAULT_CONNECTOR_COLOR)
    expect(parsed?.opacity).toBe(DEFAULT_CONNECTOR_OPACITY)
  })

  it('reads a valid opacity within 0..1', () => {
    const raw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      opacity: 0.4
    })
    expect(parseConnectorRecord(raw)?.opacity).toBe(0.4)
  })

  it('reads valid caps and falls back to defaults for untrustworthy ones', () => {
    const validRaw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      startCap: 'DIAMOND_FILLED',
      endCap: 'CIRCLE_FILLED'
    })
    const valid = parseConnectorRecord(validRaw)
    expect(valid?.startCap).toBe('DIAMOND_FILLED')
    expect(valid?.endCap).toBe('CIRCLE_FILLED')

    const invalidRaw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      startCap: 'SPARKLES',
      endCap: 5
    })
    const invalid = parseConnectorRecord(invalidRaw)
    expect(invalid?.startCap).toBe(DEFAULT_START_CAP)
    expect(invalid?.endCap).toBe(DEFAULT_END_CAP)
  })

  it('reads a valid lineStyle and falls back to the default for an untrustworthy one', () => {
    const raw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      lineStyle: 'STRAIGHT'
    })
    expect(parseConnectorRecord(raw)?.lineStyle).toBe('STRAIGHT')

    const curveRaw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      lineStyle: 'CURVE'
    })
    expect(parseConnectorRecord(curveRaw)?.lineStyle).toBe('CURVE')

    const invalidRaw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      lineStyle: 'CURVY'
    })
    expect(parseConnectorRecord(invalidRaw)?.lineStyle).toBe(DEFAULT_LINE_STYLE)
  })

  it('reads a valid cornerRadius and falls back to the default for a negative or missing one', () => {
    const raw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      cornerRadius: 8
    })
    expect(parseConnectorRecord(raw)?.cornerRadius).toBe(8)

    const invalidRaw = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      cornerRadius: -5
    })
    expect(parseConnectorRecord(invalidRaw)?.cornerRadius).toBe(DEFAULT_CORNER_RADIUS)
  })

  it('accepts a free-point anchor', () => {
    const raw = JSON.stringify({
      start: { kind: 'free', point: { x: 1, y: 2 } },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' }
    })
    const parsed = parseConnectorRecord(raw)
    expect(parsed?.start).toEqual({ kind: 'free', point: { x: 1, y: 2 } })
  })

  it('reads a label when present, else defaults to none', () => {
    const withLabel = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' },
      label: 'Payment success'
    })
    expect(parseConnectorRecord(withLabel)?.label).toBe('Payment success')

    const withoutLabel = JSON.stringify({
      start: { kind: 'magnet', nodeId: 'a', magnet: 'AUTO' },
      end: { kind: 'magnet', nodeId: 'b', magnet: 'AUTO' }
    })
    expect(parseConnectorRecord(withoutLabel)?.label).toBe(DEFAULT_LABEL)
  })
})

describe('resolveConnectorGeometry', () => {
  const record: ConnectorRecord = createConnectorRecord('a', 'b')

  it('resolves both ends when both nodes exist', () => {
    const geometry = resolveConnectorGeometry(record, startRect, endRect)
    expect(geometry.complete).toBe(true)
    expect(geometry.start).not.toBeNull()
    expect(geometry.end).not.toBeNull()
  })

  it('marks the connector incomplete when either node is gone', () => {
    expect(resolveConnectorGeometry(record, null, endRect).complete).toBe(false)
    expect(resolveConnectorGeometry(record, startRect, null).complete).toBe(false)
    expect(resolveConnectorGeometry(record, null, null).complete).toBe(false)
  })

  it('still resolves the side that has a node when the other is gone', () => {
    const geometry = resolveConnectorGeometry(record, startRect, null)
    expect(geometry.start).not.toBeNull()
    expect(geometry.end).toBeNull()
  })
})

describe('connectorRoutePoints', () => {
  it('is a straight two-point line regardless of geometry when lineStyle is STRAIGHT', () => {
    expect(connectorRoutePoints({ x: 0, y: 0 }, { x: 100, y: 50 }, 'STRAIGHT')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 }
    ])
  })

  it('bends at the midpoint of the dominant (larger-gap) axis when horizontal dominates', () => {
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 200, y: 40 }, 'ELBOW')
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 40 }
    ])
  })

  it('bends at the midpoint of the dominant axis when vertical dominates', () => {
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 40, y: 200 }, 'ELBOW')
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 40, y: 100 },
      { x: 40, y: 200 }
    ])
  })

  it('degrades to a straight line when the points already share an axis', () => {
    expect(connectorRoutePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 'ELBOW')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
    expect(connectorRoutePoints({ x: 0, y: 0 }, { x: 0, y: 100 }, 'ELBOW')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 }
    ])
  })

  it('falls back to the unsided bend when either side is unknown (free/ratio anchors)', () => {
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 200, y: 40 }, 'ELBOW', 'RIGHT', null)
    expect(points).toEqual(dominantAxisPoints(200, 40))
  })

  it('pokes straight out from each side before bending, when both sides are known', () => {
    // Start exits BOTTOM, end enters from the LEFT — an unsided bend would
    // immediately run horizontally out of the start, ignoring its side.
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 200, y: 10 }, 'ELBOW', 'BOTTOM', 'LEFT')
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[1]).toEqual({ x: 0, y: 24 }) // straight down out of the BOTTOM side first
    const last = points[points.length - 1]
    const secondLast = points[points.length - 2]
    expect(last).toEqual({ x: 200, y: 10 })
    expect(secondLast?.y).toBe(10) // arrives moving horizontally, into the LEFT side
  })

  it('takes a single corner (one bend) for a mixed-axis pair when it fits', () => {
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 300, y: 200 }, 'ELBOW', 'RIGHT', 'TOP')
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 }
    ])
  })

  it('falls back to a detour when a mixed-axis single corner would violate a clearance', () => {
    // TOP on the end means the approach must come from *above* — but the
    // corner a single bend would use sits at end.y, not above it.
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 300, y: 10 }, 'ELBOW', 'RIGHT', 'TOP')
    expect(points.length).toBeGreaterThan(3)
  })

  it('prefers the frame-gap midpoint over the raw-point midpoint, when it still fits', () => {
    const withoutHint = connectorRoutePoints({ x: 0, y: 0 }, { x: 200, y: 40 }, 'ELBOW', 'RIGHT', 'LEFT')
    expect(withoutHint[1]).toEqual({ x: 100, y: 0 })

    const withHint = connectorRoutePoints(
      { x: 0, y: 0 },
      { x: 200, y: 40 },
      'ELBOW',
      'RIGHT',
      'LEFT',
      { startClearance: 24, endClearance: 24, preferredMid: 150 }
    )
    expect(withHint[1]).toEqual({ x: 150, y: 0 })
  })

  it('clamps the preferred mid back into range instead of violating a clearance', () => {
    const points = connectorRoutePoints(
      { x: 0, y: 0 },
      { x: 200, y: 40 },
      'ELBOW',
      'RIGHT',
      'LEFT',
      { startClearance: 24, endClearance: 24, preferredMid: 1000 } // way past what the end's clearance allows
    )
    expect(points[1]?.x).toBe(176) // clamped to 200 - 24
  })

  it('honours a larger clearance to poke out past an enclosing frame first', () => {
    const points = connectorRoutePoints(
      { x: 0, y: 0 },
      { x: 500, y: 10 },
      'ELBOW',
      'RIGHT',
      'LEFT',
      { startClearance: 300, endClearance: 24 }
    )
    // Stays flat (y unchanged) until it's past the 300px clearance — no
    // turn happens while still inside the frame it needed to clear.
    const firstTurn = points.find((point) => point.y !== 0)
    expect(firstTurn).toBeDefined()
    expect(firstTurn?.x).toBeGreaterThanOrEqual(300)
  })

  it('keeps a clean single bend when both stubs already agree with the dominant axis', () => {
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 200, y: 40 }, 'ELBOW', 'RIGHT', 'LEFT')
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 40 }
    ])
  })

  it('still routes around a clearance requirement when the raw points coincidentally share an axis', () => {
    // Same x by coincidence (0), but BOTTOM/RIGHT means a bare straight
    // line would neither leave the start moving downward nor arrive at the
    // end moving leftward — it should still detour, not go straight.
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 0, y: 100 }, 'ELBOW', 'BOTTOM', 'RIGHT')
    expect(points.length).toBeGreaterThan(2)
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[points.length - 1]).toEqual({ x: 0, y: 100 })
  })
})

function dominantAxisPoints(dx: number, dy: number): ReadonlyArray<{ x: number; y: number }> {
  const midX = dx / 2
  return [
    { x: 0, y: 0 },
    { x: midX, y: 0 },
    { x: midX, y: dy },
    { x: dx, y: dy }
  ]
}

describe('routeCrossings', () => {
  const box = { x: 100, y: 100, width: 100, height: 100 }

  it('counts a box the route passes through', () => {
    const through = [
      { x: 0, y: 150 },
      { x: 300, y: 150 }
    ]
    expect(routeCrossings(through, [box])).toBe(1)
  })

  it('counts each box once however many segments hit it', () => {
    const zigzag = [
      { x: 150, y: 0 },
      { x: 150, y: 300 },
      { x: 120, y: 300 },
      { x: 120, y: 0 }
    ]
    expect(routeCrossings(zigzag, [box])).toBe(1)
  })

  it('does not count a route running flush along an edge or clipping a corner', () => {
    const flush = [
      { x: 0, y: 100 },
      { x: 300, y: 100 }
    ]
    const corner = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ]
    expect(routeCrossings(flush, [box])).toBe(0)
    expect(routeCrossings(corner, [box])).toBe(0)
  })

  it('counts every box independently', () => {
    const second = { x: 400, y: 100, width: 100, height: 100 }
    const across = [
      { x: 0, y: 150 },
      { x: 600, y: 150 }
    ]
    expect(routeCrossings(across, [box, second])).toBe(2)
  })
})

describe('connectorRoutePoints — obstacle avoidance', () => {
  const facing = { startClearance: 24, endClearance: 24 }
  /** Boxes that are nothing to do with either endpoint — the ordinary case. */
  const foreign = (rects: ReadonlyArray<Rect>) => ({ foreign: rects, own: [] })

  it('routes exactly as before when nothing is in the way', () => {
    const clear = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 100 }, 'ELBOW', 'RIGHT', 'LEFT', facing)
    const offToTheSide = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 100 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign([{ x: 0, y: 500, width: 400, height: 200 }])
    })
    expect(offToTheSide).toEqual(clear)
  })

  it('slides the bend into a clear gap rather than crossing a box', () => {
    const obstacles = [{ x: 180, y: 20, width: 40, height: 60 }]
    const before = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 100 }, 'ELBOW', 'RIGHT', 'LEFT', facing)
    expect(routeCrossings(before, obstacles)).toBe(1)

    const after = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 100 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles)
    })
    expect(routeCrossings(after, obstacles)).toBe(0)
    // Still the same three-segment Z, just bent somewhere clear.
    expect(after.length).toBe(before.length)
  })

  it('goes around a box parked between two ends that line up, where there is no bend to move', () => {
    const obstacles = [{ x: 150, y: -50, width: 100, height: 100 }]
    const before = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT', facing)
    // The unavoided route is a bare straight line — every Z-route collapses
    // to it, which is exactly why the detour shape has to exist.
    expect(before).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 }
    ])
    expect(routeCrossings(before, obstacles)).toBe(1)

    const after = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles)
    })
    expect(routeCrossings(after, obstacles)).toBe(0)
    expect(after.length).toBeGreaterThan(2)
    expect(after[0]).toEqual({ x: 0, y: 0 })
    expect(after[after.length - 1]).toEqual({ x: 400, y: 0 })
  })

  it('leaves a mixed-axis corner alone unless it actually crosses something', () => {
    const corner = connectorRoutePoints({ x: 0, y: 0 }, { x: 300, y: 200 }, 'ELBOW', 'RIGHT', 'TOP', facing)
    const stillCorner = connectorRoutePoints({ x: 0, y: 0 }, { x: 300, y: 200 }, 'ELBOW', 'RIGHT', 'TOP', {
      ...facing,
      obstacles: foreign([{ x: 0, y: 800, width: 100, height: 100 }])
    })
    expect(stillCorner).toEqual(corner)
  })

  it('still returns a usable route when every option crosses something', () => {
    const obstacles = [{ x: -1000, y: -1000, width: 3000, height: 3000 }]
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 100 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles)
    })
    expect(points.length).toBeGreaterThanOrEqual(2)
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[points.length - 1]).toEqual({ x: 400, y: 100 })
  })

  it('goes below rather than above when the two ways round are the same length', () => {
    // A box squarely between the two ends — over and under are exactly as
    // long as each other, so nothing but the tie-break decides. Frame names
    // are drawn above frames in Figma, so below is the tidier default.
    const obstacles = [{ x: 150, y: -50, width: 100, height: 100 }]
    const points = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles)
    })
    expect(routeCrossings(points, obstacles)).toBe(0)
    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(0)
  })

  it('goes the way it is pinned, even when the other way is shorter', () => {
    // The box sits well above the two ends, so going over it is the long way
    // round and AUTO takes the short way under.
    const obstacles = [{ x: 150, y: -400, width: 100, height: 450 }]
    const auto = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles)
    })
    const pinned = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles),
      detour: 'TOP'
    })
    expect(routeCrossings(auto, obstacles)).toBe(0)
    expect(routeCrossings(pinned, obstacles)).toBe(0)
    // Both clear the box; they differ only in which side they pass it on.
    expect(Math.max(...auto.map((point) => point.y))).toBeGreaterThan(0)
    expect(Math.min(...pinned.map((point) => point.y))).toBeLessThan(-400)
  })

  it('ignores a pinned direction that belongs to the other axis', () => {
    const obstacles = [{ x: 150, y: -50, width: 100, height: 100 }]
    const args = [{ x: 0, y: 0 }, { x: 400, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT'] as const
    const auto = connectorRoutePoints(...args, { ...facing, obstacles: foreign(obstacles) })
    // LEFT/RIGHT say nothing about a line already running left to right.
    const sideways = connectorRoutePoints(...args, { ...facing, obstacles: foreign(obstacles), detour: 'LEFT' })
    expect(sideways).toEqual(auto)
  })

  it('does not detour at all when nothing is in the way, however it is pinned', () => {
    const args = [{ x: 0, y: 0 }, { x: 400, y: 100 }, 'ELBOW', 'RIGHT', 'LEFT'] as const
    const plain = connectorRoutePoints(...args, facing)
    const pinned = connectorRoutePoints(...args, {
      ...facing,
      detour: 'BOTTOM',
      obstacles: foreign([{ x: 0, y: 900, width: 400, height: 100 }])
    })
    expect(pinned).toEqual(plain)
  })

  it('may cross its own screen leaving it, but not after having left', () => {
    // Start anchored inside a screen spanning x 0..400; the route has to
    // cross it to get out, and then must not come back through it.
    const own = [{ x: 0, y: -200, width: 400, height: 400 }]
    const points = connectorRoutePoints({ x: 380, y: 0 }, { x: 900, y: 0 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: { foreign: [], own }
    })
    // The leaving segment is exempt...
    expect(routeCrossings(points, own)).toBeGreaterThanOrEqual(0)
    // ...but nothing from the second segment onward may re-enter it.
    expect(routeCrossings(points, own, 1, points.length - 3)).toBe(0)
  })

  it('treats an own screen like any other box for the segments in between', () => {
    // A route that would have to double back through the screen it started
    // in gets pushed onto a shape that doesn't.
    const own = [{ x: 0, y: 0, width: 400, height: 400 }]
    const asForeign = connectorRoutePoints({ x: 400, y: 380 }, { x: 900, y: 20 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: { foreign: own, own: [] }
    })
    const asOwn = connectorRoutePoints({ x: 400, y: 380 }, { x: 900, y: 20 }, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: { foreign: [], own }
    })
    expect(routeCrossings(asOwn, own, 1, asOwn.length - 3)).toBe(0)
    expect(routeCrossings(asForeign, own)).toBe(0)
  })

  it('ignores obstacles for STRAIGHT and CURVE, which have no bend to re-aim', () => {
    const obstacles = [{ x: 150, y: -50, width: 100, height: 100 }]
    const straight = connectorRoutePoints({ x: 0, y: 0 }, { x: 400, y: 0 }, 'STRAIGHT', 'RIGHT', 'LEFT', {
      ...facing,
      obstacles: foreign(obstacles)
    })
    expect(straight).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 }
    ])
  })
})

describe('obstaclesInPlay', () => {
  const facingFor = { startClearance: 24, endClearance: 24 }
  const near = { x: 200, y: 0, width: 100, height: 100 }
  const far = { x: 9000, y: 0, width: 100, height: 100 }

  it('keeps what sits between the two ends and drops what is nowhere near', () => {
    const kept = obstaclesInPlay([near, far], { x: 0, y: 50 }, { x: 500, y: 50 }, 100)
    expect(kept).toEqual([near])
  })

  it('keeps a box just outside the span, within the margin, since a detour can reach it', () => {
    const justPast = { x: 560, y: 0, width: 100, height: 100 }
    const kept = obstaclesInPlay([justPast], { x: 0, y: 50 }, { x: 500, y: 50 }, 100)
    expect(kept).toEqual([justPast])
  })

  it('cannot change the chosen route, only how long it takes to find', () => {
    const obstacles = [{ x: 180, y: 20, width: 40, height: 60 }]
    const start = { x: 0, y: 0 }
    const end = { x: 400, y: 100 }
    const withNoise = connectorRoutePoints(start, end, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facingFor,
      obstacles: { foreign: [...obstacles, { x: 90000, y: 0, width: 10, height: 10 }], own: [] }
    })
    const filtered = connectorRoutePoints(start, end, 'ELBOW', 'RIGHT', 'LEFT', {
      ...facingFor,
      obstacles: {
        foreign: obstaclesInPlay(
          [...obstacles, { x: 90000, y: 0, width: 10, height: 10 }],
          start,
          end,
          200
        ),
        own: []
      }
    })
    expect(filtered).toEqual(withNoise)
  })
})

describe('routeCost', () => {
  /** Two screens side by side with a gap, an endpoint nested in each. */
  const leftScreen = { x: 0, y: 0, width: 100, height: 100 }
  const rightScreen = { x: 110, y: 0, width: 100, height: 100 }
  const own = { foreign: [], own: [leftScreen, rightScreen] }

  it('charges nothing for leaving one screen and arriving in the other', () => {
    const across = [
      { x: 90, y: 50 },
      { x: 105, y: 50 },
      { x: 105, y: 60 },
      { x: 130, y: 60 }
    ]
    expect(routeCost(across, own)).toBe(0)
  })

  /**
   * Both own screens are exempt on the leaving and arriving segments,
   * rather than each being paired with its own end. A route has to finish
   * inside the screen it arrives in, so pairing them would charge a plain
   * line between two adjacent screens for reaching its destination — and
   * send the router off to find a detour instead. What is actually a defect
   * is travelling *through* a screen mid-route, and every segment between
   * the first and the last is still counted, which is what catches it.
   */
  it('charges for carrying on through a screen once inside it', () => {
    const throughTheMiddle = [
      { x: 90, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 70 },
      { x: 160, y: 70 }
    ]
    expect(routeCost(throughTheMiddle, own)).toBe(1)
  })

  it('charges for turning back through the screen it just left', () => {
    const doublingBack = [
      { x: 90, y: 50 },
      { x: 105, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 90 },
      { x: 130, y: 90 }
    ]
    expect(routeCost(doublingBack, own)).toBe(1)
  })

  it('charges for a foreign box on any segment at all', () => {
    const parked = { x: 40, y: 200, width: 100, height: 100 }
    const through = [
      { x: 90, y: 250 },
      { x: 200, y: 250 }
    ]
    expect(routeCost(through, { foreign: [parked], own: [] })).toBe(1)
  })
})

describe('boxCouldAffectRoute', () => {
  /** A connector drawn straight across, as its rendered node's bounding box. */
  const route = { x: 0, y: 100, width: 500, height: 2 }

  it('says yes to a box sitting on top of the route', () => {
    const parked = { x: 200, y: 50, width: 100, height: 100 }
    expect(boxCouldAffectRoute(route, parked, ROUTE_SEARCH_MARGIN)).toBe(true)
  })

  it('says yes to a box near the route but not yet touching it', () => {
    const approaching = { x: 200, y: 400, width: 100, height: 100 }
    expect(boxCouldAffectRoute(route, approaching, ROUTE_SEARCH_MARGIN)).toBe(true)
  })

  it('says no to a box further off than any route could bulge', () => {
    const elsewhere = { x: 200, y: 9000, width: 100, height: 100 }
    expect(boxCouldAffectRoute(route, elsewhere, ROUTE_SEARCH_MARGIN)).toBe(false)
  })

  /**
   * The property the whole filter rests on: it must never drop a box that
   * `obstaclesInPlay` would have kept, or a connector goes un-resynced while
   * a box it actually routes around is being dragged. The rendered node's
   * box always contains both endpoints, so testing against it is a superset
   * of testing against the span between them — never a narrower one.
   */
  it('keeps everything the router itself would still consider', () => {
    const start = { x: 0, y: 100 }
    const end = { x: 500, y: 100 }
    const candidates = [
      { x: 200, y: 50, width: 100, height: 100 },
      { x: 200, y: 400, width: 100, height: 100 },
      { x: -900, y: 100, width: 100, height: 100 },
      { x: 200, y: 9000, width: 100, height: 100 },
      { x: 1600, y: 100, width: 100, height: 100 }
    ]
    for (const box of candidates) {
      const routerKeepsIt = obstaclesInPlay([box], start, end, ROUTE_SEARCH_MARGIN).length > 0
      if (routerKeepsIt) expect(boxCouldAffectRoute(route, box, ROUTE_SEARCH_MARGIN)).toBe(true)
    }
  })
})

describe('connectorAxisOf', () => {
  it('groups LEFT/RIGHT on x, TOP/BOTTOM on y, and CENTER/null as neither', () => {
    expect(connectorAxisOf('LEFT')).toBe('x')
    expect(connectorAxisOf('RIGHT')).toBe('x')
    expect(connectorAxisOf('TOP')).toBe('y')
    expect(connectorAxisOf('BOTTOM')).toBe('y')
    expect(connectorAxisOf('CENTER')).toBeNull()
    expect(connectorAxisOf(null)).toBeNull()
  })
})

describe('frameGapMidpoint', () => {
  it('bisects the gap between two frames side by side', () => {
    const left = { x: 0, y: 0, width: 100, height: 100 }
    const right = { x: 300, y: 0, width: 100, height: 100 }
    expect(frameGapMidpoint(left, right, 'x')).toBe(200) // gap is 100..300
    expect(frameGapMidpoint(right, left, 'x')).toBe(200) // order-independent
  })

  it('bisects the gap between two frames stacked vertically', () => {
    const top = { x: 0, y: 0, width: 100, height: 100 }
    const bottom = { x: 0, y: 400, width: 100, height: 100 }
    expect(frameGapMidpoint(top, bottom, 'y')).toBe(250) // gap is 100..400
  })

  it('returns null when the frames overlap on that axis, or either is missing', () => {
    const a = { x: 0, y: 0, width: 200, height: 100 }
    const b = { x: 100, y: 0, width: 200, height: 100 }
    expect(frameGapMidpoint(a, b, 'x')).toBeNull()
    expect(frameGapMidpoint(a, null, 'x')).toBeNull()
    expect(frameGapMidpoint(null, b, 'x')).toBeNull()
  })
})

describe('connectorStubClearance', () => {
  const frame = { x: 0, y: 0, width: 400, height: 200 }

  it('reaches past the frame edge plus the margin, on the exit side', () => {
    // Node's right edge (the point) sits at x=100, well inside a frame
    // whose own right edge is at x=400.
    expect(connectorStubClearance({ x: 100, y: 50 }, 'RIGHT', frame)).toBe(400 + 20 - 100)
    expect(connectorStubClearance({ x: 300, y: 50 }, 'LEFT', frame)).toBe(300 - (0 - 20))
    expect(connectorStubClearance({ x: 100, y: 20 }, 'TOP', frame)).toBe(20 - (0 - 20))
    expect(connectorStubClearance({ x: 100, y: 150 }, 'BOTTOM', frame)).toBe(200 + 20 - 150)
  })

  it('never goes below the flat stub, even right at the frame edge', () => {
    expect(connectorStubClearance({ x: 399, y: 50 }, 'RIGHT', frame)).toBe(24)
  })

  it('falls back to the flat stub with no frame or no side', () => {
    expect(connectorStubClearance({ x: 100, y: 50 }, 'RIGHT', null)).toBe(24)
    expect(connectorStubClearance({ x: 100, y: 50 }, null, frame)).toBe(24)
  })
})

describe('connectorCurveTangents', () => {
  it('points each handle outward from its own side', () => {
    const { tangentStart, tangentEnd } = connectorCurveTangents(
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      'RIGHT',
      'LEFT'
    )
    expect(tangentStart).toEqual({ x: 80, y: 0 })
    expect(tangentEnd).toEqual({ x: -80, y: 0 })
  })

  it('falls back to a handle aimed along the straight line when a side is unknown', () => {
    const { tangentStart, tangentEnd } = connectorCurveTangents(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      null,
      null
    )
    expect(tangentStart.x).toBeGreaterThan(0)
    expect(tangentEnd.x).toBeLessThan(0)
  })

  it('clamps the handle length within the min/max bounds', () => {
    const short = connectorCurveTangents({ x: 0, y: 0 }, { x: 10, y: 0 }, 'RIGHT', 'LEFT')
    expect(Math.hypot(short.tangentStart.x, short.tangentStart.y)).toBe(32)

    const long = connectorCurveTangents({ x: 0, y: 0 }, { x: 1000, y: 0 }, 'RIGHT', 'LEFT')
    expect(Math.hypot(long.tangentStart.x, long.tangentStart.y)).toBe(140)
  })
})

describe('pointAlongPolyline', () => {
  it('finds the true midpoint by path length, not by vertex index', () => {
    // A 20-length first leg and an 80-length second leg — the geometric
    // midpoint of the whole 100-length path is 30 units into the second leg,
    // nowhere near the shared vertex at index 1.
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 80 }
    ]
    expect(pointAlongPolyline(points, 0.5)).toEqual({ x: 20, y: 30 })
  })

  it('clamps t to the 0..1 range', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]
    expect(pointAlongPolyline(points, -1)).toEqual({ x: 0, y: 0 })
    expect(pointAlongPolyline(points, 2)).toEqual({ x: 100, y: 0 })
  })

  it('handles a single-point path without dividing by zero', () => {
    expect(pointAlongPolyline([{ x: 5, y: 5 }], 0.5)).toEqual({ x: 5, y: 5 })
  })
})

describe('pointOnCurve', () => {
  it('starts and ends exactly on the two endpoints', () => {
    const curve = connectorCurveTangents({ x: 0, y: 0 }, { x: 100, y: 0 }, 'RIGHT', 'LEFT')
    expect(pointOnCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, curve, 0)).toEqual({ x: 0, y: 0 })
    expect(pointOnCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, curve, 1)).toEqual({ x: 100, y: 0 })
  })

  it('sits on the line for a straight-ahead curve at the midpoint', () => {
    const curve = connectorCurveTangents({ x: 0, y: 0 }, { x: 100, y: 0 }, 'RIGHT', 'LEFT')
    const mid = pointOnCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, curve, 0.5)
    expect(mid.x).toBeCloseTo(50)
    expect(mid.y).toBeCloseTo(0)
  })
})
