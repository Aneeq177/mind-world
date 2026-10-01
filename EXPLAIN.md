## **System Architecture**
### The purpose of this file is to explain the system architecture, how it works, what decisions where made and why



**RAG Pipline**

## How Improve finds your past conversations (RAG pipeline)

RAG ("retrieval-augmented generation") means: first **find** relevant material, then **give it to the AI** so it writes a better answer. Mind World uses it to turn your rough draft into a prompt that already knows your history.

### 1. Saving (runs whenever a conversation is captured or imported)
- A conversation comes in from the extension's auto-save or a bulk export upload.
- We take its **title plus the first 500 characters** and convert that into an **embedding**: a list of 384 numbers that represents its meaning. The model is `all-MiniLM-L6-v2`.
- The full conversation goes into the `knowledge_nodes` table. The embedding goes into the `embeddings` table.

### 2. Finding (runs when you click Improve)
1. **Meaning search:** your draft is turned into an embedding the same way, and the database returns your 15–20 conversations whose embeddings are closest to it. 
*NOTE: The 15-20 closest conversations are found using only the title and first 500 characters.(NOT THE WHOLE CONVERSATION)*

2. **Rescoring:** if personalization is on, results are nudged toward recent conversations and your known topics and projects.
3. **AI rerank:** Claude Haiku picks the best 5. At the same time, it picks up to 6 relevant facts from your profile. 
*NOTE: So from the 15-20 chosen, HAIKU looks at the first 180 characters of those 15-20 and reranks to choose type 5 most relevant (AGAIN NOT THE FULL TEXT).*


### 3. Writing
Claude Haiku receives your draft, up to 3,000 characters from each of the 5 conversations, your profile facts, and a template if you picked one. It writes the improved prompt, which the extension places in the chat box.

*NOTE: Now finally when taking context from previous chats, it takes only th first 3000 characters(NOT THE FULL TEXT).*


### Where the vectors live
We don't run a separate vector database. Embeddings are stored in our normal **Supabase Postgres** database using the **pgvector** extension:
- One system holds chats, users, profiles and vectors, so there's nothing to keep in sync.
- Limiting a search to one user's data is a simple filter.
- Each user has thousands of conversations at most, which pgvector handles easily and for free.

### Known limitations
- **Only the start of each conversation is searchable.** Anything after the first 500 characters doesn't affect search, and auto-saved chats don't update their embedding as they grow. *Fix:* split conversations into chunks and embed each chunk.
- **No keyword matching.** Exact names or error codes can be missed. *Fix:* add Postgres full-text search alongside the meaning search.
- **Always 5 results, even when none are relevant.** *Fix:* skip context when similarity or confidence is low.
- **No search index yet.** Every search checks all of a user's vectors. That's fine now; add an HNSW index as data grows.





