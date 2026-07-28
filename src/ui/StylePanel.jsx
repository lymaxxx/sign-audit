import { ColorInput, Section, Select, Slider, Toggle } from './controls.jsx'

const ANGLE_OPTIONS = [
  { value: '90', label: '90° — strict grid' },
  { value: '60', label: '60° — hexagonal' },
  { value: '45', label: '45° — classic (London)' },
  { value: '30', label: '30° — softer diagonals' },
  { value: '22.5', label: '22.5° — very fine' },
  { value: '15', label: '15° — near-geographic' },
]

export default function StylePanel({ project, dispatch }) {
  const s = project.schematic
  const set = (patch) => dispatch({ type: 'setSchematic', patch })

  return (
    <>
      <Section title="Geometry">
        <Select
          label="Allowed angle increment"
          value={String(s.angleStep)}
          options={ANGLE_OPTIONS}
          onChange={(v) => set({ angleStep: Number(v) })}
        />
        <Slider
          label="Spacing between stops"
          value={s.edgeLength}
          min={20}
          max={110}
          onChange={(v) => set({ edgeLength: v })}
        />
        <Slider
          label="Angle strictness"
          value={s.strictness}
          min={0.2}
          max={3}
          step={0.1}
          onChange={(v) => set({ strictness: v })}
        />
        <Slider
          label="Solver passes"
          value={s.iterations}
          min={5}
          max={150}
          onChange={(v) => set({ iterations: v })}
        />
        <p className="muted small">
          Higher strictness snaps harder to the chosen angles; more passes tidy the map further but
          take longer.
        </p>
      </Section>

      <Section title="Lines">
        <Slider label="Line width" value={s.lineWidth} min={2} max={24} onChange={(v) => set({ lineWidth: v })} />
        <Slider
          label="Gap between parallel lines"
          value={s.lineGap}
          min={4}
          max={30}
          onChange={(v) => set({ lineGap: v })}
        />
        <Slider
          label="Corner radius"
          value={s.cornerRadius}
          min={0}
          max={60}
          onChange={(v) => set({ cornerRadius: v })}
        />
        <Slider
          label="Corner softness (organic / squircle)"
          value={s.cornerFullness}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set({ cornerFullness: v })}
        />
        <Slider
          label="Line opacity"
          value={s.lineOpacity}
          min={0.2}
          max={1}
          step={0.05}
          onChange={(v) => set({ lineOpacity: v })}
        />
        <Toggle label="White casing under lines" checked={s.casing} onChange={(v) => set({ casing: v })} />
        {s.casing && (
          <Slider
            label="Casing width"
            value={s.casingWidth}
            min={1}
            max={10}
            step={0.5}
            onChange={(v) => set({ casingWidth: v })}
          />
        )}
        <ColorInput label="Background" value={s.background} onChange={(v) => set({ background: v })} />
      </Section>

      <Section title="Regular stops">
        <Select
          label="Marker"
          value={s.regularStop.shape}
          options={[
            { value: 'tick', label: 'Tick across the line' },
            { value: 'circle', label: 'Filled circle' },
            { value: 'ring', label: 'Ring' },
            { value: 'square', label: 'Square' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(v) => set({ regularStop: { shape: v } })}
        />
        <Slider
          label="Size"
          value={s.regularStop.size}
          min={2}
          max={20}
          step={0.5}
          onChange={(v) => set({ regularStop: { size: v } })}
        />
        <Slider
          label="Outline width"
          value={s.regularStop.strokeWidth}
          min={0.5}
          max={8}
          step={0.5}
          onChange={(v) => set({ regularStop: { strokeWidth: v } })}
        />
        <Toggle
          label="Outline uses the line colour"
          checked={s.regularStop.useRouteColor}
          onChange={(v) => set({ regularStop: { useRouteColor: v } })}
        />
        {!s.regularStop.useRouteColor && (
          <ColorInput
            label="Outline"
            value={s.regularStop.stroke}
            onChange={(v) => set({ regularStop: { stroke: v } })}
          />
        )}
        <ColorInput
          label="Fill"
          value={s.regularStop.color}
          onChange={(v) => set({ regularStop: { color: v } })}
        />
      </Section>

      <Section title="Transfer stops">
        <Select
          label="Marker"
          value={s.interchangeStop.shape}
          options={[
            { value: 'circle', label: 'Filled circle' },
            { value: 'ring', label: 'Ring with dot' },
            { value: 'capsule', label: 'Capsule across the lines' },
            { value: 'square', label: 'Square' },
          ]}
          onChange={(v) => set({ interchangeStop: { shape: v } })}
        />
        <Slider
          label="Size"
          value={s.interchangeStop.size}
          min={3}
          max={26}
          step={0.5}
          onChange={(v) => set({ interchangeStop: { size: v } })}
        />
        <Slider
          label="Outline width"
          value={s.interchangeStop.strokeWidth}
          min={0.5}
          max={8}
          step={0.5}
          onChange={(v) => set({ interchangeStop: { strokeWidth: v } })}
        />
        <Toggle
          label="Outline uses the first line's colour"
          checked={s.interchangeStop.useRouteColor}
          onChange={(v) => set({ interchangeStop: { useRouteColor: v } })}
        />
        {!s.interchangeStop.useRouteColor && (
          <ColorInput
            label="Outline"
            value={s.interchangeStop.stroke}
            onChange={(v) => set({ interchangeStop: { stroke: v } })}
          />
        )}
        <ColorInput
          label="Fill"
          value={s.interchangeStop.color}
          onChange={(v) => set({ interchangeStop: { color: v } })}
        />
      </Section>

      <Section title="Labels" defaultOpen={false}>
        <Toggle label="Show stop names" checked={s.labels.show} onChange={(v) => set({ labels: { show: v } })} />
        <Slider
          label="Text size"
          value={s.labels.size}
          min={6}
          max={26}
          onChange={(v) => set({ labels: { size: v } })}
        />
        <Slider
          label="Text angle"
          value={s.labels.angle}
          min={-90}
          max={90}
          step={5}
          unit="°"
          onChange={(v) => set({ labels: { angle: v } })}
        />
        <Select
          label="Bold names"
          value={s.labels.bold}
          options={[
            { value: 'none', label: 'Never' },
            { value: 'interchange', label: 'Transfer stops only' },
            { value: 'all', label: 'All stops' },
          ]}
          onChange={(v) => set({ labels: { bold: v } })}
        />
        <ColorInput label="Text colour" value={s.labels.color} onChange={(v) => set({ labels: { color: v } })} />
        <ColorInput label="Halo" value={s.labels.halo} onChange={(v) => set({ labels: { halo: v } })} />
        <Slider
          label="Halo width"
          value={s.labels.haloWidth}
          min={0}
          max={8}
          step={0.5}
          onChange={(v) => set({ labels: { haloWidth: v } })}
        />
      </Section>

      <Section title="Arrows, badges & legend" defaultOpen={false}>
        <Toggle
          label="Arrows on one-way sections"
          checked={s.arrows.show}
          onChange={(v) => set({ arrows: { show: v } })}
        />
        <Slider
          label="Arrow size"
          value={s.arrows.size}
          min={3}
          max={20}
          onChange={(v) => set({ arrows: { size: v } })}
        />
        <Slider
          label="Arrow spacing"
          value={s.arrows.spacing}
          min={40}
          max={400}
          step={10}
          onChange={(v) => set({ arrows: { spacing: v } })}
        />
        <Toggle
          label="Route number badges at termini"
          checked={s.badges.show}
          onChange={(v) => set({ badges: { show: v } })}
        />
        <Slider
          label="Badge size"
          value={s.badges.size}
          min={6}
          max={26}
          onChange={(v) => set({ badges: { size: v } })}
        />
        <Toggle label="Legend" checked={s.legend.show} onChange={(v) => set({ legend: { show: v } })} />
        <Slider
          label="Legend size"
          value={s.legend.size}
          min={7}
          max={26}
          onChange={(v) => set({ legend: { size: v } })}
        />
      </Section>
    </>
  )
}
