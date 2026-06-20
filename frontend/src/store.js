import { create } from 'zustand'

export const useStore = create((set) => ({
  // App phase: 'landing' | 'processing' | 'map'
  phase: 'landing',

  // Data from /process
  conversations: [],
  myConversations: null,
  teamConversations: null,
  teamSources: null,
  totalConversations: 0,
  sources: { claude: 0, chatgpt: 0 },
  
  worldMode: 'my', // 'my' | 'team'

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
  setConversations: (conversations, sources) => {
    set({
      conversations,
      myConversations: conversations,
      totalConversations: conversations.length,
      sources
    })
  },
  setWorldMode: (mode) => set({ worldMode: mode }),
  setTeamConversations: (conversations, sources) => set({
    teamConversations: conversations,
    teamSources: sources,
    conversations,
    totalConversations: conversations.length,
    sources
  }),
  restoreMyConversations: () => set(state => ({
    conversations: state.myConversations || [],
    totalConversations: (state.myConversations || []).length
  })),
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
  removeConversation: (id) => set((state) => {
    const filterOut = (list) => (list || []).filter(c => c.id !== id)
    const conversations = filterOut(state.conversations)
    const myConversations = filterOut(state.myConversations)
    const teamConversations = filterOut(state.teamConversations)
    return {
      conversations,
      myConversations,
      teamConversations,
      totalConversations: conversations.length,
      selectedId: state.selectedId === id ? null : state.selectedId,
      blendIds: state.blendIds.filter(b => b !== id),
    }
  }),
}))
