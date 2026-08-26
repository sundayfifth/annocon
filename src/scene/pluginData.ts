/**
 * Guards our own pluginData writes on annotation targets so they do not
 * retrigger the `nodechange` listener that drives live re-routing.
 *
 * `setPluginData` on a node is itself a property change, so writing it back
 * from inside the listener would loop forever without this. The release is
 * deferred a tick past the synchronous write because Figma delivers
 * `nodechange` on the following task, not synchronously.
 */

let suppressDepth = 0

export function isSuppressed(): boolean {
  return suppressDepth > 0
}

export function withSuppressedNodeChange<T>(fn: () => T): T {
  suppressDepth += 1
  try {
    return fn()
  } finally {
    setTimeout(() => {
      suppressDepth = Math.max(0, suppressDepth - 1)
    }, 0)
  }
}

/**
 * Same idea, for an async block. Every write we make to a badge/card/leader
 * (position, vector network, resize) is itself a property change the
 * `nodechange` listener sees — without this, positioning a card during a
 * normal sync or during stacking looks identical to a person dragging it,
 * and gets fed back into `updateCardOffsetFromDrag`, which can overwrite the
 * record with a bogus offset read mid-write. The suppress window has to
 * span the whole async block, not just its synchronous start, because the
 * writes inside include awaited calls like `setVectorNetworkAsync`.
 */
export async function withSuppressedNodeChangeAsync<T>(fn: () => Promise<T>): Promise<T> {
  suppressDepth += 1
  try {
    return await fn()
  } finally {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    suppressDepth = Math.max(0, suppressDepth - 1)
  }
}
