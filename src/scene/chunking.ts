/**
 * Shared by Annotate and Connect — both process a page's worth of nodes in
 * a loop that has to yield periodically, or a page with enough of them
 * stalls the main thread long enough that a person can't even click
 * Cancel.
 */

/** How many items a chunked loop processes before yielding back to the main thread. */
export const CHUNK_SIZE = 20

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
