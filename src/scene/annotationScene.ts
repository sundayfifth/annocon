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
  DEFAULT_METRICS,
  MIN_OUTSIDE_CARD_WIDTH,
  OUTSIDE_MARGIN,
  annotationLayout,
  annotationLayoutOutsideFrame,
  createAnnotationRecord,
  elbowPoints,
  laneElbowPoints,
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
import { findEnclosingFrame } from './frames.js'
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
/**
 * The card and leader's own layer name — just the note's text, not a
 * generic "Annotation" label. Card/leader would otherwise be named
 * identically across every annotation, which is useless clutter once
 * there's more than one on the canvas (Figma floats layer names above
 * nodes when zoomed out).
 */
function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

const CARD_SHADOW: DropShadowEffect = {
  type: 'DROP_SHADOW',
  color: { r: 0, g: 0, b: 0, a: 0.16 },
  offset: { x: 0, y: 2 },
  radius: 8,
  spread: 0,
  visible: true,
  blendMode: 'NORMAL'
}

const CHUNK_SIZE = 20

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

function tag(node: SceneNode, ownerId: string, role: Role): void {
  node.setPluginData(OWNER_KEY, ownerId)
  node.setPluginData(ROLE_KEY, role)
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
  }
}

export function ownerIdOf(node: SceneNode): string | null {
  const value = node.getPluginData(OWNER_KEY)
  return value === '' ? null : value
}

export function roleOf(node: SceneNode): Role | null {
  const value = node.getPluginData(ROLE_KEY)
  return value === 'badge' || value === 'card' || value === 'leader' ? value : null
}

/** Removes whatever rendered nodes an owner has, regardless of its record. */
export function removeRenderedNodesForOwner(ownerId: string): void {
  const rendered = findRenderedNodes(ownerId)
  removeIfPresent(rendered.badge)
  removeIfPresent(rendered.card)
  removeIfPresent(rendered.leader)
}

/** Deletes rendered nodes whose owner is not in `liveTargetIds`. Returns the count removed. */
export function removeOrphanRenderedNodes(liveTargetIds: ReadonlySet<string>): number {
  const owned = figma.currentPage.findAllWithCriteria({ pluginData: { keys: [OWNER_KEY] } })
  let removed = 0
  for (const node of owned) {
    const ownerId = node.getPluginData(OWNER_KEY)
    if (ownerId !== '' && !liveTargetIds.has(ownerId) && !node.removed) {
      node.remove()
      removed += 1
    }
  }
  return removed
}

interface Card {
  readonly card: FrameNode
  readonly text: TextNode
}

const CARD_PADDING_X = 12
const CARD_PADDING_Y_TOP = 10
const CARD_PADDING_Y_BOTTOM = 10
const CATEGORY_PILL_KEY = 'annotationCategoryPill'

/**
 * The category pill — name on a solid colour chip, sitting above the note
 * text — the same idea as Figma's own category label. Kept as the card's
 * first child (inserted, not appended) so it always reads above the text
 * regardless of which one was created first.
 */
async function ensureCategoryPill(card: FrameNode, category: Category | null): Promise<void> {
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
    pill.paddingLeft = 8
    pill.paddingRight = 8
    pill.paddingTop = 3
    pill.paddingBottom = 3
    pill.cornerRadius = 999
    pill.setPluginData(CATEGORY_PILL_KEY, 'true')
    card.insertChild(0, pill)
  }
  pill.name = 'Category'
  pill.fills = [figma.util.solidPaint(category.color)]
  let label = pill.children.find((child): child is TextNode => child.type === 'TEXT')
  if (typeof label === 'undefined') {
    label = figma.createText()
    await figma.loadFontAsync(PILL_FONT)
    label.fontName = PILL_FONT
    label.fontSize = 10
    pill.appendChild(label)
  }
  if (label.characters !== category.name) {
    await figma.loadFontAsync(PILL_FONT)
    label.characters = category.name
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
  category: Category | null
): Promise<Card> {
  const card = existing ?? figma.createFrame()
  card.name = 'Annotation card'
  card.layoutMode = 'VERTICAL'
  card.primaryAxisSizingMode = 'AUTO'
  card.counterAxisSizingMode = 'FIXED'
  card.paddingLeft = CARD_PADDING_X
  card.paddingRight = CARD_PADDING_X
  card.paddingTop = CARD_PADDING_Y_TOP
  card.paddingBottom = CARD_PADDING_Y_BOTTOM
  card.itemSpacing = 6
  card.cornerRadius = 8
  card.fills = [figma.util.solidPaint(CARD_FILL)]
  card.strokes = [figma.util.solidPaint(CARD_STROKE)]
  card.strokeWeight = 1
  card.effects = [CARD_SHADOW]
  card.resize(width, card.height)
  // Draggable on purpose — see `updateCardOffsetFromDrag`. Badge and leader
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
    text.fontSize = 13
    text.lineHeight = { value: 150, unit: 'PERCENT' }
    text.fills = [figma.util.solidPaint(CARD_TEXT)]
  }
  // Reasserted every sync, not just on creation: a card whose text node was
  // created before this fix existed would otherwise stay broken forever —
  // this is also what was still leaving Thai text in a loopless fallback
  // font: the font was only ever applied on first creation, so every
  // already-existing card kept whatever it started with.
  text.fontName = await resolveCardFont()
  // `layoutSizingHorizontal: 'FILL'` is documented to make an auto-layout
  // child's width track its parent, but in practice it left the text at
  // whatever sliver of a width it was created with — every character wrapped
  // onto its own line. Setting the width directly, instead of trusting FILL,
  // is what actually works.
  text.textAutoResize = 'HEIGHT'
  text.layoutSizingHorizontal = 'FIXED'
  text.resize(width - CARD_PADDING_X * 2, text.height)
  await ensureCategoryPill(card, category)
  return { card, text }
}

