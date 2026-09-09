import { describe, expect, it } from 'vitest'

import {
  type ObservedChange,
  classifyBatch,
  classifyChange,
  isEmptyBatch
} from '../src/core/nodeChanges.js'

function change(overrides: Partial<ObservedChange> = {}): ObservedChange {
  return {
    type: 'PROPERTY_CHANGE',
    nodeId: 'node-1',
    properties: [],
    nodeType: 'FRAME',
    hasBox: true,
    role: null,
    ownerId: null,
    ...overrides
  }
}

const moved = (overrides: Partial<ObservedChange> = {}) =>
  change({ properties: ['x', 'y'], ...overrides })

describe('classifyChange', () => {
  it('takes a deletion as a deletion, whatever else it says', () => {
    expect(classifyChange(change({ type: 'DELETE', hasBox: false }))).toMatchObject({
      deleted: true,
      movedTarget: false
    })
  })

  it('ignores a create — a node nothing is anchored to yet has nothing to re-route', () => {
    expect(classifyChange(change({ type: 'CREATE' }))).toMatchObject({
      deleted: false,
      movedTarget: false,
      editedText: false
    })
  })

  /**
   * Stated as its own rule rather than left to fall out of a create having
   * no properties: what makes a create nothing to do is that nothing is
   * anchored to a node that did not exist a moment ago, not the shape of the
   * event Figma happens to send.
   */
  it('ignores a create however it is described', () => {
    const described = change({ type: 'CREATE', properties: ['x', 'y', 'characters'], nodeType: 'TEXT' })
    expect(classifyChange(described)).toMatchObject({
      deleted: false,
      movedTarget: false,
      draggedCardOwnerId: null,
      editedText: false
    })
  })

  /**
   * A node moved and then deleted inside one batch arrives as a positional
   * change on a `RemovedNode`. There is nothing left to route to, and it is
   * about to come through as a deletion anyway.
   */
  it('ignores a move of a node that is already gone', () => {
    expect(classifyChange(moved({ hasBox: false }))).toMatchObject({
      movedTarget: false,
      draggedCardOwnerId: null
    })
  })

  it('treats a moved ordinary layer as a target to re-route', () => {
    expect(classifyChange(moved())).toMatchObject({ movedTarget: true })
  })

  it('re-routes for a reshaped vector, whose box need not have changed at all', () => {
    // Pull a bend inwards and the two ends still describe the same rectangle
    // with the same number of vertices, so nothing positional would fire.
    expect(classifyChange(change({ properties: ['vectorNetwork'], nodeType: 'VECTOR' }))).toMatchObject({
      movedTarget: true
    })
  })

  describe('the properties it will not chase', () => {
    /**
     * This is the measurement B3 turns on. `withSuppressedNodeChange`'s own
     * docstring says a `setPluginData` echo "would loop forever without
     * this" — but `pluginData` is not a property this filter acts on, so the
     * echo stops here whether the flag is raised or not.
     */
    it('ignores a pluginData change, which is the echo the suppress flag claims to stop', () => {
      expect(classifyChange(change({ properties: ['pluginData'] }))).toMatchObject({
        movedTarget: false,
        draggedCardOwnerId: null,
        editedText: false
      })
    })

    /** Every sync puts its rendered nodes back on the page, which changes `parent`. */
    it('ignores a reparent', () => {
      expect(classifyChange(change({ properties: ['parent'] }))).toMatchObject({
        movedTarget: false
      })
    })

    it('ignores the properties a restyle touches', () => {
      for (const property of ['fills', 'strokes', 'opacity', 'name', 'locked', 'cornerRadius']) {
        expect(classifyChange(change({ properties: [property] }))).toMatchObject({
          movedTarget: false
        })
      }
    })

    /** One positional property among ignorable ones is still a move. */
    it('acts on a batch that mixes an ignored property with a positional one', () => {
      expect(classifyChange(change({ properties: ['pluginData', 'x'] }))).toMatchObject({
        movedTarget: true
      })
    })
  })

  describe('the rendered nodes it recognises as its own', () => {
    /**
     * The other half of what the suppress flag is credited with, done by
     * asking what the node *is* rather than when the write happened: a badge
     * and a leader are locked and positioned only by this plugin's sync, so
     * a move of one is always our own write coming back.
     */
    it('ignores a badge or a leader that moved', () => {
      expect(classifyChange(moved({ role: 'badge', ownerId: 'layer-1' }))).toMatchObject({
        movedTarget: false,
        draggedCardOwnerId: null
      })
      expect(classifyChange(moved({ role: 'leader', ownerId: 'layer-1' }))).toMatchObject({
        movedTarget: false,
        draggedCardOwnerId: null
      })
    })

    /**
     * A card is the exception, and the reason the suppress flag still has a
     * job: it is unlocked, so a move of one is either a person dragging it or
     * this plugin positioning it, and nothing in the change itself says which.
     */
    it('reads a moved card as its owner having been dragged', () => {
      expect(classifyChange(moved({ role: 'card', ownerId: 'layer-1' }))).toMatchObject({
        draggedCardOwnerId: 'layer-1',
        movedTarget: false
      })
    })

    /** A card whose owner cannot be traced is not a target either — there is nothing to update. */
    it('ignores a moved card with no owner recorded', () => {
      expect(classifyChange(moved({ role: 'card', ownerId: null }))).toMatchObject({
        draggedCardOwnerId: null,
        movedTarget: false
      })
    })
  })

  describe('text typed on the canvas', () => {
    const typed = (overrides: Partial<ObservedChange> = {}) =>
      change({ properties: ['characters'], nodeType: 'TEXT', ...overrides })

    it('is noticed on a text node', () => {
      expect(classifyChange(typed())).toMatchObject({ editedText: true })
    })

    it('is not noticed on anything that is not a text node', () => {
      expect(classifyChange(typed({ nodeType: 'FRAME' }))).toMatchObject({ editedText: false })
    })

    /** Nothing left to read the words off of. */
    it('is not noticed on a node deleted in the same batch', () => {
      expect(classifyChange(typed({ hasBox: false }))).toMatchObject({ editedText: false })
    })

    /**
     * Decided separately from the positional filter rather than instead of
     * it: `characters` is not a position, and reading the words back into the
     * record is not a re-render. A batch can carry both.
     */
    it('is noticed alongside a move, not swallowed by it', () => {
      const both = typed({ properties: ['characters', 'x'], role: 'card', ownerId: 'layer-1' })
      expect(classifyChange(both)).toMatchObject({
        editedText: true,
        draggedCardOwnerId: 'layer-1'
      })
    })

    it('is noticed even when the rest of the change is ignored', () => {
      const withEchoes = typed({ properties: ['characters', 'pluginData'] })
      expect(classifyChange(withEchoes)).toMatchObject({ editedText: true, movedTarget: false })
    })
  })
})

