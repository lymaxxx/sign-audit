import { useRef, useState } from 'react'
import { pdfPageCount } from '../underlay/pdf.js'

const SCALE_STEP = 1.05

/**
 * Attaching and aligning a reference background — a rasterised PDF page, or a
 * second DXF's geometry — behind the plan.
 *
 * Placement is entirely manual: the two drawings rarely share an origin or
 * even a unit system, so a computed best-fit would be guessing. The starting
 * position/scale (see `guessUnderlayTransform` in the store) only gets the
 * user into the neighbourhood; dragging in align mode and nudging scale/
 * rotation from here does the actual work.
 */
export default function UnderlayPanel({
  underlayMeta,
  onSetAlignMode,
  onAdd,
  onRemove,
  onSetOpacity,
  onNudgeScale,
  onNudgeRotation,
  onClose,
}) {
  const pdfInput = useRef(null)
  const dxfInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [pagePicker, setPagePicker] = useState(null) // { file, count }

  const pickPdf = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const count = await pdfPageCount(file)
      if (count > 1) {
        setPagePicker({ file, count })
      } else {
        await onAdd({ file, type: 'pdf', pageNumber: 1 })
      }
    } catch (cause) {
      alert(cause.message ?? String(cause))
    } finally {
      setBusy(false)
    }
  }

  const confirmPage = async (pageNumber) => {
    const { file } = pagePicker
    setPagePicker(null)
    setBusy(true)
    try {
      await onAdd({ file, type: 'pdf', pageNumber })
    } finally {
      setBusy(false)
    }
  }

  const pickDxf = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      await onAdd({ file, type: 'dxf' })
    } catch (cause) {
      alert(cause.message ?? String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet" role="dialog" aria-label="Background">
      <header className="sheet__head">
        <h3>Background</h3>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="sheet__body">
        {!underlayMeta ? (
          <>
            <p className="muted small">
              Place a PDF plot or a second DXF behind the plan as reference — useful when this
              drawing is missing geometry this app cannot parse (an unbound external reference, an
              unsupported entity type). It is never parsed for signs; only its position, scale and
              opacity are yours to set, by dragging it into place against what this app already
              draws.
            </p>
            {pagePicker ? (
              <div className="underlay__pages">
                <p className="muted small">
                  This PDF has {pagePicker.count} pages. Which one is the plan?
                </p>
                <div className="underlay__pageGrid">
                  {Array.from({ length: pagePicker.count }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="chip"
                      disabled={busy}
                      onClick={() => confirmPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button type="button" className="ghost" onClick={() => setPagePicker(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="card__actions">
                <button type="button" disabled={busy} onClick={() => pdfInput.current?.click()}>
                  {busy ? 'Working…' : 'Add a PDF page'}
                </button>
                <button type="button" disabled={busy} onClick={() => dxfInput.current?.click()}>
                  Add a DXF drawing
                </button>
              </div>
            )}
            <input
              ref={pdfInput}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                pickPdf(file)
              }}
            />
            <input
              ref={dxfInput}
              type="file"
              accept=".dxf,application/dxf,image/vnd.dxf,text/plain"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                pickDxf(file)
              }}
            />
          </>
        ) : (
          <>
            <button type="button" onClick={onSetAlignMode}>
              Drag to align
            </button>
            <p className="muted small">
              Closes this panel so the plan can take the drag — drag anywhere to move the
              background, and use "Done aligning" in the plan's toolbar to come back here.
            </p>

            <label className="field">
              <span>Opacity — {Math.round(underlayMeta.opacity * 100)}%</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={underlayMeta.opacity}
                onChange={(event) => onSetOpacity(Number(event.target.value))}
              />
            </label>

            <div className="field">
              <span>Scale</span>
              <div className="underlay__nudge">
                <button type="button" className="ghost" onClick={() => onNudgeScale(1 / SCALE_STEP)}>
                  smaller
                </button>
                <button type="button" className="ghost" onClick={() => onNudgeScale(SCALE_STEP)}>
                  larger
                </button>
              </div>
            </div>

            <div className="field">
              <span>Rotation</span>
              <div className="underlay__nudge">
                <button type="button" className="ghost" onClick={() => onNudgeRotation(-15)}>
                  −15°
                </button>
                <button type="button" className="ghost" onClick={() => onNudgeRotation(-1)}>
                  −1°
                </button>
                <button type="button" className="ghost" onClick={() => onNudgeRotation(1)}>
                  +1°
                </button>
                <button type="button" className="ghost" onClick={() => onNudgeRotation(15)}>
                  +15°
                </button>
              </div>
            </div>

            <button type="button" className="danger" onClick={onRemove}>
              Remove background
            </button>
          </>
        )}
      </div>
    </div>
  )
}
