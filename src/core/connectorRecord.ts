/**
 * What a connector *is*, as opposed to where it goes.
 *
 * The record in pluginData, the styles it carries, the defaults a new one
 * starts from, and the decoding of all of it back out of a document that
 * other builds of this plugin — and people editing by hand — may have
 * touched. Nothing here computes a route.
 *
 * Split from the router because the two change for unrelated reasons: adding
 * a cap or a line style is a change to what a connector can be, and it should
 * not sit in the same file as the question of which way a line bends around a
 * screen. The dependency runs one way — the router imports these types to
 * name its inputs, and nothing here imports the router.
 *
 * Unlike an annotation, a connector has no single "owner" node — it belongs
 * equally to both ends. So the record lives in pluginData on the connector's
 * own rendered node, not on either endpoint. Deleting the connector node on
 * canvas deletes the record with it; there is nothing left to orphan.
 */

import { type Anchor, isMagnet } from './anchor.js'
import { type ManualShape, parseManualShape } from './manualShape.js'

/**
 * A curated mirror of Figma's `StrokeCap` — the whole set is line-end
 * styles, not just arrowheads, so "cap" rather than "arrowhead" throughout.
 * Kept as our own union (not importing the ambient Figma type) so this file
 * never has a reason to assume anything about the `figma` global exists.
 *
 * Figma's own `'ROUND'`/`'SQUARE'` deliberately left out: those are a subtle
 * line-tip rounding/squaring-off, sized off the stroke weight itself (the
 * same thing CSS/SVG's `stroke-linecap` does) — not a marker shape. At the
 * thin weights a connector actually uses, they render as good as invisible,
 * which just reads as "I picked this and nothing happened." The `_FILLED`
 * caps are real marker shapes with their own visible size regardless of
 * stroke weight, which is what a person picking a "cap" actually expects.
 */
export type ConnectorCap =
  | 'NONE'
  | 'ARROW_LINES'
  | 'ARROW_EQUILATERAL'
  | 'DIAMOND_FILLED'
  | 'TRIANGLE_FILLED'
  | 'CIRCLE_FILLED'

export const CONNECTOR_CAPS: ReadonlyArray<ConnectorCap> = [
  'NONE',
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'DIAMOND_FILLED',
  'TRIANGLE_FILLED',
  'CIRCLE_FILLED'
]

/**
 * Which way a connector goes around a box parked in its path.
 *
 * `AUTO` takes whichever way is shorter, which is right almost always and
 * arbitrary when the two ways tie. The rest pin it, for the times a person
 * looks at the automatic choice and wants the other one.
 *
 * Only one pair ever applies to a given connector: a route running left to
 * right can go over or under it (`TOP`/`BOTTOM`), one running top to bottom
 * can pass either side of it (`LEFT`/`RIGHT`). Picking one that doesn't
 * apply to this connector's direction is not an error — there is simply
 * nothing for it to pin, so the route falls back to `AUTO`.
 */
export type ConnectorDetour = 'AUTO' | 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT'

const CONNECTOR_DETOURS: ReadonlyArray<ConnectorDetour> = [
  'AUTO',
  'TOP',
  'BOTTOM',
  'LEFT',
  'RIGHT'
]

/**
 * `STRAIGHT` is a direct line; `ELBOW` routes with right-angled bends,
 * FigJam/Autoflow-style; `CURVE` is a smooth S-curve that still leaves and
 * arrives perpendicular to each end's side.
 */
export type ConnectorLineStyle = 'STRAIGHT' | 'ELBOW' | 'CURVE'