function ensureLeader(existing: VectorNode | null, ownerId: string, color: string): VectorNode {
  const leader = existing ?? figma.createVector()
  leader.name = 'Annotation leader'
  leader.strokes = [figma.util.solidPaint(color)]
  leader.strokeWeight = 1.5
  leader.dashPattern = [4, 4]
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
  const centered = elbowPoints(from, { x: cardEdge.x, y: card.y + card.height / 2 })
  return centered ?? points
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
 * How far it is from `ownFrame`'s edge on `side` to the nearest other
 * top-level frame that a card routed that way could run into — screens
 * placed close together in a flow, say. `Infinity` when nothing is in the
 * way, so the card is free to use its ideal width.
 */
function nearestNeighborGap(ownFrame: Rect, side: 'LEFT' | 'RIGHT', ownFrameId: string): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const frame of figma.currentPage.children) {
    if (frame.type !== 'FRAME' || frame.id === ownFrameId) continue
    const rect = frame.absoluteBoundingBox
    if (rect === null || !verticallyOverlaps(ownFrame, rect)) continue
    const gap =
      side === 'RIGHT' ? rect.x - (ownFrame.x + ownFrame.width) : ownFrame.x - (rect.x + rect.width)
    if (gap >= 0 && gap < nearest) nearest = gap
  }
  return nearest
}

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
  const frame = findEnclosingFrame(target)
  const frameRect = frame?.absoluteBoundingBox ?? null
  if (frame === null || frameRect === null) {
    return { layout: annotationLayout(rect, record), cardWidth: DEFAULT_METRICS.cardWidth, side: null }
  }

  const side = resolveOutsideSide(rect, frameRect)
  const gap = nearestNeighborGap(frameRect, side, frame.id)
  const cardWidth = Number.isFinite(gap)
    ? Math.max(MIN_OUTSIDE_CARD_WIDTH, Math.min(DEFAULT_METRICS.cardWidth, gap - OUTSIDE_MARGIN - NEIGHBOR_SAFETY_GAP))
    : DEFAULT_METRICS.cardWidth

  const layout = annotationLayoutOutsideFrame(rect, frameRect, record, {
    ...DEFAULT_METRICS,
    cardWidth
  })
  return { layout, cardWidth, side }
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

/** Renders (or updates) the annotation for one target node from its record. */
export async function syncAnnotation(target: SceneNode): Promise<void> {
  const inFlight = inFlightSyncs.get(target.id)
  if (typeof inFlight !== 'undefined') {
    await inFlight
    return
  }
  const promise = syncAnnotationExclusive(target)
  inFlightSyncs.set(target.id, promise)
  try {
    await promise
  } finally {
    inFlightSyncs.delete(target.id)
  }
}

