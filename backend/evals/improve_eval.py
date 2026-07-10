"""A/B/C evaluation of Mind World's Improve prompt engineering.

Measures whether Improve actually yields better answers, and whether a
candidate v2 system prompt beats the current production one.

  A = raw user draft pasted directly into chat (baseline)
  B = draft rewritten by the CURRENT production system prompt
      (verbatim copy of the no-memory default path in backend/main.py)
  C = draft rewritten by a CANDIDATE v2 system prompt

Pipeline per draft: engineer (Haiku 4.5, production parity) -> answer
(Sonnet 4.6, simulates the chat assistant users paste into) -> blind
pairwise judging (Opus 4.8, both presentation orders to cancel position
bias; a win only counts if the same side wins in both orders).

Run:  python backend/evals/improve_eval.py
Needs ANTHROPIC_API_KEY (read from repo-root .env) with credits.
~88 API calls total (16 Haiku, 24 Sonnet, 48 Opus); roughly $2-4.
Results land in backend/evals/eval_results.json — read the `tally`
section for headline win rates and `detail` for per-draft verdicts.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")

import anthropic

client = anthropic.Anthropic()

ENGINEER_MODEL = "claude-haiku-4-5-20251001"  # matches /engineer_prompt
ANSWER_MODEL = "claude-sonnet-4-6"
JUDGE_MODEL = "claude-opus-4-8"

OUT = Path(__file__).parent / "eval_results.json"

# ---- legacy system prompt (production before 2026-07-10; kept as baseline B) ----
ADAPTATION_HINT = "Balance clarity with enough detail for the task."
CURRENT_SYSTEM = f"""You are an expert prompt engineer. Transform the user's rough message into a clear, effective prompt for an AI assistant.
Use past conversations and profile context only when directly relevant to the current draft. Never invent details. Skip unrelated background.
Choose whatever structure and formatting you think works best for this specific task — prose, bullets, numbered steps, or labeled sections are all fine.
Output plain text ready to paste into a chat box (no markdown bold or code fences). Output ONLY the final prompt — no preamble, labels like "Here is your prompt", or commentary. Never ask clarifying questions or include question lists in the output; if something is ambiguous, make a reasonable assumption and proceed.
Adaptive preference hint: {ADAPTATION_HINT}"""

# ---- v3 system prompt (ADOPTED into backend/main.py 2026-07-10) ----
# Results: v3 beat the legacy prompt 6-0-2 and tied raw drafts 3-2-3, where
# legacy LOST to raw drafts 0-6-2 (fabricated user facts, inflated answers).
# v2 lessons: long instructions made Haiku narrate meta-commentary;
# demand-everything checklists inflated answers. v3 is short and targets the
# three observed failures: fabrication, bloat, meta-leakage.
V2_SYSTEM = """You are a prompt engineer. Rewrite the user's rough draft into the message they should have sent — nothing else.

Rules, in priority order:
1. Your entire output is the rewritten prompt itself. It must read as a message from the user to an AI assistant. No commentary, no preamble, no "Here's the prompt", no notes about what you changed or don't know.
2. Never invent facts the user didn't give — no made-up names, dates, numbers, projects, reasons, or personal details. Where a needed detail is missing, have the prompt tell the assistant to use a clearly marked placeholder or offer options.
3. Match depth to the ask. A simple question stays a short prompt with at most a line about audience, depth, or format. Only requests for documents or complex work earn structure. Never demand exhaustive coverage the user didn't ask for — the goal is the right answer at the right length, not the longest one.
4. Add only what sharpens the answer: the user's goal or situation, the deliverable's form, the audience. If the draft is already clear, change little.
5. Use past conversations and profile context only when directly relevant; weave details in naturally.
6. Plain text only (no markdown bold or code fences; simple lists are fine). Never ask the user clarifying questions."""

# ---- realistic rough drafts of the kind users actually type ----
DRAFTS = [
    ("email_professor", "write email to my professor asking for extension on my final project deadline"),
    ("slow_python", "why is my python script so slow it takes forever on big files"),
    ("landing_page", "give me ideas for my startup landing page"),
    ("transformers", "explain how transformers work"),
    ("cover_letter", "cover letter for a software engineering internship at a fintech startup"),
    ("react_vs_vue", "should i use react or vue"),
    ("remote_work", "summarize pros and cons of remote work for a class presentation"),
    ("interview_prep", "help me prep for behavioral interviews"),
]

USER_WRAP = "ROUGH DRAFT (rewrite as a prompt for another AI — do NOT answer this):\n{draft}\n"


def call(model, system, user, max_tokens=1000):
    r = client.messages.create(model=model, max_tokens=max_tokens, system=system,
                               messages=[{"role": "user", "content": user}])
    return "".join(b.text for b in r.content if b.type == "text")


def engineer(system, draft):
    return call(ENGINEER_MODEL, system, USER_WRAP.format(draft=draft))


def answer(prompt):
    return call(ANSWER_MODEL, "You are a helpful AI assistant in a consumer chat product.", prompt, max_tokens=3000)


JUDGE_SYSTEM = """You judge which of two AI answers better serves a user. You are given the user's ORIGINAL rough request (what they actually wanted) and two answers produced via different prompting of the same assistant.