export interface ConnectorRecord {
  readonly start: Anchor
  readonly end: Anchor
  readonly strokeWeight: number
  /** Hex colour, e.g. `#7B61FF`. */
  readonly color: string
  /** 0 (invisible) .. 1 (opaque). */
  readonly opacity: number
  readonly startCap: ConnectorCap
  readonly endCap: ConnectorCap
  readonly lineStyle: ConnectorLineStyle
  /** How rounded an `ELBOW` bend is. Meaningless (and unused) for `STRAIGHT`/`CURVE`. */
  readonly cornerRadius: number
  /** Which way an `ELBOW` goes around whatever is in its path. Meaningless for `STRAIGHT`/`CURVE`, which don't avoid anything. */
  readonly detour: ConnectorDetour
  /** An optional label drawn at the midpoint of the route, FigJam/Autoflow-style. Empty string means no label. */
  readonly label: string
  /**
   * The label pill's fill. Its text takes whichever of black or white reads
   * against it, so one choice covers both.
   *
   * Unlike the label itself — this connector's own words — a colour is a
   * look-and-feel choice like the line's, and carries to the next connector
   * with the rest of the style.
   */
  readonly labelColor: string
  /**
   * Set once somebody has reshaped the line themselves with Figma's own
   * vector tools. From then on the plugin stops deciding where it goes.
   *
   * The one place this codebase's "geometry flows one way" rule is answered
   * by handing the geometry over rather than by owning it: the plugin does
   * not read the shape back, it simply stops writing one. Everything else —
   * colour, weight, caps, the label, and being listed as this pair's
   * connector — carries on as before.
   *
   * The cost, taken deliberately: a hand-drawn line no longer follows its
   * layers. Reshaping is a promise that the shape is right, and there is no
   * honest way to keep that promise while moving the shape around.
   */
  readonly manualGeometry: boolean
  /**
   * The shape somebody drew, with the endpoints it was drawn against.
   *
   * Read off the node once, when the edit is noticed, and written to the
   * record — after which drawing goes back to flowing one way, record to
   * node, like everything else here. Keeping it lets a hand-drawn line
   * follow its layers instead of being stranded the first time one moves.
   *
   * `null` for a line that has not been reshaped, and for one reshaped
   * before this was recorded — which is drawn where it stands and left
   * there, since there is nothing to carry it by.
   */
  readonly manualShape: ManualShape | null
}

const DEFAULT_CONNECTOR_WEIGHT = 1.5
const DEFAULT_CONNECTOR_COLOR = '#000000'
const DEFAULT_CONNECTOR_OPACITY = 1
const DEFAULT_START_CAP: ConnectorCap = 'CIRCLE_FILLED'
const DEFAULT_END_CAP: ConnectorCap = 'ARROW_EQUILATERAL'
const DEFAULT_LINE_STYLE: ConnectorLineStyle = 'ELBOW'
const DEFAULT_CORNER_RADIUS = 20
const DEFAULT_DETOUR: ConnectorDetour = 'AUTO'
const DEFAULT_LABEL = ''
/** White: what every label pill was before the colour could be chosen. */
export const DEFAULT_LABEL_COLOR = '#FFFFFF'

/**
 * The style fields a new connector inherits from whatever was last set —
 * everything in `ConnectorRecord` except its anchors, its label, and its
 * detour.
 *
 * The label is excluded because it is this connector's own words. The detour
 * is excluded for a subtler reason: it is not a style in the way the rest of
 * these are. A colour applies to every connector there will ever be, and
 * looks the same on all of them. "Go below" only means anything while
 * something is in the way — so carried forward, it lies dormant on line
 * after line with nothing to avoid, and then one day a screen lands in the
 * path of one of them and it takes effect, months after the choice was made
 * and nowhere near the connector it was made on. A preference that does
 * nothing until it surprises you is worse than one you have to set twice.
 */
export interface ConnectorStylePrefs {
  readonly strokeWeight: number
  readonly color: string
  readonly opacity: number
  readonly startCap: ConnectorCap
  readonly endCap: ConnectorCap
  readonly lineStyle: ConnectorLineStyle
  readonly cornerRadius: number
  readonly labelColor: string
}

const DEFAULT_CONNECTOR_STYLE_PREFS: ConnectorStylePrefs = {
  strokeWeight: DEFAULT_CONNECTOR_WEIGHT,
  color: DEFAULT_CONNECTOR_COLOR,
  opacity: DEFAULT_CONNECTOR_OPACITY,
  startCap: DEFAULT_START_CAP,
  endCap: DEFAULT_END_CAP,
  lineStyle: DEFAULT_LINE_STYLE,
  cornerRadius: DEFAULT_CORNER_RADIUS,
  labelColor: DEFAULT_LABEL_COLOR
}

