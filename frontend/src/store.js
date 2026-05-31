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
    const mockDocs = [
      { id: 'mock-doc-1', type: 'document', source_app: 'notion', title: 'Notion Architecture Guidelines', x: 500, y: 500, created_at: new Date().toISOString(), region: 'Architecture', preview: 'Mock Notion document for testing the new Static Knowledge UI.' },
      { id: 'mock-doc-2', type: 'document', source_app: 'confluence', title: 'Confluence Meeting Notes', x: 520, y: 480, created_at: new Date().toISOString(), region: 'Planning', preview: 'Mock Confluence document for testing the new Static Knowledge UI.' }
    ]
    const updated = [...conversations, ...mockDocs]
    set({
      conversations: updated,
      myConversations: updated,
      totalConversations: updated.length,
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
}))
