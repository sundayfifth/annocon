import { describe, expect, it, vi } from 'vitest'

import {
  type OwnedNode,
  groupByOwner,
  ownerIdOf,
  resolveOwnersBehind
} from '../src/core/ownerIndex.js'

const KEY = 'annotationOwner'

/** Stands in for a rendered node: an id, and whatever its pluginData says. */
function node(id: string, data: Record<string, string> = {}): OwnedNode {
  return { id, getPluginData: (key) => data[key] ?? '' }
}

const owned = (id: string, ownerId: string) => node(id, { [KEY]: ownerId })

describe('ownerIdOf', () => {
  it('reads the owner out of the given key', () => {
    expect(ownerIdOf(owned('card-1', 'layer-1'), KEY)).toBe('layer-1')
  })

  /** An untagged node and a node tagged empty are the same thing: not ours. */
  it('answers null for a node with nothing in that key', () => {
    expect(ownerIdOf(node('plain'), KEY)).toBeNull()
    expect(ownerIdOf(owned('blank', ''), KEY)).toBeNull()
  })

  /**
   * The two features keep separate indexes under separate keys, so reading
   * the wrong one has to come back empty rather than crossing them.
   */
  it('does not see an owner written under another key', () => {
    const pill = node('pill-1', { connectorLabelOwner: 'line-1' })
    expect(ownerIdOf(pill, KEY)).toBeNull()
    expect(ownerIdOf(pill, 'connectorLabelOwner')).toBe('line-1')
  })
})

describe('groupByOwner', () => {
  it('collects each owner\'s nodes together', () => {
    const badge = owned('badge-1', 'layer-1')
    const card = owned('card-1', 'layer-1')
    const other = owned('badge-2', 'layer-2')
    const grouped = groupByOwner([badge, card, other], KEY)
    expect(grouped.get('layer-1')).toEqual([badge, card])
    expect(grouped.get('layer-2')).toEqual([other])
  })

  it('keeps the order the nodes came in, per owner', () => {
    const first = owned('a', 'layer-1')
    const second = owned('b', 'layer-1')
    expect(groupByOwner([first, second], KEY).get('layer-1')).toEqual([first, second])
    expect(groupByOwner([second, first], KEY).get('layer-1')).toEqual([second, first])
  })

  /**
   * The case the grouping exists for: an earlier sync that threw partway
   * through can leave two nodes tagged for the same owner, and the caller
   * clears both rather than picking one. A map of single nodes would hide it.
   */
  it('keeps every duplicate rather than letting one win', () => {
    const grouped = groupByOwner([owned('card-1', 'layer-1'), owned('card-2', 'layer-1')], KEY)
    expect(grouped.get('layer-1')).toHaveLength(2)
  })

  it('drops nodes that are not tagged at all', () => {
    const grouped = groupByOwner([node('plain'), owned('card-1', 'layer-1')], KEY)
    expect([...grouped.keys()]).toEqual(['layer-1'])
  })

  it('answers an empty map for nothing tagged', () => {
    expect(groupByOwner([], KEY).size).toBe(0)
    expect(groupByOwner([node('plain')], KEY).size).toBe(0)
  })
})

describe('resolveOwnersBehind', () => {
  const layer = { id: 'layer-1' }
  const otherLayer = { id: 'layer-2' }
  const owners = () => [layer, otherLayer]

  it('answers each selected node with the owner it belongs to', () => {
    const resolved = resolveOwnersBehind([owned('card-1', 'layer-1')], KEY, owners)
    expect(resolved.get('card-1')).toBe(layer)
  })

  it('answers every node of one owner, not just the first', () => {
    const resolved = resolveOwnersBehind(
      [owned('badge-1', 'layer-1'), owned('card-1', 'layer-1')],
      KEY,
      owners
    )
    expect(resolved.get('badge-1')).toBe(layer)
    expect(resolved.get('card-1')).toBe(layer)
  })

  it('keys by the selected node, so two owners in one selection both resolve', () => {
    const resolved = resolveOwnersBehind(
      [owned('card-1', 'layer-1'), owned('card-2', 'layer-2')],
      KEY,
      owners
    )
    expect(resolved.get('card-1')).toBe(layer)
    expect(resolved.get('card-2')).toBe(otherLayer)
  })

  it('leaves out a node whose owner is gone', () => {
    const resolved = resolveOwnersBehind([owned('card-9', 'deleted-layer')], KEY, owners)
    expect(resolved.size).toBe(0)
  })

  it('leaves an untagged node alone', () => {
    expect(resolveOwnersBehind([node('plain')], KEY, owners).size).toBe(0)
  })

  /**
   * The contract that lets this run on every `selectionchange`: finding the
   * owners means scanning the page, and an ordinary selection — a layer, not
   * one of our rendered nodes — must not pay for one.
   */
  it('never asks for the owners when nothing selected is tagged', () => {
    const findOwners = vi.fn(owners)
    resolveOwnersBehind([node('plain'), node('another')], KEY, findOwners)
    expect(findOwners).not.toHaveBeenCalled()
  })

  it('asks for the owners exactly once, however much is selected', () => {
    const findOwners = vi.fn(owners)
    resolveOwnersBehind(
      [owned('a', 'layer-1'), owned('b', 'layer-1'), owned('c', 'layer-2')],
      KEY,
      findOwners
    )
    expect(findOwners).toHaveBeenCalledTimes(1)
  })
})
