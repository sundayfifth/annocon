import {
  Bold,
  Button,
  Container,
  Divider,
  Dropdown,
  IconButton,
  IconClose16,
  Muted,
  SegmentedControl,
  Tabs,
  Text,
  Textbox,
  TextboxMultiline,
  TextboxNumeric,
  VerticalSpace,
  render
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { Magnet } from './core/anchor.js'
import { ANNOTATION_SIZES, type AnnotationSize, DEFAULT_ANNOTATION_SIZE } from './core/annotation.js'
import { CATEGORY_PALETTE, type Category, contrastingTextColor } from './core/category.js'
import {
  CONNECTOR_CAPS,
  type ConnectorCap,
  type ConnectorDetour,
  type ConnectorLineStyle
} from './core/connector.js'
import { ICON_DATA_URL } from './icon.js'
import type {
  AddCategoryHandler,
  CategoriesChangedHandler,
  CreateConnectorHandler,
  DeleteCategoryHandler,
  RecolorCategoryHandler,
  RenameCategoryHandler,
  SelectionChangedHandler,
  SelectionSummary,
  SetAnnotationCategoryHandler,
  SetAnnotationSizeHandler,
  SetAnnotationTextHandler,
  UpdateConnectorAnchorHandler,
  UpdateConnectorStyleHandler
} from './messages.js'

interface PluginProps {
  selection: ReadonlyArray<SelectionSummary>
  categories: ReadonlyArray<Category>
}

/**
 * Nothing when there's no selection at all — every caller already follows
 * this with its own more specific guidance ("Select a layer, then type a
 * note…"), so a generic "Select a layer" line right above it was just
 * saying the same thing twice.
 */
function SelectionReadout({ selection }: { selection: ReadonlyArray<SelectionSummary> }) {
  if (selection.length === 0) {
    return null
  }
  if (selection.length === 1) {
    const node = selection[0] as SelectionSummary
    return (
      <Text>
        <Bold>{node.name}</Bold> <Muted>{node.type}</Muted>
      </Text>
    )
  }
  return (
    <Text>
      <Bold>{selection.length} layers</Bold> <Muted>selected</Muted>
    </Text>
  )
}

function Swatch({
  color,
  selected,
  onClick
}: {
  color: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '20px',
        height: '20px',
        borderRadius: '999px',
        backgroundColor: color,
        border: selected ? '2px solid var(--figma-color-text)' : '2px solid transparent',
        boxShadow: selected ? 'none' : '0 0 0 1px rgba(0, 0, 0, 0.1) inset',
        cursor: 'pointer',
        padding: 0
      }}
      title={color}
      type="button"
    />
  )
}

function SwatchPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {CATEGORY_PALETTE.map((color) => (
        <Swatch key={color} color={color} onClick={() => onChange(color)} selected={color === value} />
      ))}
    </div>
  )
}

/** One selectable pill — coloured for a real category, neutral for "None". Same colour+label shape as the pill rendered on the canvas card, so picking one previews what it'll look like there. */
function CategoryPill({
  color,
  label,
  selected,
  onClick
}: {
  color: string | null
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: color ?? 'var(--figma-color-bg-secondary)',
        border: selected ? '1.5px solid var(--figma-color-border-selected)' : '1.5px solid transparent',
        borderRadius: '999px',
        color: color === null ? 'var(--figma-color-text-secondary)' : contrastingTextColor(color),
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 600,
        height: 'var(--space-24)',
        opacity: selected ? 1 : 0.68,
        padding: '0 10px'
      }}
      type="button"
    >
      {label}
    </button>
  )
}

function CategoryPicker({
  categoryId,
  categories,
  onChange
}: {
  categoryId: string | null
  categories: ReadonlyArray<Category>
  onChange: (categoryId: string | null) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      <CategoryPill
        color={null}
        label="None"
        onClick={() => {
          onChange(null)
        }}
        selected={categoryId === null}
      />
      {categories.map((category) => (
        <CategoryPill
          color={category.color}
          key={category.id}
          label={category.name}
          onClick={() => {
            onChange(category.id)
          }}
          selected={categoryId === category.id}
        />
      ))}
    </div>
  )
}

const CAP_LABELS: Record<ConnectorCap, string> = {
  NONE: 'None',
  ARROW_LINES: 'Arrow (lines)',
  ARROW_EQUILATERAL: 'Arrow (filled)',
  DIAMOND_FILLED: 'Diamond',
  TRIANGLE_FILLED: 'Triangle',
  CIRCLE_FILLED: 'Circle'
}

