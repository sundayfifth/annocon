/**
 * The main-thread <-> UI message protocol.
 *
 * Both directions are typed here so the two bundles cannot drift. Remember the
 * asymmetry Figma imposes: the UI must wrap outgoing payloads in
 * `{ pluginMessage }`, the main thread receives them unwrapped.
 * `@create-figma-plugin/utilities` `emit`/`on` handle that wrapping for us.
 */

/** What the UI needs to know about the current selection. */
export interface SelectionSummary {
  readonly id: string
  readonly name: string
  readonly type: string
  /** False for types Figma refuses native annotations on (groups, sections). */
  readonly supportsNativeAnnotation: boolean
}

export interface SelectionChangedHandler {
  name: 'SELECTION_CHANGED'
  handler: (selection: ReadonlyArray<SelectionSummary>) => void
}

export interface SpikeReportHandler {
  name: 'SPIKE_REPORT'
  handler: (report: string) => void
}

export interface RunSpikesHandler {
  name: 'RUN_SPIKES'
  handler: () => void
}

export interface ResyncPageHandler {
  name: 'RESYNC_PAGE'
  handler: () => void
}

export interface CloseHandler {
  name: 'CLOSE'
  handler: () => void
}
