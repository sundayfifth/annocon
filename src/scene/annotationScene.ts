/**
 * Annotate feature — draws an `AnnotationRecord` as real canvas nodes.
 *
 * The layout math lives in `src/core/annotation.ts` and is pure; this module
 * only ever writes canvas state from a record (see ADR 0001 — geometry flows
 * one way, record to node, never back).
 *
 * The record lives in `annotation` pluginData on the target node. The card
 * and leader are separate top-level nodes tagged with `annotationOwner`
 * (the target's id) and `annotationRole`, found by query rather than by id
 * cached on the target — the canvas is untrusted, so a fresh scan is the
 * source of truth on every sync, not a cache that can drift. (`badge` is a
 * third, retired role kept only so an older file's leftover dot markers get
 * swept up and removed on the next sync.)
 */

import type { Point, Rect } from '../core/anchor.js'
import {
  type AnnotationLayout,
  type AnnotationRecord,
  CARD_APPROACH_STUB,
  type AnnotationSize,
  type CardMetrics,
  metricsForSize,
  MIN_OUTSIDE_CARD_WIDTH,
  OUTSIDE_MARGIN,
  annotationLayout,
  annotationLayoutOutsideFrame,
  createAnnotationRecord,
  elbowPoints,
  leaderIntoCard,
  nearestPointOnRect,
  parseAnnotationRecord,
  resolveCardStacking,
  resolveOutsideSide,
  serialiseAnnotationRecord
} from '../core/annotation.js'
import {
  type Category,
  DEFAULT_CATEGORY_ID,
  contrastingTextColor,
  findCategory
} from '../core/category.js'
import { getCategories } from './categoryScene.js'
import { CHUNK_SIZE, yieldToMainThread } from './chunking.js'
import { findEnclosingFrame } from './frames.js'
import { removeOrphansByOwnerKey } from './orphans.js'
import { withSuppressedNodeChange, withSuppressedNodeChangeAsync } from './pluginData.js'

const ANNOTATION_KEY = 'annotation'
const OWNER_KEY = 'annotationOwner'
const ROLE_KEY = 'annotationRole'

type Role = 'badge' | 'card' | 'leader'

// Leader colour for an annotation with no category assigned.
const DEFAULT_ANNOTATION_COLOR = '#000000'
const CARD_FILL = '#FFFFFF'
const CARD_STROKE = '#E1E1E6'
const CARD_TEXT = '#1E1E24'
// Inter is Figma's own UI typeface — used for the category pill's label. It
// has no Thai glyphs at all, though, so the card's note text needs a font
// that actually covers Thai — see `resolveCardFont`.
const PILL_FONT: FontName = { family: 'Inter', style: 'Bold' }

/**
 * The note card's font, resolved once and cached for the rest of the
 * session. Noto Sans Thai is a looped ("มีหัว") Thai face available through
 * Figma's built-in Google Fonts — not something that has to be locally
 * installed — but plugins can't assume any specific font is actually
 * reachable, so this falls back rather than letting a failed
 * `loadFontAsync` take the whole annotation down with it.
 */
const CARD_FONT_CANDIDATES: ReadonlyArray<FontName> = [
  { family: 'Noto Sans Thai', style: 'Regular' },
  { family: 'Inter', style: 'Regular' }
]
let resolvedCardFont: Promise<FontName> | null = null

function resolveCardFont(): Promise<FontName> {
  resolvedCardFont ??= (async () => {
    for (const candidate of CARD_FONT_CANDIDATES) {
      try {
        await figma.loadFontAsync(candidate)
        return candidate
      } catch {
        continue
      }
    }
    const probe = figma.createText()
    const fallback = probe.fontName as FontName
    probe.remove()
    return fallback
  })()
  return resolvedCardFont
}
// Figma draws a top-level frame's name on the canvas, above the frame, in
// the file itself — not just in the layers panel. A card sitting beside the
// screen it annotates therefore came with a label floating over the artwork
// that nobody asked for and nobody can turn off, which is exactly the kind
// of clutter this plugin exists to avoid. A single space is a name Figma
// accepts and draws as nothing.
//
// The cost is the layers panel, where these now read as blank rows. Judged
// the better trade: the canvas is what everyone sees, all the time, and
// these nodes are locked and derived — there is very little reason to go
// hunting for one by name. The leader is a vector, whose name Figma never
// draws, so it keeps a useful one.
const CARD_LAYER_NAME = ' '
const LEADER_LAYER_NAME = 'Annotation leader'

const CARD_SHADOW: DropShadowEffect = {
  type: 'DROP_SHADOW',
  color: { r: 0, g: 0, b: 0, a: 0.16 },
  offset: { x: 0, y: 2 },
  radius: 8,
  spread: 0,
  visible: true,
  blendMode: 'NORMAL'
}

export function getAnnotationRecord(node: SceneNode): AnnotationRecord | null {
  return parseAnnotationRecord(node.getPluginData(ANNOTATION_KEY))
}

/**
 * Every annotated node inside `ancestor` (not `ancestor` itself).
 *
 * A moved node's own `x`/`y` only change when *it* moves directly — dragging
 * a frame changes the frame's x/y but not its children's, even though their
 * absolute position on canvas just moved too. Without this, an annotation
 * anchored to something nested inside a frame would silently stop
 * following the moment its parent (rather than itself) gets dragged.
 */
export function findAnnotationTargetsUnder(
  ancestor: SceneNode & ChildrenMixin
): ReadonlyArray<SceneNode> {
  return ancestor
    .findAllWithCriteria({ pluginData: { keys: [ANNOTATION_KEY] } })
    .filter((node) => getAnnotationRecord(node) !== null)
}

function writeAnnotationRecord(node: SceneNode, record: AnnotationRecord): void {
  withSuppressedNodeChange(() => {
    node.setPluginData(ANNOTATION_KEY, serialiseAnnotationRecord(record))
    // Lets a teammate right-click the node on canvas and reopen the plugin
    // straight into the editor for it, instead of hunting for it in the UI.
    node.setRelaunchData({ annotate: '' })
  })
}

function eraseAnnotationRecord(node: SceneNode): void {
  withSuppressedNodeChange(() => {
    node.setPluginData(ANNOTATION_KEY, '')
    node.setRelaunchData({})
  })
}

