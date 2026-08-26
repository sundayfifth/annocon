import {
  Bold,
  Button,
  Container,
  Divider,
  Dropdown,
  type DropdownOption,
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
import { CATEGORY_PALETTE, type Category } from './core/category.js'
import { CONNECTOR_CAPS, type ConnectorCap, type ConnectorLineStyle } from './core/connector.js'
import { ICON_DATA_URL } from './icon.js'
import type {
  AddCategoryHandler,
  CategoriesChangedHandler,
  CloseHandler,
  CreateConnectorHandler,
  DeleteCategoryHandler,
  RecolorCategoryHandler,
  RenameCategoryHandler,
  ResyncPageHandler,
  SelectionChangedHandler,
  SelectionSummary,
  SetAnnotationCategoryHandler,
  SetAnnotationTextHandler,
  UpdateConnectorAnchorHandler,
  UpdateConnectorStyleHandler
} from './messages.js'

interface PluginProps {
  selection: ReadonlyArray<SelectionSummary>
  categories: ReadonlyArray<Category>
}

const NO_CATEGORY = '__none__'

function SelectionReadout({ selection }: { selection: ReadonlyArray<SelectionSummary> }) {
  if (selection.length === 0) {
    return (
      <Text>
        <Muted>Select a layer on the canvas.</Muted>
      </Text>
    )
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
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {CATEGORY_PALETTE.map((color) => (
        <Swatch key={color} color={color} onClick={() => onChange(color)} selected={color === value} />
      ))}
    </div>
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
  const options: Array<DropdownOption> = [
    { value: NO_CATEGORY, text: 'No category' },
    ...categories.map((category) => ({ value: category.id, text: category.name }))
  ]
  return (
    <Dropdown
      onValueChange={(value) => {
        onChange(value === NO_CATEGORY ? null : value)
      }}
      options={options}
      value={categoryId ?? NO_CATEGORY}
    />
  )
}

const CAP_LABELS: Record<ConnectorCap, string> = {
  NONE: 'None',
  ROUND: 'Round',
  SQUARE: 'Square',
  ARROW_LINES: 'Arrow (lines)',
  ARROW_EQUILATERAL: 'Arrow (filled)',
  DIAMOND_FILLED: 'Diamond',
  TRIANGLE_FILLED: 'Triangle',
  CIRCLE_FILLED: 'Circle'
}

const CAP_OPTIONS: Array<DropdownOption> = CONNECTOR_CAPS.map((cap) => ({
  value: cap,
  text: CAP_LABELS[cap]
}))

function CapPicker({
  label,
  value,
  onChange
}: {
  label: string
  value: ConnectorCap
  onChange: (cap: ConnectorCap) => void
}) {
  return (
    <div style={{ flex: '1 1 0' }}>
      <Text>
        <Muted>{label}</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <Dropdown
        onValueChange={(next) => {
          onChange(next as ConnectorCap)
        }}
        options={CAP_OPTIONS}
        value={value}
      />
    </div>
  )
}

const MAGNET_OPTIONS: Array<DropdownOption> = [
  { value: 'AUTO', text: 'Auto' },
  { value: 'TOP', text: 'Top' },
  { value: 'RIGHT', text: 'Right' },
  { value: 'BOTTOM', text: 'Bottom' },
  { value: 'LEFT', text: 'Left' }
]

function MagnetPicker({
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
      <Dropdown
        onValueChange={(next) => {
          onChange(next as Magnet)
        }}
        options={MAGNET_OPTIONS}
        value={value}
      />
    </div>
  )
}

function ConnectorStyleEditor({ node }: { node: SelectionSummary }) {
  const style = node.connectorStyle
  const [weightText, setWeightText] = useState<string>(String(style?.strokeWeight ?? ''))
  const [radiusText, setRadiusText] = useState<string>(String(style?.cornerRadius ?? ''))
  const [opacityText, setOpacityText] = useState<string>(
    String(Math.round((style?.opacity ?? 1) * 100))
  )
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
    }>
  ) => {
    emit<UpdateConnectorStyleHandler>('UPDATE_CONNECTOR_STYLE', { targetId: node.id, ...changes })
  }

  const updateAnchor = (side: 'start' | 'end', magnet: Magnet) => {
    emit<UpdateConnectorAnchorHandler>('UPDATE_CONNECTOR_ANCHOR', { targetId: node.id, side, magnet })
  }

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Text>
        <Bold>Connector style</Bold>
      </Text>
      <VerticalSpace space="small" />
      <Text>
        <Muted>Line</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <SegmentedControl
        onValueChange={(value) => {
          update({ lineStyle: value as ConnectorLineStyle })
        }}
        options={[
          { children: 'Straight', value: 'STRAIGHT' },
          { children: 'Curve', value: 'CURVE' },
          { children: 'Elbow', value: 'ELBOW' }
        ]}
        value={style.lineStyle}
      />
      {style.lineStyle === 'ELBOW' ? (
        <>
          <VerticalSpace space="small" />
          <Text>
            <Muted>Corner radius</Muted>
          </Text>
          <VerticalSpace space="extraSmall" />
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
        </>
      ) : null}
      <VerticalSpace space="small" />
      <Text>
        <Muted>Colour</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <SwatchPicker
        onChange={(color) => {
          update({ color })
        }}
        value={style.color}
      />
      <VerticalSpace space="small" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: '1 1 0' }}>
          <Text>
            <Muted>Weight</Muted>
          </Text>
          <VerticalSpace space="extraSmall" />
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
          <Text>
            <Muted>Opacity</Muted>
          </Text>
          <VerticalSpace space="extraSmall" />
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
      </div>
      <VerticalSpace space="small" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <CapPicker
          label="Start"
          onChange={(startCap) => {
            update({ startCap })
          }}
          value={style.startCap}
        />
        <CapPicker
          label="End"
          onChange={(endCap) => {
            update({ endCap })
          }}
          value={style.endCap}
        />
      </div>
      <VerticalSpace space="small" />
      <Text>
        <Muted>Exit / entry side</Muted>
      </Text>
      <VerticalSpace space="extraSmall" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <MagnetPicker
          label="Start"
          onChange={(magnet) => {
            updateAnchor('start', magnet)
          }}
          value={style.startMagnet}
        />
        <MagnetPicker
          label="End"
          onChange={(magnet) => {
            updateAnchor('end', magnet)
          }}
          value={style.endMagnet}
        />
      </div>
      <VerticalSpace space="medium" />
    </Container>
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
    <Container space="medium">
      <VerticalSpace space="medium" />
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
      <Text>
        <Muted>Renders as a badge, leader line, and note card on the canvas.</Muted>
      </Text>
      <VerticalSpace space="medium" />
    </Container>
  )
}

