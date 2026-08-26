/**
 * Category CRUD — the list lives on `figma.root` (the document), not a page,
 * so it's shared across every page in the file, the same scope Figma's own
 * annotation categories use.
 */

import {
  type Category,
  DEFAULT_CATEGORIES,
  createCategory,
  parseCategoryList,
  serialiseCategoryList
} from '../core/category.js'
import { withSuppressedNodeChange } from './pluginData.js'

const CATEGORIES_KEY = 'categories'

export function getCategories(): ReadonlyArray<Category> {
  return parseCategoryList(figma.root.getPluginData(CATEGORIES_KEY))
}

function saveCategories(categories: ReadonlyArray<Category>): void {
  withSuppressedNodeChange(() => {
    figma.root.setPluginData(CATEGORIES_KEY, serialiseCategoryList(categories))
  })
}

/**
 * Seeds the three defaults (Note/Idea/Requirement) the first time a file
 * has no categories at all — never once any exist, so it won't clobber a
 * list someone has already customised (deleting down to zero and reopening
 * re-seeds, same as any other empty state).
 */
export function ensureDefaultCategories(): void {
  if (getCategories().length > 0) return
  saveCategories(DEFAULT_CATEGORIES)
}

function generateCategoryId(): string {
  return `cat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function addCategory(name: string, color: string): Category {
  const category = createCategory(generateCategoryId(), name, color)
  saveCategories([...getCategories(), category])
  return category
}

export function renameCategory(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') return
  saveCategories(getCategories().map((category) => (category.id === id ? { ...category, name: trimmed } : category)))
}

export function recolorCategory(id: string, color: string): void {
  saveCategories(getCategories().map((category) => (category.id === id ? { ...category, color } : category)))
}

/**
 * Removes the category. Annotations that referenced it keep their stored
 * `categoryId` untouched — `findCategory` already treats an id that matches
 * nothing as "no category", so this doesn't need to sweep every annotation
 * on the page to stay consistent.
 */
export function deleteCategory(id: string): void {
  saveCategories(getCategories().filter((category) => category.id !== id))
}
