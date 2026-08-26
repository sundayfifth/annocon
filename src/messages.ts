/**
 * The main-thread <-> UI message protocol.
 *
 * Both directions are typed here so the two bundles cannot drift. Remember the
 * asymmetry Figma imposes: the UI must wrap outgoing payloads in
 * `{ pluginMessage }`, the main thread receives them unwrapped.
 * `@create-figma-plugin/utilities` `emit`/`on` handle that wrapping for us.
 */

import type { Magnet } from './core/anchor.js'
import type { Category } from './core/category.js'
import type { ConnectorCap, ConnectorLineStyle } from './core/connector.js'

export interface ConnectorStyleSummary {
  readonly color: string
  readonly opacity: number
  readonly strokeWeight: number
  readonly startCap: ConnectorCap
  readonly endCap: ConnectorCap
  readonly lineStyle: ConnectorLineStyle
  readonly cornerRadius: number
  /** Which side of the start/end node the connector exits/enters from. `AUTO` picks based on relative position. */
  readonly startMagnet: Magnet
  readonly endMagnet: Magnet
}

/** What the UI needs to know about the current selection. */
export interface SelectionSummary {
  readonly id: string
  readonly name: string
  readonly type: string
  /** False for types Figma refuses native annotations on (groups, sections). */
  readonly supportsNativeAnnotation: boolean
  /** The node's current annotation note, or `null` if it has none. */
  readonly annotationText: string | null
  /** The node's current category id, or `null` if it has none. */
  readonly categoryId: string | null
  /** Set when this node is itself a connector — lets the UI show its style controls. */
  readonly connectorStyle: ConnectorStyleSummary | null
}

export interface SelectionChangedHandler {
  name: 'SELECTION_CHANGED'
  handler: (selection: ReadonlyArray<SelectionSummary>) => void
}

export interface SetAnnotationTextPayload {
  readonly targetId: string
  readonly text: string
}

export interface SetAnnotationTextHandler {
  name: 'SET_ANNOTATION_TEXT'
  handler: (payload: SetAnnotationTextPayload) => void
}

export interface ResyncPageHandler {
  name: 'RESYNC_PAGE'
  handler: () => void
}

export interface CreateConnectorPayload {
  readonly startId: string
  readonly endId: string
}

export interface CreateConnectorHandler {
  name: 'CREATE_CONNECTOR'
  handler: (payload: CreateConnectorPayload) => void
}

export interface CloseHandler {
  name: 'CLOSE'
  handler: () => void
}

export interface CategoriesChangedHandler {
  name: 'CATEGORIES_CHANGED'
  handler: (categories: ReadonlyArray<Category>) => void
}

export interface SetAnnotationCategoryPayload {
  readonly targetId: string
  readonly categoryId: string | null
}

export interface SetAnnotationCategoryHandler {
  name: 'SET_ANNOTATION_CATEGORY'
  handler: (payload: SetAnnotationCategoryPayload) => void
}

export interface AddCategoryPayload {
  readonly name: string
  readonly color: string
}

export interface AddCategoryHandler {
  name: 'ADD_CATEGORY'
  handler: (payload: AddCategoryPayload) => void
}

export interface RenameCategoryPayload {
  readonly id: string
  readonly name: string
}

export interface RenameCategoryHandler {
  name: 'RENAME_CATEGORY'
  handler: (payload: RenameCategoryPayload) => void
}

export interface RecolorCategoryPayload {
  readonly id: string
  readonly color: string
}

export interface RecolorCategoryHandler {
  name: 'RECOLOR_CATEGORY'
  handler: (payload: RecolorCategoryPayload) => void
}

export interface DeleteCategoryPayload {
  readonly id: string
}

export interface DeleteCategoryHandler {
  name: 'DELETE_CATEGORY'
  handler: (payload: DeleteCategoryPayload) => void
}

export interface UpdateConnectorStylePayload {
  readonly targetId: string
  readonly color?: string
  readonly opacity?: number
  readonly strokeWeight?: number
  readonly startCap?: ConnectorCap
  readonly endCap?: ConnectorCap
  readonly lineStyle?: ConnectorLineStyle
  readonly cornerRadius?: number
}

export interface UpdateConnectorStyleHandler {
  name: 'UPDATE_CONNECTOR_STYLE'
  handler: (payload: UpdateConnectorStylePayload) => void
}

export interface UpdateConnectorAnchorPayload {
  readonly targetId: string
  readonly side: 'start' | 'end'
  readonly magnet: Magnet
}

export interface UpdateConnectorAnchorHandler {
  name: 'UPDATE_CONNECTOR_ANCHOR'
  handler: (payload: UpdateConnectorAnchorPayload) => void
}
