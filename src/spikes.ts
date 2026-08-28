/**
 * S6 — can a plugin-owned drag handle feel like direct manipulation?
 *
 * See `docs/spikes.md`. S3 already established that `nodechange` streams
 * *during* a drag rather than only on drop, but it only counted events (32
 * over 6223ms) and never measured the two numbers that actually decide
 * whether a draggable handle is worth building:
 *
 *   1. How far apart the events arrive. A 16ms median reads as 60fps; a
 *      200ms median reads as the line jumping in steps behind the cursor.
 *   2. How long our own re-route takes per event. If the sync costs more
 *      than the gap between events, we are the bottleneck, events pile up
 *      behind an in-flight sync, and the handle lags however smooth Figma's
 *      own delivery is.
 *
 * So this probe drives the *real* `syncConnector` on the *real* connectors
 * attached to whatever the person drags — not a simulation of the cost. It
 * reproduces exactly what `resyncTouched` in `main.ts` does on a positional
 * change, including the single-flight behaviour a shipped handle would need
 * (drop events that arrive while a sync is still running, rather than queue
 * them and fall further behind).
 *
 * Run from the plugin menu against a scratch file; paste the report into
 * `docs/spikes.md`. Delete this file once the question is answered.
 */

import {
  explainConnectorRoute,
  findConnectorsInvolving,
  findConnectorsWithEndpointUnder,
  isConnector,
  syncConnector
} from './scene/connectorScene.js'
import { isSuppressed } from './scene/pluginData.js'

const PROBE_MS = 10000
const POSITIONAL_PROPERTIES = ['x', 'y', 'width', 'height', 'relativeTransform', 'rotation']

/** Milliseconds a sync has to stay under for the drag to read as roughly 30fps. */
const SMOOTH_MS = 33
/** Past this, the handle visibly trails the cursor rather than tracking it. */
const CHUNKY_MS = 100

interface Samples {
  /** When each qualifying event arrived, relative to arming. */
  readonly eventAt: Array<number>
  /** How long one full `syncConnector` pass took, per event we actually served. */
  readonly syncMs: Array<number>
  /** Events that arrived while a sync was still in flight, and so were dropped. */
  dropped: number
}

/** The p-th percentile of `values` (0..1), nearest-rank. Returns `null` for an empty sample. */
function percentile(values: ReadonlyArray<number>, p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index] ?? null
}

