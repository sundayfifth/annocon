/**
 * Temporary. Reports what the router can see for the selected connector, as a
 * text node on the canvas. Delete once the question is settled.
 */

import { routeCrossings } from './core/connector.js'
import { collectRouteObstacles, getConnectorRecord } from './scene/connectorScene.js'

function box(node: SceneNode): string {
  const b = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null
  return b === null ? 'no-box' : `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`
}

/** The chain from the page down to `node`, so we can see what is nested in what. */
function ancestry(node: BaseNode): string {
  const parts: Array<string> = []
  let current: BaseNode | null = node
  while (current !== null && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    parts.push(`${current.type}("${current.name}")`)
    current = current.parent
  }
  return parts.reverse().join(' > ')
}

export default async function diagnose(): Promise<void> {
  const lines: Array<string> = []
  const page = figma.currentPage

  lines.push(`page children: ${page.children.length}`)
  const counts = new Map<string, number>()
  for (const node of page.children) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  }
  lines.push(`  by type: ${[...counts].map(([t, n]) => `${t}×${n}`).join(', ')}`)

  for (const node of page.selection) {
    if (node.type !== 'VECTOR') {
      lines.push(`selected ${node.type} "${node.name}" — not a connector`)
      continue
    }
    const record = getConnectorRecord(node)
    if (record === null) {
      lines.push(`selected VECTOR "${node.name}" — no connector record`)
      continue
    }
    lines.push('')
    lines.push(`CONNECTOR lineStyle=${record.lineStyle} detour=${record.detour}`)
    lines.push(`  drawn bbox: ${box(node)}`)
    for (const [which, anchor] of [['start', record.start], ['end', record.end]] as const) {
      if (anchor.kind === 'free') {
        lines.push(`  ${which}: free point`)
        continue
      }
      const target = await figma.getNodeByIdAsync(anchor.nodeId)
      if (target === null || !('absoluteBoundingBox' in target)) {
        lines.push(`  ${which}: node ${anchor.nodeId} is gone`)
        continue
      }
      lines.push(`  ${which}: ${box(target)}`)
      lines.push(`    nesting: ${ancestry(target)}`)
    }
    lines.push('')
    lines.push('  THE TWO SCREENS THE ROUTER EXEMPTS AS "OWN":')
    for (const [which, anchor] of [['start', record.start], ['end', record.end]] as const) {
      if (anchor.kind === 'free') continue
      const target = await figma.getNodeByIdAsync(anchor.nodeId)
      if (target === null || !('absoluteBoundingBox' in target)) continue
      let top: BaseNode = target
      while (top.parent !== null && top.parent.type !== 'PAGE' && top.parent.type !== 'DOCUMENT') {
        top = top.parent
      }
      const b = 'absoluteBoundingBox' in top ? top.absoluteBoundingBox : null
      lines.push(`    ${which} → ${top.type}("${top.name}") ${b === null ? '?' : `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`}`)
      if ('children' in top) {
        lines.push(`      children: ${top.children.length}`)
        for (const child of top.children.slice(0, 12)) {
          lines.push(`        ${child.type} "${child.name}" ${box(child)}`)
        }
      }
    }

    // The route as drawn, segment by segment — not its bounding box, which
    // for an elbow covers a great deal of canvas the line never touches.
    const transform = node.absoluteTransform
    const originX = transform[0]?.[2] ?? node.x
    const originY = transform[1]?.[2] ?? node.y
    const route = node.vectorNetwork.vertices.map((vertex) => ({
      x: vertex.x + originX,
      y: vertex.y + originY
    }))
    lines.push('')
    lines.push(`  ROUTE AS DRAWN (${route.length} points):`)
    for (const point of route.slice(0, 12)) {
      lines.push(`    ${Math.round(point.x)},${Math.round(point.y)}`)
    }

    const collected = collectRouteObstacles()
    lines.push('')
    lines.push(`  router collected ${collected.length} boxes`)
    lines.push('  BOXES THE DRAWN LINE ACTUALLY CUTS THROUGH:')
    let crossed = 0
    for (const obstacle of collected) {
      if (routeCrossings(route, [obstacle.rect]) === 0) continue
      crossed += 1
      if (crossed > 15) continue
      const owner = await figma.getNodeByIdAsync(obstacle.id)
      const name = owner === null ? obstacle.id : `"${owner.name}"`
      lines.push(
        `    ${name} ${Math.round(obstacle.rect.x)},${Math.round(obstacle.rect.y)} ${Math.round(obstacle.rect.width)}x${Math.round(obstacle.rect.height)}`
      )
    }
    lines.push(`    (${crossed} of ${collected.length} collected boxes are actually crossed)`)

    lines.push('')
    lines.push('  what the router treats as boxes (page level, groups/sections descended):')
    const walk = (nodes: ReadonlyArray<SceneNode>, depth: number): void => {
      for (const child of nodes) {
        const isContainer = child.type === 'GROUP' || child.type === 'SECTION'
        const counted = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(child.type)
        lines.push(
          `${'  '.repeat(depth + 2)}${child.type}${child.visible ? '' : '[hidden]'} "${child.name}" ${box(child)} ${counted ? '← OBSTACLE' : isContainer ? '← looked inside' : '← ignored'}`
        )
        if (isContainer && 'children' in child) walk(child.children, depth + 1)
      }
    }
    walk(page.children.slice(0, 40), 0)
  }

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  const report = figma.createText()
  report.fontName = { family: 'Inter', style: 'Regular' }
  report.fontSize = 13
  report.characters = lines.join('\n')
  report.name = 'ANNOCON diagnosis'
  report.x = figma.viewport.center.x
  report.y = figma.viewport.center.y
  figma.currentPage.appendChild(report)
  figma.viewport.scrollAndZoomIntoView([report])
  figma.closePlugin('Diagnosis written to a text node in the middle of your view.')
}
