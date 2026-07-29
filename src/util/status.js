/** The four states a sign can be in during an audit. */
export const STATUS = {
  unchecked: { label: 'Not checked', short: 'To do', color: '#8b93a7' },
  checked: { label: 'Checked', short: 'Checked', color: '#32d74b' },
  review: { label: 'Needs review', short: 'Review', color: '#ff9f0a' },
  // Signs dropped onto the plan on site stay proposals until someone decides.
  proposed: { label: 'Proposed', short: 'Proposed', color: '#64d2ff' },
}

export const STATUS_ORDER = ['unchecked', 'checked', 'review', 'proposed']

export function statusOf(key) {
  return STATUS[key] ?? STATUS.unchecked
}
