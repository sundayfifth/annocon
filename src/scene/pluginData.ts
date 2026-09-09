/**
 * Stops the `nodechange` listener acting on this plugin's own writes.
 *
 * **Narrower than it used to claim.** This said a `setPluginData` echo "would
 * loop forever without this". It would not: `pluginData` is not a property
 * `classifyChange` acts on (`core/nodeChanges.ts`), so that echo stops at the
 * filter whether the flag is raised or not, and `test/nodeChanges.test.ts`
 * asserts it. The same goes for the `parent` change every reparent makes, and
 * for a badge or leader that moved — recognised as ours by what the node *is*
 * rather than by when the write happened.
 *
 * What is left, and what this is still needed for, is the one write the filter
 * cannot attribute: **a note card's position and size**. A card is unlocked so
 * a person can drag it, so a move of one is either that or this plugin
 * positioning it, and nothing in the change says which. Without the flag, a
 * sync's own write is read as a drag and fed to `updateCardFromDrag`, which
 * writes a bogus offset back into the record.
 *
 * It is also load-bearing for our own `.remove()` calls, which arrive as a
 * DELETE and are not filtered at all.
 *
 * Time-based, and that is its weakness: the release is deferred one tick past
 * the synchronous write because Figma delivers `nodechange` on the following
 * task — so a `nodechange` for a write inside a long async block can still
 * land after the window has closed. That is why `shapeFingerprint` exists for
 * connectors, and why a card's width is told apart by comparing what is on
 * the node rather than by this. Both of those are content-based and do not
 * depend on when an event turns up. Widening that approach to a card's
 * position would retire this mechanism; see B3 in `docs/remaining-work.md`.
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
 * Same idea, for an async block — which is where the card case above actually
 * arises: positioning a card during a normal sync or during stacking looks
 * identical to a person dragging it, and gets fed back into
 * `updateCardFromDrag`, which can overwrite the record with a bogus offset
 * read mid-write.
 *
 * The window has to span the whole async block, not just its synchronous
 * start, because the writes inside include awaited calls like
 * `setVectorNetworkAsync` — and spanning an async block is exactly where a
 * time-based window is least reliable.
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