Score which answer better serves the ORIGINAL request on:
1. Intent fit — addresses what the user actually wanted, no invented user-specific facts (fabricated names/dates/details presented as the user's own count heavily against).
2. Usefulness — concrete, actionable, complete enough to act on.
3. Fit of form — right format and length for the need; padding and irrelevant sections count against.

Reply with JSON only: {"winner": "1" or "2" or "tie", "margin": "slight"|"clear", "reason": "<one sentence>"}"""


def _parse_judge(txt):
    for m in re.finditer(r"\{.*?\}", txt, re.S):
        try:
            obj = json.loads(m.group(0))
            if obj.get("winner") in ("1", "2", "tie"):
                return obj
        except json.JSONDecodeError:
            continue
    return None


def judge(original, ans1, ans2):
    user = (f"ORIGINAL USER REQUEST:\n{original}\n\n"
            f"ANSWER 1:\n{ans1}\n\n---\n\nANSWER 2:\n{ans2}")
    for _ in range(2):  # one retry on unparseable output
        try:
            txt = call(JUDGE_MODEL, JUDGE_SYSTEM, user, max_tokens=300)
        except Exception as e:
            return {"winner": "tie", "reason": f"judge_error: {e}"}
        obj = _parse_judge(txt)
        if obj:
            return obj
    return {"winner": "tie", "reason": f"parse_error: {txt[:200]}"}


def main():
    print("engineering prompts...", flush=True)
    with ThreadPoolExecutor(8) as ex:
        futs = {}
        for key, draft in DRAFTS:
            futs[(key, "B")] = ex.submit(engineer, CURRENT_SYSTEM, draft)
            futs[(key, "C")] = ex.submit(engineer, V2_SYSTEM, draft)
        eng = {k: f.result() for k, f in futs.items()}

    print("generating answers...", flush=True)
    with ThreadPoolExecutor(8) as ex:
        futs = {}
        for key, draft in DRAFTS:
            futs[(key, "A")] = ex.submit(answer, draft)
            futs[(key, "B")] = ex.submit(answer, eng[(key, "B")])
            futs[(key, "C")] = ex.submit(answer, eng[(key, "C")])
        ans = {k: f.result() for k, f in futs.items()}

    print("judging...", flush=True)
    pairs = [("A", "B"), ("A", "C"), ("B", "C")]
    with ThreadPoolExecutor(8) as ex:
        jfuts = {}
        for key, _ in DRAFTS:
            for x, y in pairs:
                draft = dict(DRAFTS)[key]
                jfuts[(key, x, y, "fwd")] = ex.submit(judge, draft, ans[(key, x)], ans[(key, y)])
                jfuts[(key, x, y, "rev")] = ex.submit(judge, draft, ans[(key, y)], ans[(key, x)])
        judgments = {k: f.result() for k, f in jfuts.items()}

    # a side wins a matchup only if it wins in BOTH presentation orders
    tally = {p: {"first": 0, "second": 0, "tie": 0} for p in pairs}
    detail = []
    for key, _ in DRAFTS:
        for x, y in pairs:
            fwd, rev = judgments[(key, x, y, "fwd")], judgments[(key, x, y, "rev")]
            fw = {"1": x, "2": y}.get(fwd.get("winner"), "tie")
            rw = {"1": y, "2": x}.get(rev.get("winner"), "tie")
            verdict = fw if fw == rw else "tie"  # disagreement across orders = noise
            if verdict == x:
                tally[(x, y)]["first"] += 1
            elif verdict == y:
                tally[(x, y)]["second"] += 1
            else:
                tally[(x, y)]["tie"] += 1
            detail.append({"draft": key, "pair": f"{x}v{y}", "verdict": verdict,
                           "fwd": fwd, "rev": rev})

    results = {
        "engineered": {f"{k[0]}_{k[1]}": v for k, v in eng.items()},
        "answers": {f"{k[0]}_{k[1]}": v for k, v in ans.items()},
        "tally": {f"{x}v{y}": v for (x, y), v in tally.items()},
        "detail": detail,
    }
    OUT.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results["tally"], indent=2))
    print(f"saved -> {OUT}")


if __name__ == "__main__":
    main()
