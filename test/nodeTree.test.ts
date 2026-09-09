import { describe, expect, it } from 'vitest'

import {
  type StackedNode,
  type TreeNode,
  enclosingFrameOf,
  needsRaising,
  topLevelAncestorIdOf
} from '../src/core/nodeTree.js'

/**
 * `nodeTree.ts` only walks `parent` links and reads `type`, so a plain object
 * tree stands in for a document. Written outermost-first, the way the layer
 * panel reads top-down, with the node under test last.
 */
function tree(...chain: Array<[string, string]>): TreeNode {
  let parent: TreeNode | null = null
  let node: TreeNode | null = null
  for (const [id, type] of chain) {
    node = { id, type, parent }
    parent = node
  }
  if (node === null) throw new Error('a tree needs at least one node')
  return node
}

const page = ['page', 'PAGE'] as [string, string]

describe('enclosingFrameOf', () => {
  it('finds the frame a node sits directly inside', () => {
    const button = tree(page, ['screen', 'FRAME'], ['button', 'INSTANCE'])
    expect(enclosingFrameOf(button)?.id).toBe('screen')
  })

  /**
   * The screen someone laid out, not the nearest frame up the chain — which
   * is what makes the card sit outside the whole screen rather than outside
   * the row it happened to be dropped in.
   */
  it('takes the outermost frame, not the nearest one', () => {
    const label = tree(page, ['screen', 'FRAME'], ['card', 'FRAME'], ['row', 'FRAME'], ['label', 'TEXT'])
    expect(enclosingFrameOf(label)?.id).toBe('screen')
  })

  it('sees through groups, sections and components on the way out', () => {
    const icon = tree(page, ['flow', 'SECTION'], ['screen', 'FRAME'], ['group', 'GROUP'], ['icon', 'VECTOR'])
    expect(enclosingFrameOf(icon)?.id).toBe('screen')
  })

  it('answers null for a node with no frame above it', () => {
    expect(enclosingFrameOf(tree(page, ['screen', 'FRAME']))).toBeNull()
    expect(enclosingFrameOf(tree(page, ['flow', 'SECTION'], ['sticky', 'TEXT']))).toBeNull()
  })

  /** A node that is itself a frame is not inside itself. */
  it('does not report the node itself', () => {
    expect(enclosingFrameOf(tree(page, ['screen', 'FRAME']))).toBeNull()
  })

  it('stops at the page rather than walking past it', () => {
    // A PAGE typed as FRAME above it would be a malformed tree; what matters
    // is that nothing above the page is ever consulted.
    const node = tree(['doc', 'DOCUMENT'], ['outer', 'FRAME'], page, ['screen', 'FRAME'], ['button', 'INSTANCE'])
    expect(enclosingFrameOf(node)?.id).toBe('screen')
  })
})

describe('topLevelAncestorIdOf', () => {
  it('reports the top-level frame a node belongs to', () => {
    const button = tree(page, ['screen', 'FRAME'], ['row', 'FRAME'], ['button', 'INSTANCE'])
    expect(topLevelAncestorIdOf(button)).toBe('screen')
  })

  it('reports the node itself when nothing encloses it', () => {
    expect(topLevelAncestorIdOf(tree(page, ['screen', 'FRAME']))).toBe('screen')
  })

  /**
   * The difference from `enclosingFrameOf`, and the whole reason both exist:
   * a component is a box a route has to avoid, even though it is not a screen
   * an annotation card sits outside of.
   */
  it('counts a component, unlike enclosingFrameOf', () => {
    const text = tree(page, ['chip', 'COMPONENT'], ['text', 'TEXT'])
    expect(topLevelAncestorIdOf(text)).toBe('chip')
    expect(enclosingFrameOf(text)).toBeNull()
  })

  /**
   * A section is a way of handling several screens at once, not a box in its
   * own right — `collectRouteObstacles` looks inside one for the screens. If
   * the section were reported here, a connector between two screens in it
   * would see its own screen as a foreign box to avoid.
   */
  it('steps over a section and reports the screen inside it', () => {
    const button = tree(page, ['flow', 'SECTION'], ['screen', 'FRAME'], ['button', 'INSTANCE'])
    expect(topLevelAncestorIdOf(button)).toBe('screen')
  })

  it('steps over a group the same way', () => {
    const icon = tree(page, ['cluster', 'GROUP'], ['screen', 'FRAME'], ['icon', 'VECTOR'])
    expect(topLevelAncestorIdOf(icon)).toBe('screen')
  })

  /** Nothing but stepped-over containers above it: the node is its own box. */
  it('reports the node itself when only containers enclose it', () => {
    const sticky = tree(page, ['board', 'SECTION'], ['cluster', 'GROUP'], ['sticky', 'TEXT'])
    expect(topLevelAncestorIdOf(sticky)).toBe('sticky')
  })

  it('stops at a document parent as well as a page', () => {
    const node = tree(['doc', 'DOCUMENT'], ['screen', 'FRAME'], ['button', 'INSTANCE'])
    expect(topLevelAncestorIdOf(node)).toBe('screen')
  })
})

describe('needsRaising', () => {
  /** Siblings in the order Figma reports them: later in `children` draws on top. */
  function siblings(count: number): { parent: { children: Array<StackedNode> }; nodes: Array<StackedNode> } {
    const parent = { children: [] as Array<StackedNode> }
    const nodes: Array<StackedNode> = []
    for (let i = 0; i < count; i += 1) {
      const node: StackedNode = { removed: false, parent }
      parent.children.push(node)
      nodes.push(node)
    }
    return { parent, nodes }
  }

  it('is true when the node sits below what it should cover', () => {
    const { nodes } = siblings(2)
    expect(needsRaising(nodes[0]!, nodes[1]!)).toBe(true)
  })

  it('is false when it already draws over it', () => {
    const { nodes } = siblings(2)
    expect(needsRaising(nodes[1]!, nodes[0]!)).toBe(false)
  })

  /**
   * Guards the degenerate call rather than the interesting one: a node is
   * already over itself, and re-appending it would be exactly the pointless
   * reorder this function exists to avoid.
   */
  it('is false for a node compared against itself', () => {
    const { nodes } = siblings(2)
    expect(needsRaising(nodes[0]!, nodes[0]!)).toBe(false)
  })

  it('is false when there is nothing to sit over', () => {
    const { nodes } = siblings(1)
    expect(needsRaising(nodes[0]!, null)).toBe(false)
  })

  it('is false when either node is already deleted', () => {
    const { parent, nodes } = siblings(2)
    const gone: StackedNode = { removed: true, parent }
    expect(needsRaising(nodes[0]!, gone)).toBe(false)
    expect(needsRaising({ removed: true, parent }, nodes[1]!)).toBe(false)
  })

  /**
   * Across two parents the layer order does not decide which draws over the
   * other, so re-appending would move the node without fixing anything.
   */
  it('is false for nodes in different parents', () => {
    const a = siblings(1)
    const b = siblings(1)
    expect(needsRaising(a.nodes[0]!, b.nodes[0]!)).toBe(false)
  })

  it('is false for a node with no parent at all', () => {
    const { nodes } = siblings(1)
    expect(needsRaising({ removed: false, parent: null }, nodes[0]!)).toBe(false)
  })
})