export function createConnectorRecord(
  startNodeId: string,
  endNodeId: string,
  stylePrefs: ConnectorStylePrefs = DEFAULT_CONNECTOR_STYLE_PREFS
): ConnectorRecord {
  return {
    start: { kind: 'magnet', nodeId: startNodeId, magnet: 'AUTO' },
    end: { kind: 'magnet', nodeId: endNodeId, magnet: 'AUTO' },
    ...stylePrefs,
    // Always AUTO, never inherited — see `ConnectorStylePrefs`.
    detour: DEFAULT_DETOUR,
    label: DEFAULT_LABEL,
    manualGeometry: false,
    manualShape: null
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const CAP_SET = new Set<string>(CONNECTOR_CAPS)
const LINE_STYLES: ReadonlySet<string> = new Set<ConnectorLineStyle>(['STRAIGHT', 'ELBOW', 'CURVE'])
const DETOURS = new Set<string>(CONNECTOR_DETOURS)

function isDetour(value: unknown): value is ConnectorDetour {
  return typeof value === 'string' && DETOURS.has(value)
}

function isCap(value: unknown): value is ConnectorCap {
  return typeof value === 'string' && CAP_SET.has(value)
}

function isLineStyle(value: unknown): value is ConnectorLineStyle {
  return typeof value === 'string' && LINE_STYLES.has(value)
}

/**
 * The style-field half of decoding a connector out of pluginData — shared by
 * `parseConnectorRecord` (which adds the anchors and label on top) and
 * `parseConnectorStylePrefs` (which is only ever the style fields, decoded
 * from `clientStorage` rather than a connector node). Same tolerant,
 * field-by-field fallback either way: a stray or corrupted value degrades to
 * the shipped default for that one field instead of failing the whole decode.
 */
function stylePrefsFrom(candidate: Record<string, unknown>): ConnectorStylePrefs {
  return {
    strokeWeight:
      typeof candidate.strokeWeight === 'number' && candidate.strokeWeight > 0
        ? candidate.strokeWeight
        : DEFAULT_CONNECTOR_WEIGHT,
    color:
      typeof candidate.color === 'string' && HEX_COLOR.test(candidate.color)
        ? candidate.color
        : DEFAULT_CONNECTOR_COLOR,
    opacity:
      typeof candidate.opacity === 'number' && candidate.opacity >= 0 && candidate.opacity <= 1
        ? candidate.opacity
        : DEFAULT_CONNECTOR_OPACITY,
    startCap: isCap(candidate.startCap) ? candidate.startCap : DEFAULT_START_CAP,
    endCap: isCap(candidate.endCap) ? candidate.endCap : DEFAULT_END_CAP,
    lineStyle: isLineStyle(candidate.lineStyle) ? candidate.lineStyle : DEFAULT_LINE_STYLE,
    cornerRadius:
      typeof candidate.cornerRadius === 'number' && candidate.cornerRadius >= 0
        ? candidate.cornerRadius
        : DEFAULT_CORNER_RADIUS,
    labelColor:
      typeof candidate.labelColor === 'string' && HEX_COLOR.test(candidate.labelColor)
        ? candidate.labelColor
        : DEFAULT_LABEL_COLOR
  }
}

/**
 * Decodes a `ConnectorStylePrefs` out of `clientStorage` — the "last style
 * used" a new connector starts from (see `createConnector`).
 */
export function parseConnectorStylePrefs(raw: string): ConnectorStylePrefs {
  if (raw === '') return DEFAULT_CONNECTOR_STYLE_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_CONNECTOR_STYLE_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CONNECTOR_STYLE_PREFS
  return stylePrefsFrom(parsed as Record<string, unknown>)
}

export function serialiseConnectorStylePrefs(prefs: ConnectorStylePrefs): string {
  return JSON.stringify(prefs)
}

/**
 * A record whose anchor does not decode is `null` rather than repaired, unlike
 * the style fields — including one carrying a `kind` this build does not know,
 * which is how a `ratio` or `free` anchor written by some future build arrives
 * here. There is no default endpoint to fall back to: a connector with a
 * guessed end is a line drawn somewhere nobody put it.
 */
function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'magnet') return false
  return (
    typeof candidate.nodeId === 'string' && candidate.nodeId !== '' && isMagnet(candidate.magnet)
  )
}

/**
 * Decodes a record out of pluginData. Deliberately tolerant, same reasoning
 * as `parseAnnotationRecord`: a record we cannot read at all is `null`; one
 * that is merely incomplete falls back to defaults field by field. That
 * tolerance is also this record's entire versioning story — see
 * `parseAnnotationRecord` for why the `v` marker these records used to carry
 * was removed rather than fixed.
 */
export function parseConnectorRecord(raw: string): ConnectorRecord | null {
  if (raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  if (!isAnchor(candidate.start) || !isAnchor(candidate.end)) return null
  return {
    start: candidate.start,
    end: candidate.end,
    ...stylePrefsFrom(candidate),
    // Read here rather than in `stylePrefsFrom`, because a connector records
    // its own detour but never hands it on to the next one.
    detour: isDetour(candidate.detour) ? candidate.detour : DEFAULT_DETOUR,
    label: typeof candidate.label === 'string' ? candidate.label : DEFAULT_LABEL,
    manualGeometry: candidate.manualGeometry === true,
    manualShape: parseManualShape(candidate.manualShape)
  }
}

export function serialiseConnectorRecord(record: ConnectorRecord): string {
  return JSON.stringify(record)
}