// A deleted node's pluginData is gone by the time `nodechange` reports the
// DELETE — Figma hands back only a `RemovedNode` (id/type/removed), nothing
// queryable. Without this, deleting a card or leader directly (both are
// real, selectable, unlocked-or-not nodes a person can click and hit
// Delete on) leaves the target's record and the other rendered node
// dangling, with nothing left able to trace back to who owned it — or, for
// the role, what kind of deletion just happened (see `lastKnownRoleOf`).
// Both are in-memory, session-only caches — reconciliation on open rebuilds
// everything from scratch anyway, so nothing is lost by not persisting them.
const ownerIdByRenderedNodeId = new Map<string, string>()
const roleByRenderedNodeId = new Map<string, Role>()

function tag(node: SceneNode, ownerId: string, role: Role): void {
  node.setPluginData(OWNER_KEY, ownerId)
  node.setPluginData(ROLE_KEY, role)
  ownerIdByRenderedNodeId.set(node.id, ownerId)
  roleByRenderedNodeId.set(node.id, role)
}

/**
 * The owner a now-deleted card or leader used to belong to, from the
 * cache `tag` maintains — `null` if `nodeId` was never one of ours, or we
 * simply don't remember it (a fresh plugin session that hasn't touched
 * this node yet). See `ownerIdByRenderedNodeId` for why this can't just
 * read the node's own pluginData instead.
 */
export function lastKnownOwnerOf(nodeId: string): string | null {
  return ownerIdByRenderedNodeId.get(nodeId) ?? null
}

/** The role a now-deleted card or leader used to have — see `lastKnownOwnerOf`. */
export function lastKnownRoleOf(nodeId: string): Role | null {
  return roleByRenderedNodeId.get(nodeId) ?? null
}

interface RenderedNodes {
  readonly badge: FrameNode | null
  readonly card: FrameNode | null
  readonly leader: VectorNode | null
}

/**
 * Removes every node found for a role when there's more than one, and
 * returns `null` so the caller creates a fresh one from scratch.
 *
 * Older, broken sync attempts (e.g. one that threw partway through, before
 * this file self-healed that class of bug) could leave a second badge/card/
 * leader tagged for the same owner. There's no reliable way to tell which of
 * several candidates is the "good" one — picking a winner risks keeping the
 * broken one and deleting the correct one — so when there's ambiguity, clear
 * the slate instead of guessing.
 */
function dedupe<T extends SceneNode>(nodes: ReadonlyArray<T>): T | null {
  if (nodes.length <= 1) return nodes[0] ?? null
  for (const node of nodes) {
    removeIfPresent(node)
  }
  return null
}

/**
 * Every rendered node on the page, grouped by the target it belongs to.
 *
 * One page scan for the whole reconcile, rather than `findRenderedNodes`'s
 * one per annotation. Opening the plugin reconciles the page, so on a file
 * with fifty notes that was fifty scans of everything before the panel
 * appeared — which is what "it takes a while to open" was.
 */
export function collectRenderedByOwner(): Map<string, RenderedNodes> {
  const badges = new Map<string, Array<FrameNode>>()
  const cards = new Map<string, Array<FrameNode>>()
  const leaders = new Map<string, Array<VectorNode>>()
  const push = <T>(into: Map<string, Array<T>>, ownerId: string, node: T): void => {
    const list = into.get(ownerId)
    if (typeof list === 'undefined') into.set(ownerId, [node])
    else list.push(node)
  }
  for (const node of figma.currentPage.findAllWithCriteria({ pluginData: { keys: [OWNER_KEY] } })) {
    const ownerId = node.getPluginData(OWNER_KEY)
    if (ownerId === '') continue
    const role = node.getPluginData(ROLE_KEY)
    if (role === 'badge' && node.type === 'FRAME') push(badges, ownerId, node)
    else if (role === 'card' && node.type === 'FRAME') push(cards, ownerId, node)
    else if (role === 'leader' && node.type === 'VECTOR') push(leaders, ownerId, node)
  }
  const byOwner = new Map<string, RenderedNodes>()
  for (const ownerId of new Set([...badges.keys(), ...cards.keys(), ...leaders.keys()])) {
    byOwner.set(ownerId, {
      badge: dedupe(badges.get(ownerId) ?? []),
      card: dedupe(cards.get(ownerId) ?? []),
      leader: dedupe(leaders.get(ownerId) ?? [])
    })
  }
  return byOwner
}

const NOTHING_RENDERED: RenderedNodes = { badge: null, card: null, leader: null }

function findRenderedNodes(ownerId: string): RenderedNodes {
  const owned = figma.currentPage.findAllWithCriteria({ pluginData: { keys: [OWNER_KEY] } })
  const badges: Array<FrameNode> = []
  const cards: Array<FrameNode> = []
  const leaders: Array<VectorNode> = []
  for (const node of owned) {
    if (node.getPluginData(OWNER_KEY) !== ownerId) continue
    const role = node.getPluginData(ROLE_KEY)
    if (role === 'badge' && node.type === 'FRAME') badges.push(node)
    else if (role === 'card' && node.type === 'FRAME') cards.push(node)
    else if (role === 'leader' && node.type === 'VECTOR') leaders.push(node)
  }
  return {
    badge: dedupe(badges),
    card: dedupe(cards),
    leader: dedupe(leaders)
  }
}

/** Same idea as `dedupe`, for a badge/card's own text child. */
function dedupeTextChild(parent: FrameNode): TextNode | undefined {
  const texts = parent.children.filter((child): child is TextNode => child.type === 'TEXT')
  if (texts.length <= 1) return texts[0]
  for (const text of texts) {
    removeIfPresent(text)
  }
  return undefined
}

function removeIfPresent(node: BaseNode | null): void {
  if (node !== null && !node.removed) {
    node.remove()
    // Harmless no-op for anything that was never in the cache (a text
    // child, say) — only card/leader ids are ever actually present.
    ownerIdByRenderedNodeId.delete(node.id)
    roleByRenderedNodeId.delete(node.id)
  }
}

export function ownerIdOf(node: SceneNode): string | null {
  const value = node.getPluginData(OWNER_KEY)
  return value === '' ? null : value
}

/**
 * The annotated layer each rendered node in `nodes` belongs to, keyed by the
 * rendered node's own id — `null` when `node` is not
 * one of ours, or its target is gone.
 *
 * Lets a selection of a card stand for a selection of the note it shows: the
 * record lives on the layer being annotated, so without this, someone who
 * has just dragged a card is holding the one thing the panel has nothing to
 * say about.
 *
 * Takes the whole selection rather than one node at a time, and answers all
 * of it from a single page scan. Called on every `selectionchange`, where
 * Select All on a page of annotations would otherwise scan once per card.
 * Scans at all — rather than taking each id to `getNodeByIdAsync` — so it can
 * stay synchronous, which that caller needs.
 */
