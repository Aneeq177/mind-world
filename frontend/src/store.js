import { create } from 'zustand'

export const useStore = create((set) => ({
  // App phase: 'landing' | 'processing' | 'map'
  phase: 'landing',

  // Data from /process
  conversations: [],
  totalConversations: 0,
  sources: { claude: 0, chatgpt: 0 },

  // Selection
  selectedId: null,
  blendIds: [],

  // Credentials
  email: '',
  apiKey: '',

  // Filters
  filterSource: 'all', // 'all' | 'claude' | 'chatgpt'
  filterRegion: 'all', // 'all' | region name

  // Actions
  setCredentials: (email, apiKey) => set({ email, apiKey }),
  setPhase: (phase) => set({ phase }),
  setConversations: (conversations, sources) => set({
    conversations,
    totalConversations: conversations.length,
    sources
  }),
  setSelected: (id) => set({ selectedId: id }),
  toggleBlend: (id) => set((state) => {
    const exists = state.blendIds.includes(id)
    if (exists) return { blendIds: state.blendIds.filter(b => b !== id) }
    if (state.blendIds.length >= 4) return state
    return { blendIds: [...state.blendIds, id] }
  }),
  clearBlend: () => set({ blendIds: [] }),
  setFilterSource: (filterSource) => set({ filterSource }),
  setFilterRegion: (filterRegion) => set({ filterRegion }),
}))
