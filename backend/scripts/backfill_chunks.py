"""One-time backfill: chunk and embed conversations saved before chunk retrieval.

Safe to re-run: conversations whose full_text hash matches their last chunking
are skipped, so an interrupted run resumes where it left off.

Run from the repo root (needs SUPABASE_URL / SUPABASE_SERVICE_KEY, and
migration 015_conversation_chunks.sql applied):
  python backend/scripts/backfill_chunks.py                  # every user
  python backend/scripts/backfill_chunks.py --email a@b.com  # one user
  python backend/scripts/backfill_chunks.py --force          # rebuild all chunks
"""
import argparse
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
load_dotenv(BACKEND.parent / ".env")
load_dotenv(BACKEND / ".env")

from services.database import get_supabase  # noqa: E402
from services.retrieval import index_conversations_chunks  # noqa: E402

PAGE_SIZE = 50


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--email", help="only backfill this user")
    p.add_argument("--force", action="store_true", help="rebuild chunks even if text is unchanged")
    args = p.parse_args()

    supabase = get_supabase()
    user_id = None
    if args.email:
        res = supabase.table("users").select("id").eq("email", args.email.lower().strip()).execute()
        if not res.data:
            sys.exit(f"No user with email {args.email}")
        user_id = res.data[0]["id"]

    totals = {"indexed": 0, "skipped": 0, "failed": 0}
    started = time.time()
    offset = 0
    while True:
        query = supabase.table("knowledge_nodes").select("id, user_id, title, full_text").order("id")
        if user_id:
            query = query.eq("user_id", user_id)
        page = query.range(offset, offset + PAGE_SIZE - 1).execute().data or []
        if not page:
            break

        rows = [r for r in page if r.get("user_id")]
        report = index_conversations_chunks(None, rows, force=args.force)
        for k in totals:
            totals[k] += report[k]
        totals["failed"] += len(page) - len(rows)  # no owner, can't be searched anyway
        offset += len(page)
        print(f"{offset} conversations processed  {totals}  ({time.time() - started:.0f}s)", flush=True)

    print(f"done: {totals}")
    if totals["failed"]:
        print("Some conversations failed; re-run to retry them (successful ones are skipped).")


if __name__ == "__main__":
    main()