export function annotationTargetsBehind(
  nodes: ReadonlyArray<SceneNode>
): Map<string, SceneNode> {
  const wanted = new Map<string, Array<string>>()
  for (const node of nodes) {
    const ownerId = ownerIdOf(node)
    if (ownerId === null) continue
    const asking = wanted.get(ownerId)
    if (typeof asking === 'undefined') wanted.set(ownerId, [node.id])
    else asking.push(node.id)
  }
  const resolved = new Map<string, SceneNode>()
  // Nothing rendered by us is selected, so there is nothing to look up and no
  // reason to scan — which is every ordinary selection.
  if (wanted.size === 0) return resolved
  for (const target of figma.currentPage.findAllWithCriteria({
    pluginData: { keys: [ANNOTATION_KEY] }
  })) {
    const asking = wanted.get(target.id)
    if (typeof asking === 'undefined') continue
    for (const id of asking) resolved.set(id, target)
  }
  return resolved
}

export function roleOf(node: SceneNode): Role | null {
  const value = node.getPluginData(ROLE_KEY)
  return value === 'badge' || value === 'card' || value === 'leader' ? value : null
}

/**
 * Removes whatever rendered nodes an owner has, regardless of its record.
 * Pass `known` when the caller already has a fresh `findRenderedNodes`
 * result for this owner (e.g. `reconcileAllAnnotations`'s loop, which reads
 * it once and would otherwise pay for the same full-page scan twice).
 */
export function removeRenderedNodesForOwner(ownerId: string, known?: RenderedNodes): void {
  const rendered = known ?? findRenderedNodes(ownerId)
  removeIfPresent(rendered.badge)
  removeIfPresent(rendered.card)
  removeIfPresent(rendered.leader)
}

/** Deletes rendered nodes whose owner is not in `liveTargetIds`. Returns the count removed. */
export function removeOrphanRenderedNodes(liveTargetIds: ReadonlySet<string>): number {
  return removeOrphansByOwnerKey(OWNER_KEY, liveTargetIds)
}

interface Card {
  readonly card: FrameNode
  readonly text: TextNode
}

const CATEGORY_PILL_KEY = 'annotationCategoryPill'

/**
 * The category pill — name on a solid colour chip, sitting above the note
 * text — the same idea as Figma's own category label. Kept as the card's
 * first child (inserted, not appended) so it always reads above the text
 * regardless of which one was created first.
 */
async function ensureCategoryPill(
  card: FrameNode,
  category: Category | null,
  metrics: CardMetrics
): Promise<void> {
  const existingPill = card.children.find(
    (child): child is FrameNode =>
      child.type === 'FRAME' && child.getPluginData(CATEGORY_PILL_KEY) === 'true'
  )
  if (category === null) {
    if (typeof existingPill !== 'undefined') existingPill.remove()
    return
  }
  const pill = existingPill ?? figma.createFrame()
  if (typeof existingPill === 'undefined') {
    pill.layoutMode = 'HORIZONTAL'
    pill.primaryAxisSizingMode = 'AUTO'
    pill.counterAxisSizingMode = 'AUTO'
    pill.cornerRadius = 999
    pill.setPluginData(CATEGORY_PILL_KEY, 'true')
    card.insertChild(0, pill)
  }
  // Padding derived from the pill's own type size rather than fixed, so the
  // pill keeps its shape at every card size instead of turning into a thin
  // capsule around big text. Reasserted every sync so a size change redraws
  // pills that already exist.
  pill.paddingLeft = Math.round(metrics.categoryFontSize * 0.8)
  pill.paddingRight = pill.paddingLeft
  pill.paddingTop = Math.round(metrics.categoryFontSize * 0.3)
  pill.paddingBottom = pill.paddingTop
  pill.name = 'Category'
  pill.fills = [figma.util.solidPaint(category.color)]
  let label = pill.children.find((child): child is TextNode => child.type === 'TEXT')
  if (typeof label === 'undefined') {
    label = figma.createText()
    await figma.loadFontAsync(PILL_FONT)
    label.fontName = PILL_FONT
    pill.appendChild(label)
  }
  // Loaded before the write, not only when creating the node: writing
  // `fontSize` touches the font the label already has, and an existing pill's
  // font is not loaded just because the pill exists. Same rule as the card's
  // text below.
  await figma.loadFontAsync(PILL_FONT)
  label.fontSize = metrics.categoryFontSize
  if (label.characters !== category.name) {
    label.characters = category.name
  }
  // Belt as well as braces. The floor above keeps a card wide enough for its
  // own pill at a sensible category name, but a long enough name overflows
  // any width — and a pill hanging out past the card reads as broken rather
  // than as a long name. Capped at what the card can hold, so it truncates
  // instead.
  const room = card.width - metrics.paddingX * 2 - Math.round(metrics.categoryFontSize * 1.6)
  if (room > 0 && label.width > room) {
    label.textAutoResize = 'HEIGHT'
    label.resize(room, label.height)
  }
  // Reasserted every sync, not just on creation — a recolour needs the
  // label to flip between black and white right along with it, and this is
  // cheap enough that a pill created before this fix self-heals too.
  label.fills = [figma.util.solidPaint(contrastingTextColor(category.color))]
}

