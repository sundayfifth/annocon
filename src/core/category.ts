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

// Kept small on purpose — 7 colours reads as a deliberate, curated set on a
// swatch grid; more than that starts to feel like a colour picker instead of
// a category picker. Black and grey stay no matter what (grey is the
// default "Note" category's colour, black is the default connector colour),
// leaving 5 hues that cover warm to cool without needing near-duplicates
// like a second green.
export const CATEGORY_PALETTE: ReadonlyArray<string> = [
  '#000000', // black
  '#8C8C8C', // grey — the neutral option, and the default "Note" category's colour
  '#E5484D', // red
  '#F76B15', // orange
  '#FECC00', // yellow — the default "Idea" category's colour
  '#46A758', // green
  '#0091FF' // blue — the default "Dev" category's colour
]

export const DEFAULT_CATEGORY_COLOR: string = CATEGORY_PALETTE[0] as string

/**
 * Seeded once, the first time a file has no categories at all — see
 * `categoryScene.ensureDefaultCategories`. Fixed (not randomly generated)
 * ids so `DEFAULT_CATEGORY_ID` can be referenced as the fallback an
 * annotation gets when nobody's picked a category — dangling gracefully to
 * "no category" if this one's ever renamed away or deleted, same as any
 * other `categoryId`.
 */
export const DEFAULT_CATEGORY_ID = 'cat-note'

export const DEFAULT_CATEGORIES: ReadonlyArray<Category> = [
  { id: DEFAULT_CATEGORY_ID, name: 'Note', color: '#8C8C8C' },
  { id: 'cat-dev', name: 'Dev', color: '#0091FF' },
  { id: 'cat-idea', name: 'Idea', color: '#FECC00' }
]

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

/**
 * Black or white, whichever reads clearly on `hex` — a category's label is
 * always drawn in one fixed colour (white) both on the canvas pill and in
 * the picker, which fails outright on a light background like the palette's
 * yellow. YIQ perceived-brightness, not full WCAG contrast: cheap, and more
 * than accurate enough for picking between exactly two options.
 */
export function contrastingTextColor(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#1E1E24' : '#FFFFFF'
}
