import { useActiveTemplate, useStore, type InspectorTab } from '../store'
import { Button, ColorInput, Field, Group, NumberInput, Row, Select, TextInput, Toggle } from './controls'
import { ARTBOARD_PRESETS } from '../model/defaults'
import type { MasterTemplate, StyleRole, VectorItem, ZoneId } from '../model/template'
import { routeLabel, routesAtStop } from '../model/types'
import { BUNDLED_FONTS, FAMILY_LABELS } from '../layout/fonts'
import type { Page } from '../layout'

/** Every knob in the master template, grouped the way the work divides up. */

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'artboard', label: 'Artboard' },
  { id: 'flow', label: 'Flow' },
  { id: 'zones', label: 'Header & footer' },
  { id: 'type', label: 'Type' },
  { id: 'colour', label: 'Colour' },
  { id: 'rules', label: 'Rules' },
  { id: 'templates', label: 'Templates' },
  { id: 'stop', label: 'This stop' },
]

const STYLE_ROLES: Array<{ id: StyleRole; label: string; note?: string }> = [
  { id: 'title', label: 'Title' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'routeNumber', label: 'Route number' },
  { id: 'destination', label: 'Destination' },
  { id: 'viaList', label: 'Streets' },
  { id: 'columnHeader', label: 'Day-type heading' },
  { id: 'rowLabel', label: 'Row label' },
  { id: 'time', label: 'Departure time' },
  { id: 'hour', label: 'Hour', note: 'in the hourly grid' },
  { id: 'minute', label: 'Minutes', note: 'in the hourly grid' },
  { id: 'intervalValue', label: 'Headway figure' },
  { id: 'intervalUnit', label: 'Headway unit' },
  { id: 'note', label: 'Note' },
  { id: 'footerText', label: 'Footer text' },
]

const FONT_FAMILIES = [...new Set(BUNDLED_FONTS.map((f) => f.family))].map((family) => ({
  value: family,
  label: FAMILY_LABELS[family] ?? family,
}))

/** Only the weights a family actually has; the rest would silently snap. */
const weightsFor = (family: string) =>
  [...new Set(BUNDLED_FONTS.filter((f) => f.family === family).map((f) => f.weight))]
    .sort((a, b) => a - b)
    .map((w) => ({ value: String(w), label: String(w) }))

const useTemplateEdit = () => {
  const commit = useStore((s) => s.commit)
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  return (label: string, mutate: (t: MasterTemplate) => void) =>
    commit(label, (draft) => {
      const entry = draft.templates.find((t) => t.id === activeTemplateId)
      if (entry) mutate(entry.template)
    })
}

/* ------------------------------------------------------------------ panels */

