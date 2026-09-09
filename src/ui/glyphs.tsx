/**
 * The two SVG previews the connector panel is built out of.
 *
 * Split off `ui.tsx` because they are markup and nothing else — no state, no
 * messages, no decisions — and they were the largest thing in that file that
 * nobody ever needs to read while working on its behaviour.
 *
 * Both are previews rather than icons, which is the point of them: picking a
 * cap or a route shape means recognising the thing itself, not reading eight
 * near-identical-length labels apart.
 */

import type { ConnectorCap, ConnectorLineStyle } from '../core/connectorRecord.js'

/**
 * A short stub line ending in the cap's actual shape — not a generic icon,
 * a preview of what the connector end will look like — so picking a cap
 * doesn't require reading eight near-identical-length labels apart.
 */
export function CapGlyph({ cap, color, size = 14 }: { cap: ConnectorCap; color: string; size?: number }) {
  const content = (() => {
    switch (cap) {
      case 'NONE':
        return <line stroke={color} strokeWidth="1.4" x1="2" x2="14" y1="8" y2="8" />
      case 'ARROW_LINES':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="10" y1="8" y2="8" />
            <path
              d="M7 4.5L11 8L7 11.5"
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
          </>
        )
      case 'ARROW_EQUILATERAL':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="8" y1="8" y2="8" />
            <path d="M8 5L13 8L8 11Z" fill={color} />
          </>
        )
      case 'DIAMOND_FILLED':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="8" y1="8" y2="8" />
            <path d="M11 5L14 8L11 11L8 8Z" fill={color} />
          </>
        )
      case 'TRIANGLE_FILLED':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="8" y1="8" y2="8" />
            <path d="M8 5.5L14 8L8 10.5Z" fill={color} />
          </>
        )
      case 'CIRCLE_FILLED':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="2" x2="9" y1="8" y2="8" />
            <circle cx="12" cy="8" fill={color} r="3" />
          </>
        )
    }
  })()
  return (
    <svg height={size} style={{ flexShrink: 0 }} viewBox="0 0 16 16" width={size}>
      {content}
    </svg>
  )
}

/** A small preview of what the route itself will look like, not a name. */
export function LineStyleGlyph({ style, color }: { style: ConnectorLineStyle; color: string }) {
  const content = (() => {
    switch (style) {
      case 'STRAIGHT':
        return <line stroke={color} strokeLinecap="round" strokeWidth="1.6" x1="4" x2="14" y1="14" y2="4" />
      case 'CURVE':
        return (
          <path
            d="M4 14C4 14 5 4 9 4C13 4 10 14 14 14"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth="1.6"
          />
        )
      case 'ELBOW':
        return (
          <path
            d="M4 14H10V4H14"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        )
    }
  })()
  return (
    <svg height="16" style={{ flexShrink: 0 }} viewBox="0 0 18 18" width="16">
      {content}
    </svg>
  )
}
