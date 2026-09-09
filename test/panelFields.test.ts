import { describe, expect, it } from 'vitest'

import {
  CORNER_RADIUS_FIELD,
  OPACITY_FIELD,
  STROKE_WEIGHT_FIELD,
  commitNumericField,
  numericFieldText,
  visibleConnectorControls
} from '../src/core/panelFields.js'

describe('commitNumericField', () => {
  it('takes a number in range as typed, with its unit', () => {
    expect(commitNumericField('3', STROKE_WEIGHT_FIELD)).toEqual({ value: 3, text: '3px' })
    expect(commitNumericField('40', OPACITY_FIELD)).toEqual({ value: 40, text: '40%' })
  })

  /** The unit is already in the box from the last commit, so it has to parse back out. */
  it('reads a value that still has its unit on it', () => {
    expect(commitNumericField('12px', CORNER_RADIUS_FIELD)?.value).toBe(12)
    expect(commitNumericField('75%', OPACITY_FIELD)?.value).toBe(75)
  })

  it('keeps a fractional weight, which is the whole reason for clamping late', () => {
    // Every value from 0.5 to 0.9 is untypeable if the bound is applied per
    // keystroke instead — see `NumericField`.
    expect(commitNumericField('0.8', STROKE_WEIGHT_FIELD)).toEqual({ value: 0.8, text: '0.8px' })
  })

  /**
   * Written back, not just stored: a field that shows the number it rejected
   * while storing a different one reads as the edit having been ignored.
   */
  it('clamps up to the minimum and says so in the text', () => {
    expect(commitNumericField('0.1', STROKE_WEIGHT_FIELD)).toEqual({ value: 0.5, text: '0.5px' })
    expect(commitNumericField('-3', OPACITY_FIELD)).toEqual({ value: 0, text: '0%' })
    expect(commitNumericField('-5', CORNER_RADIUS_FIELD)).toEqual({ value: 0, text: '0px' })
  })

  it('clamps down to the maximum where there is one', () => {
    expect(commitNumericField('420', OPACITY_FIELD)).toEqual({ value: 100, text: '100%' })
  })

  /**
   * Neither a weight nor a radius has an upper bound of its own — the router
   * reduces a radius that will not fit, and a thick line is a choice.
   */
  it('leaves a large weight or radius alone', () => {
    expect(commitNumericField('999', STROKE_WEIGHT_FIELD)?.value).toBe(999)
    expect(commitNumericField('999', CORNER_RADIUS_FIELD)?.value).toBe(999)
  })

  /**
   * The one case that keeps whatever is on screen: an empty field, or one
   * holding just a unit, is somebody mid-edit rather than somebody asking
   * for a value. Clamping it to the minimum would put a number they never
   * typed into the document.
   */
  it('answers null for text with no number in it', () => {
    expect(commitNumericField('', STROKE_WEIGHT_FIELD)).toBeNull()
    expect(commitNumericField('px', STROKE_WEIGHT_FIELD)).toBeNull()
    expect(commitNumericField('%', OPACITY_FIELD)).toBeNull()
    expect(commitNumericField('thin', STROKE_WEIGHT_FIELD)).toBeNull()
  })

  it('answers null rather than NaN or Infinity', () => {
    expect(commitNumericField('NaN', OPACITY_FIELD)).toBeNull()
    expect(commitNumericField('Infinity', CORNER_RADIUS_FIELD)).toBeNull()
  })
})

describe('numericFieldText', () => {
  /**
   * The unit is baked into the very first value on purpose: `TextboxNumeric`
   * only appends its own `suffix` once the field has been blurred, so without
   * this the box looks unfinished until somebody touches it.
   */
  it('shows a value from the record with its unit already on it', () => {
    expect(numericFieldText(1.5, STROKE_WEIGHT_FIELD)).toBe('1.5px')
    expect(numericFieldText(20, CORNER_RADIUS_FIELD)).toBe('20px')
    expect(numericFieldText(100, OPACITY_FIELD)).toBe('100%')
  })

  it('shows nothing at all for a value the record does not have', () => {
    expect(numericFieldText(undefined, STROKE_WEIGHT_FIELD)).toBe('')
  })

  it('round-trips through a commit unchanged', () => {
    const shown = numericFieldText(0.8, STROKE_WEIGHT_FIELD)
    expect(commitNumericField(shown, STROKE_WEIGHT_FIELD)).toEqual({ value: 0.8, text: shown })
  })
})

describe('visibleConnectorControls', () => {
  it('shows everything for a routed elbow', () => {
    expect(visibleConnectorControls({ lineStyle: 'ELBOW', manualGeometry: false })).toEqual({
      lineStyle: true,
      cornerRadius: true,
      detour: true,
      handedOver: false
    })
  })

  /** A straight line has no bend to round, and nothing it routes around. */
  it('hides corner radius and Go around for a straight line', () => {
    expect(visibleConnectorControls({ lineStyle: 'STRAIGHT', manualGeometry: false })).toMatchObject({
      lineStyle: true,
      cornerRadius: false,
      detour: false
    })
  })

  it('hides them for a curve too', () => {
    expect(visibleConnectorControls({ lineStyle: 'CURVE', manualGeometry: false })).toMatchObject({
      cornerRadius: false,
      detour: false
    })
  })

  /**
   * A hand-drawn line has had its shape handed over, so every control that
   * would decide the shape is gone rather than inert — including the line
   * style picker, which is shown for every routed line.
   */
  it('hides every shape control on a hand-drawn line, and explains itself instead', () => {
    expect(visibleConnectorControls({ lineStyle: 'ELBOW', manualGeometry: true })).toEqual({
      lineStyle: false,
      cornerRadius: false,
      detour: false,
      handedOver: true
    })
  })

  /** Being hand-drawn wins over what the record still says the line style was. */
  it('hides them however the line was routed before it was reshaped', () => {
    for (const lineStyle of ['STRAIGHT', 'CURVE', 'ELBOW'] as const) {
      expect(visibleConnectorControls({ lineStyle, manualGeometry: true })).toEqual({
        lineStyle: false,
        cornerRadius: false,
        detour: false,
        handedOver: true
      })
    }
  })

  /** The explanation and the shape controls are never both on screen. */
  it('never shows the hand-drawn notice alongside a shape control', () => {
    for (const manualGeometry of [true, false]) {
      for (const lineStyle of ['STRAIGHT', 'CURVE', 'ELBOW'] as const) {
        const visible = visibleConnectorControls({ lineStyle, manualGeometry })
        const anyShapeControl = visible.lineStyle || visible.cornerRadius || visible.detour
        expect(visible.handedOver && anyShapeControl).toBe(false)
      }
    }
  })
})
