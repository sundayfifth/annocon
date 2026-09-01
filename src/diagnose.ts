/**
 * Temporary. Reports what the router can see for the selected connector, as a
 * text node on the canvas. Delete once the question is settled.
 */

import type { Rect } from './core/anchor.js'
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

    const drawn = node.absoluteBoundingBox
    if (drawn !== null) {
      lines.push('')
      lines.push('  BOXES OVERLAPPING THE LINE (what it should have avoided):')
      const overlaps = (b: Rect): boolean =>
        b.x < drawn.x + drawn.width && b.x + b.width > drawn.x && b.y < drawn.y + drawn.height && b.y + b.height > drawn.y
      let found = 0
      const scan = (nodes: ReadonlyArray<SceneNode>, depth: number): void => {
        for (const child of nodes) {
          const b = 'absoluteBoundingBox' in child ? child.absoluteBoundingBox : null
          if (b !== null && overlaps(b) && ['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(child.type)) {
            found += 1
            if (found <= 25) lines.push(`${'  '.repeat(depth + 2)}${child.type} "${child.name}" ${box(child)}`)
          }
          if ((child.type === 'GROUP' || child.type === 'SECTION' || child.type === 'FRAME') && 'children' in child && depth < 2) {
            scan(child.children, depth + 1)
          }
        }
      }
      scan(page.children, 0)
      lines.push(`  (${found} overlapping in total)`)
    }

    lines.push('')
    lines.push('  DOES THE ROUTER SEE THE BOXES THE LINE HITS?')
    if (drawn !== null) {
      const seen = collectRouteObstacles()
      const seenIds = new Set(seen.map((o) => o.id))
      lines.push(`    router collected ${seen.length} boxes from this page`)
      const overlapsDrawn = (b: Rect): boolean =>
        b.x < drawn.x + drawn.width && b.x + b.width > drawn.x && b.y < drawn.y + drawn.height && b.y + b.height > drawn.y
      let hit = 0
      for (const child of page.children) {
        if (!('absoluteBoundingBox' in child)) continue
        const b = child.absoluteBoundingBox
        if (b === null || !overlapsDrawn(b)) continue
        if (!['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(child.type)) continue
        hit += 1
        if (hit > 20) continue
        const isOwn = seenIds.has(child.id) ? '' : ' ← NOT COLLECTED'
        const gap = Math.round(b.x + b.width - drawn.x)
        lines.push(`    ${child.type} "${child.name}" ${box(child)} overlap=${gap}px${isOwn}`)
      }
      lines.push(`    (${hit} top-level boxes overlap the line)`)
    }

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
