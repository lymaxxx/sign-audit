import { useState } from 'react'

export function Section({ title, children, defaultOpen = true, right }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header onClick={() => setOpen((v) => !v)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <h3>{title}</h3>
        {right && (
          <span className="section-right" onClick={(e) => e.stopPropagation()}>
            {right}
          </span>
        )}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <em title={hint}>?</em>}
      </span>
      {children}
    </label>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, unit = '' }) {
  return (
    <div className="field slider">
      <span className="field-label">
        {label}
        <b>
          {typeof value === 'number' ? Math.round(value * 100) / 100 : value}
          {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function Select({ label, value, options, onChange }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function ColorInput({ label, value, onChange }) {
  return (
    <Field label={label}>
      <span className="color-input">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </span>
    </Field>
  )
}
