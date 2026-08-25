import { emit, on, showUI } from '@create-figma-plugin/utilities'

import type {
  CloseHandler,
  ResyncPageHandler,
  SelectionChangedHandler,
  SelectionSummary
} from './messages.js'

function summariseSelection(): Array<SelectionSummary> {
  return figma.currentPage.selection.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    // Groups, sections and boolean operations have no `annotations` property,
    // so the native dual-write has to be skipped for them.
    supportsNativeAnnotation: 'annotations' in node
  }))
}

export default function main(): void {
  on<ResyncPageHandler>('RESYNC_PAGE', () => {
    figma.notify('Re-sync lands in phase 3 — nothing to sync yet.')
  })

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin()
  })

  figma.on('selectionchange', () => {
    emit<SelectionChangedHandler>('SELECTION_CHANGED', summariseSelection())
  })

  showUI({ height: 440, width: 320 }, { selection: summariseSelection() })
}

/**
 * Menu + relaunch-button command. Runs without a UI and closes immediately,
 * so it is safe to fire from the properties panel on a stale connector.
 */
export function resyncPage(): void {
  figma.closePlugin('Re-sync lands in phase 3 — nothing to sync yet.')
}
