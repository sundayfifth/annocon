import { describe, expect, it } from 'vitest'

import type { Rect } from '../src/core/anchor.js'
import {
  CONNECTOR_VERSION,
  type ConnectorRecord,
  DEFAULT_CONNECTOR_COLOR,
  DEFAULT_CONNECTOR_OPACITY,
  DEFAULT_CONNECTOR_WEIGHT,
  DEFAULT_CORNER_RADIUS,
  DEFAULT_END_CAP,
  DEFAULT_LINE_STYLE,
  DEFAULT_START_CAP,
  connectorAxisOf,
  connectorCurveTangents,
  connectorRoutePoints,
  connectorStubClearance,
  createConnectorRecord,
  frameGapMidpoint,
  parseConnectorRecord,
  resolveConnectorGeometry,
  serialiseConnectorRecord
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
      cornerRadius: DEFAULT_CORNER_RADIUS
    })
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
      24,
      24,
      150
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
      24,
      24,
      1000 // way past what the end's clearance allows
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
      300,
      24
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