async function syncAnnotationExclusive(target: SceneNode): Promise<void> {
  const record = getAnnotationRecord(target)
  const rendered = findRenderedNodes(target.id)
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

  const label = truncate(record.text, 24)

  try {
    await syncAnnotationBody(target, rect, record, rendered, category, color, label)
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
  color: string,
  label: string
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

    const { card, text } = await ensureCard(rendered.card, target.id, resolved.cardWidth, category)
    // The note's own text, not a generic "Annotation — " prefix — every
    // layer already reads as an annotation from its type/position, so
    // spelling that out on each one was clutter of its own.
    card.name = label
    card.x = layout.cardTopLeft.x
    card.y = layout.cardTopLeft.y
    if (text.characters !== record.text) {
      await figma.loadFontAsync(text.fontName as FontName)
      text.characters = record.text
    }

    if (layout.leader === null) {
      removeIfPresent(rendered.leader)
    } else {
      const leader = ensureLeader(rendered.leader, target.id, color)
      leader.name = label
      // `layout.leader`'s card-side endpoint was computed before the card's
      // real height was known (a fixed inset from the top, as a stand-in).
      // Now that `card.height` reflects the actual rendered card, retarget
      // it at the card's vertical centre instead — only meaningful for the
      // outside-frame layout, where the leader actually reaches the card;
      // the near-target layout's leader just docks at the target's edge.
      const points =
        resolved.side === null ? layout.leader : leaderToCardCenter(layout.leader, card)
      await positionLeader(leader, points)
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

// The margin corridor (`OUTSIDE_MARGIN`) is only 20px wide, so this has to
// stay small — enough to visibly separate a handful of leaders sharing the
// same side without running the innermost lane back into the frame itself.
const LEADER_LANE_GAP = 5

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
  for (const [ownerId, card] of cardsByOwner) {
    const target = await figma.getNodeByIdAsync(ownerId)
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

  try {
    // Suppressed for the same reason as in `syncAnnotationExclusive`: moving
    // a card here to avoid overlap must not look like a person dragging it.
    await withSuppressedNodeChangeAsync(async () => {
      for (const [side, list] of groups.entries()) {
        const stacked = resolveCardStacking(
          list.map((item) => ({ id: item.ownerId, top: item.naturalTop, height: item.card.height })),
          CARD_STACK_GAP
        )
        // Every leader in this group shares the same `nearEdgeX` — bending
        // all of them there at once is what made several leaders overlap
        // into the same line through the margin. Lane them instead: sort
        // top to bottom and give each one after the first a bend a little
        // further into the margin, so they fan out instead of stacking on
        // top of each other. `RIGHT` fans toward smaller x (back toward the
        // frame); `LEFT` mirrors it toward larger x.
        const laneSign = side === 'RIGHT' ? -1 : 1
        const lanesOf = [...list].sort((a, b) => a.edgeStart.y - b.edgeStart.y)
        const laneXById = new Map<string, number>(
          lanesOf.map((item, index) => [item.ownerId, item.nearEdgeX + laneSign * index * LEADER_LANE_GAP])
        )

        for (const item of list) {
          const top = stacked.get(item.ownerId)
          if (typeof top !== 'number') continue
          // Same reparent-before-position reasoning as `syncAnnotationExclusive`
          // — the card may have drifted into another frame since the last sync.
          figma.currentPage.appendChild(item.card)
          item.card.y = top
          if (item.leader === null) continue
          figma.currentPage.appendChild(item.leader)

          // Vertical centre of the card, same as the initial sync — not the
          // fixed top-of-card inset `CARD_LEADER_INSET` still used as this
          // module's own before-the-real-height starting guess.
          const to: Point = { x: item.nearEdgeX, y: top + item.card.height / 2 }
          const laneX = laneXById.get(item.ownerId) ?? item.nearEdgeX
          const points = laneElbowPoints(item.edgeStart, laneX, to)
          await positionLeader(item.leader, points)
        }
      }
    })
  } catch (error) {
    // Same reasoning as `syncAnnotationExclusive`'s catch — a throw here
    // used to vanish silently and leave cards stuck mid-reflow.
    figma.notify(`Couldn't lay out annotation cards: ${String(error)}`, { error: true })
    throw error
  }
}

/** Everything that needs to run after a batch of annotation changes settles. */
export async function finalizeLayout(): Promise<void> {
  await applyCardStacking()
}

/** Removes the rendered nodes and the record for one target. */
export async function clearAnnotation(target: SceneNode): Promise<void> {
  removeRenderedNodesForOwner(target.id)
  eraseAnnotationRecord(target)
  await finalizeLayout()
}

/** Sets or replaces the note text for a target, creating the record if needed. */
export async function setAnnotationText(target: SceneNode, text: string): Promise<void> {
  const trimmed = text.trim()
  if (trimmed === '') {
    await clearAnnotation(target)
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

const CARD_OFFSET_EPSILON = 0.5

/**
 * Captures a manual drag of the card as the record's new offset preference,
 * then re-syncs so the badge/leader catch up to wherever the card landed.
 */
export async function updateCardOffsetFromDrag(target: SceneNode): Promise<void> {
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

  const before = computeLayout(target, rect, record).layout
  const newOffset: Point = {
    x: cardBox.x - before.badgeCenter.x,
    y: cardBox.y - before.badgeCenter.y
  }
  const unchanged =
    Math.abs(newOffset.x - record.cardOffset.x) < CARD_OFFSET_EPSILON &&
    Math.abs(newOffset.y - record.cardOffset.y) < CARD_OFFSET_EPSILON
  if (unchanged) return

  writeAnnotationRecord(target, { ...record, side: 'AUTO', cardOffset: newOffset })
  await syncAnnotation(target)
  await finalizeLayout()
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Re-renders every annotation on the current page and sweeps orphaned nodes. */
export async function reconcileAllAnnotations(): Promise<{
  synced: number
  orphansRemoved: number
}> {
  const targets = figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [ANNOTATION_KEY] } })
    .filter((node) => getAnnotationRecord(node) !== null)

  let synced = 0
  for (const target of targets) {
    await syncAnnotation(target)
    synced += 1
    if (synced % CHUNK_SIZE === 0) await yieldToMainThread()
  }

  const orphansRemoved = removeOrphanRenderedNodes(new Set(targets.map((node) => node.id)))
  await finalizeLayout()
  return { synced, orphansRemoved }
}