/**
 * A short stub line ending in the cap's actual shape — not a generic icon,
 * a preview of what the connector end will look like — so picking a cap
 * doesn't require reading eight near-identical-length labels apart.
 */
function CapGlyph({ cap, color, size = 14 }: { cap: ConnectorCap; color: string; size?: number }) {
  const content = (() => {
    switch (cap) {
      case 'NONE':
        return <line stroke={color} strokeWidth="1.4" x1="2" x2="14" y1="8" y2="8" />
      case 'ARROW_LINES':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="10" y1="8" y2="8" />
            <path
              d="M7 4.5L11 8L7 11.5"
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
          </>
        )
      case 'ARROW_EQUILATERAL':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="8" y1="8" y2="8" />
            <path d="M8 5L13 8L8 11Z" fill={color} />
          </>
        )
      case 'DIAMOND_FILLED':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="8" y1="8" y2="8" />
            <path d="M11 5L14 8L11 11L8 8Z" fill={color} />
          </>
        )
      case 'TRIANGLE_FILLED':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="1" x2="8" y1="8" y2="8" />
            <path d="M8 5.5L14 8L8 10.5Z" fill={color} />
          </>
        )
      case 'CIRCLE_FILLED':
        return (
          <>
            <line stroke={color} strokeWidth="1.4" x1="2" x2="9" y1="8" y2="8" />
            <circle cx="12" cy="8" fill={color} r="3" />
          </>
        )
    }
  })()
  return (
    <svg height={size} style={{ flexShrink: 0 }} viewBox="0 0 16 16" width={size}>
      {content}
    </svg>
  )
}

/**
 * The cap picker as an icon button + flyout grid, Autoflow-style, instead
 * of a text `Dropdown` — the button previews the selected cap directly
 * rather than naming it. Sized to `--space-24`/`--border-radius-4`, the
 * same tokens `Dropdown` and `TextboxNumeric` use, so it lines up with the
 * Weight/Opacity/Corner-radius rows above it in this same panel.
 */
