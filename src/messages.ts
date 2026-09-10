/**
 * The main-thread <-> UI message protocol.
 *
 * Both directions are typed here so the two bundles cannot drift. Remember the
 * asymmetry Figma imposes: the UI must wrap outgoing payloads in
 * `{ pluginMessage }`, the main thread receives them unwrapped.
 * `@create-figma-plugin/utilities` `emit`/`on` handle that wrapping for us.
 *
 * `UiToMain` and `MainToUi` at the bottom of this file are the actual
 * contract: every message name, mapped to what it carries. The
 * `…Handler` interfaces above them are what `emit`/`on` want at each call
 * site, and they are derived from those maps rather than written twice.
 *
 * The maps exist so that registration can be checked. Thirteen handler
 * interfaces and eleven `on()` calls used to be kept in step by hand:
 * everything was registered, but nothing said so, and adding a message and
 * forgetting to listen for it compiled and then did nothing at all.
 * `main.ts` now registers from an object typed by `UiToMain`, so a message
 * without a handler is a type error.
 */

import type { Magnet } from './core/anchor.js'
import type { AnnotationSize } from './core/annotation.js'
import type { Category } from './core/category.js'
import type { ConnectorCap, ConnectorDetour, ConnectorLineStyle } from './core/connectorRecord.js'

export interface ConnectorStyleSummary {
  readonly color: string
  readonly opacity: number
  readonly strokeWeight: number
  readonly startCap: ConnectorCap
  readonly endCap: ConnectorCap
  readonly lineStyle: ConnectorLineStyle
  readonly cornerRadius: number
  /** Which way an `ELBOW` goes around whatever is in its path. */
  readonly detour: ConnectorDetour
  /** True once someone has reshaped the line by hand and the plugin has stopped routing it. */
  readonly manualGeometry: boolean
  /** True when an end's layer is gone, which is what the red dashed line on the canvas means. */
  readonly broken: boolean
  /** The label pill's fill. */
  readonly labelColor: string
  /** Which side of the start/end node the connector exits/enters from. `AUTO` picks based on relative position. */
  readonly startMagnet: Magnet
  readonly endMagnet: Magnet
  /** Optional label drawn at the midpoint of the route. Empty string means none. */
  readonly label: string
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
  /** The annotation's card size, or `null` when the node has no annotation. */
  readonly annotationSize: AnnotationSize | null
  /** The node's current category id, or `null` if it has none. */
  readonly categoryId: string | null
  /** Set when this node is itself a connector — lets the UI show its style controls. */
  readonly connectorStyle: ConnectorStyleSummary | null
}

export interface SetAnnotationTextPayload {
  readonly targetId: string
  readonly text: string
}

export interface CreateConnectorPayload {
  readonly startId: string
  readonly endId: string
}

export interface SetAnnotationCategoryPayload {
  readonly targetId: string
  readonly categoryId: string | null
}

export interface SetAnnotationSizePayload {
  readonly targetId: string
  readonly size: AnnotationSize
}

export interface RestoreAutoRoutePayload {
  readonly connectorId: string
}

export interface DeleteConnectorPayload {
  readonly connectorId: string
}

export interface AddCategoryPayload {
  readonly name: string
  readonly color: string
}

export interface RenameCategoryPayload {
  readonly id: string
  readonly name: string
}

export interface RecolorCategoryPayload {
  readonly id: string
  readonly color: string
}

export interface DeleteCategoryPayload {
  readonly id: string
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
  readonly detour?: ConnectorDetour
  readonly label?: string
  readonly labelColor?: string
}

export interface UpdateConnectorAnchorPayload {
  readonly targetId: string
  readonly side: 'start' | 'end'
  readonly magnet: Magnet
}