async function ensureCard(
  existing: FrameNode | null,
  ownerId: string,
  width: number,
  category: Category | null,
  metrics: CardMetrics
): Promise<Card> {
  const card = existing ?? figma.createFrame()
  card.name = CARD_LAYER_NAME
  card.layoutMode = 'VERTICAL'
  card.primaryAxisSizingMode = 'AUTO'
  card.counterAxisSizingMode = 'FIXED'
  // Reasserted every sync rather than only on creation, so changing an
  // existing annotation's size redraws it instead of only affecting the next
  // one — same reasoning as the font and category colour below.
  card.paddingLeft = metrics.paddingX
  card.paddingRight = metrics.paddingX
  card.paddingTop = metrics.paddingY
  card.paddingBottom = metrics.paddingY
  card.itemSpacing = metrics.itemSpacing
  card.cornerRadius = metrics.cornerRadius
  card.fills = [figma.util.solidPaint(CARD_FILL)]
  card.strokes = [figma.util.solidPaint(CARD_STROKE)]
  card.strokeWeight = 1
  card.effects = [CARD_SHADOW]
  // Draggable on purpose — see `updateCardFromDrag`. Badge and leader
  // stay locked because their position is fully derived; the card's is a
  // record-backed preference a person can nudge.
  tag(card, ownerId, 'card')
  let text = dedupeTextChild(card)
  if (typeof text === 'undefined') {
    text = figma.createText()
    card.appendChild(text)
    // `fontName` must be loaded and assigned *before* any other text
    // property write on a brand-new node: its current font (Figma's own
    // default, "Inter Regular") is not loaded just because the node
    // exists, and writing `fontSize`/`lineHeight`/`fills` first throws
    // "Cannot write to node with unloaded font" since those still touch
    // the not-yet-reassigned current font. `fontName` is the one property
    // that only needs the *new* font loaded, not the old one.
    text.fontName = await resolveCardFont()
    text.lineHeight = { value: 150, unit: 'PERCENT' }
    text.fills = [figma.util.solidPaint(CARD_TEXT)]
  }
  // Reasserted every sync, not just on creation: a card whose text node was
  // created before this fix existed would otherwise stay broken forever —
  // this is also what was still leaving Thai text in a loopless fallback
  // font: the font was only ever applied on first creation, so every
  // already-existing card kept whatever it started with.
  text.fontName = await resolveCardFont()
  // After the reassignment above, never before it. Writing `fontSize` first
  // touches whatever font the node is *currently* set to, which for a card
  // written earlier is a Thai face this sync has not loaded — and Figma
  // refuses the write with "Cannot write to node with unloaded font". The
  // same rule the comment above spells out for a brand-new node applies to
  // an existing one whose font is about to be replaced.
  text.fontSize = metrics.fontSize
  text.textAutoResize = 'HEIGHT'
  // Sized explicitly first, and this order is the whole trick to making a
  // card narrower: auto-layout will not shrink a frame past a fixed-width
  // child, so resizing the card first left it propped open at the old width
  // by text that had not moved yet — overflowing whatever it sat beside,
  // including out past the edge of a section.
  text.layoutSizingHorizontal = 'FIXED'
  text.resize(width - metrics.paddingX * 2, text.height)
  card.resize(width, card.height)
  // Then handed to auto-layout to keep. An earlier attempt at `FILL` alone
  // was abandoned because the text stayed at the sliver of a width it was
  // created at — but that was `FILL` on a card whose own width had not been
  // set yet, so there was nothing to fill. Set last, with both widths
  // already right, it holds: and it is what makes the text follow *during* a
  // drag, when no sync has run yet and nothing else is there to reflow it.
  text.layoutSizingHorizontal = 'FILL'
  await ensureCategoryPill(card, category, metrics)
  return { card, text }
}

function ensureLeader(existing: VectorNode | null, ownerId: string, color: string): VectorNode {
  const leader = existing ?? figma.createVector()
  leader.name = 'Annotation leader'
  leader.strokes = [figma.util.solidPaint(color)]
  leader.strokeWeight = 1.5
  // A near-zero dash length plus a round cap is the standard way to draw a
  // fine dotted line rather than short dashes — the round cap balloons each
  // near-zero-length dash into a small circle. There's no separate "dash cap"
  // in the plugin API (Figma's own Stroke panel splits dash cap from end-of-
  // path cap; the API exposes only the latter, `strokeCap`, which happens to
  // still round every dash segment along the way, not just the two true ends).
  leader.dashPattern = [0.5, 5]
  leader.strokeCap = 'ROUND'
  leader.locked = true
  tag(leader, ownerId, 'leader')
  return leader
}

/** Turns a leader polyline (2 points straight, 3 points elbowed) into a positioned vector network. */
function polylineNetwork(points: ReadonlyArray<Point>): {
  x: number
  y: number
  vectorNetwork: VectorNetwork
} {
  const originX = Math.min(...points.map((point) => point.x))
  const originY = Math.min(...points.map((point) => point.y))
  return {
    x: originX,
    y: originY,
    vectorNetwork: {
      vertices: points.map((point) => ({ x: point.x - originX, y: point.y - originY })),
      segments: points.slice(1).map((_point, index) => ({ start: index, end: index + 1 })),
      regions: []
    }
  }
}

/**
 * Retargets an outside-frame leader's card-side endpoint at the card's
 * actual vertical centre — its x (which edge, left or right) is kept as
 * already routed; only the y, previously a fixed guess made before the
 * card's real height was known, gets corrected.
 */
function leaderToCardCenter(points: ReadonlyArray<Point>, card: FrameNode): ReadonlyArray<Point> {
  const from = points[0]
  const cardEdge = points[points.length - 1]
  if (typeof from === 'undefined' || typeof cardEdge === 'undefined') return points
  return leaderIntoCard(from, { x: cardEdge.x, y: card.y + card.height / 2 })
}

/**
 * The near-target layout's leader-to-card counterpart to
 * `leaderToCardCenter`: aims at whichever point on the card's own box is
 * actually closest to `from`, since a near-target card can sit in any
 * direction from its badge (there's no fixed left/right side the way the
 * outside-frame layout has to route around).
 */
function leaderToCardBoundary(from: Point, card: FrameNode): ReadonlyArray<Point> | null {
  const boundary = nearestPointOnRect(
    { x: card.x, y: card.y, width: card.width, height: card.height },
    from
  )
  return elbowPoints(from, boundary)
}

async function positionLeader(leader: VectorNode, points: ReadonlyArray<Point>): Promise<void> {
  const { x, y, vectorNetwork } = polylineNetwork(points)
  leader.x = x
  leader.y = y
  await leader.setVectorNetworkAsync(vectorNetwork)
}

function verticallyOverlaps(a: Rect, b: Rect): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height
}

// Symmetric with OUTSIDE_MARGIN (core): 20px clear of the frame being
// annotated, 20px clear of whatever frame is next door — so a 160px gap
// between two frames lands the card at exactly its 120px floor width with
// no bleed on either side.
const NEIGHBOR_SAFETY_GAP = 20

/**
 * How far it is from `ownFrame`'s edge on `side` to the nearest other frame
 * that a card routed that way could run into — screens placed close together
 * in a flow, say. `Infinity` when nothing is in the way, so the card is free
 * to use its ideal width.
 *
 * Looks inside groups and sections for the same reason `collectRouteObstacles`
 * does: putting a flow in a section is how people tidy up, and it must not
 * quietly change what the plugin can see. Reading only the page's own
 * children meant a card beside a screen in a section believed it had the
 * whole canvas to itself.
 */
