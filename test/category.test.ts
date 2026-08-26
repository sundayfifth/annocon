import { describe, expect, it } from 'vitest'

import {
  CATEGORY_PALETTE,
  createCategory,
  findCategory,
  parseCategoryList,
  serialiseCategoryList
} from '../src/core/category.js'

describe('createCategory', () => {
  it('trims the name but keeps the given id and colour', () => {
    const category = createCategory('cat-1', '  Needs review  ', CATEGORY_PALETTE[0] as string)
    expect(category).toEqual({ id: 'cat-1', name: 'Needs review', color: CATEGORY_PALETTE[0] })
  })
})

describe('parseCategoryList / serialiseCategoryList', () => {
  it('round-trips a list of categories', () => {
    const categories = [
      createCategory('a', 'Bug', CATEGORY_PALETTE[0] as string),
      createCategory('b', 'Question', CATEGORY_PALETTE[1] as string)
    ]
    expect(parseCategoryList(serialiseCategoryList(categories))).toEqual(categories)
  })

  it('returns an empty list for empty, malformed, or non-array data', () => {
    expect(parseCategoryList('')).toEqual([])
    expect(parseCategoryList('{oops')).toEqual([])
    expect(parseCategoryList('null')).toEqual([])
    expect(parseCategoryList('{"id":"a"}')).toEqual([])
  })

  it('drops individually malformed entries instead of discarding the whole list', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'Bug', color: '#E5484D' },
      { id: 'b', name: '' }, // missing color, blank name
      { name: 'no id', color: '#0091FF' },
      { id: 'c', name: 'Question', color: '#0091FF' }
    ])
    expect(parseCategoryList(raw)).toEqual([
      { id: 'a', name: 'Bug', color: '#E5484D' },
      { id: 'c', name: 'Question', color: '#0091FF' }
    ])
  })
})

describe('findCategory', () => {
  const categories = [
    createCategory('a', 'Bug', CATEGORY_PALETTE[0] as string),
    createCategory('b', 'Question', CATEGORY_PALETTE[1] as string)
  ]

  it('finds a category by id', () => {
    expect(findCategory(categories, 'b')).toEqual(categories[1])
  })

  it('returns null for a null id', () => {
    expect(findCategory(categories, null)).toBeNull()
  })

  it('returns null for an id that no longer exists (category deleted since)', () => {
    expect(findCategory(categories, 'deleted-category')).toBeNull()
  })
})