function CapIconPicker({
  label,
  value,
  isOpen,
  onToggle,
  onChange
}: {
  label: string
  value: ConnectorCap
  isOpen: boolean
  onToggle: () => void
  onChange: (cap: ConnectorCap) => void
}) {
  return (
    <div style={{ flex: '1 1 0', position: 'relative' }}>
      <Text>
        <Muted>{label}</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <button
        onClick={onToggle}
        style={{
          alignItems: 'center',
          background: 'var(--figma-color-bg)',
          border: `1px solid ${isOpen ? 'var(--figma-color-border-selected)' : 'var(--figma-color-border)'}`,
          borderRadius: 'var(--border-radius-4)',
          cursor: 'pointer',
          display: 'flex',
          gap: '6px',
          height: 'var(--space-24)',
          justifyContent: 'center',
          padding: '0 6px',
          width: '100%'
        }}
        title={CAP_LABELS[value]}
        type="button"
      >
        <CapGlyph cap={value} color="var(--figma-color-icon)" />
        <svg
          height="7"
          style={{
            color: 'var(--figma-color-icon-tertiary)',
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'none'
          }}
          viewBox="0 0 10 10"
          width="7"
        >
          <path
            d="M2 3.5L5 6.5L8 3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.3"
          />
        </svg>
      </button>
      {isOpen ? (
        <>
          {/* Closes the flyout on an outside click without stealing focus from whatever's clicked. */}
          <div
            onClick={onToggle}
            style={{ bottom: 0, left: 0, position: 'fixed', right: 0, top: 0, zIndex: 5 }}
          />
          <div
            style={{
              background: 'var(--figma-color-bg)',
              border: '1px solid var(--figma-color-border)',
              borderRadius: 'var(--border-radius-4)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
              display: 'grid',
              gap: '2px',
              // 3 columns × 2 rows fills exactly — 6 caps now that Round/Square
              // (see `ConnectorCap`) are gone, no trailing empty cells.
              gridTemplateColumns: 'repeat(3, var(--space-24))',
              left: 0,
              padding: '4px',
              position: 'absolute',
              top: 'calc(100% + 4px)',
              zIndex: 6
            }}
          >
            {CONNECTOR_CAPS.map((cap) => {
              const selected = cap === value
              return (
                <button
                  key={cap}
                  onClick={() => {
                    onChange(cap)
                  }}
                  style={{
                    alignItems: 'center',
                    background: selected ? 'var(--figma-color-bg-selected)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--border-radius-2)',
                    cursor: 'pointer',
                    display: 'flex',
                    height: 'var(--space-24)',
                    justifyContent: 'center',
                    width: 'var(--space-24)'
                  }}
                  title={CAP_LABELS[cap]}
                  type="button"
                >
                  <CapGlyph
                    cap={cap}
                    color={selected ? 'var(--figma-color-icon-selected)' : 'var(--figma-color-icon)'}
                  />
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

const LINE_STYLE_LABELS: Record<ConnectorLineStyle, string> = {
  STRAIGHT: 'Straight',
  CURVE: 'Curve',
  ELBOW: 'Elbow'
}

const LINE_STYLES: ReadonlyArray<ConnectorLineStyle> = ['STRAIGHT', 'CURVE', 'ELBOW']

/** A small preview of what the route itself will look like, not a name. */
function LineStyleGlyph({ style, color }: { style: ConnectorLineStyle; color: string }) {
  const content = (() => {
    switch (style) {
      case 'STRAIGHT':
        return <line stroke={color} strokeLinecap="round" strokeWidth="1.6" x1="4" x2="14" y1="14" y2="4" />
      case 'CURVE':
        return (
          <path
            d="M4 14C4 14 5 4 9 4C13 4 10 14 14 14"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth="1.6"
          />
        )
      case 'ELBOW':
        return (
          <path
            d="M4 14H10V4H14"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        )
    }
  })()
  return (
    <svg height="16" style={{ flexShrink: 0 }} viewBox="0 0 18 18" width="16">
      {content}
    </svg>
  )
}

/** Three icon toggles instead of `SegmentedControl`'s text labels — the route shape previews itself, Autoflow-style. */
function LineStylePicker({
  value,
  onChange
}: {
  value: ConnectorLineStyle
  onChange: (style: ConnectorLineStyle) => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--figma-color-border)',
        borderRadius: 'var(--border-radius-4)',
        display: 'flex',
        // `height` (not just the children's own) so this lines up exactly
        // with the 24px-tall inputs beside it — box-sizing: border-box (the
        // global reset) keeps the 1px border inside that height rather than
        // adding to it.
        height: 'var(--space-24)',
        overflow: 'hidden'
      }}
    >
      {LINE_STYLES.map((style, index) => {
        const selected = style === value
        return (
          <button
            key={style}
            onClick={() => {
              onChange(style)
            }}
            style={{
              alignItems: 'center',
              background: selected ? 'var(--figma-color-bg-selected)' : 'var(--figma-color-bg)',
              border: 'none',
              borderLeft: index === 0 ? 'none' : '1px solid var(--figma-color-border)',
              cursor: 'pointer',
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              width: 'var(--space-24)'
            }}
            title={LINE_STYLE_LABELS[style]}
            type="button"
          >
            <LineStyleGlyph
              color={selected ? 'var(--figma-color-icon-selected)' : 'var(--figma-color-icon)'}
              style={style}
            />
          </button>
        )
      })}
    </div>
  )
}

type MagnetSide = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'

const RESOLVED_MAGNET_SIDES: ReadonlyArray<MagnetSide> = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT']

const MAGNET_DOT_POSITION: Record<MagnetSide, { top: string; left: string }> = {
  TOP: { top: '0%', left: '50%' },
  RIGHT: { top: '50%', left: '100%' },
  BOTTOM: { top: '100%', left: '50%' },
  LEFT: { top: '50%', left: '0%' }
}

/**
 * The exit/entry side as a small clickable diagram — a square standing in
 * for "the shape", with a dot at each edge to pick a fixed side, instead of
 * naming sides in a text dropdown. Clicking the square itself (not a dot)
 * picks `AUTO`, whose ring lights up the same way a chosen dot would.
 */
function MagnetGraphicPicker({
  label,
  value,
  onChange
}: {
  label: string
  value: Magnet
  onChange: (magnet: Magnet) => void
}) {
  return (
    <div style={{ flex: '1 1 0' }}>
      <Text>
        <Muted>{label}</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <div style={{ alignItems: 'center', display: 'flex', height: '52px', justifyContent: 'center' }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              onChange('AUTO')
            }}
            style={{
              background: 'var(--figma-color-bg-secondary)',
              border: `1.5px solid ${
                value === 'AUTO' ? 'var(--figma-color-border-selected)' : 'var(--figma-color-border-strong)'
              }`,
              borderRadius: 'var(--border-radius-4)',
              cursor: 'pointer',
              display: 'block',
              height: '36px',
              width: '36px'
            }}
            title="Auto"
            type="button"
          />
          {RESOLVED_MAGNET_SIDES.map((side) => {
            const selected = value === side
            const position = MAGNET_DOT_POSITION[side]
            return (
              <button
                key={side}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(side)
                }}
                style={{
                  background: selected ? 'var(--figma-color-bg-brand)' : 'var(--figma-color-icon-tertiary)',
                  border: selected ? '1.5px solid var(--figma-color-bg)' : 'none',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  height: selected ? '13px' : '9px',
                  left: position.left,
                  padding: 0,
                  position: 'absolute',
                  top: position.top,
                  transform: 'translate(-50%, -50%)',
                  width: selected ? '13px' : '9px'
                }}
                title={side.charAt(0) + side.slice(1).toLowerCase()}
                type="button"
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * A section heading, visually distinct from the `Muted` item-level labels
 * (`CapIconPicker`'s "Start"/"End", say) sitting right underneath it — bold
 * and full-opacity text against their lighter, secondary-coloured captions,
 * so the hierarchy between "what this group of controls is" and "which one
 * of the pair this particular control is" actually reads at a glance.
 */
/**
 * Both axes' choices are offered at once rather than filtered to the pair
 * that applies. Which pair that is depends on where the two anchored nodes
 * currently sit, so it changes as they move — a picker whose options came
 * and went underneath you would be worse than one with two entries that
 * quietly mean "auto" for this line. `detourEdgeFor` in `core/connector.ts`
 * is what makes picking an inapplicable one harmless.
 */
const DETOUR_OPTIONS: Array<{ value: ConnectorDetour; text: string }> = [
  { text: 'Auto — shorter way, below if tied', value: 'AUTO' },
  { text: 'Above', value: 'TOP' },
  { text: 'Below', value: 'BOTTOM' },
  { text: 'Left', value: 'LEFT' },
  { text: 'Right', value: 'RIGHT' }
]

/**
 * Whole words rather than S/M/L: the control sits directly under the note
 * field with nothing labelling it, so it has to say what it does on its own.
 */
const SIZE_LABELS: Readonly<Record<AnnotationSize, string>> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large'
}

const SIZE_OPTIONS = ANNOTATION_SIZES.map((size) => ({
  value: size,
  children: SIZE_LABELS[size]
}))

function SectionLabel({ children }: { children: string }) {
  return (
    <Text>
      <Bold>{children}</Bold>
    </Text>
  )
}

function ConnectorStyleEditor({ node }: { node: SelectionSummary }) {
  const style = node.connectorStyle
  // `TextboxNumeric`'s `suffix` only gets appended to what's on screen once
  // the field has actually been blurred — baking it into the very first
  // value here is what makes the unit visible immediately, before anyone's
  // touched the field at all, instead of it looking unfinished until they do.
  const [weightText, setWeightText] = useState<string>(
    typeof style?.strokeWeight === 'undefined' ? '' : `${style.strokeWeight}px`
  )
  const [radiusText, setRadiusText] = useState<string>(
    typeof style?.cornerRadius === 'undefined' ? '' : `${style.cornerRadius}px`
  )
  const [opacityText, setOpacityText] = useState<string>(
    `${Math.round((style?.opacity ?? 1) * 100)}%`
  )
  const [labelText, setLabelText] = useState<string>(style?.label ?? '')
  // Only one flyout open at a time across the whole panel — colour and both cap pickers share this.
  const [openFlyout, setOpenFlyout] = useState<'color' | 'startCap' | 'endCap' | null>(null)
  if (style === null) return null

  const update = (
    changes: Partial<{
      color: string
      opacity: number
      strokeWeight: number
      startCap: ConnectorCap
      endCap: ConnectorCap
      lineStyle: ConnectorLineStyle
      cornerRadius: number
      detour: ConnectorDetour
      label: string
    }>
  ) => {
    emit<UpdateConnectorStyleHandler>('UPDATE_CONNECTOR_STYLE', { targetId: node.id, ...changes })
  }

  const updateAnchor = (side: 'start' | 'end', magnet: Magnet) => {
    emit<UpdateConnectorAnchorHandler>('UPDATE_CONNECTOR_ANCHOR', { targetId: node.id, side, magnet })
  }

  return (
    <>
      <VerticalSpace space="small" />
      <Text>
        <Bold>{node.name}</Bold> <Muted>{node.type}</Muted>
      </Text>
      <VerticalSpace space="medium" />
      <SectionLabel>Style</SectionLabel>
      <VerticalSpace space="extraSmall" />
      <div style={{ alignItems: 'center', display: 'flex', gap: '6px' }}>
        <div style={{ flex: '0 0 auto', position: 'relative' }}>
          <ColorSwatchTrigger
            color={style.color}
            isOpen={openFlyout === 'color'}
            onToggle={() => {
              setOpenFlyout(openFlyout === 'color' ? null : 'color')
            }}
          />
          {openFlyout === 'color' ? (
            <ColorFlyout
              onChange={(color) => {
                update({ color })
              }}
              onClose={() => {
                setOpenFlyout(null)
              }}
              value={style.color}
            />
          ) : null}
        </div>
        <div style={{ flex: '1 1 0' }}>
          <TextboxNumeric
            minimum={0.5}
            onBlur={() => {
              const parsed = Number.parseFloat(weightText)
              if (Number.isFinite(parsed) && parsed > 0) update({ strokeWeight: parsed })
            }}
            onValueInput={setWeightText}
            suffix="px"
            value={weightText}
          />
        </div>
        <div style={{ flex: '1 1 0' }}>
          <TextboxNumeric
            maximum={100}
            minimum={0}
            onBlur={() => {
              const parsed = Number.parseFloat(opacityText)
              if (Number.isFinite(parsed)) {
                const clamped = Math.min(100, Math.max(0, parsed))
                setOpacityText(String(clamped))
                update({ opacity: clamped / 100 })
              }
            }}
            onValueInput={setOpacityText}
            suffix="%"
            value={opacityText}
          />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <LineStylePicker
            onChange={(lineStyle) => {
              update({ lineStyle })
            }}
            value={style.lineStyle}
          />
        </div>
        {style.lineStyle === 'ELBOW' ? (
          <div style={{ flex: '1 1 0' }}>
            <TextboxNumeric
              minimum={0}
              onBlur={() => {
                const parsed = Number.parseFloat(radiusText)
                if (Number.isFinite(parsed) && parsed >= 0) update({ cornerRadius: parsed })
              }}
              onValueInput={setRadiusText}
              suffix="px"
              value={radiusText}
            />
          </div>
        ) : null}
      </div>
      <VerticalSpace space="medium" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <CapIconPicker
          isOpen={openFlyout === 'startCap'}
          label="Start"
          onChange={(startCap) => {
            update({ startCap })
            setOpenFlyout(null)
          }}
          onToggle={() => {
            setOpenFlyout(openFlyout === 'startCap' ? null : 'startCap')
          }}
          value={style.startCap}
        />
        <CapIconPicker
          isOpen={openFlyout === 'endCap'}
          label="End"
          onChange={(endCap) => {
            update({ endCap })
            setOpenFlyout(null)
          }}
          onToggle={() => {
            setOpenFlyout(openFlyout === 'endCap' ? null : 'endCap')
          }}
          value={style.endCap}
        />
      </div>
      <VerticalSpace space="medium" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <MagnetGraphicPicker
          label="Start"
          onChange={(magnet) => {
            updateAnchor('start', magnet)
          }}
          value={style.startMagnet}
        />
        <MagnetGraphicPicker
          label="End"
          onChange={(magnet) => {
            updateAnchor('end', magnet)
          }}
          value={style.endMagnet}
        />
      </div>
      {style.lineStyle === 'ELBOW' ? (
        <>
          <VerticalSpace space="medium" />
          <SectionLabel>Go around</SectionLabel>
          <VerticalSpace space="extraSmall" />
          <Dropdown
            onChange={(event) => {
              update({ detour: event.currentTarget.value as ConnectorDetour })
            }}
            options={DETOUR_OPTIONS}
            value={style.detour}
          />
        </>
      ) : null}
      <VerticalSpace space="medium" />
      <SectionLabel>Label</SectionLabel>
      <VerticalSpace space="extraSmall" />
      <Textbox
        onBlur={() => {
          update({ label: labelText })
        }}
        onValueInput={setLabelText}
        placeholder="Add text…"
        value={labelText}
      />
      <VerticalSpace space="medium" />
    </>
  )
}

function AnnotateEditor({
  node,
  categories
}: {
  node: SelectionSummary
  categories: ReadonlyArray<Category>
}) {
  const [text, setText] = useState<string>(node.annotationText ?? '')

  return (
    <>
      <VerticalSpace space="small" />
      <Text>
        <Bold>{node.name}</Bold> <Muted>{node.type}</Muted>
      </Text>
      <VerticalSpace space="small" />
      <CategoryPicker
        categories={categories}
        categoryId={node.categoryId}
        onChange={(categoryId) => {
          emit<SetAnnotationCategoryHandler>('SET_ANNOTATION_CATEGORY', { targetId: node.id, categoryId })
        }}
      />
      <VerticalSpace space="small" />
      <TextboxMultiline
        onBlur={() => {
          emit<SetAnnotationTextHandler>('SET_ANNOTATION_TEXT', { targetId: node.id, text })
        }}
        onValueInput={setText}
        placeholder="Type a note…"
        rows={3}
        value={text}
      />
      <VerticalSpace space="small" />
      <SegmentedControl
        onChange={(event) => {
          emit<SetAnnotationSizeHandler>('SET_ANNOTATION_SIZE', {
            targetId: node.id,
            size: event.currentTarget.value as AnnotationSize
          })
        }}
        options={SIZE_OPTIONS}
        value={node.annotationSize ?? DEFAULT_ANNOTATION_SIZE}
      />
      <VerticalSpace space="extraSmall" />
      <Text>
        <Muted>Drag the card's side edge on the canvas to widen it.</Muted>
      </Text>
      <VerticalSpace space="small" />
      <Text>
        <Muted>Renders as a leader line and note card on the canvas.</Muted>
      </Text>
      <VerticalSpace space="medium" />
    </>
  )
}

/**
 * A colour, shown as a small round trigger rather than the full swatch grid
 * sitting permanently open — with several rows (categories, or the
 * connector style panel's own colour field), a whole grid each was most of
 * what made those areas feel heavy. Opens the grid in a flyout instead, the
 * same interaction shape as `CapIconPicker`'s cap flyout, so recolouring
 * reuses a pattern this panel already teaches elsewhere.
 */
function ColorSwatchTrigger({
  color,
  isOpen,
  onToggle,
  size = 20
}: {
  color: string
  isOpen: boolean
  onToggle: () => void
  size?: number
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        background: color,
        border: `1px solid ${isOpen ? 'var(--figma-color-border-selected)' : 'transparent'}`,
        borderRadius: '50%',
        boxShadow: isOpen ? 'none' : '0 0 0 1px rgba(0, 0, 0, 0.1) inset',
        cursor: 'pointer',
        flexShrink: 0,
        height: `${size}px`,
        padding: 0,
        width: `${size}px`
      }}
      title="Change colour"
      type="button"
    />
  )
}

/** The flyout `ColorSwatchTrigger` opens — an outside-click-to-close overlay plus the palette grid. */
function ColorFlyout({
  value,
  onChange,
  onClose
}: {
  value: string
  onChange: (color: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div onClick={onClose} style={{ bottom: 0, left: 0, position: 'fixed', right: 0, top: 0, zIndex: 5 }} />
      <div
        style={{
          background: 'var(--figma-color-bg)',
          border: '1px solid var(--figma-color-border)',
          borderRadius: 'var(--border-radius-4)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
          left: 0,
          padding: '8px',
          position: 'absolute',
          top: 'calc(100% + 4px)',
          zIndex: 6
        }}
      >
        <SwatchPicker
          onChange={(next) => {
            onChange(next)
            onClose()
          }}
          value={value}
        />
      </div>
    </>
  )
}

function CategoryRow({
  category,
  isColorOpen,
  onToggleColor,
  onRename,
  onRecolor,
  onDelete
}: {
  category: Category
  isColorOpen: boolean
  onToggleColor: () => void
  onRename: (name: string) => void
  onRecolor: (color: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState<string>(category.name)
  const [deleteHovered, setDeleteHovered] = useState<boolean>(false)

  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: '8px', padding: '4px 0', position: 'relative' }}>
      <ColorSwatchTrigger color={category.color} isOpen={isColorOpen} onToggle={onToggleColor} />
      {isColorOpen ? (
        <ColorFlyout onChange={onRecolor} onClose={onToggleColor} value={category.color} />
      ) : null}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <Textbox
          onBlur={() => {
            // The scene layer silently rejects a blank name (renameCategory
            // no-ops on an empty trim) — without this, clearing the field
            // and clicking away leaves this textbox showing blank forever,
            // even though the stored name never actually changed.
            if (name.trim() === '') {
              setName(category.name)
              return
            }
            onRename(name)
          }}
          onValueInput={setName}
          value={name}
        />
      </div>
      {/* Neutral by default, danger-red only on hover — a permanent delete
          action shouldn't be a loud accent color sitting idle in every row. */}
      <div
        onMouseEnter={() => {
          setDeleteHovered(true)
        }}
        onMouseLeave={() => {
          setDeleteHovered(false)
        }}
        style={deleteHovered ? { color: 'var(--figma-color-icon-danger)' } : undefined}
      >
        <IconButton
          onClick={() => {
            onDelete()
          }}
        >
          <IconClose16 />
        </IconButton>
      </div>
    </div>
  )
}

function AddCategoryForm({ onAdd }: { onAdd: (name: string, color: string) => void }) {
  const [name, setName] = useState<string>('')
  const [color, setColor] = useState<string>(CATEGORY_PALETTE[0] as string)

  return (
    <>
      <Text>
        <Muted>Add a category</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <Textbox onValueInput={setName} placeholder="Category name" value={name} />
      <VerticalSpace space="small" />
      <SwatchPicker onChange={setColor} value={color} />
      <VerticalSpace space="small" />
      <Button
        disabled={name.trim() === ''}
        fullWidth
        onClick={() => {
          onAdd(name, color)
          setName('')
        }}
        secondary
      >
        Add category
      </Button>
    </>
  )
}

function CategoryManager({ categories }: { categories: ReadonlyArray<Category> }) {
  // Only one colour flyout open at a time, same rule as the cap pickers.
  const [openColorId, setOpenColorId] = useState<string | null>(null)

  return (
    <>
      <VerticalSpace space="small" />
      <SectionLabel>Categories</SectionLabel>
      <VerticalSpace space="extraSmall" />
      {categories.length === 0 ? (
        <Text>
          <Muted>No categories yet. Add one below, then pick it from the Annotate tab.</Muted>
        </Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {categories.map((category) => (
            <CategoryRow
              category={category}
              isColorOpen={openColorId === category.id}
              key={category.id}
              onDelete={() => {
                emit<DeleteCategoryHandler>('DELETE_CATEGORY', { id: category.id })
              }}
              onRecolor={(color) => {
                emit<RecolorCategoryHandler>('RECOLOR_CATEGORY', { id: category.id, color })
              }}
              onRename={(name) => {
                emit<RenameCategoryHandler>('RENAME_CATEGORY', { id: category.id, name })
              }}
              onToggleColor={() => {
                setOpenColorId(openColorId === category.id ? null : category.id)
              }}
            />
          ))}
        </div>
      )}
      <VerticalSpace space="medium" />
      <Divider />
      <VerticalSpace space="medium" />
      <AddCategoryForm
        onAdd={(name, color) => {
          emit<AddCategoryHandler>('ADD_CATEGORY', { name, color })
        }}
      />
      <VerticalSpace space="medium" />
    </>
  )
}

function Plugin({ selection: initialSelection, categories: initialCategories }: PluginProps) {
  const [selection, setSelection] = useState<ReadonlyArray<SelectionSummary>>(initialSelection)
  const [categories, setCategories] = useState<ReadonlyArray<Category>>(initialCategories)
  const [tab, setTab] = useState<string>(initialSelection.length === 2 ? 'Connect' : 'Annotate')
  // Once a person deliberately picks a tab, selection changes stop steering
  // them elsewhere — the auto-jump below is only for arriving at the right
  // place, not for wrestling the tab away from someone using it.
  const tabTouched = useRef<boolean>(false)

  useEffect(() => {
    // Picking exactly two non-connector layers is an unambiguous "I want
    // to connect these" signal — connect them immediately instead of
    // making a button click the reward for making that selection. Safe to
    // fire every time this pair comes up again: the main thread reselects
    // the existing connector rather than stacking a duplicate on top.
    const tryAutoConnect = (list: ReadonlyArray<SelectionSummary>) => {
      if (list.length !== 2) return
      const a = list[0]
      const b = list[1]
      if (typeof a === 'undefined' || typeof b === 'undefined') return
      if (a.connectorStyle === null && b.connectorStyle === null) {
        emit<CreateConnectorHandler>('CREATE_CONNECTOR', { startId: a.id, endId: b.id })
      }
    }
    tryAutoConnect(initialSelection)

    const offSelection = on<SelectionChangedHandler>('SELECTION_CHANGED', (next) => {
      setSelection(next)
      // Picking exactly two layers is an unambiguous "I want to connect
      // these" signal — jump straight to the tab that shows the result
      // instead of making that the reward for finding the right tab first.
      // Clicking a line, or the label pill on one, says the same thing about
      // a connector that already exists.
      const single = next.length === 1 ? next[0] : undefined
      if (!tabTouched.current && (next.length === 2 || single?.connectorStyle != null)) {
        setTab('Connect')
      }
      tryAutoConnect(next)
    })
    const offCategories = on<CategoriesChangedHandler>('CATEGORIES_CHANGED', (next) => {
      setCategories(next)
    })
    return () => {
      offSelection()
      offCategories()
    }
  }, [])

  return (
    <Container space="medium">
      <VerticalSpace space="small" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <img
          alt=""
          height={20}
          src={ICON_DATA_URL}
          style={{ borderRadius: '5px', display: 'block' }}
          width={20}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {/* Two stacked `<Text>`s here used to overlap: `Text`'s CSS leans on a
              translateY/negative-margin trick meant for lining it up next to a
              24px control in a single row, not for stacking two of them
              directly — so plain, unhacked spans instead. */}
          <span style={{ fontSize: 'var(--font-size-12)', fontWeight: 'var(--font-weight-bold)' }}>
            ANNOCON
          </span>
          <span style={{ color: 'var(--figma-color-text-secondary)' }}>Annotate &amp; Connect</span>
        </div>
      </div>
      <VerticalSpace space="small" />
      <Tabs
        onValueChange={(value) => {
          tabTouched.current = true
          setTab(value)
        }}
        value={tab}
        options={[
          {
            value: 'Annotate',
            children:
              selection.length === 1 ? (
                <AnnotateEditor
                  categories={categories}
                  // Keyed on the note as well as the layer, so text typed
                  // straight into the card on the canvas replaces what is in
                  // the box here. Typing in the box does not remount it: the
                  // record only changes on blur, which is when the two are
                  // meant to agree again.
                  key={`${(selection[0] as SelectionSummary).id}:${(selection[0] as SelectionSummary).annotationText ?? ''}`}
                  node={selection[0] as SelectionSummary}
                />
              ) : (
                <>
                  <VerticalSpace space="small" />
                  {selection.length > 0 ? (
                    <>
                      <SelectionReadout selection={selection} />
                      <VerticalSpace space="small" />
                    </>
                  ) : null}
                  <Text>
                    <Muted>
                      {selection.length === 0
                        ? 'Select a layer, then type a note to render it on the canvas.'
                        : 'Select a single layer to annotate.'}
                    </Muted>
                  </Text>
                  <VerticalSpace space="medium" />
                </>
              )
          },
          {
            value: 'Connect',
            children:
              selection.length === 1 && (selection[0] as SelectionSummary).connectorStyle !== null ? (
                <ConnectorStyleEditor
                  // Keyed on the label too, for the same reason as the
                  // annotation editor above: text typed into the pill on the
                  // canvas has to replace what is in the box here.
                  key={`${(selection[0] as SelectionSummary).id}:${(selection[0] as SelectionSummary).connectorStyle?.label ?? ''}`}
                  node={selection[0] as SelectionSummary}
                />
              ) : (
                <>
                  <VerticalSpace space="small" />
                  {selection.length > 0 ? (
                    <>
                      <SelectionReadout selection={selection} />
                      <VerticalSpace space="small" />
                    </>
                  ) : null}
                  <Text>
                    <Muted>
                      {selection.length === 2
                        ? 'Connecting — drew an arrow from the first layer you selected to the second, and keeps it attached as either one moves.'
                        : 'Select exactly two layers to connect them automatically, or select an existing connector to edit its style.'}
                    </Muted>
                  </Text>
                  <VerticalSpace space="medium" />
                </>
              )
          },
          {
            value: 'Categories',
            children: <CategoryManager categories={categories} />
          }
        ]}
      />
    </Container>
  )
}

export default render(Plugin)