function nearestNeighborGap(ownFrame: Rect, side: 'LEFT' | 'RIGHT', ownFrameId: string): number {
  let nearest = Number.POSITIVE_INFINITY
  const visit = (nodes: ReadonlyArray<SceneNode>): void => {
    for (const node of nodes) {
      if (!node.visible) continue
      if (NEIGHBOR_CONTAINERS.has(node.type) && 'children' in node) {
        visit(node.children)
        continue
      }
      if (node.type !== 'FRAME' || node.id === ownFrameId) continue
      const rect = node.absoluteBoundingBox
      if (rect === null || !verticallyOverlaps(ownFrame, rect)) continue
      const gap =
        side === 'RIGHT' ? rect.x - (ownFrame.x + ownFrame.width) : ownFrame.x - (rect.x + rect.width)
      if (gap >= 0 && gap < nearest) nearest = gap
    }
  }
  visit(figma.currentPage.children)
  return nearest
}

/** Containers holding screens rather than being one — mirrors `OBSTACLE_CONTAINERS` in `connectorScene`. */
const NEIGHBOR_CONTAINERS: ReadonlySet<string> = new Set(['GROUP', 'SECTION'])

interface ResolvedLayout {
  readonly layout: AnnotationLayout
  readonly cardWidth: number
  /** `null` when the target isn't inside a frame, so the card sits next to it instead of routed outside. */
  readonly side: 'LEFT' | 'RIGHT' | null
}

/**
 * Card placement outside the enclosing frame keeps it from covering the UI
 * it's annotating (see conversation: the near-target placement was landing
 * on top of real content). Falls back to the near-target placement when the
 * target isn't inside a frame at all.
 *
 * The card's width shrinks — down to `MIN_OUTSIDE_CARD_WIDTH` — when a
 * neighbouring frame doesn't leave enough room for the default width, so it
 * never bleeds into whatever is sitting next door.
 */
function computeLayout(target: SceneNode, rect: Rect, record: AnnotationRecord): ResolvedLayout {
  // A width dragged by hand wins over the size preset's, but only over that
  // — the type, padding and radius still come from the size. Dragging widens
  // the column the words flow in; it does not scale the card.
  const preset = metricsForSize(record.size)
  const metrics: CardMetrics =
    record.cardWidth === null ? preset : { ...preset, cardWidth: record.cardWidth }
  const frame = findEnclosingFrame(target)
  const frameRect = frame?.absoluteBoundingBox ?? null
  if (frame === null || frameRect === null) {
    return { layout: annotationLayout(rect, record, metrics), cardWidth: metrics.cardWidth, side: null }
  }

  const side = resolveOutsideSide(rect, frameRect)
  // Shrink-to-fit applies to a width this plugin chose, not to one a person
  // dragged. Someone dragging an edge can see the gap they are dragging into
  // and has decided; pulling the card back from under them means the drag
  // simply does not work wherever a neighbour happens to be close, which is
  // most of a real file.
  const cardWidth = record.cardWidth !== null ? record.cardWidth : shrinkToFit(metrics, frameRect, side, frame.id)

  const layout = annotationLayoutOutsideFrame(rect, frameRect, record, {
    ...metrics,
    cardWidth
  })
  return { layout, cardWidth, side }
}

/**
 * The plugin's own choice of width, narrowed so the card never bleeds into
 * the screen next door — down to `MIN_OUTSIDE_CARD_WIDTH`, or to the card's
 * own width when that is already narrower (a Small card must not be widened
 * back out by the floor).
 */
function shrinkToFit(
  metrics: CardMetrics,
  frameRect: Rect,
  side: 'LEFT' | 'RIGHT',
  ownFrameId: string
): number {
  const gap = nearestNeighborGap(frameRect, side, ownFrameId)
  if (!Number.isFinite(gap)) return metrics.cardWidth
  return Math.max(
    floorFor(metrics),
    Math.min(metrics.cardWidth, gap - OUTSIDE_MARGIN - NEIGHBOR_SAFETY_GAP)
  )
}

/**
 * How narrow this size is allowed to be squeezed.
 *
 * `MIN_OUTSIDE_CARD_WIDTH` was tuned when every card was one width, and it
 * squeezes a Large card down to a Medium one — at which point its type and
 * its category pill, still sized for Large, no longer fit and the pill runs
 * out past the edge. Reported exactly that way.
 *
 * So the floor is proportional as well as absolute: never below the tuned
 * minimum, never below three quarters of what this size asks for, and never
 * above the size's own width (a Small card is already narrower than the
 * minimum and must not be widened by it). Medium and Small come out exactly
 * where they always did; only Large stops short of where it used to go.
 */
function floorFor(metrics: CardMetrics): number {
  return Math.min(metrics.cardWidth, Math.max(MIN_OUTSIDE_CARD_WIDTH, metrics.cardWidth * 0.75))
}

// `ensureBadge`/`ensureCard` each have an `await` (font loading) between
// checking whether their text child exists and appending one. Our own
// writes just before that await — `resize()`, `appendChild()` — fire
// `nodechange` events that this plugin listens to, so a second `syncAnnotation`
// for the *same target* could start while the first is still paused at that
// await, and both would see "no text child yet" and each append their own —
// hence duplicate text nodes with no error anywhere. This map coalesces
// concurrent calls for the same target into the one already in flight.
const inFlightSyncs = new Map<string, Promise<void>>()

/**
 * Targets whose record changed while a sync for them was already running.
 *
 * Coalescing has to stop two syncs *overlapping*, but the first version of
 * it also threw the second one away — and a drag delivers a change per
 * frame, so whenever the last one landed mid-render, the width the person
 * finished on was never drawn. The card stopped wherever the previous frame
 * had left it, which is exactly the "sometimes it works" a resize was
 * reported with. Running once more after the first finishes is not an
 * overlap, so it costs nothing the coalescing was protecting.
 */
const staleAfterSync = new Set<string>()

/**
 * Renders (or updates) the annotation for one target node from its record.
 * Pass `known` when the caller already has a fresh `findRenderedNodes`
 * result for this target (see `removeRenderedNodesForOwner`'s `known` for
 * the same reasoning) — ignored if a sync for this target is already in
 * flight, since that one already committed to whatever it read.
 */
