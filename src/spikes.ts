/**
 * Phase 0 spikes — see docs/spikes.md.
 *
 * These probe the four behaviours the Figma docs do not settle, and which the
 * architecture depends on. Run them from the plugin menu against a scratch
 * file; paste the output into docs/spikes.md. Delete this file once every
 * question is answered and recorded.
 */

const SPIKE_LABEL = 'annotate-connect spike'

function line(id: string, verdict: string, detail: string): string {
  return `${id}: ${verdict}\n    ${detail}`
}

/** S1 — can we write `node.annotations` from a Design-mode plugin? */
function spikeAnnotations(): string {
  const node = figma.currentPage.selection[0]
  if (typeof node === 'undefined') {
    return line('S1', 'SKIPPED', 'Select one frame/text/rect first, then re-run.')
  }
  if (!('annotations' in node)) {
    return line(
      'S1',
      'SKIPPED',
      `${node.type} has no \`annotations\` property. Try a FRAME or TEXT.`
    )
  }
  const before = node.annotations
  try {
    node.annotations = [{ label: SPIKE_LABEL }]
    const after = node.annotations
    const wrote = after.length === 1 && after[0]?.label === SPIKE_LABEL
    node.annotations = before
    return line(
      'S1',
      wrote ? 'PASS' : 'FAIL',
      wrote
        ? `Wrote and read back on ${node.type} from editorType "figma". Now toggle View > Annotations and confirm it is visible on canvas.`
        : `Assignment silently did nothing on ${node.type}. Read back: ${JSON.stringify(after)}`
    )
  } catch (error) {
    return line('S1', 'FAIL', `Threw: ${String(error)}`)
  }
}

/** S2 — do per-vertex stroke caps survive `setVectorNetworkAsync`? */
async function spikeAsymmetricCaps(): Promise<string> {
  const vector = figma.createVector()
  vector.name = `${SPIKE_LABEL} vector`
  try {
    vector.strokes = [figma.util.solidPaint('#ff0000')]
    vector.strokeWeight = 2
    await vector.setVectorNetworkAsync({
      vertices: [
        { x: 0, y: 0, strokeCap: 'NONE' },
        { x: 200, y: 120, strokeCap: 'ARROW_EQUILATERAL' }
      ],
      segments: [{ start: 0, end: 1 }],
      regions: []
    })
    const positionAfter = { x: vector.x, y: vector.y }
    const network = vector.vectorNetwork
    const caps = network.vertices.map((vertex) => vertex.strokeCap ?? 'undefined')
    const asymmetric = caps.length === 2 && caps[0] !== caps[1]
    return line(
      'S2',
      asymmetric ? 'PASS' : 'FAIL',
      `caps read back = ${JSON.stringify(caps)}; node.strokeCap = ${String(
        vector.strokeCap
      )}; position after set = ${JSON.stringify(positionAfter)}; size = ${
        vector.width
      }x${vector.height}`
    )
  } catch (error) {
    return line('S2', 'FAIL', `Threw: ${String(error)}`)
  } finally {
    vector.remove()
  }
}

/** S4 — does the main-thread sandbox actually expose timers? */
function spikeTimers(): string {
  const hasTimeout = typeof setTimeout === 'function'
  const hasInterval = typeof setInterval === 'function'
  return line(
    'S4',
    hasTimeout ? 'PASS' : 'FAIL',
    `setTimeout=${hasTimeout}, setInterval=${hasInterval}. If FAIL, debounce from the UI iframe instead.`
  )
}

/**
 * S3 — is `nodechange` delivered during a drag, or only on drop?
 *
 * Cannot be answered synchronously: it needs the user to drag something. This
 * starts a 10-second window, counts events, and reports the spread of
 * timestamps. Many events spread over the drag means live re-routing will feel
 * like FigJam; one event at the end means it snaps on drop.
 */
export function startNodeChangeProbe(report: (text: string) => void): void {
  const stamps: Array<number> = []
  const page = figma.currentPage
  const listener = (event: NodeChangeEvent): void => {
    const positional = event.nodeChanges.filter(
      (change) =>
        change.type === 'PROPERTY_CHANGE' &&
        change.properties.some((property) =>
          ['x', 'y', 'width', 'height', 'relativeTransform', 'rotation'].includes(property)
        )
    )
    if (positional.length > 0) {
      stamps.push(Date.now())
    }
  }
  page.on('nodechange', listener)
  report('S3: probe armed — drag a frame around for a few seconds, then re-run the spikes to see the count.')

  const finish = (): void => {
    page.off('nodechange', listener)
    if (stamps.length === 0) {
      report(line('S3', 'INCONCLUSIVE', 'No positional nodechange events seen. Did anything move?'))
      return
    }
    const first = stamps[0] as number
    const last = stamps[stamps.length - 1] as number
    report(
      line(
        'S3',
        stamps.length > 3 ? 'PASS (streams during drag)' : 'FAIL (fires on drop only)',
        `${stamps.length} positional events over ${last - first}ms`
      )
    )
  }

  if (typeof setTimeout === 'function') {
    setTimeout(finish, 10000)
  } else {
    report('S3: no setTimeout in the sandbox — see S4; run this probe from the UI thread instead.')
  }
}

export async function runSpikes(): Promise<string> {
  const results = [spikeAnnotations(), await spikeAsymmetricCaps(), spikeTimers()]
  return results.join('\n\n')
}
