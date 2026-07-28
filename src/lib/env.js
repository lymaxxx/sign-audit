export const isFileProtocol =
  typeof location !== 'undefined' && location.protocol === 'file:'

// Opened straight off the disk, a browser may refuse cross-origin requests to
// Overpass/Nominatim/OSRM. Say so instead of leaving a bare "Failed to fetch".
export function networkHint() {
  return isFileProtocol
    ? ' Tip: this page was opened straight from a file. If requests keep failing, serve the folder over http instead (for example `npx serve`) — some browsers block network calls from file:// pages.'
    : ''
}