export async function syncAnnotation(target: SceneNode, known?: RenderedNodes): Promise<void> {
  const inFlight = inFlightSyncs.get(target.id)
  if (typeof inFlight !== 'undefined') {
    staleAfterSync.add(target.id)
    await inFlight
    // Whoever removes the flag runs the follow-up, so several callers
    // waiting on the same sync produce one re-render between them rather
    // than one each. `known` is deliberately dropped: it was read before
    // the wait and is exactly what is now out of date.
    if (staleAfterSync.delete(target.id)) await syncAnnotation(target)
    return
  }
  staleAfterSync.delete(target.id)
  const promise = syncAnnotationExclusive(target, known)
  inFlightSyncs.set(target.id, promise)
  try {
    await promise
  } finally {
    inFlightSyncs.delete(target.id)
  }
}

async function syncAnnotationExclusive(target: SceneNode, known?: RenderedNodes): Promise<void> {
  const record = getAnnotationRecord(target)
  const rendered = known ?? findRenderedNodes(target.id)
  if (record === null) {
    removeIfPresent(rendered.badge)
    removeIfPresent(rendered.card)
    removeIfPresent(rendered.leader)
    return
  }

  const rect: Rect | null = target.absoluteBoundingBox
  if (rect === null) return

  // Every write below — position, resize, vector network — is itself a
  // property change our own `nodechange` listener sees. Left unsuppressed,
  // positioning the card here looks identical to a person dragging it, and
  // gets fed back into `updateCardOffsetFromDrag`, which can then overwrite
  // the record with an offset read mid-write — corrupted, sometimes wildly
  // off-canvas, positions with no error anywhere.
  const category = findCategory(getCategories(), record.categoryId)
  const color = category?.color ?? DEFAULT_ANNOTATION_COLOR

  try {
    await syncAnnotationBody(target, rect, record, rendered, category, color)
  } catch (error) {
    // A throw partway through leaves whatever ran before it half-applied —
    // a card created but never positioned, say — and used to vanish into
    // the console no one but a developer would ever open. Surfacing it is
    // strictly better than a silently broken annotation with no visible
    // explanation.
    figma.notify(`Couldn't update the annotation on "${target.name}": ${String(error)}`, {
      error: true
    })
    throw error
  }
}

async function syncAnnotationBody(
  target: SceneNode,
  rect: Rect,
  record: AnnotationRecord,
  rendered: RenderedNodes,
  category: Category | null,
  color: string
): Promise<void> {
  await withSuppressedNodeChangeAsync(async () => {
    // Reparent to the page *before* touching anything else. Every x/y
    // write below is a page-absolute coordinate — but the card is
    // deliberately draggable, and Figma auto-reparents any node dropped
    // onto a frame into that frame. If that happened since the last sync,
    // the card's x/y would already mean "relative to that frame" the
    // moment we write them, sending it flying off to the wrong spot (and
    // an auto-layout frame it lands in can also force its size, hiding
    // the text). Reparenting first makes every write below mean what it's
    // supposed to, regardless of where the node drifted to on canvas.
    if (rendered.card !== null) figma.currentPage.appendChild(rendered.card)
    if (rendered.leader !== null) figma.currentPage.appendChild(rendered.leader)
    // The dot marker used to sit at the target's edge — dropped, since a
    // leader line already shows what's being annotated without one more
    // node cluttering the canvas. Sweeps away any left over from before
    // this changed, rather than stranding them.
    removeIfPresent(rendered.badge)

    const resolved = computeLayout(target, rect, record)
    const { layout } = resolved

    const { card, text } = await ensureCard(
      rendered.card,
      target.id,
      resolved.cardWidth,
      category,
      metricsForSize(record.size)
    )
    card.name = CARD_LAYER_NAME
    card.x = layout.cardTopLeft.x
    card.y = layout.cardTopLeft.y
    if (text.characters !== record.text) {
      await figma.loadFontAsync(text.fontName as FontName)
      text.characters = record.text
    }

    if (layout.leader === null) {
      removeIfPresent(rendered.leader)
    } else {
      // `layout.leader`'s card-side endpoint was computed before the card's
      // real height (and, for the near-target layout, the card's actual
      // position) was known. Now that `card` is real, retarget the leader
      // at wherever the card's own boundary actually ends up: the vertical
      // centre of its facing edge for the outside-frame layout (which
      // always approaches from a known left/right side), or the closest
      // point on the card's box for the near-target layout (whose card can
      // sit in any direction, not just left/right).
      const points =
        resolved.side === null
          ? leaderToCardBoundary(layout.leader[0] ?? layout.badgeCenter, card)
          : leaderToCardCenter(layout.leader, card)
      // `leaderToCardBoundary` returns `null` when the target's edge and
      // the card's own boundary land on the exact same point — a genuine
      // zero-length line, not a bug to paper over. Falling back to
      // `layout.leader` there used to show a stale placeholder line headed
      // toward where the badge used to be, nowhere near the card's actual
      // position — worse than just not drawing a leader for that one sync.
      if (points === null) {
        removeIfPresent(rendered.leader)
      } else {
        const leader = ensureLeader(rendered.leader, target.id, color)
        leader.name = LEADER_LAYER_NAME
        await positionLeader(leader, points)
      }
    }

    // Re-parenting to the same page moves a node to the front of the
    // stacking order. Done last so the card's solid face reads as covering
    // the leader's endpoint, not a dashed line cutting across its corner.
    figma.currentPage.appendChild(card)
  })
}

// Wider than the strictly-needed clearance between two card bodies — Figma
// floats each layer's name above it when zoomed out, and a tighter gap left
// that label overlapping the card above it.
const CARD_STACK_GAP = 28

// How much further out each leader after the first in a shared margin gets
// pushed, via `leaderIntoCard`'s `laneOffset` — see there for why every
// leader on the same side needs a distinct one instead of 0.
const LEADER_LANE_GAP = 8

interface StackItem {
  readonly ownerId: string
  readonly card: FrameNode
  readonly leader: VectorNode | null
  readonly edgeStart: Point
  readonly nearEdgeX: number
  readonly naturalTop: number
}

/**
 * Pushes overlapping "outside frame" cards apart vertically (see
 * `resolveCardStacking`) and re-routes each affected leader to point at
 * wherever its card actually ended up.
 *
 * Cards placed near their own target (no enclosing frame) are left alone —
 * only cards sharing a margin, where one annotation's height can crowd the
 * next one's natural position, need this.
 */