function CategoryRow({
  category,
  onRename,
  onRecolor,
  onDelete
}: {
  category: Category
  onRename: (name: string) => void
  onRecolor: (color: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState<string>(category.name)

  return (
    <Container space="medium">
      <VerticalSpace space="small" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: '1 1 auto' }}>
          <Textbox
            onBlur={() => {
              onRename(name)
            }}
            onValueInput={setName}
            value={name}
          />
        </div>
        <IconButton
          onClick={() => {
            onDelete()
          }}
        >
          <IconClose16 />
        </IconButton>
      </div>
      <VerticalSpace space="extraSmall" />
      <SwatchPicker onChange={onRecolor} value={category.color} />
      <VerticalSpace space="small" />
      <Divider />
    </Container>
  )
}

function AddCategoryForm({ onAdd }: { onAdd: (name: string, color: string) => void }) {
  const [name, setName] = useState<string>('')
  const [color, setColor] = useState<string>(CATEGORY_PALETTE[0] as string)

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Text>
        <Bold>Add a category</Bold>
      </Text>
      <VerticalSpace space="small" />
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
      <VerticalSpace space="medium" />
    </Container>
  )
}

function CategoryManager({ categories }: { categories: ReadonlyArray<Category> }) {
  return (
    <Container space="medium">
      {categories.length === 0 ? (
        <>
          <VerticalSpace space="medium" />
          <Text>
            <Muted>No categories yet. Add one below, then pick it from the Annotate tab.</Muted>
          </Text>
        </>
      ) : (
        categories.map((category) => (
          <CategoryRow
            category={category}
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
          />
        ))
      )}
      <AddCategoryForm
        onAdd={(name, color) => {
          emit<AddCategoryHandler>('ADD_CATEGORY', { name, color })
        }}
      />
    </Container>
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
      if (!tabTouched.current && next.length === 2) {
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
        <Text>
          <Bold>Annotate & Connect</Bold>
        </Text>
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
                  key={(selection[0] as SelectionSummary).id}
                  node={selection[0] as SelectionSummary}
                />
              ) : (
                <Container space="medium">
                  <VerticalSpace space="medium" />
                  <SelectionReadout selection={selection} />
                  <VerticalSpace space="small" />
                  <Text>
                    <Muted>
                      {selection.length === 0
                        ? 'Select a layer, then type a note to render it on the canvas.'
                        : 'Select a single layer to annotate.'}
                    </Muted>
                  </Text>
                  <VerticalSpace space="medium" />
                </Container>
              )
          },
          {
            value: 'Connect',
            children:
              selection.length === 1 && (selection[0] as SelectionSummary).connectorStyle !== null ? (
                <ConnectorStyleEditor
                  key={(selection[0] as SelectionSummary).id}
                  node={selection[0] as SelectionSummary}
                />
              ) : (
                <Container space="medium">
                  <VerticalSpace space="medium" />
                  <SelectionReadout selection={selection} />
                  <VerticalSpace space="small" />
                  <Text>
                    <Muted>
                      {selection.length === 2
                        ? 'Connecting — drew an arrow from the first layer you selected to the second, and keeps it attached as either one moves.'
                        : 'Select exactly two layers to connect them automatically, or select an existing connector to edit its style.'}
                    </Muted>
                  </Text>
                  <VerticalSpace space="small" />
                  <Button
                    fullWidth
                    secondary
                    onClick={() => {
                      emit<ResyncPageHandler>('RESYNC_PAGE')
                    }}
                  >
                    Re-sync this page
                  </Button>
                  <VerticalSpace space="medium" />
                </Container>
              )
          },
          {
            value: 'Categories',
            children: <CategoryManager categories={categories} />
          }
        ]}
      />
      <Divider />
      <VerticalSpace space="small" />
      <Button
        fullWidth
        secondary
        onClick={() => {
          emit<CloseHandler>('CLOSE')
        }}
      >
        Close
      </Button>
      <VerticalSpace space="small" />
    </Container>
  )
}

export default render(Plugin)