const ArtboardPanel = () => {
  const t = useActiveTemplate()
  const edit = useTemplateEdit()

  return (
    <>
      <Group title="Size">
        <Field label="Preset">
          <Select
            value=""
            onChange={(id) => {
              const preset = ARTBOARD_PRESETS.find((p) => p.id === id)
              if (!preset) return
              edit('Artboard preset', (tpl) => {
                tpl.artboard.width = preset.width
                tpl.artboard.height = preset.height
              })
            }}
            options={[{ value: '', label: 'Choose…' }, ...ARTBOARD_PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
          />
        </Field>
        <Row>
          <Field label="Width">
            <NumberInput
              value={t.artboard.width}
              min={20}
              suffix="mm"
              onChange={(v) => edit('Width', (tpl) => void (tpl.artboard.width = v))}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={t.artboard.height}
              min={20}
              suffix="mm"
              onChange={(v) => edit('Height', (tpl) => void (tpl.artboard.height = v))}
            />
          </Field>
        </Row>
        <Button
          variant="ghost"
          onClick={() =>
            edit('Rotate', (tpl) => {
              const { width, height } = tpl.artboard
              tpl.artboard.width = height
              tpl.artboard.height = width
            })
          }
        >
          Swap width and height
        </Button>
      </Group>

      <Group title="Margins">
        <Row>
          <Field label="Top">
            <NumberInput value={t.artboard.margins.top} suffix="mm" onChange={(v) => edit('Margin', (tpl) => void (tpl.artboard.margins.top = v))} />
          </Field>
          <Field label="Bottom">
            <NumberInput value={t.artboard.margins.bottom} suffix="mm" onChange={(v) => edit('Margin', (tpl) => void (tpl.artboard.margins.bottom = v))} />
          </Field>
        </Row>
        <Row>
          <Field label="Left">
            <NumberInput value={t.artboard.margins.left} suffix="mm" onChange={(v) => edit('Margin', (tpl) => void (tpl.artboard.margins.left = v))} />
          </Field>
          <Field label="Right">
            <NumberInput value={t.artboard.margins.right} suffix="mm" onChange={(v) => edit('Margin', (tpl) => void (tpl.artboard.margins.right = v))} />
          </Field>
        </Row>
      </Group>

      <Group title="Print">
        <Field label="Bleed" hint="0 for a sheet that is not trimmed">
          <NumberInput value={t.artboard.bleed} min={0} step={0.5} suffix="mm" onChange={(v) => edit('Bleed', (tpl) => void (tpl.artboard.bleed = v))} />
        </Field>
        <Toggle
          label="Crop marks"
          value={t.artboard.cropMarks}
          onChange={(v) => edit('Crop marks', (tpl) => void (tpl.artboard.cropMarks = v))}
        />
      </Group>
    </>
  )
}

const FlowPanel = ({ page }: { page: Page | null }) => {
  const t = useActiveTemplate()
  const edit = useTemplateEdit()

  return (
    <>
      <Group title="Route blocks">
        <Field label="Columns" hint="auto follows the artboard">
          <Select
            value={t.flow.columns === 'auto' ? 'auto' : String(t.flow.columns)}
            onChange={(v) => edit('Columns', (tpl) => void (tpl.flow.columns = v === 'auto' ? 'auto' : Number(v)))}
            options={[{ value: 'auto', label: 'Auto' }, ...[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: `${n} per row` }))]}
          />
        </Field>

        <Field label="Block width" hint="sets how many fit, and how large the type is">
          <NumberInput
            value={t.flow.blockWidth}
            min={20}
            suffix="mm"
            onChange={(v) => edit('Block width', (tpl) => void (tpl.flow.blockWidth = v))}
          />
        </Field>

        <Toggle
          label="Stretch blocks to fill the row"
          value={t.flow.stretch}
          onChange={(v) => edit('Stretch', (tpl) => void (tpl.flow.stretch = v))}
        />
        {!t.flow.stretch ? (
          <Field label="Align">
            <Select
              value={t.flow.align}
              onChange={(v) => edit('Align', (tpl) => void (tpl.flow.align = v))}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Field>
        ) : null}

        <Row>
          <Field label="Column gap">
            <NumberInput value={t.flow.columnGap} min={0} suffix="mm" onChange={(v) => edit('Gap', (tpl) => void (tpl.flow.columnGap = v))} />
          </Field>
          <Field label="Row gap">
            <NumberInput value={t.flow.rowGap} min={0} suffix="mm" onChange={(v) => edit('Gap', (tpl) => void (tpl.flow.rowGap = v))} />
          </Field>
        </Row>
      </Group>

      <Group title="Fitting">
        <Toggle
          label="Shrink to fit when a sheet overflows"
          value={t.flow.autoFit}
          onChange={(v) => edit('Auto fit', (tpl) => void (tpl.flow.autoFit = v))}
        />
        <Field label="Smallest allowed" hint="below this the sheet is flagged instead">
          <NumberInput
            value={Math.round(t.flow.minScale * 100)}
            min={20}
            max={100}
            suffix="%"
            onChange={(v) => edit('Minimum scale', (tpl) => void (tpl.flow.minScale = v / 100))}
          />
        </Field>
        {page ? (
          <p className="readout">
            This sheet: {page.diagnostics.columns} columns, type at{' '}
            {(page.diagnostics.scale * 100).toFixed(0)}%
            {page.diagnostics.fitScale < 1 ? ` (shrunk from ${(page.diagnostics.scale / page.diagnostics.fitScale * 100).toFixed(0)}%)` : ''}.
          </p>
        ) : null}
      </Group>

      <Group title="Inside a block">
        <Row>
          <Field label="Label gutter">
            <NumberInput value={t.block.labelWidth} min={0} suffix="mm" onChange={(v) => edit('Gutter', (tpl) => void (tpl.block.labelWidth = v))} />
          </Field>
          <Field label="Between days">
            <NumberInput value={t.block.dayTypeGap} min={0} suffix="mm" onChange={(v) => edit('Gap', (tpl) => void (tpl.block.dayTypeGap = v))} />
          </Field>
        </Row>
        <Field label="Times per row" hint="auto fits as many as will go">
          <Select
            value={t.block.timesPerRow === 'auto' ? 'auto' : String(t.block.timesPerRow)}
            onChange={(v) => edit('Times per row', (tpl) => void (tpl.block.timesPerRow = v === 'auto' ? 'auto' : Number(v)))}
            options={[{ value: 'auto', label: 'Auto' }, ...[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: String(n) }))]}
          />
        </Field>
        <Row>
          <Field label="Hour grid columns" hint="splits a long grid across the cell; 1 keeps one column">
            <NumberInput
              value={t.block.maxCellColumns}
              min={1}
              max={8}
              onChange={(v) => edit('Grid columns', (tpl) => void (tpl.block.maxCellColumns = v))}
            />
          </Field>
          <Field label="Between them">
            <NumberInput
              value={t.block.cellColumnGap}
              min={0}
              step={0.5}
              suffix="mm"
              onChange={(v) => edit('Grid columns', (tpl) => void (tpl.block.cellColumnGap = v))}
            />
          </Field>
        </Row>
        <Toggle label="Show street list" value={t.block.showViaList} onChange={(v) => edit('Streets', (tpl) => void (tpl.block.showViaList = v))} />
        <Toggle label="Show day-type headings" value={t.block.showColumnHeaders} onChange={(v) => edit('Headings', (tpl) => void (tpl.block.showColumnHeaders = v))} />
      </Group>

      <Group title="Route badge">
        <Field label="Shape">
          <Select
            value={t.block.badge.shape}
            onChange={(v) => edit('Badge', (tpl) => void (tpl.block.badge.shape = v))}
            options={[
              { value: 'rounded', label: 'Rounded' },
              { value: 'square', label: 'Square' },
              { value: 'pill', label: 'Pill' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Field>
        <Field label="Fill">
          <Select
            value={t.block.badge.fill}
            onChange={(v) => edit('Badge', (tpl) => void (tpl.block.badge.fill = v))}
            options={[
              { value: 'route', label: 'Route colour' },
              { value: 'accent', label: 'Accent' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Field>
        <Row>
          <Field label="Width">
            <NumberInput value={t.block.badge.width} min={4} suffix="mm" onChange={(v) => edit('Badge', (tpl) => void (tpl.block.badge.width = v))} />
          </Field>
          <Field label="Height">
            <NumberInput value={t.block.badge.height} min={4} suffix="mm" onChange={(v) => edit('Badge', (tpl) => void (tpl.block.badge.height = v))} />
          </Field>
        </Row>
        <Toggle
          label="Rule above the block in the route colour"
          value={t.block.badge.topRule.show}
          onChange={(v) => edit('Badge rule', (tpl) => void (tpl.block.badge.topRule.show = v))}
        />
      </Group>
    </>
  )
}

const newItem = (kind: VectorItem['kind'], zone: ZoneId): VectorItem => {
  const base = {
    id: `${zone}-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    x: 4,
    y: 4,
    w: 40,
    h: 10,
    anchorX: 'left' as const,
    anchorY: 'top' as const,
    locked: false,
  }
  switch (kind) {
    case 'text':
      return { ...base, kind: 'text', text: 'Text', role: 'footerText', align: 'left', valign: 'top' }
    case 'shape':
      return { ...base, kind: 'shape', shape: 'rect', fill: 'accent', stroke: 'none', strokeWidth: 0.3, radius: 0 }
    case 'pattern':
      return { ...base, kind: 'pattern', source: '<rect width="10" height="10" fill="#ddd"/>', tileWidth: 10 }
    case 'image':
      return { ...base, kind: 'image', source: '', format: 'svg', fit: 'contain' }
  }
}

const ZonesPanel = () => {
  const t = useActiveTemplate()
  const edit = useTemplateEdit()
  const selection = useStore((s) => s.selection)
  const selectItem = useStore((s) => s.selectItem)
  const addZoneItem = useStore((s) => s.addZoneItem)
  const removeZoneItem = useStore((s) => s.removeZoneItem)

  const selected = selection.zone
    ? t.zones[selection.zone].items.find((i) => i.id === selection.itemId)
    : undefined

  return (
    <>
      {(['header', 'footer'] as ZoneId[]).map((zone) => (
        <Group key={zone} title={zone === 'header' ? 'Header band' : 'Footer band'}>
          <Field label="Height" hint="the schedule is laid out in what is left">
            <NumberInput
              value={t.zones[zone].height}
              min={0}
              suffix="mm"
              onChange={(v) => edit('Band height', (tpl) => void (tpl.zones[zone].height = v))}
            />
          </Field>
          <Field
            label={zone === 'header' ? 'Space below' : 'Space above'}
            hint="plain gap between the band and the schedule; the fill does not follow it in"
          >
            <NumberInput
              value={t.zones[zone].contentGap}
              min={0}
              suffix="mm"
              onChange={(v) => edit('Band gap', (tpl) => void (tpl.zones[zone].contentGap = v))}
            />
          </Field>
          <Field label="Type scale" hint="band type is sized against the sheet, not the block">
            <NumberInput
              value={Math.round(t.zones[zone].scale * 100)}
              min={20}
              max={400}
              suffix="%"
              onChange={(v) => edit('Band scale', (tpl) => void (tpl.zones[zone].scale = v / 100))}
            />
          </Field>
          <Toggle
            label="Divider rule"
            value={t.zones[zone].divider.show}
            onChange={(v) => edit('Divider', (tpl) => void (tpl.zones[zone].divider.show = v))}
          />
          <Field label="Background">
            <ColorInput
              value={t.zones[zone].background === 'none' ? '#ffffff' : String(t.zones[zone].background)}
              onChange={(v) => edit('Band fill', (tpl) => void (tpl.zones[zone].background = v))}
            />
          </Field>
          <Toggle
            label="No background"
            value={t.zones[zone].background === 'none'}
            onChange={(v) => edit('Band fill', (tpl) => void (tpl.zones[zone].background = v ? 'none' : '#f4f4f5'))}
          />
          <Toggle
            label="Stack text items"
            value={t.zones[zone].stack}
            onChange={(v) => edit('Stack', (tpl) => void (tpl.zones[zone].stack = v))}
          />
          {t.zones[zone].stack ? (
            <Field label="Space between them">
              <NumberInput
                value={t.zones[zone].stackGap}
                min={0}
                step={0.5}
                suffix="mm"
                onChange={(v) => edit('Stack gap', (tpl) => void (tpl.zones[zone].stackGap = v))}
              />
            </Field>
          ) : null}

          <Toggle
            label="Pictogram to the left of the text"
            value={t.zones[zone].pictogram.show}
            onChange={(v) => edit('Pictogram', (tpl) => void (tpl.zones[zone].pictogram.show = v))}
          />
          {t.zones[zone].pictogram.show ? (
            <>
              <Row>
                <Field label="Size">
                  <NumberInput
                    value={t.zones[zone].pictogram.size}
                    min={2}
                    suffix="mm"
                    onChange={(v) => edit('Pictogram', (tpl) => void (tpl.zones[zone].pictogram.size = v))}
                  />
                </Field>
                <Field label="Gap">
                  <NumberInput
                    value={t.zones[zone].pictogram.gap}
                    min={0}
                    suffix="mm"
                    onChange={(v) => edit('Pictogram', (tpl) => void (tpl.zones[zone].pictogram.gap = v))}
                  />
                </Field>
              </Row>
              <Field label="Align with the text">
                <Select
                  value={t.zones[zone].pictogram.align}
                  onChange={(v) => edit('Pictogram', (tpl) => void (tpl.zones[zone].pictogram.align = v))}
                  options={[
                    { value: 'top', label: 'Top' },
                    { value: 'middle', label: 'Middle' },
                    { value: 'bottom', label: 'Bottom' },
                  ]}
                />
              </Field>
              <Row>
                <Button variant="ghost" onClick={() => void loadPictogram(zone, edit)}>
                  {t.zones[zone].pictogram.source ? 'Replace artwork…' : 'Choose artwork…'}
                </Button>
                {t.zones[zone].pictogram.source ? (
                  <Button
                    variant="danger"
                    onClick={() => edit('Pictogram', (tpl) => void (tpl.zones[zone].pictogram.source = ''))}
                  >
                    Clear
                  </Button>
                ) : null}
              </Row>
            </>
          ) : null}

          <ul className="item-list">
            {t.zones[zone].items.map((item) => (
              <li key={item.id}>
                <button
                  className={`item${selection.itemId === item.id ? ' is-selected' : ''}`}
                  onClick={() => selectItem(zone, item.id)}
                >
                  <em>{item.kind}</em>
                  {item.kind === 'text' ? item.text : item.kind === 'image' ? 'artwork' : item.kind}
                </button>
                <button className="remove" title="Remove" onClick={() => removeZoneItem(zone, item.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>

          <Row>
            <Button variant="ghost" onClick={() => addZoneItem(zone, newItem('text', zone))}>
              + Text
            </Button>
            <Button variant="ghost" onClick={() => addZoneItem(zone, newItem('shape', zone))}>
              + Shape
            </Button>
            <Button variant="ghost" onClick={() => void importArtwork(zone, addZoneItem)}>
              + Artwork
            </Button>
          </Row>
        </Group>
      ))}

      {selected && selection.zone ? <ItemPanel zone={selection.zone} item={selected} /> : null}
    </>
  )
}

/** Load a mark for the pictogram slot. */
const loadPictogram = async (
  zone: ZoneId,
  edit: (label: string, mutate: (t: MasterTemplate) => void) => void,
): Promise<void> => {
  const { openFiles } = await import('../platform')
  const files = await openFiles([{ name: 'Artwork', extensions: ['svg', 'png', 'jpg', 'jpeg'] }])
  const file = files[0]
  if (!file) return

  const isSvg = file.name.toLowerCase().endsWith('.svg')
  edit('Pictogram', (tpl) => {
    const p = tpl.zones[zone].pictogram
    if (isSvg) {
      p.source = unwrapSvg(new TextDecoder().decode(file.bytes))
      p.format = 'svg'
    } else {
      p.source = toDataUri(file.name, file.bytes)
      p.format = 'raster'
    }
  })
}

/** Strip the outer <svg> so artwork nests in the sheet's own viewport. */
const unwrapSvg = (markup: string): string =>
  markup.replace(/<\?xml[^>]*\?>/g, '').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '')

const toDataUri = (name: string, bytes: Uint8Array): string => {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  const mime = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${btoa(binary)}`
}

/** Bring in a logo or an ornament for a band. */
const importArtwork = async (zone: ZoneId, add: (zone: ZoneId, item: VectorItem) => void) => {
  const { openFiles } = await import('../platform')
  const files = await openFiles([{ name: 'Artwork', extensions: ['svg', 'png', 'jpg', 'jpeg'] }])
  const file = files[0]
  if (!file) return

  const isSvg = file.name.toLowerCase().endsWith('.svg')
  const item = newItem('image', zone) as Extract<VectorItem, { kind: 'image' }>

  if (isSvg) {
    item.source = unwrapSvg(new TextDecoder().decode(file.bytes))
    item.format = 'svg'
  } else {
    item.source = toDataUri(file.name, file.bytes)
    item.format = 'raster'
  }

  add(zone, item)
}

const ItemPanel = ({ zone, item }: { zone: ZoneId; item: VectorItem }) => {
  const edit = useTemplateEdit()
  const update = (mutate: (i: VectorItem) => void) =>
    edit('Item', (tpl) => {
      const target = tpl.zones[zone].items.find((i) => i.id === item.id)
      if (target) mutate(target)
    })

  return (
    <Group title="Selected item">
      <Row>
        <Field label="X">
          <NumberInput value={item.x} suffix="mm" onChange={(v) => update((i) => void (i.x = v))} />
        </Field>
        <Field label="Y">
          <NumberInput value={item.y} suffix="mm" onChange={(v) => update((i) => void (i.y = v))} />
        </Field>
      </Row>
      <Row>
        <Field label="Width">
          <NumberInput value={item.w} min={1} suffix="mm" onChange={(v) => update((i) => void (i.w = v))} />
        </Field>
        <Field label="Height">
          <NumberInput value={item.h} min={1} suffix="mm" onChange={(v) => update((i) => void (i.h = v))} />
        </Field>
      </Row>
      <Row>
        <Field label="Anchor X">
          <Select
            value={item.anchorX}
            onChange={(v) => update((i) => void (i.anchorX = v))}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </Field>
        <Field label="Anchor Y">
          <Select
            value={item.anchorY}
            onChange={(v) => update((i) => void (i.anchorY = v))}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'center', label: 'Centre' },
              { value: 'bottom', label: 'Bottom' },
            ]}
          />
        </Field>
      </Row>

      {item.kind === 'text' ? (
        <>
          <Field label="Text" hint="{stop} {direction} {terminals} {routes} {date}">
            <TextInput value={item.text} onChange={(v) => update((i) => void ((i as typeof item).text = v))} />
          </Field>
          <Field label="Style role">
            <Select
              value={item.role}
              onChange={(v) => update((i) => void ((i as typeof item).role = v))}
              options={STYLE_ROLES.map((r) => ({ value: r.id, label: r.label }))}
            />
          </Field>
          <Row>
            <Field label="Align">
              <Select
                value={item.align}
                onChange={(v) => update((i) => void ((i as typeof item).align = v))}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Centre' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </Field>
            <Field label="Vertical">
              <Select
                value={item.valign}
                onChange={(v) => update((i) => void ((i as typeof item).valign = v))}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'middle', label: 'Middle' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
              />
            </Field>
          </Row>
          <Toggle
            label="Frame around the text"
            value={item.frame?.show ?? false}
            onChange={(v) =>
              update((i) => {
                const text = i as typeof item
                text.frame ??= { show: v, fill: 'none', stroke: 'rule', strokeWidth: 0.3, radius: 2, padding: { top: 3, right: 4, bottom: 3, left: 4 } }
                text.frame.show = v
              })
            }
          />
        </>
      ) : null}

      {item.kind === 'shape' ? (
        <Row>
          <Field label="Fill">
            <TextInput value={String(item.fill)} onChange={(v) => update((i) => void ((i as typeof item).fill = v))} />
          </Field>
          <Field label="Radius">
            <NumberInput value={item.radius} min={0} suffix="mm" onChange={(v) => update((i) => void ((i as typeof item).radius = v))} />
          </Field>
        </Row>
      ) : null}

      <Toggle label="Locked" value={item.locked} onChange={(v) => update((i) => void (i.locked = v))} />
    </Group>
  )
}

const TypePanel = () => {
  const t = useActiveTemplate()
  const edit = useTemplateEdit()

  return (
    <>
      <Group title="Wording">
        <Field label="Title" hint="{stop} {direction} {terminals} {routes} {date}">
          <TextInput value={t.title.template} onChange={(v) => edit('Title', (tpl) => void (tpl.title.template = v))} />
        </Field>
        <Field label="Subtitle">
          <TextInput
            value={t.title.subtitleTemplate}
            onChange={(v) => edit('Subtitle', (tpl) => void (tpl.title.subtitleTemplate = v))}
          />
        </Field>
        <Field label="Headway row">
          <TextInput
            value={t.block.labels.interval}
            onChange={(v) => edit('Label', (tpl) => void (tpl.block.labels.interval = v))}
          />
        </Field>
        <Row>
          <Field label="First departures">
            <TextInput value={t.block.labels.firstTrips} onChange={(v) => edit('Label', (tpl) => void (tpl.block.labels.firstTrips = v))} />
          </Field>
          <Field label="Last departures">
            <TextInput value={t.block.labels.lastTrips} onChange={(v) => edit('Label', (tpl) => void (tpl.block.labels.lastTrips = v))} />
          </Field>
        </Row>
        <Row>
          <Field label="Departures">
            <TextInput value={t.block.labels.times} onChange={(v) => edit('Label', (tpl) => void (tpl.block.labels.times = v))} />
          </Field>
          <Field label="Headway unit">
            <TextInput value={t.block.intervalUnit} onChange={(v) => edit('Unit', (tpl) => void (tpl.block.intervalUnit = v))} />
          </Field>
        </Row>
        <Row>
          <Field label="Average headway within" hint="A range this narrow prints as one figure">
            <NumberInput
              value={t.block.intervalAverageThreshold}
              min={0}
              suffix="min"
              onChange={(v) => edit('Rules', (tpl) => void (tpl.block.intervalAverageThreshold = v))}
            />
          </Field>
          <Field label="Average prefix">
            <TextInput
              value={t.block.intervalAveragePrefix}
              onChange={(v) => edit('Unit', (tpl) => void (tpl.block.intervalAveragePrefix = v))}
            />
          </Field>
        </Row>
      </Group>

      <Group title="Night routes">
        <Field label="Heading" hint="above the night-routes list at the foot of the sheet">
          <TextInput
            value={t.block.labels.nightRoutes}
            onChange={(v) => edit('Label', (tpl) => void (tpl.block.labels.nightRoutes = v))}
          />
        </Field>
        <Row>
          <Field label="Space before" hint="between the day grid and this section">
            <NumberInput
              value={t.block.nightSection.gapBefore}
              min={0}
              suffix="mm"
              onChange={(v) => edit('Night routes', (tpl) => void (tpl.block.nightSection.gapBefore = v))}
            />
          </Field>
          <Field label="Space after heading" hint="between the heading and the first block">
            <NumberInput
              value={t.block.nightSection.gapAfterHeading}
              min={0}
              suffix="mm"
              onChange={(v) => edit('Night routes', (tpl) => void (tpl.block.nightSection.gapAfterHeading = v))}
            />
          </Field>
        </Row>
        <Toggle
          label="Divider rule"
          value={t.block.nightSection.divider.show}
          onChange={(v) => edit('Night routes', (tpl) => void (tpl.block.nightSection.divider.show = v))}
        />
        {t.block.nightSection.divider.show ? (
          <Row>
            <Field label="Thickness">
              <NumberInput
                value={t.block.nightSection.divider.thickness}
                min={0.1}
                step={0.1}
                suffix="mm"
                onChange={(v) => edit('Night routes', (tpl) => void (tpl.block.nightSection.divider.thickness = v))}
              />
            </Field>
            <Field label="Colour">
              <ColorInput
                value={String(t.block.nightSection.divider.color)}
                onChange={(v) => edit('Night routes', (tpl) => void (tpl.block.nightSection.divider.color = v))}
              />
            </Field>
          </Row>
        ) : null}
      </Group>

      {STYLE_ROLES.map((role) => {
        const style = t.styles[role.id]
        return (
          <Group key={role.id} title={role.note ? `${role.label} — ${role.note}` : role.label}>
            <Row>
              <Field label="Family">
                <Select
                  value={style.family}
                  onChange={(v) => edit('Font', (tpl) => void (tpl.styles[role.id].family = v))}
                  options={FONT_FAMILIES}
                />
              </Field>
              <Field label="Weight">
                <Select
                  value={String(style.weight)}
                  onChange={(v) => edit('Weight', (tpl) => void (tpl.styles[role.id].weight = Number(v)))}
                  options={weightsFor(style.family)}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Size">
                <NumberInput
                  value={style.sizePt}
                  min={2}
                  step={0.5}
                  suffix="pt"
                  onChange={(v) => edit('Size', (tpl) => void (tpl.styles[role.id].sizePt = v))}
                />
              </Field>
              <Field label="Leading">
                <NumberInput
                  value={style.lineHeight}
                  min={0.8}
                  step={0.05}
                  suffix="×"
                  onChange={(v) => edit('Leading', (tpl) => void (tpl.styles[role.id].lineHeight = v))}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Tracking">
                <NumberInput
                  value={style.tracking}
                  step={0.01}
                  suffix="em"
                  onChange={(v) => edit('Tracking', (tpl) => void (tpl.styles[role.id].tracking = v))}
                />
              </Field>
              <Field label="Case">
                <Select
                  value={style.transform}
                  onChange={(v) => edit('Case', (tpl) => void (tpl.styles[role.id].transform = v))}
                  options={[
                    { value: 'none', label: 'As typed' },
                    { value: 'uppercase', label: 'Upper' },
                    { value: 'lowercase', label: 'Lower' },
                  ]}
                />
              </Field>
            </Row>
            <Field label="Colour">
              <ColorInput
                value={style.color}
                onChange={(v) => edit('Colour', (tpl) => void (tpl.styles[role.id].color = v))}
              />
            </Field>
          </Group>
        )
      })}
    </>
  )
}

const ColourPanel = () => {
  const t = useActiveTemplate()
  const edit = useTemplateEdit()
  const slots = [
    ['paper', 'Paper'],
    ['ink', 'Ink'],
    ['muted', 'Muted'],
    ['accent', 'Accent'],
    ['rule', 'Rules'],
  ] as const

  return (
    <Group title="Palette">
      <p className="readout">
        Route colours come from the timetable, not from here — these are the sheet's own.
      </p>
      {slots.map(([key, label]) => (
        <Field key={key} label={label}>
          <ColorInput
            value={t.palette[key]}
            onChange={(v) => edit('Palette', (tpl) => void (tpl.palette[key] = v))}
          />
        </Field>
      ))}
    </Group>
  )
}

const RulesPanel = () => {
  const t = useActiveTemplate()
  const edit = useTemplateEdit()

  return (
    <>
      <Group title="When to quote a headway">
        <p className="readout">
          A stretch of the day becomes “every N minutes” when the service is regular enough; the rest is
          listed, or set out hour by hour once there is too much to list.
        </p>
        <Field label="At least this many departures">
          <NumberInput value={t.rules.minTripsForInterval} min={2} onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.minTripsForInterval = v))} />
        </Field>
        <Field label="Longest headway to quote" hint="beyond this, exact departure times are listed instead">
          <NumberInput value={t.rules.maxHeadwayForInterval} min={1} suffix="min" onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.maxHeadwayForInterval = v))} />
        </Field>
        <Field label="Shortest stretch">
          <NumberInput value={t.rules.minSpanForInterval} min={10} suffix="min" onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.minSpanForInterval = v))} />
        </Field>
        <Field label="Allowed wobble" hint="or half the headway, whichever is larger">
          <NumberInput value={t.rules.headwayTolerance} min={0} suffix="min" onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.headwayTolerance = v))} />
        </Field>
        <Field label="Widest range" hint="“every 5–25 min” tells nobody anything">
          <NumberInput value={t.rules.maxHeadwayRatio} min={1} step={0.1} suffix="×" onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.maxHeadwayRatio = v))} />
        </Field>
      </Group>

      <Group title="Edges of the day">
        <Field label="First departures shown" hint="a headway always shows at least one">
          <NumberInput value={t.rules.firstTripsCount} min={1} onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.firstTripsCount = v))} />
        </Field>
        <Field label="Last departures shown" hint="…and the one it runs to">
          <NumberInput value={t.rules.lastTripsCount} min={1} onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.lastTripsCount = v))} />
        </Field>
        <Toggle label="Round headway spans to whole hours" value={t.rules.snapBoundariesToHour} onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.snapBoundariesToHour = v))} />
        <Toggle label="Print service after midnight as 24:37" value={t.rules.postMidnightAsHour24} onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.postMidnightAsHour24 = v))} />
      </Group>

      <Group title="Hour-by-hour grid">
        <Field label="Switch to a grid above">
          <NumberInput value={t.rules.hourlyThreshold} min={4} suffix="departures" onChange={(v) => edit('Rules', (tpl) => void (tpl.rules.hourlyThreshold = v))} />
        </Field>
      </Group>
    </>
  )
}