export async function applyCardStacking(): Promise<void> {
  const owned = figma.currentPage.findAllWithCriteria({ pluginData: { keys: [OWNER_KEY] } })
  const cardsByOwner = new Map<string, FrameNode>()
  const leadersByOwner = new Map<string, VectorNode>()
  for (const node of owned) {
    const ownerId = node.getPluginData(OWNER_KEY)
    if (ownerId === '') continue
    const role = node.getPluginData(ROLE_KEY)
    if (role === 'card' && node.type === 'FRAME') cardsByOwner.set(ownerId, node)
    else if (role === 'leader' && node.type === 'VECTOR') leadersByOwner.set(ownerId, node)
  }

  const groups = new Map<'LEFT' | 'RIGHT', Array<StackItem>>()
  let prepared = 0
  for (const [ownerId, card] of cardsByOwner) {
    const target = await figma.getNodeByIdAsync(ownerId)
    prepared += 1
    if (prepared % CHUNK_SIZE === 0) await yieldToMainThread()
    if (target === null || !('absoluteBoundingBox' in target)) continue
    const rect = target.absoluteBoundingBox
    if (rect === null) continue
    const record = getAnnotationRecord(target)
    if (record === null) continue

    const resolved = computeLayout(target, rect, record)
    if (resolved.side === null) continue

    const edgeStart = resolved.layout.leader?.[0] ?? resolved.layout.badgeCenter
    const nearEdgeX =
      resolved.side === 'RIGHT'
        ? resolved.layout.cardTopLeft.x
        : resolved.layout.cardTopLeft.x + resolved.cardWidth

    const list = groups.get(resolved.side) ?? []
    list.push({ ownerId, card, leader: leadersByOwner.get(ownerId) ?? null, edgeStart, nearEdgeX, naturalTop: resolved.layout.cardTopLeft.y })
    groups.set(resolved.side, list)
  }

  let processed = 0
  let failures = 0
  for (const list of groups.values()) {
    const stacked = resolveCardStacking(
      list.map((item) => ({ id: item.ownerId, top: item.naturalTop, height: item.card.height })),
      CARD_STACK_GAP
    )
    // Every leader in this group shares the same `nearEdgeX` (`to.x` below),
    // so with no offset their vertical runs would too — sort top to bottom
    // and give each one after the first a bit more lane, so overlapping
    // spans fan out instead of merging into one line. The first item still
    // gets 0 (no unearned bend for the common single-annotation case).
    const laneOffsetById = new Map<string, number>(
      [...list]
        .sort((a, b) => a.edgeStart.y - b.edgeStart.y)
        .map((item, index) => [item.ownerId, index * LEADER_LANE_GAP])
    )
    for (const item of list) {
      const top = stacked.get(item.ownerId)
      // A card (or its leader) can vanish between the read pass above and
      // here — deleted mid-batch by whatever else is touching the canvas.
      // Skipping it here, instead of writing to a removed node and letting
      // that throw, is what keeps one gone card from also stalling every
      // other card still waiting in this same pass.
      if (typeof top !== 'number' || item.card.removed) continue
      try {
        // Suppressed per card, not for the whole batch — moving a card to
        // avoid overlap must not look like a person dragging it, but one
        // suppression window spanning every annotation on the page would
        // also drop genuine unrelated edits for as long as this ran.
        await withSuppressedNodeChangeAsync(async () => {
          // Same reparent-before-position reasoning as `syncAnnotationExclusive`
          // — the card may have drifted into another frame since the last sync.
          figma.currentPage.appendChild(item.card)
          item.card.y = top
          if (item.leader === null || item.leader.removed) return
          figma.currentPage.appendChild(item.leader)

          // Vertical centre of the card, same as the initial sync — not the
          // fixed top-of-card inset `CARD_LEADER_INSET` still used as this
          // module's own before-the-real-height starting guess.
          const to: Point = { x: item.nearEdgeX, y: top + item.card.height / 2 }
          // Straight out from the target, docking into the card with a
          // short, clearly perpendicular final stub — see `leaderIntoCard`
          // — with each item's own lane offset keeping several leaders
          // sharing this margin from merging into one line.
          const laneOffset = laneOffsetById.get(item.ownerId) ?? 0
          await positionLeader(
            item.leader,
            leaderIntoCard(item.edgeStart, to, CARD_APPROACH_STUB, laneOffset)
          )
        })
      } catch (error) {
        failures += 1
        console.error(error)
      }
      processed += 1
      if (processed % CHUNK_SIZE === 0) await yieldToMainThread()
    }
  }
  if (failures > 0) {
    // One summary notification, not one per card — a whole frame's worth
    // of annotations disappearing at once shouldn't spam the same message.
    figma.notify(
      `Couldn't lay out ${failures} annotation card${failures === 1 ? '' : 's'} — try re-syncing.`,
      { error: true }
    )
  }
}

/** Everything that needs to run after a batch of annotation changes settles. */
export async function finalizeLayout(): Promise<void> {
  await applyCardStacking()
}

/**
 * Removes the rendered nodes and the record for one target. Doesn't call
 * `finalizeLayout` itself — callers batching several of these in one user
 * action (`resyncTouched`'s delete loop) call it once after the whole
 * batch instead of paying for a full-page stacking pass per target.
 */
export function clearAnnotation(target: SceneNode): void {
  removeRenderedNodesForOwner(target.id)
  eraseAnnotationRecord(target)
}

/** Sets or replaces the note text for a target, creating the record if needed. */
export async function setAnnotationText(target: SceneNode, text: string): Promise<void> {
  const trimmed = text.trim()
  if (trimmed === '') {
    clearAnnotation(target)
    await finalizeLayout()
    return
  }
  const existing = getAnnotationRecord(target)
  // A brand-new annotation defaults to the Note category rather than none —
  // `createAnnotationRecord` itself stays opinion-free (`categoryId: null`);
  // this is where category policy actually lives, alongside the rest of the
  // category lookups this module already does.
  const record: AnnotationRecord =
    existing === null
      ? { ...createAnnotationRecord(trimmed), categoryId: DEFAULT_CATEGORY_ID }
      : { ...existing, text: trimmed }
  writeAnnotationRecord(target, record)
  await syncAnnotation(target)
  await finalizeLayout()
}

/**
 * Sets or clears a target's category, creating the record (with empty note
 * text) if it doesn't exist yet — the category picker is usable before
 * anyone's typed a note, same as the text field is usable before anyone's
 * picked a category. Picking a category first used to silently no-op,
 * since nothing else in the UI requires text before category.
 */
export async function setAnnotationCategory(target: SceneNode, categoryId: string | null): Promise<void> {
  const existing = getAnnotationRecord(target)
  const record: AnnotationRecord =
    existing === null ? { ...createAnnotationRecord(''), categoryId } : { ...existing, categoryId }
  writeAnnotationRecord(target, record)
  await syncAnnotation(target)
  await finalizeLayout()
}

