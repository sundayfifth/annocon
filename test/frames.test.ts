import { describe, expect, it } from 'vitest'

import { commonSectionOf } from '../src/scene/frames.js'

/**
 * `frames.ts` never touches the `figma` global — it only walks `parent`
 * links — so a plain object tree stands in for a real one. The Figma types
 * are erased at runtime, hence the casts.
 */
interface FakeNode {
  id: string
  type: string
  parent: FakeNode | null
}

function tree(...chain: Array<[string, string]>): FakeNode {
  // Outermost first, so the last entry is the node itself.
  let parent: FakeNode | null = null
  let node: FakeNode | null = null
  for (const [id, type] of chain) {
    node = { id, type, parent }
    parent = node
  }
  return node as FakeNode
}

const section = (a: FakeNode, b: FakeNode) =>
  commonSectionOf(a as unknown as SceneNode, b as unknown as SceneNode)

describe('commonSectionOf', () => {
  it('finds the section two frames share', () => {
    const flow = ['flow', 'SECTION'] as [string, string]
    const a = tree(['page', 'PAGE'], flow, ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], flow, ['screen-b', 'FRAME'])
    expect(section(a, b)?.id).toBe('flow')
  })

  it('finds it for anchors nested deep inside those frames', () => {
    const flow = ['flow', 'SECTION'] as [string, string]
    const a = tree(['page', 'PAGE'], flow, ['screen-a', 'FRAME'], ['row', 'FRAME'], ['button', 'INSTANCE'])
    const b = tree(['page', 'PAGE'], flow, ['screen-b', 'FRAME'], ['label', 'TEXT'])
    expect(section(a, b)?.id).toBe('flow')
  })

  it('answers null when neither is in a section', () => {
    const a = tree(['page', 'PAGE'], ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], ['screen-b', 'FRAME'])
    expect(section(a, b)).toBeNull()
  })

  /**
   * A line with one end outside belongs on the page: putting it in the
   * section would have the section move half of what the line is attached
   * to, dragging the line away from the other half.
   */
  it('answers null when only one end is in a section', () => {
    const a = tree(['page', 'PAGE'], ['flow', 'SECTION'], ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], ['screen-b', 'FRAME'])
    expect(section(a, b)).toBeNull()
  })

  it('answers null for two different sections', () => {
    const a = tree(['page', 'PAGE'], ['flow-1', 'SECTION'], ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], ['flow-2', 'SECTION'], ['screen-b', 'FRAME'])
    expect(section(a, b)).toBeNull()
  })

  /** The tightest section that still holds both is the one the line is part of. */
  it('takes the innermost section when they are nested', () => {
    const outer = ['board', 'SECTION'] as [string, string]
    const inner = ['flow', 'SECTION'] as [string, string]
    const a = tree(['page', 'PAGE'], outer, inner, ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], outer, inner, ['screen-b', 'FRAME'])
    expect(section(a, b)?.id).toBe('flow')
  })

  it('falls back to the shared outer section when only that one holds both', () => {
    const outer = ['board', 'SECTION'] as [string, string]
    const a = tree(['page', 'PAGE'], outer, ['flow-1', 'SECTION'], ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], outer, ['flow-2', 'SECTION'], ['screen-b', 'FRAME'])
    expect(section(a, b)?.id).toBe('board')
  })

  it('ignores groups and frames on the way up', () => {
    const flow = ['flow', 'SECTION'] as [string, string]
    const a = tree(['page', 'PAGE'], flow, ['group', 'GROUP'], ['screen-a', 'FRAME'])
    const b = tree(['page', 'PAGE'], flow, ['screen-b', 'FRAME'])
    expect(section(a, b)?.id).toBe('flow')
  })

  it('handles a connector between a screen and something inside it', () => {
    const flow = ['flow', 'SECTION'] as [string, string]
    const screen = ['screen', 'FRAME'] as [string, string]
    const a = tree(['page', 'PAGE'], flow, screen)
    const b = tree(['page', 'PAGE'], flow, screen, ['button', 'INSTANCE'])
    expect(section(a, b)?.id).toBe('flow')
  })
})
