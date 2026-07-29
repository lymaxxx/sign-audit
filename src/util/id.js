/** Short, collision-resistant ids for signs, photos and projects. */
export function newId(prefix = '') {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return prefix ? `${prefix}_${hex}` : hex
}
