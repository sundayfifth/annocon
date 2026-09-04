/**
 * Shared by Annotate and Connect — both tag a rendered node with its
 * owner's id in a pluginData key (`annotationOwner` for cards/leaders,
 * `connectorLabelOwner` for a connector's label) and need to sweep up
 * whichever ones lost their owner without the plugin catching it live.
 */
/**
 * The pluginData key each feature tags its rendered nodes with. Declared
 * here, where the sweep that reads them lives, so the two features can
 * recognise each other's nodes without importing each other — a card and a
 * label pill are both `FRAME`s on the canvas, and each side needs to know
 * that the other's are not the user's own content.
 */
export const ANNOTATION_OWNER_KEY = 'annotationOwner'
export const CONNECTOR_LABEL_OWNER_KEY = 'connectorLabelOwner'

export function removeOrphansByOwnerKey(
  ownerKey: string,
  liveOwnerIds: ReadonlySet<string>
): number {
  const owned = figma.currentPage.findAllWithCriteria({ pluginData: { keys: [ownerKey] } })
  let removed = 0
  for (const node of owned) {
    const ownerId = node.getPluginData(ownerKey)
    if (ownerId !== '' && !liveOwnerIds.has(ownerId) && !node.removed) {
      node.remove()
      removed += 1
    }
  }
  return removed
}
