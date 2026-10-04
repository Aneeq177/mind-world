## **Design decisions made and being made**

**Local storage:**

***-Keep local and server options both:*** Things can be really slow for users with low RAM and CPU.

***-Memory lives in one browser:*** There's no cross-device or mobile memory until you build encrypted sync, and uninstalling or switching Chrome profiles wipes it. Users with ChatGPT open on a work laptop and a home laptop get two separate memories. You need local export and restore from day one.

***-You can't see what's going wrong:*** Today, when Improve pulls the wrong memory, you can inspect the user's data in Supabase. Locally you can't, so you rely on your own data, synthetic evals and anything users choose to share. Plan for an opt-in "send this Improve trace to support" button and good client-side logging of non-content signals like scores and timings.

***-Upgrades are slower to roll out:*** Switching to a better embedding model or chunking strategy means every user's device re-indexes its own history in the background. Today you'd run one backfill script.

***-The 2D map gets harder:*** UMAP has a usable JS port (umap-js), but it's slow on large datasets, and HDBSCAN has no mature JS equivalent. The map is secondary in VISION.md, so it can lag behind or get simpler clustering without hurting the core product.

***Profile inference runs on the client:*** The background LLM profile updates have to be triggered from the extension and tolerate the MV3 service worker sleeping. That's doable but fiddly.

***-No content analytics:*** You can't learn from aggregate conversation data later, beyond count-based events.