/**
 * The template library.
 *
 * A project can hold more than one master template — different shelter
 * shapes, different sponsors' artwork — and every stop uses one of them: the
 * project's default unless it says otherwise. Ticking a stop here is the same
 * assignment as the picker on "This stop"; both write the one thing.
 */
const TemplatesPanel = () => {
  const templates = useStore((s) => s.project.templates)
  const defaultTemplateId = useStore((s) => s.project.defaultTemplateId)
  const activeTemplateId = useStore((s) => s.activeTemplateId)
  const stops = useStore((s) => s.project.timetable.stops)
  const edits = useStore((s) => s.project.edits)
  const setActiveTemplateId = useStore((s) => s.setActiveTemplateId)
  const addTemplate = useStore((s) => s.addTemplate)
  const duplicateTemplate = useStore((s) => s.duplicateTemplate)
  const renameTemplate = useStore((s) => s.renameTemplate)
  const deleteTemplate = useStore((s) => s.deleteTemplate)
  const setDefaultTemplate = useStore((s) => s.setDefaultTemplate)
  const assignStopTemplate = useStore((s) => s.assignStopTemplate)

  return (
    <>
      <Group title={`${templates.length} template${templates.length === 1 ? '' : 's'}`}>
        <p className="readout">
          Every stop uses the project's default template unless assigned one of its own — a stop with its own
          template also gets that template's own header and footer artwork.
        </p>
        <Button onClick={() => addTemplate('New template')}>+ New template</Button>
      </Group>

      {templates.map((entry) => {
        const assignedCount = stops.filter(
          (s) => (edits[s.id]?.templateId ?? defaultTemplateId) === entry.id,
        ).length
        return (
          <Group key={entry.id} title={entry.name || 'Untitled template'}>
            <Field label="Name">
              <TextInput value={entry.name} onChange={(v) => renameTemplate(entry.id, v)} />
            </Field>
            <Row>
              <Button
                variant={activeTemplateId === entry.id ? 'primary' : 'ghost'}
                onClick={() => setActiveTemplateId(entry.id)}
              >
                {activeTemplateId === entry.id ? 'Editing here' : 'Edit'}
              </Button>
              <Button variant="ghost" onClick={() => duplicateTemplate(entry.id)}>
                Duplicate
              </Button>
              <Button variant="danger" disabled={templates.length <= 1} onClick={() => deleteTemplate(entry.id)}>
                Delete
              </Button>
            </Row>
            <Toggle
              label="Project default"
              value={defaultTemplateId === entry.id}
              onChange={(v) => v && setDefaultTemplate(entry.id)}
            />
            <p className="readout">
              {assignedCount} of {stops.length} stop{stops.length === 1 ? '' : 's'} use this template.
            </p>

            {stops.length > 0 ? (
              <details className="template-stop-picker">
                <summary>Choose stops…</summary>
                <ul className="check-list">
                  {stops.map((stop) => {
                    const usesThis = (edits[stop.id]?.templateId ?? defaultTemplateId) === entry.id
                    return (
                      <li key={stop.id}>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={usesThis}
                            onChange={(e) => assignStopTemplate(stop.id, e.target.checked ? entry.id : null)}
                          />
                          <span>
                            {stop.name}
                            {stop.direction ? ` → ${stop.direction}` : ''}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </details>
            ) : null}
          </Group>
        )
      })}
    </>
  )
}

const StopPanel = () => {
  const stopId = useStore((s) => s.selection.stopId)
  const stops = useStore((s) => s.project.timetable.stops)
  const edits = useStore((s) => s.project.edits)
  const updateEdits = useStore((s) => s.updateEdits)
  const timetable = useStore((s) => s.project.timetable)
  const templates = useStore((s) => s.project.templates)
  const defaultTemplateId = useStore((s) => s.project.defaultTemplateId)
  const assignStopTemplate = useStore((s) => s.assignStopTemplate)

  const stop = stops.find((s) => s.id === stopId)
  if (!stop || !stopId) return <p className="readout">No stop selected.</p>

  const current = edits[stopId] ?? {}
  const hidden = new Set(current.hidden ?? [])
  const routes = routesAtStop(timetable, stop.id)
  const defaultName = templates.find((t) => t.id === defaultTemplateId)?.name ?? 'Default'

  return (
    <>
      <Group title={stop.name}>
        <Field label="Title" hint="leave empty to use the template's wording">
          <TextInput
            value={current.titleOverride ?? ''}
            placeholder={stop.name}
            onChange={(v) => updateEdits(stopId, (e) => void (v ? (e.titleOverride = v) : delete e.titleOverride))}
          />
        </Field>
        <Field label="Subtitle">
          <TextInput
            value={current.subtitleOverride ?? ''}
            placeholder={stop.direction ?? ''}
            onChange={(v) => updateEdits(stopId, (e) => void (v ? (e.subtitleOverride = v) : delete e.subtitleOverride))}
          />
        </Field>
      </Group>

      <Group title="Template">
        <Field label="Use" hint="which master template — and which header/footer artwork — this sheet is built from">
          <Select
            value={current.templateId ?? ''}
            onChange={(v) => assignStopTemplate(stopId, v || null)}
            options={[
              { value: '', label: `Project default (${defaultName})` },
              ...templates.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </Field>
      </Group>

      <Group title="Routes on this sheet">
        {routes.map((route) => (
          <Toggle
            key={route.id}
            label={`${routeLabel(route)} — ${route.terminal || 'no destination'}`}
            value={!hidden.has(route.id)}
            onChange={(show) =>
              updateEdits(stopId, (e) => {
                const set = new Set(e.hidden ?? [])
                if (show) set.delete(route.id)
                else set.add(route.id)
                e.hidden = [...set]
              })
            }
          />
        ))}
        {routes.length === 0 ? <p className="readout">Nothing calls here.</p> : null}
      </Group>

      <Group title="Edits">
        <p className="readout">
          These sit on top of the generated sheet. Re-importing a fresh timetable replaces the departures and
          leaves this alone.
        </p>
        <Button
          variant="danger"
          disabled={Object.keys(current).length === 0}
          onClick={() => updateEdits(stopId, (e) => void Object.keys(e).forEach((k) => delete (e as Record<string, unknown>)[k]))}
        >
          Reset this stop
        </Button>
      </Group>
    </>
  )
}


export const Inspector = ({ page }: { page: Page | null }) => {
  const tab = useStore((s) => s.inspectorTab)
  const setTab = useStore((s) => s.setInspectorTab)

  return (
    <aside className="inspector">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="inspector-body">
        {tab === 'artboard' ? <ArtboardPanel /> : null}
        {tab === 'flow' ? <FlowPanel page={page} /> : null}
        {tab === 'zones' ? <ZonesPanel /> : null}
        {tab === 'type' ? <TypePanel /> : null}
        {tab === 'colour' ? <ColourPanel /> : null}
        {tab === 'rules' ? <RulesPanel /> : null}
        {tab === 'templates' ? <TemplatesPanel /> : null}
        {tab === 'stop' ? <StopPanel /> : null}
      </div>
    </aside>
  )
}
