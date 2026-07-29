import { createContext, useContext } from 'react'

/**
 * Kept apart from store.jsx so that file exports only its component. Mixing
 * component and non-component exports in one module breaks Vite's fast refresh.
 */
export const StoreContext = createContext(null)

export function useStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
