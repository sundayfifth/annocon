/**
 * Annotation categories — a file-wide list of (name, colour) pairs an
 * annotation can be tagged with, the same idea as Figma's own native
 * annotation categories. Pure, like `annotation.ts`.
 *
 * Colour is chosen from a fixed palette rather than an arbitrary hex value,
 * again mirroring Figma's own category picker — a small closed set reads
 * consistently on a badge and a card pill; free-form colour picking doesn't
 * add anything a team actually needs here.
 */

export const CATEGORY_VERSION = 1

export interface Category {
  readonly id: string
  readonly name: string
  /** One of `CATEGORY_PALETTE`. Not enforced by the type so a colour removed
   * from a future palette doesn't make old data unparsable — just unusual. */
  readonly color: string
}

export const CATEGORY_PALETTE: ReadonlyArray<string> = [
  '#E5484D', // red
  '#F76B15', // orange
  '#FFC53D', // yellow
  '#46A758', // green
  '#12A594', // teal
  '#0091FF', // blue
  '#7B61FF', // purple
  '#E93D82' // pink
]

export const DEFAULT_CATEGORY_COLOR: string = CATEGORY_PALETTE[0] as string

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isCategory(value: unknown): value is Category {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.name) &&
    isNonEmptyString(candidate.color)
  )
}

export function createCategory(id: string, name: string, color: string): Category {
  return { id, name: name.trim(), color }
}

/**
 * Decodes the category list out of pluginData. Same tolerance as the other
 * parsers in this codebase: unreadable data is an empty list rather than an
 * error, and any single malformed entry is dropped rather than discarding
 * every category because one is bad.
 */
export function parseCategoryList(raw: string): ReadonlyArray<Category> {
  if (raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isCategory)
}

export function serialiseCategoryList(categories: ReadonlyArray<Category>): string {
  return JSON.stringify(categories)
}

/** The category an annotation's `categoryId` refers to, or `null` if unset or deleted since. */
export function findCategory(
  categories: ReadonlyArray<Category>,
  categoryId: string | null
): Category | null {
  if (categoryId === null) return null
  return categories.find((category) => category.id === categoryId) ?? null
}
