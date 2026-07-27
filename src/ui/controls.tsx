import type { ReactNode } from 'react'

/** Small, plain inspector controls. Nothing here knows about the schedule. */

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field">
    <span className="field-label">
      {label}
      {hint ? <em className="field-hint">{hint}</em> : null}
    </span>
    {children}
  </label>
)

export const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="group">
    <h3>{title}</h3>
    {children}
  </section>
)

export const Row = ({ children }: { children: ReactNode }) => <div className="row">{children}</div>

export const NumberInput = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) => (
  <span className="number">
    <input
      type="number"
      value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const next = Number(e.target.value)
        if (Number.isFinite(next)) onChange(next)
      }}
    />
    {suffix ? <em>{suffix}</em> : null}
  </span>
)

export const TextInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) => (
  <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
)

export const Select = <T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) => (
  <select value={value} onChange={(e) => onChange(e.target.value as T)}>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
)

export const Toggle = ({
  value,
  onChange,
  label,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
}) => (
  <label className="toggle">
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
)

export const ColorInput = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <span className="colour">
    <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
  </span>
)

export const Button = ({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
}) => (
  <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled} title={title}>
    {children}
  </button>
)
