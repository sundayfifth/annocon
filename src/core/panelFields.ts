/**
 * The decisions the connector panel makes, separated from the markup that
 * shows them.
 *
 * `ui.tsx` never touches the `figma` global, so everything it decides could
 * always have been tested — there was simply nowhere to put it. Two things
 * live here: what a number typed into a field commits to, and which controls
 * are worth showing at all.
 */

import type { ConnectorLineStyle } from './connectorRecord.js'

/**
 * What a numeric field accepts, and how it reads the value back.
 *
 * `min`/`max` are enforced when the field is **committed**, on blur, and must
 * never be handed to `TextboxNumeric` as `minimum`/`maximum`.
 *
 * `minimum` reads as a bound on the finished value; it is really a bound on
 * every keystroke. `RawTextboxNumeric` evaluates what the field would say
 * after each key and calls `preventDefault()` when that is out of range — so
 * a minimum of 0.5 rejects the leading `0` of `0.8`, and every value from
 * 0.5 to 0.9 becomes untypeable. The field refuses the values it exists to
 * accept, and says nothing about why. Clamping on commit costs one
 * wrong-looking number for as long as the cursor is in the field, and gets
 * the whole range back.
 */
export interface NumericField {
  readonly min: number
  readonly max: number
  /** Appended to the value the field shows, so the unit is visible before anyone touches it. */
  readonly suffix: string
}

/**
 * The thinnest stroke worth drawing — below this a line stops reading as one
 * at ordinary zoom.
 */
export const STROKE_WEIGHT_FIELD: NumericField = {
  min: 0.5,
  max: Number.POSITIVE_INFINITY,
  suffix: 'px'
}

/** Whole percent, as the panel shows it — the record stores 0..1. */
export const OPACITY_FIELD: NumericField = { min: 0, max: 100, suffix: '%' }

/**
 * How rounded an elbow's bends are. No upper bound of its own: the router
 * already reduces a radius that will not fit the segments it has, so a large
 * number here is a request rather than a mistake.
 */
export const CORNER_RADIUS_FIELD: NumericField = {
  min: 0,
  max: Number.POSITIVE_INFINITY,
  suffix: 'px'
}

/** A committed field: the number to store, and what the box should now show. */
export interface CommittedField {
  readonly value: number
  readonly text: string
}

/**
 * What a field commits to when it loses focus, or `null` when there is no
 * number in it to commit.
 *
 * `text` comes back alongside `value` because the box has to be written back
 * to. A field that clamps silently — showing the rejected number while
 * storing a different one — reads as the edit having been ignored, and this
 * used to be true of the corner radius alone: typing a negative number left
 * it on screen while nothing was stored, so the two ways of getting it wrong
 * (out of range, and not a number at all) looked identical.
 *
 * Not a number at all is the one case that keeps what is on screen: an empty
 * field, or one holding just a unit, is somebody mid-edit rather than
 * somebody asking for a value.
 */
export function commitNumericField(text: string, field: NumericField): CommittedField | null {
  const parsed = Number.parseFloat(text)
  if (!Number.isFinite(parsed)) return null
  const value = Math.min(field.max, Math.max(field.min, parsed))
  return { value, text: `${value}${field.suffix}` }
}

/** What a field shows for a value that came from the record rather than the keyboard. */
export function numericFieldText(value: number | undefined, field: NumericField): string {
  return typeof value === 'undefined' ? '' : `${value}${field.suffix}`
}

/** Which of the connector panel's conditional controls are worth showing. */
export interface VisibleConnectorControls {
  readonly lineStyle: boolean
  readonly cornerRadius: boolean
  readonly detour: boolean
  /** The explanation of a hand-drawn line, and the button that gives routing back. */
  readonly handedOver: boolean
  /** The explanation of a line whose end is gone, and the button that removes it. */
  readonly broken: boolean
}

/**
 * Hides the controls that would do nothing, rather than showing them inert.
 *
 * A hand-drawn line has had its shape handed over: switching between
 * straight, curved and elbowed, rounding its corners, or asking it to go
 * around something would all change nothing, so none of them appear —
 * a control that does nothing is worse than no control. Colour, caps and the
 * label are untouched by that and stay where they are.
 *
 * Corner radius and **Go around** additionally only mean something to an
 * elbow: a straight line has no bend to round, and neither it nor a curve
 * avoids anything.
 *
 * `broken` is not exclusive with any of them, unlike `handedOver`. A line
 * whose end is gone can also be one somebody reshaped, and its colour and
 * caps still apply to the stale line sitting on the canvas — what it needs is
 * to be told what happened, not to have its controls taken away.
 *
 * The elbow half of this was written out twice in `ui.tsx`, as the same
 * `lineStyle === 'ELBOW' && !manualGeometry` in two places.
 */
export function visibleConnectorControls(style: {
  readonly lineStyle: ConnectorLineStyle
  readonly manualGeometry: boolean
  readonly broken: boolean
}): VisibleConnectorControls {
  const routed = !style.manualGeometry
  const elbow = routed && style.lineStyle === 'ELBOW'
  return {
    lineStyle: routed,
    cornerRadius: elbow,
    detour: elbow,
    handedOver: style.manualGeometry,
    broken: style.broken
  }
}
