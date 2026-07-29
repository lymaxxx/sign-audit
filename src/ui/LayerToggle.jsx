/** Show/hide individual CAD line layers, plus the drawing's own text. */
export default function LayerToggle({ layers, showLabels, onSetLayer, onSetShowLabels, onClose }) {
  const allOn = layers.every((l) => l.visible)

  return (
    <div className="sheet" role="dialog" aria-label="Layers">
      <header className="sheet__head">
        <h3>Layers</h3>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="sheet__body">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(event) => onSetShowLabels(event.target.checked)}
          />
          <span>Drawing text</span>
        </label>

        <button
          type="button"
          className="ghost sheet__all"
          onClick={() => layers.forEach((l) => onSetLayer(l.name, !allOn))}
        >
          {allOn ? 'Hide all' : 'Show all'}
        </button>

        <ul className="layers">
          {layers.map((layer) => (
            <li key={layer.name}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(event) => onSetLayer(layer.name, event.target.checked)}
                />
                <span className="layers__swatch" style={{ background: layer.color }} />
                <span className="layers__name">{layer.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