/**
 * Changes how big an annotation's card is drawn. Every visual the size
 * decides is reasserted on sync, so this redraws the card in place rather
 * than only affecting annotations made afterwards.
 */
export async function setAnnotationSize(target: SceneNode, size: AnnotationSize): Promise<void> {
  const existing = getAnnotationRecord(target)
  if (existing === null) return
  // Picking a size clears a width dragged by hand. Someone reaching for the
  // preset is asking for the card that preset describes — and it doubles as
  // the way back from a width they dragged and no longer want, which there
  // is otherwise no control for.
  writeAnnotationRecord(target, { ...existing, size, cardWidth: null })
  await syncAnnotation(target)
  await finalizeLayout()
}

const CARD_OFFSET_EPSILON = 0.5

/**
 * Captures a manual drag of the card as the record's new offset preference,
 * then re-syncs so the badge/leader catch up to wherever the card landed.
 */
export async function updateCardFromDrag(target: SceneNode): Promise<void> {
  const record = getAnnotationRecord(target)
  if (record === null) return
  const rendered = findRenderedNodes(target.id)
  if (rendered.card === null) return
  const rect = target.absoluteBoundingBox
  if (rect === null) return

  // `.x`/`.y` are relative to whatever the card's *current* parent is — and
  // the drag that triggered this call may well have dropped the card onto a
  // frame, which Figma auto-reparents it into. Reading `.x`/`.y` there would
  // capture a frame-relative number as if it were page-absolute, and that
  // garbage offset gets written straight into the record below — not a
  // one-off glitch, a permanently corrupted position. `absoluteBoundingBox`
  // is immune to whatever the parent currently is.
  const cardBox = rendered.card.absoluteBoundingBox
  if (cardBox === null) return

  const before = computeLayout(target, rect, record)
  const newOffset: Point = {
    x: cardBox.x - before.layout.badgeCenter.x,
    y: cardBox.y - before.layout.badgeCenter.y
  }
  const movedBy =
    Math.abs(newOffset.x - record.cardOffset.x) >= CARD_OFFSET_EPSILON ||
    Math.abs(newOffset.y - record.cardOffset.y) >= CARD_OFFSET_EPSILON

  // Compared against the width this sync *drew*, not the width in the
  // record. They differ whenever a card was shrunk to fit a narrow gap, and
  // measuring against the record would then read our own shrinking back as
  // if the person had dragged the card narrower — quietly overwriting the
  // width they actually chose the first time the card passed a tight spot.
  const widthNow = cardBox.width
  const resized = Math.abs(widthNow - before.cardWidth) >= CARD_OFFSET_EPSILON
  if (!movedBy && !resized) return

  writeAnnotationRecord(target, {
    ...record,
    side: movedBy ? 'AUTO' : record.side,
    cardOffset: movedBy ? newOffset : record.cardOffset,
    cardWidth: resized ? widthNow : record.cardWidth
  })
  await syncAnnotation(target)
  await finalizeLayout()
}

/**
 * Takes text typed straight into a card on the canvas and makes it the
 * note's own text.
 *
 * The card is a rendering of the record, so without this a person who
 * double-clicks and types watches their words survive until the next sync
 * and then vanish — worse than not being able to type at all. Reading the
 * edit back is the same move already made for a dragged position and a
 * dragged width: what somebody did by hand becomes the stored intent.
 *
 * `false` when `text` is not a card's own text node — the category pill's
 * label lives one level deeper and is not the note.
 */
export async function captureCardTextEdit(text: TextNode): Promise<boolean> {
  const card = text.parent
  if (card === null || card.type !== 'FRAME' || roleOf(card) !== 'card') return false
  const ownerId = ownerIdOf(card)
  if (ownerId === null) return false
  const target = figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [ANNOTATION_KEY] } })
    .find((candidate) => candidate.id === ownerId)
  if (typeof target === 'undefined') return false
  const record = getAnnotationRecord(target)
  if (record === null || record.text === text.characters) return false
  // Emptying the card is deleting the note, exactly as emptying the field in
  // the panel is (`setAnnotationText`). Without this the two ways of editing
  // the same words disagree about what erasing them means, and the canvas
  // keeps an empty card that nothing offers to remove.
  if (text.characters.trim() === '') {
    clearAnnotation(target)
    await finalizeLayout()
    return true
  }
  writeAnnotationRecord(target, { ...record, text: text.characters })
  await syncAnnotation(target)
  await finalizeLayout()
  return true
}

/** Re-renders every annotation on the current page and sweeps orphaned nodes. */
export async function reconcileAllAnnotations(): Promise<{
  synced: number
  orphansRemoved: number
}> {
  const targets = figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [ANNOTATION_KEY] } })
    .filter((node) => getAnnotationRecord(node) !== null)

  // One scan for the whole page, handed to each target below — see
  // `collectRenderedByOwner`.
  const renderedByOwner = collectRenderedByOwner()

  let synced = 0
  for (const target of targets) {
    const rendered = renderedByOwner.get(target.id) ?? NOTHING_RENDERED
    if (rendered.card === null) {
      // The card is gone — same "this counts as a delete" rule the live
      // in-session path uses (`resyncTouched` treats losing the card,
      // specifically, as the person deleting the annotation; losing just
      // the leader is treated as damage to repair, not intent). A record
      // can only reach this state by someone deleting the card directly
      // while the plugin wasn't open to catch it live — every path that
      // *writes* a record also renders it in the same call
      // (`setAnnotationText`/`setAnnotationCategory`), so a full reconcile
      // never otherwise finds a record whose card was never rendered yet.
      // Recreating it here would be exactly the resurrection bug this was
      // built to fix. A leftover leader (or a retired badge from an older
      // file) has nothing left to point at either, so it's swept along
      // with the record instead of orphaned on the canvas forever — nothing
      // else ever will, since the orphan sweep below only looks at whether
      // the *target* node is still alive, not whether it still has a record.
      removeRenderedNodesForOwner(target.id, rendered)
      eraseAnnotationRecord(target)
    } else {
      await syncAnnotation(target, rendered)
    }
    synced += 1
    if (synced % CHUNK_SIZE === 0) await yieldToMainThread()
  }

  const orphansRemoved = removeOrphanRenderedNodes(new Set(targets.map((node) => node.id)))
  await finalizeLayout()
  return { synced, orphansRemoved }
}
