## **System Architecture**
### The purpose of this file is to explain the system architecture, how it works, what decisions where made and why



**RAG Pipline**

## How Improve finds your past conversations (RAG pipeline)

RAG ("retrieval-augmented generation") means: first **find** relevant material, then **give it to the AI** so it writes a better answer. Mind World uses it to turn your rough draft into a prompt that already knows your history.

Here's the whole pipeline in chunked mode:

**Search:** Your draft is embedded, and the 60 closest chunks across all your conversations are found.
**Group:** Those chunks are grouped by conversation. Each conversation scores its best chunk's similarity, plus 0.01 per extra matching chunk (up to +0.03). The top 15 move on, or the top 20 if your personal profile is on.
**Carry forward:** Each conversation brings its best chunk as a 600-character snippet, plus the positions of all its matched chunks for later.
**Re-score (profile on only):** Each score becomes 75% best-chunk similarity, 15% recency, 7% domain match, and 3% project match. The top 15 move on.
Rerank. Claude Haiku looks only at your draft and each candidate's title, similarity, and snippet, then picks the top 5.
**Excerpt:**For each of the 5, the full text is fetched and cut down to 3,000 characters: the first 500 characters plus the best matched chunks until the limit is reached.
**-Generate:** Claude Haiku gets the system prompt, your draft, your profile facts, an optional template, and up to about 15,000 characters of excerpts. It returns the improved prompt.




### 1. Saving (runs whenever a conversation is captured or imported)
- A conversation comes in from the extension's auto-save or a bulk export upload.
- We take its **title plus the first 500 characters** and convert that into an **embedding**: a list of 384 numbers that represents its meaning. The model is `all-MiniLM-L6-v2`.
- The full conversation goes into the `knowledge_nodes` table. The embedding goes into the `embeddings` table.
------------------
-Conversation-level embedding is made from the title and the first 500 character and saved in  `knowledge_nodes`
-Then we now save the full text of the conversations with no character limit. Each conversation is embedded as chunks in `index_conversation_chunks` to prevent loss in context.
------------------


### 2. Finding (runs when you click Improve)
1. **Meaning search:** your draft is turned into an embedding the same way, and the database returns your 15–20 conversations whose embeddings are closest to it. 
*NOTE: The 15-20 closest conversations are found using only the title and first 500 characters.(NOT THE WHOLE CONVERSATION)*

---------------------------------------------------------------------------------
-The users draft is embedded.
Profile off: fetch 15. These go straight to the reranker.
Profile on: fetch 20, re-score them, and keep the top 15.

We have two modes for searching conversations:
1) Baseline mode (Default): uses the `match_conversations` function in Postgres. Each conversation is stored as a title and first 500 characters and cosine similarity is used and returns top 15-20. (NOTW: Anything after the opening 500 characters is invisible to this search method).

2) Chunked mode (RETRIEVAL_MODE = chunked): 
-Conversations are split into 800 character chunks and 150 character overlap. Each chunk is embedded as Title + chunk text. (Leftover piece under 200 characters is merged with the last chunk).

Here's an example. Say the top 60 chunks include these:

Conversation A has 1 matching chunk, with a similarity of 0.82.
Conversation B has 4 matching chunks, with similarities of 0.78, 0.75, 0.70, and 0.65.
Conversation C has 6 matching chunks, the best at 0.74.
Scores:

A: 0.82, plus no bonus because there are no extra chunks, for 0.82.
B: 0.78, plus 0.01 for each of its 3 extra chunks (+0.03), for 0.81.
C: 0.74, plus 0.03 (5 extra chunks, but the bonus stops at 3), for 0.77.
The final order is A, then B, then C.

-The top 15-20 conversations are kept, each carrying its best chunk (up to 600 characters) as a "snippet," plus the positions of all its matched chunks.
-If chunks haven't been built or chunks error, reverts to baseline search.
-----------------------------------------------------------------------------

2. **Rescoring:** if personalization is on, results are nudged toward recent conversations and your known topics and projects.
3. **AI rerank:** Claude Haiku picks the best 5. At the same time, it picks up to 6 relevant facts from your profile. 
*NOTE: So from the 15-20 chosen, HAIKU looks at the first 180 characters of those 15-20 and reranks to choose type 5 most relevant (AGAIN NOT THE FULL TEXT). for the baseline vesion*


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