function round(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value)}ms`
}

/** The gaps between consecutive timestamps — the shape of Figma's delivery, independent of our own cost. */
function gapsBetween(stamps: ReadonlyArray<number>): Array<number> {
  const gaps: Array<number> = []
  for (let i = 1; i < stamps.length; i += 1) {
    const previous = stamps[i - 1]
    const current = stamps[i]
    if (typeof previous === 'undefined' || typeof current === 'undefined') continue
    gaps.push(current - previous)
  }
  return gaps
}

/**
 * The end-to-end verdict: what a person actually feels is the gap between
 * events *plus* the sync that has to finish before the line moves. Judged on
 * the median rather than the worst case — one slow frame is invisible, a slow
 * median is what makes a handle feel broken.
 */
function verdictFor(medianGap: number | null, medianSync: number | null): string {
  if (medianGap === null || medianSync === null) return 'INCONCLUSIVE — no samples'
  const perceived = medianGap + medianSync
  if (perceived <= SMOOTH_MS) return `PASS — ~${Math.round(1000 / perceived)}fps, feels like direct manipulation`
  if (perceived <= CHUNKY_MS) return `MARGINAL — ~${Math.round(1000 / perceived)}fps, usable but visibly steppy`
  return `FAIL — ~${Math.round(1000 / perceived)}fps, the line trails the cursor in steps`
}

function reportFor(samples: Samples, connectorCount: number): string {
  const { eventAt, syncMs, dropped } = samples
  if (eventAt.length === 0) {
    return 'S6: INCONCLUSIVE — no positional events seen. Did the selected node actually move during the 10s window?'
  }

  const first = eventAt[0] ?? 0
  const last = eventAt[eventAt.length - 1] ?? 0
  const span = last - first
  const gaps = gapsBetween(eventAt)
  const medianGap = percentile(gaps, 0.5)
  const medianSync = percentile(syncMs, 0.5)

  return [
    `S6 — drag-handle feasibility (${connectorCount} connector${connectorCount === 1 ? '' : 's'} on the dragged node)`,
    '',
    verdictFor(medianGap, medianSync),
    '',
    `events: ${eventAt.length} over ${span}ms` +
      (span > 0 ? ` (${(eventAt.length / (span / 1000)).toFixed(1)}/s)` : ''),
    `  first event at +${first}ms, last at +${last}ms of a ${PROBE_MS}ms window`,
    `  gap between events: p50 ${round(medianGap)}, p90 ${round(percentile(gaps, 0.9))}, max ${round(percentile(gaps, 1))}`,
    '',
    `syncConnector: ${syncMs.length} served, ${dropped} dropped while busy`,
    `  p50 ${round(medianSync)}, p90 ${round(percentile(syncMs, 0.9))}, max ${round(percentile(syncMs, 1))}`,
    '',
    dropped > syncMs.length
      ? 'Note: more events were dropped than served — our own sync, not Figma delivery, is the bottleneck.'
      : 'Note: most events were served — Figma delivery, not our sync, sets the ceiling.'
  ].join('\n')
}

const REPORT_FONT: FontName = { family: 'Inter', style: 'Regular' }

/**
 * Drops the report on the canvas rather than the devtools console — this is
 * meant to be run by whoever is deciding whether the feature is worth
 * building, who should not have to open devtools to read the answer.
 */
async function writeReportNode(text: string): Promise<void> {
  await figma.loadFontAsync(REPORT_FONT)
  const node = figma.createText()
  node.name = 'ANNOCON probe result'
  node.fontName = REPORT_FONT
  node.fontSize = 14
  node.characters = text
  figma.currentPage.appendChild(node)
  node.x = figma.viewport.center.x - node.width / 2
  node.y = figma.viewport.center.y - node.height / 2
}

/**
 * Menu command. Arms a listener for `PROBE_MS`, re-routing for real on every
 * positional change to the selected node, then writes the report to canvas
 * and closes.
 */
export function startDragProbe(): void {
  const selection = figma.currentPage.selection
  const target = selection[0]
  if (selection.length !== 1 || typeof target === 'undefined') {
    figma.closePlugin('S6: select exactly one node to drag, then re-run.')
    return
  }
  // Easy mistake to make, and the generic message below reads as nonsense
  // when you hit it: the probe measures what happens when a connector's
  // *endpoint* moves, so the thing to select and drag is the frame, not the
  // line that is already attached to it.
  if (isConnector(target)) {
    figma.closePlugin(
      'S6: that is the connector itself. Select one of the frames it joins instead, and drag that.'
    )
    return
  }
  // A connector is very often anchored to some small layer *inside* a frame
  // rather than to the frame itself, so the frame a person selects and drags
  // matches no anchor by id. Dragging it still moves the endpoint, and still
  // has to re-route — which is exactly what this probe measures — so the
  // descendants have to be searched too, the same way `resyncTouched` does.
  const connectors = [
    ...findConnectorsInvolving(target.id),
    ...('children' in target ? findConnectorsWithEndpointUnder(target) : [])
  ]
  if (connectors.length === 0) {
    figma.closePlugin(
      `S6: nothing on or inside "${target.name}" is an endpoint of any connector. Draw a connector from it to another frame first, then re-run and drag this frame.`
    )
    return
  }

  const samples: Samples = { eventAt: [], syncMs: [], dropped: 0 }
  const armedAt = Date.now()
  const page = figma.currentPage
  let busy = false

  const listener = (event: NodeChangeEvent): void => {
    // Our own writes echo back through `nodechange` exactly like a person's
    // drag does — counting them would inflate the event rate with our own
    // noise and make delivery look faster than it is.
    if (isSuppressed()) return
    const moved = event.nodeChanges.some(
      (change) =>
        change.type === 'PROPERTY_CHANGE' &&
        change.node.id === target.id &&
        change.properties.some((property) => POSITIONAL_PROPERTIES.includes(property))
    )
    if (!moved) return

    samples.eventAt.push(Date.now() - armedAt)
    // Single-flight, the same way a shipped handle would have to behave:
    // queueing every event behind the last sync only makes the line fall
    // further behind the cursor the longer the drag goes on.
    if (busy) {
      samples.dropped += 1
      return
    }
    busy = true
    const startedAt = Date.now()
    void Promise.all(connectors.map((connector) => syncConnector(connector)))
      .then(() => {
        samples.syncMs.push(Date.now() - startedAt)
      })
      .catch((error: unknown) => {
        figma.notify(`S6: sync threw — ${String(error)}`, { error: true })
      })
      .finally(() => {
        busy = false
      })
  }

  page.on('nodechange', listener)
  figma.notify(`S6 armed — drag "${target.name}" around for ${PROBE_MS / 1000} seconds.`, {
    timeout: PROBE_MS
  })

  setTimeout(() => {
    page.off('nodechange', listener)
    const text = reportFor(samples, connectors.length)
    writeReportNode(text)
      .then(() => {
        figma.closePlugin('S6 done — report written to the canvas.')
      })
      .catch((error: unknown) => {
        figma.closePlugin(`S6 done, but the report node failed: ${String(error)}\n\n${text}`)
      })
  }, PROBE_MS)
}

/**
 * Menu command: explain the selected connector's route. Not a spike — a
 * diagnostic for the routing itself, kept here because it shares the
 * report-to-canvas plumbing and is just as temporary.
 */
export function explainSelectedRoute(): void {
  const selection = figma.currentPage.selection
  const target = selection[0]
  if (selection.length !== 1 || typeof target === 'undefined' || target.type !== 'VECTOR') {
    figma.closePlugin('Select exactly one connector (the line itself), then re-run.')
    return
  }
  explainConnectorRoute(target)
    .then(async (text) => {
      await writeReportNode(text)
      figma.closePlugin('Route diagnostic written to the canvas.')
    })
    .catch((error: unknown) => {
      figma.closePlugin(`Route diagnostic failed: ${String(error)}`)
    })
}
