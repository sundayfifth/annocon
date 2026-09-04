/**
 * Shared by Annotate and Connect — both tag a rendered node with its
 * owner's id in a pluginData key (`annotationOwner` for cards/leaders,
 * `connectorLabelOwner` for a connector's label) and need to sweep up
 * whichever ones lost their owner without the plugin catching it live.
 */
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
