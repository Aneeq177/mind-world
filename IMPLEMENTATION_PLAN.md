# Multi-Source Knowledge Architecture Plan

## 1. The Strategy: Why Add More Sources?
Mind World’s vision is to be the "Operating System for Human Knowledge". While AI conversations represent *dynamic problem-solving*, a true brain needs context from *static knowledge* and *collaborative thought*. By ingesting other sources, the semantic map becomes a complete graph of a company's or individual's intellect.

### Proposed Knowledge Sources & Justifications
1. **Slack / Microsoft Teams (Collaborative Thought)**
   - *Why*: This is where real-time human-to-human problem solving happens.
   - *Value*: UMAP will naturally cluster a Slack thread about "Database Migration" right next to an AI conversation asking Claude "How to migrate Postgres". 
2. **Notion / Google Docs (Synthesized Static Thought)**
   - *Why*: These are the final artifacts of the thought process. 
   - *Value*: Agents in the future orchestration layer can read a Notion doc to understand the current architecture, then use an AI conversation to draft the next iteration.
3. **Emails / Customer Support Tickets**
   - *Why*: Represents external feedback and constraints.
   - *Value*: An engineer can see how an AI coding session maps directly to a user's bug report email in the 3D space.
4. **GitHub Issues / Linear (Task-Based Thought)**
   - *Why*: Represents the execution of ideas.

---

## 2. Visualizing Heterogeneous Data (2D UX / UI Architecture)

To maintain clarity on the 2D semantic map, we are moving forward with **Tabbed Viewports**. This prevents the dashboard from becoming a chaotic mess of overlapping nodes while still utilizing the powerful UMAP semantic clustering.

### Tabbed Viewports Implementation
We will separate the 2D canvas into distinct views using top-level tabs:
- **Tab 1: AI Memory Map** (Only Claude & ChatGPT conversations)
- **Tab 2: Static Knowledge** (Notion & Google Docs)
- **Tab 3: Unified View** (Everything combined for cross-source context blending)

In all views, nodes will be represented by clean SVG icons (AI logos, Document icons) colored by their HDBSCAN topic cluster. When you switch tabs, the map smoothly filters out irrelevant nodes.

---

## 3. Notion & Google Docs Integration Strategy

To ingest static knowledge, we need to build OAuth integrations for Notion and Google Docs.

### Data Ingestion Pipeline
1. **OAuth Flow**: 
   - Add `/auth/notion` and `/auth/google` endpoints to the FastAPI backend.
   - Store access tokens in a new `user_integrations` Supabase table.
2. **Document Scraping**:
   - For Notion: Use the Notion API to fetch pages the user has granted access to. Extract the Markdown text.
   - For Google Docs: Use the Google Drive API to fetch `.gdoc` files and convert them to plain text.
3. **Embedding & Clustering**:
   - The document text is passed through the same `all-MiniLM-L6-v2` embedding model.
   - UMAP and HDBSCAN will cluster these documents into the same semantic space as the AI conversations.

### The Dashboard Interface
- **Detail Panel Upgrades**: When a user clicks a node, the slide-out `DetailPanel.jsx` must be polymorphic. 
  - If it's an email, show Subject, Sender, and Body.
  - If it's Slack, show the thread UI.
- **Context Blender**: The Blender becomes incredibly powerful. You can select 1 Notion doc, 1 Slack thread, and 1 ChatGPT conversation, and inject them all into a new Claude prompt.

---

## 4. Database Architecture & Schema Evolution

Currently, the DB is tightly coupled to "conversations". We need to evolve this into a generalized **Knowledge Graph**.

### Migration Plan
Rename `conversations` to `knowledge_nodes`.

```sql
CREATE TABLE knowledge_nodes (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  company_id UUID,          -- For org-wide docs
  type TEXT,                -- 'ai_chat', 'slack_thread', 'document', 'email'
  source_app TEXT,          -- 'claude', 'chatgpt', 'slack', 'notion'
  title TEXT,
  preview TEXT,
  full_text TEXT,
  metadata JSONB,           -- Polymorphic data (e.g., { "channel": "#dev", "url": "..." })
  cluster_id INTEGER,
  region TEXT,
  color TEXT,
  x FLOAT, y FLOAT, z FLOAT,
  visibility TEXT DEFAULT 'private'
);
```

By using a `metadata` JSONB column, we can store Slack channel IDs, Notion URLs, or Email senders without breaking the schema. The `embeddings` table remains exactly the same, pointing to `knowledge_nodes(id)`.