describe('classifyBatch', () => {
  it('gathers each kind under its own key', () => {
    const effects = classifyBatch([
      change({ type: 'DELETE', nodeId: 'gone', hasBox: false }),
      moved({ nodeId: 'screen' }),
      moved({ nodeId: 'card-1', role: 'card', ownerId: 'layer-1' }),
      change({ nodeId: 'text-1', properties: ['characters'], nodeType: 'TEXT' })
    ])
    expect([...effects.deletedIds]).toEqual(['gone'])
    expect([...effects.movedTargetIds]).toEqual(['screen'])
    expect([...effects.draggedCardOwnerIds]).toEqual(['layer-1'])
    expect(effects.editedTextNodeIds).toEqual(['text-1'])
  })

  /** A multi-select drag reports the same node repeatedly across one batch. */
  it('collapses repeats of the same node', () => {
    const effects = classifyBatch([moved({ nodeId: 'screen' }), moved({ nodeId: 'screen' })])
    expect(effects.movedTargetIds.size).toBe(1)
  })

  it('collapses two cards belonging to one owner', () => {
    const effects = classifyBatch([
      moved({ nodeId: 'card-1', role: 'card', ownerId: 'layer-1' }),
      moved({ nodeId: 'card-2', role: 'card', ownerId: 'layer-1' })
    ])
    expect([...effects.draggedCardOwnerIds]).toEqual(['layer-1'])
  })

  /**
   * The cheap path, and the common one: a batch of nothing but our own echoes
   * has to cost nothing after this, since a drag delivers one batch per frame.
   */
  it('is empty for a batch of nothing but echoes', () => {
    const effects = classifyBatch([
      change({ properties: ['pluginData'] }),
      change({ properties: ['parent'] }),
      moved({ role: 'badge', ownerId: 'layer-1' }),
      moved({ role: 'leader', ownerId: 'layer-1' })
    ])
    expect(isEmptyBatch(effects)).toBe(true)
  })

  it('is empty for no changes at all', () => {
    expect(isEmptyBatch(classifyBatch([]))).toBe(true)
  })

  it('is not empty as soon as one change asks for something', () => {
    expect(isEmptyBatch(classifyBatch([moved()]))).toBe(false)
  })
})