/**
 * Why a command did not apply, on its way back to the person who asked.
 *
 * Handlers bail out on purpose — a node deleted between the panel reading it
 * and the message arriving, or one that turns out to be the wrong type — and
 * every one of them used to do it with a bare `return`. Nothing told the
 * person, and nothing told the panel, which went on showing a value that was
 * never stored until the next selection change happened to refresh it.
 */
export interface CommandFailure {
  /** Which command was dropped, so the reason can name it. */
  readonly command: keyof UiToMain
  /** What the person should be told, in their own terms rather than the code's. */
  readonly reason: string
}

/**
 * Every message the UI sends the main thread, and what it carries.
 *
 * Adding one here without registering a handler in `main.ts` is a type error,
 * which is the whole reason this map exists.
 */
export interface UiToMain {
  SET_ANNOTATION_TEXT: SetAnnotationTextPayload
  SET_ANNOTATION_CATEGORY: SetAnnotationCategoryPayload
  SET_ANNOTATION_SIZE: SetAnnotationSizePayload
  ADD_CATEGORY: AddCategoryPayload
  RENAME_CATEGORY: RenameCategoryPayload
  RECOLOR_CATEGORY: RecolorCategoryPayload
  DELETE_CATEGORY: DeleteCategoryPayload
  CREATE_CONNECTOR: CreateConnectorPayload
  UPDATE_CONNECTOR_STYLE: UpdateConnectorStylePayload
  UPDATE_CONNECTOR_ANCHOR: UpdateConnectorAnchorPayload
  RESTORE_AUTO_ROUTE: RestoreAutoRoutePayload
  DELETE_CONNECTOR: DeleteConnectorPayload
}

/** Every message the main thread sends the UI, and what it carries. */
export interface MainToUi {
  SELECTION_CHANGED: ReadonlyArray<SelectionSummary>
  CATEGORIES_CHANGED: ReadonlyArray<Category>
  COMMAND_FAILED: CommandFailure
}

/** The `{ name, handler }` shape `emit`/`on` are generic over, for one message of a map. */
export type MessageHandler<Map, Name extends keyof Map> = {
  name: Name
  handler: (payload: Map[Name]) => void
}

/**
 * One alias per message, for the `emit`/`on` call sites — each is just its
 * entry in the map above, so a payload is described in exactly one place.
 */
export type SelectionChangedHandler = MessageHandler<MainToUi, 'SELECTION_CHANGED'>
export type SetAnnotationTextHandler = MessageHandler<UiToMain, 'SET_ANNOTATION_TEXT'>
export type CreateConnectorHandler = MessageHandler<UiToMain, 'CREATE_CONNECTOR'>
export type CategoriesChangedHandler = MessageHandler<MainToUi, 'CATEGORIES_CHANGED'>
export type SetAnnotationCategoryHandler = MessageHandler<UiToMain, 'SET_ANNOTATION_CATEGORY'>
export type SetAnnotationSizeHandler = MessageHandler<UiToMain, 'SET_ANNOTATION_SIZE'>
export type RestoreAutoRouteHandler = MessageHandler<UiToMain, 'RESTORE_AUTO_ROUTE'>
export type AddCategoryHandler = MessageHandler<UiToMain, 'ADD_CATEGORY'>
export type RenameCategoryHandler = MessageHandler<UiToMain, 'RENAME_CATEGORY'>
export type RecolorCategoryHandler = MessageHandler<UiToMain, 'RECOLOR_CATEGORY'>
export type DeleteCategoryHandler = MessageHandler<UiToMain, 'DELETE_CATEGORY'>
export type UpdateConnectorStyleHandler = MessageHandler<UiToMain, 'UPDATE_CONNECTOR_STYLE'>
export type UpdateConnectorAnchorHandler = MessageHandler<UiToMain, 'UPDATE_CONNECTOR_ANCHOR'>
export type DeleteConnectorHandler = MessageHandler<UiToMain, 'DELETE_CONNECTOR'>
export type CommandFailedHandler = MessageHandler<MainToUi, 'COMMAND_FAILED'>
