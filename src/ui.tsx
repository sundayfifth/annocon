import {
  Bold,
  Button,
  Container,
  Divider,
  Muted,
  Tabs,
  Text,
  VerticalSpace,
  render
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { useEffect, useState } from 'preact/hooks'

import type {
  CloseHandler,
  ResyncPageHandler,
  SelectionChangedHandler,
  SelectionSummary
} from './messages.js'

interface PluginProps {
  selection: ReadonlyArray<SelectionSummary>
}

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

function Plugin({ selection: initialSelection }: PluginProps) {
  const [selection, setSelection] = useState<ReadonlyArray<SelectionSummary>>(initialSelection)
  const [tab, setTab] = useState<string>('Annotate')

  useEffect(() => {
    const offSelection = on<SelectionChangedHandler>('SELECTION_CHANGED', (next) => {
      setSelection(next)
    })
    return () => {
      offSelection()
    }
  }, [])

  return (
    <Container space="medium">
      <VerticalSpace space="small" />
      <Tabs
        onValueChange={setTab}
        value={tab}
        options={[
          {
            value: 'Annotate',
            children: (
              <Container space="medium">
                <VerticalSpace space="medium" />
                <SelectionReadout selection={selection} />
                <VerticalSpace space="small" />
                <Text>
                  <Muted>
                    Phase 1: type a note here and it renders as real nodes on the canvas.
                  </Muted>
                </Text>
                <VerticalSpace space="medium" />
              </Container>
            )
          },
          {
            value: 'Connect',
            children: (
              <Container space="medium">
                <VerticalSpace space="medium" />
                <SelectionReadout selection={selection} />
                <VerticalSpace space="small" />
                <Text>
                  <Muted>
                    Phase 3: select two layers to draw a connector that stays attached.
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
