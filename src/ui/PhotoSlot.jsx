import { useRef, useState } from 'react'
import { usePhotoUrl } from '../state/photos.js'

/**
 * One side's worth of photos for a sign.
 *
 * Two separate file inputs rather than one: on iOS, `capture="environment"`
 * jumps straight to the rear camera, which is what you want while standing in
 * front of the sign, whereas the plain input offers the photo library and
 * Files. Both paths funnel through the same downscaling step.
 */

function Thumb({ photoId, onOpen, onRemove }) {
  const url = usePhotoUrl(photoId, { thumb: true })
  return (
    <div className="thumb">
      <button
        type="button"
        className="thumb__open"
        onClick={() => onOpen(photoId)}
        aria-label="Open photo"
      >
        {url ? <img src={url} alt="" /> : <span className="thumb__pending" />}
      </button>
      <button
        type="button"
        className="thumb__remove"
        onClick={() => onRemove(photoId)}
        aria-label="Delete photo"
      >
        ×
      </button>
    </div>
  )
}

function Lightbox({ photoId, onClose }) {
  const url = usePhotoUrl(photoId)
  return (
    <div className="lightbox" onClick={onClose} role="presentation">
      {url ? <img src={url} alt="" /> : <p className="lightbox__pending">Loading…</p>}
      <button type="button" className="lightbox__close" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

export default function PhotoSlot({ side, photoIds, onAdd, onRemove, disabled }) {
  const cameraRef = useRef(null)
  const libraryRef = useRef(null)
  const [open, setOpen] = useState(null)

  const handleFiles = (event) => {
    const files = [...(event.target.files ?? [])]
    // Reset first so picking the same file twice still fires a change event.
    event.target.value = ''
    for (const file of files) onAdd(file)
  }

  return (
    <section className="slot">
      <header className="slot__head">
        <h4>Side {side}</h4>
        <span className="slot__count">
          {photoIds.length} {photoIds.length === 1 ? 'photo' : 'photos'}
        </span>
      </header>

      {photoIds.length > 0 && (
        <div className="slot__strip">
          {photoIds.map((id) => (
            <Thumb key={id} photoId={id} onOpen={setOpen} onRemove={onRemove} />
          ))}
        </div>
      )}

      <div className="slot__actions">
        <button type="button" onClick={() => cameraRef.current?.click()} disabled={disabled}>
          Camera
        </button>
        <button type="button" onClick={() => libraryRef.current?.click()} disabled={disabled}>
          Choose file
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handleFiles}
      />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={handleFiles} />

      {open && <Lightbox photoId={open} onClose={() => setOpen(null)} />}
    </section>
  )
}
