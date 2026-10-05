"""Golden fixtures for the extension's JS ports of chunker, retrieval,
personalization and query_intent. Writes tests/js/fixtures/golden.json;
tests/js/*.test.mjs replay every case against the JS port.

Run from the repo root:  backend\\venv\\Scripts\\python.exe backend/evals/parity/golden_fixtures.py
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))

from services import (  # noqa: E402
    chunker,
    engineer_core,
    parser,
    personalization,
    personalization_llm,
    prompt_format,
    query_intent,
    retrieval,
)

NOW = datetime(2026, 10, 4, 12, 0, 0, tzinfo=timezone.utc)
NOW_MS = int(NOW.timestamp() * 1000)


class _FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


    @classmethod
    def fromtimestamp(cls, t, tz=None):
        # The server runs in UTC; the JS port always uses UTC.
        return datetime.fromtimestamp(t, timezone.utc).replace(tzinfo=None)


personalization.datetime = _FixedDatetime
personalization_llm.datetime = _FixedDatetime
parser.datetime = _FixedDatetime

OUT = HERE.parents[2] / "tests" / "js" / "fixtures" / "golden.json"

WORDS = (
    "the model resume python react debug api essay college interview project building tool "
    "career masters fastapi email draft tone example concise step by walk through school "
    "research paper internship linkedin application sql javascript scholarship café naïve "
    "über résumé data vector search memory improve prompt template chip"
).split()


def _sentence(rng: random.Random) -> str:
    words = [rng.choice(WORDS) for _ in range(rng.randint(4, 18))]
    words[0] = words[0].capitalize()
    return " ".join(words) + rng.choice([".", "?", "!", "."])


def _conversation(rng: random.Random, turns: int) -> str:
    parts = []
    for i in range(turns):
        role = "user" if i % 2 == 0 else "assistant"
        paras = []
        for _ in range(rng.randint(1, 4)):
            paras.append(" ".join(_sentence(rng) for _ in range(rng.randint(1, 6))))
        parts.append(f"[{role}] " + ("\n" if rng.random() < 0.3 else "\n\n").join(paras))
    return "\n\n".join(parts)


def chunker_cases() -> list[dict]:
    rng = random.Random(7)
    texts = [
        "",
        "short text",
        "x" * 999,
        "x" * 1001,
        "word " * 400,
        ("a" * 50 + " ") * 40,
        "nobreaks" * 300,
        _conversation(rng, 2),
        _conversation(rng, 6),
        _conversation(rng, 14),
        _conversation(rng, 30),
        "Line one\nLine two\n" * 120,
        "Question? Answer! Statement. " * 90,
    ]
    out = []
    for i, text in enumerate(texts):
        spans = chunker.chunk_spans(text)
        out.append({
            "text": text,
            "title": f"Conversation {i}" if i % 3 else "",
            "spans": [list(s) for s in spans],
            "inputs": chunker.chunk_embed_inputs(f"Conversation {i}" if i % 3 else "", text, spans),
            "hash": chunker.text_hash(text),
        })
    return out


def _hits(rng: random.Random, n_convs: int, n_hits: int, keyword: bool = False) -> list[dict]:
    hits = []
    for _ in range(n_hits):
        cid = f"c{rng.randint(1, n_convs)}"
        start = rng.randint(0, 6000)
        hit = {
            "conversation_id": cid,
            "similarity": round(rng.uniform(0.15, 0.8), 4),
            "start_char": start,
            "end_char": start + rng.randint(200, 800),
            "chunk_text": f"chunk of {cid} at {start} " + "lorem " * rng.randint(10, 150),
            "title": f"Title {cid}",
            "preview": f"Preview {cid}",
            "created_at": f"2026-0{rng.randint(1, 9)}-1{rng.randint(0, 9)}T10:00:00+00:00",
        }
        if keyword:
            hit["keyword_score"] = round(rng.uniform(0.1, 1.0), 4)
        hits.append(hit)
    return hits


def _strip_user_id(items: list[dict]) -> list[dict]:
    return [{k: v for k, v in c.items() if k != "user_id"} for c in items]


def retrieval_cases() -> dict:
    rng = random.Random(11)
    group = []
    for n_convs, n_hits in ((1, 1), (3, 8), (8, 40), (20, 60)):
        hits = _hits(rng, n_convs, n_hits)
        group.append({"hits": hits, "out": _strip_user_id(retrieval.group_chunk_hits(hits))})

    cutoff = []
    for _ in range(6):
        cands = [{"id": f"c{i}", "similarity": round(rng.uniform(0.1, 0.9), 4)} for i in range(rng.randint(0, 10))]
        for args in ((), (0.30, 0.25), (0.5, 0.1)):
            cutoff.append({"cands": cands, "args": list(args), "out": retrieval.apply_relevance_cutoff(cands, *args)})

    excerpt = []
    text = _conversation(random.Random(3), 30)
    for _ in range(8):
        matched = [
            {"start_char": (s := rng.randint(0, len(text))), "end_char": s + rng.randint(100, 900),
             "similarity": round(rng.uniform(0.2, 0.8), 4)}
            for _ in range(rng.randint(0, 6))
        ]
        for budget in (3000, 1200):
            excerpt.append({"matched": matched, "budget": budget, "out": retrieval.build_excerpt(text, matched, budget)})

    keyword_group = []
    for n_convs, n_hits in ((2, 4), (10, 30)):
        hits = _hits(rng, n_convs, n_hits, keyword=True)
        keyword_group.append({"hits": hits, "out": _strip_user_id(retrieval.group_keyword_hits(hits))})

    hybrid = []
    for n_queries, cap, min_sim in ((1, None, 0.36), (1, None, 0.36), (3, 4, 0.30), (2, None, 0.36), (4, 2, 0.30)):
        vec = [_strip_user_id(retrieval.group_chunk_hits(_hits(rng, 12, 40))) for _ in range(n_queries)]
        kw = [_strip_user_id(retrieval.group_keyword_hits(_hits(rng, 12, 20, keyword=True))) for _ in range(rng.randint(0, n_queries))]
        out = retrieval.merge_hybrid(vec, kw, min_similarity=min_sim, per_list_cap=cap)
        hybrid.append({"vec": vec, "kw": kw, "cap": cap, "min_similarity": min_sim, "out": out})

    return {
        "text": text,
        "group": group,
        "cutoff": cutoff,
        "excerpt": excerpt,
        "keyword_group": keyword_group,
        "hybrid": hybrid,
    }


def _iso(days_ago: float) -> str:
    from datetime import timedelta
    return (NOW - timedelta(days=days_ago)).isoformat()


def profiles() -> list[dict]:
    return [
        {},
        {"domains": "not json"},
        {
            "domains": {
                "coding": {"confidence": 0.82, "last_observed_at": _iso(3), "evidence_count": 12},
                "career": {"confidence": 0.55, "last_observed_at": _iso(40)},
                "writing": {"confidence": 0.4, "last_observed_at": _iso(120)},
            },
            "preferences": {
                "concise": {"value": True, "confidence": 0.9, "last_observed_at": _iso(1)},
                "step_by_step": {"value": True, "confidence": 0.7, "last_observed_at": _iso(10)},
                "examples": {"value": False, "confidence": 0.9, "last_observed_at": _iso(1)},
            },
            "active_projects": [{"name": "mind world", "confidence": 0.8, "last_observed_at": _iso(2)}],
        },
        {
            "domains": json.dumps({"education": {"confidence": 0.7, "last_observed_at": _iso(5)}}),
            "confirmed_anchors": {"summary": "school and essays", "domains": ["education"], "confirmed_at": _iso(10)},
            "preferences": {"formal_tone": {"value": True, "confidence": 0.95, "last_observed_at": "2026-09-30T08:00:00"}},
            "adaptive_weights": {"retrieval_recency_boost": 1.15, "retrieval_domain_boost": 0.85, "detail_level": 0.7},
        },
        {
            "llm_synthesized_summary": "A CS student building a Chrome extension.",
            "llm_summary_confidence": 0.77,
            "entities": {"schools": ["MIT"], "tools": []},
            "llm_quick_corrections": [{"id": "ext", "label": "Extension dev"}, {"label": "Exam prep"}, {"id": "x"}],
            "last_llm_synthesis_at": _iso(0.5),
            "confirmed_anchors": {"confirmed_at": _iso(45), "domains": ["career"]},
            "domains": {"coding": {"confidence": 0.9, "last_observed_at": _iso(1)}},
        },
        {"background": "Grad student", "last_llm_synthesis_at": "2026-10-01T00:00:00Z"},
    ]


QUERIES = [
    "fix my python api debug error",
    "write a cover letter for an internship",
    "help with the mind world landing page",
    "make my essay more formal",
    "",
]

ABOUT_ME_DRAFTS = [
    "write my bio for the conference",
    "improve my resume parser code",
    "update my résumé for a PM role",
    "tell me about myself",
    "should I pursue a masters in CS?",
    "which grad school should I pick",
    "is an MBA worth it for me",
    "fix this sql query",
    "write a linkedin summary",
    "My background is in physics, help me pivot",
    "draft a cover letter app",
    "introducing myself to the team",
    "Should I\naccept the job offer",
    "écris ma bio",
    "the cv",
    "my resumes",
]

SNIPPETS = [
    "I'm working on mind world, building a chrome extension with fastapi and react. Keep it short.",
    "Can you walk me through my college essay step by step? Show me an example and use a formal tone.",
    "Interview prep for my internship application; on my the portfolio tool project.",
    "",
    "nothing relevant here at all",
]


def scoring_cases() -> dict:
    profs = profiles()
    out: dict = {"now_ms": NOW_MS, "profiles": profs}
    p = personalization
    out["normalize"] = [p.normalize_profile_data(x) for x in profs + ["{\"domains\": {}}", "[]", 5]]
    out["infer_delta"] = [
        {"profile": i, "snippet": s, "out": p.infer_profile_delta(profs[i], s)}
        for i in range(len(profs)) for s in SNIPPETS
    ]
    out["decay"] = [
        {"conf": c, "ts": ts, "out": p.decay_confidence(c, ts)}
        for c in (0.0, 0.5, 1.0) for ts in (None, "", _iso(0), _iso(45), _iso(200), "2026-09-01T00:00:00", "bad")
    ]
    out["per_profile"] = [
        {
            "top_domains": [list(t) for t in p.get_top_domains(x)],
            "top_domains_loose": [list(t) for t in p.get_top_domains(x, 0.25, 4)],
            "summary_confidence": p.compute_summary_confidence(x),
            "inferred_summary": p.build_inferred_summary(x),
            "personal_facts": p.profile_has_personal_facts(x),
            "enough_history_10": p.has_enough_history(10, x),
            "enough_history_3": p.has_enough_history(3, x),
            "prompt_confirmation": p.should_prompt_confirmation(x),
            "anchor_facts": p.extract_confirmed_anchor_facts(x),
            "display_summary": personalization_llm.get_display_summary(x),
            "quick_corrections": personalization_llm.get_quick_corrections(x),
            "synthesis_stale": personalization_llm.synthesis_is_stale(x),
            "should_extract": personalization_llm.should_run_llm_extraction(x),
            "relevant_facts": [p.extract_relevant_profile_facts(x, q) for q in QUERIES],
        }
        for x in profs
    ]
    out["confirmation"] = [
        {"profile": i, "action": a, "ids": ids, "out": p.apply_summary_confirmation(profs[i], a, ids)}
        for i in range(len(profs))
        for a, ids in (("confirm", []), ("correct", ["coding"]), ("correct", ["Career", "writing", "other"]),
                       ("correct", ["other"]), ("skip", []), ("bogus", []))
    ]
    rng = random.Random(5)
    convs = [
        {"id": f"c{i}", "title": rng.choice(["Python API bug", "Cover letter", "mind world landing", "Essay draft", "Misc"]),
         "preview": rng.choice(["debug the api", "internship application", "react page", "formal tone", ""]),
         "created_at": rng.choice([_iso(rng.uniform(0, 300)), None, "2026-05-01T00:00:00"]),
         **({"similarity": round(rng.uniform(0.3, 0.8), 4)} if rng.random() < 0.7 else {"keyword_score": round(rng.uniform(0.4, 1), 4)})}
        for i in range(12)
    ]
    out["hybrid"] = [
        {"convs": convs, "query": q, "profile": i, "out": p.hybrid_score_conversations(convs, q, profs[i])}
        for i in range(len(profs)) for q in QUERIES[:3]
    ]
    out["edit_feedback"] = [
        {"profile": i, "metrics": m, "accepted": a, "out": p.apply_edit_feedback_adaptation(profs[i], m, a)}
        for i in (0, 2, 3)
        for m, a in (({"normalized_edit_distance": 0.5, "engineered_length": 1200}, False),
                     ({"normalized_edit_distance": 0.05, "engineered_length": 300}, False),
                     ({"normalized_edit_distance": 0.3, "engineered_length": 200}, False),
                     ({}, True), (None, True))
    ]
    deltas = [
        {"domains": {"coding": {"confidence": 0.9, "expertise_level": "advanced"}, "new_area": {"confidence": 0.5}, "bad": 3},
         "preferences": {"concise": {"confidence": 0.6}, "examples": {"value": False, "confidence": 1}},
         "active_projects": [{"name": "Mind World", "confidence": 0.9}, {"name": " "}, "x", {"name": "Thesis", "confidence": 0.4}],
         "constraints": ["no jargon", "no jargon", " ", "uses Windows"],
         "entities": {"schools": ["MIT", "MIT", "Stanford", " "], "tools": "notalist"}},
        {},
    ]
    out["merge_delta"] = [
        {"profile": i, "delta": d, "out": personalization_llm.merge_llm_profile_delta(profs[i], d)}
        for i in range(len(profs)) for d in deltas
    ]
    out["queue"] = [
        {"profile": {"llm_pending_snippets": pending}, "snippet": s,
         "out": personalization_llm.queue_snippet_for_llm_extraction({"llm_pending_snippets": pending}, s)}
        for pending in ([], ["a", "b", "c", "d", "e", "f"]) for s in ("new one", "   ", "y" * 3000)
    ]
    out["about_me"] = [{"draft": d, "out": query_intent.is_about_me(d)} for d in ABOUT_ME_DRAFTS]
    out["route"] = [
        {"draft": d, "profile": prof, "out": retrieval.memory_route(d, prof)}
        for d in ABOUT_ME_DRAFTS[:5]
        for prof in (None, {"is_profile_enabled": True, "profile_data": profs[4]},
                     {"is_profile_enabled": False, "profile_data": profs[4]},
                     {"is_profile_enabled": True, "profile_data": profs[2]})
    ]
    out["parse_json"] = [
        {"text": t, "out": personalization_llm._parse_json_text(t)}
        for t in ('{"a": 1}', '```json\n{"a": [1, 2]}\n```', 'Here: {"b": "x}"} and more text {"c": 2}',
                  '[1, {"d": 2}] trailing', '```\n["q1", "q2"]\n```')
    ]
    return out


def _chatgpt_convo(rng: random.Random, cid: str | None, create_time, branchy: bool, with_current: bool) -> dict:
    mapping = {"root": {"id": "root", "parent": None, "children": ["m0"], "message": None}}
    prev = "root"
    for i in range(rng.randint(2, 6)):
        nid = f"m{i}"
        role = rng.choice(["user", "assistant"]) if i else "user"
        msg = {
            "author": {"role": role},
            "content": {"content_type": "text", "parts": [_sentence(rng) + " " + _sentence(rng), "", 7]},
            "recipient": "all",
            "metadata": {},
        }
        if i == 1 and rng.random() < 0.3:
            msg["recipient"] = "browser"
        if i == 2 and rng.random() < 0.3:
            msg["metadata"]["is_visually_hidden_from_conversation"] = True
        if i == 3 and rng.random() < 0.3:
            msg["content"] = {"content_type": "code", "text": "print(1)"}
        mapping[nid] = {"id": nid, "parent": prev, "children": [], "message": msg}
        mapping[prev]["children"].append(nid)
        if branchy and i == 1:
            alt = f"alt{i}"
            mapping[alt] = {"id": alt, "parent": prev, "children": [], "message": {
                "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["regenerated " * 10]}}}
            mapping[prev]["children"].insert(0, alt)
        prev = nid
    convo = {"title": rng.choice(["Chat about APIs", "", None, "Essay help"]), "mapping": mapping,
             "create_time": create_time, "update_time": create_time + 50 if isinstance(create_time, (int, float)) else create_time}
    if cid:
        convo["id"] = cid
    if with_current:
        convo["current_node"] = prev
    return convo


def _claude_convo(rng: random.Random, uuid: str, created: str) -> dict:
    msgs = []
    for i in range(rng.randint(1, 5)):
        if rng.random() < 0.5:
            msgs.append({"sender": "human" if i % 2 == 0 else "assistant", "text": _sentence(rng) + " " + _sentence(rng)})
        else:
            msgs.append({"sender": "assistant", "text": "", "content": [
                {"type": "text", "text": _sentence(rng)}, {"type": "tool_use", "name": "x"}, {"type": "text", "text": " more."}]})
    return {"uuid": uuid, "name": rng.choice(["Claude chat", "", None]), "created_at": created,
            "updated_at": created, "chat_messages": msgs}


def _zip(files: dict[str, bytes]) -> bytes:
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def parser_cases() -> list[dict]:
    import base64
    rng = random.Random(21)
    chatgpt = [
        _chatgpt_convo(rng, f"g{i}", ct, branchy=i % 2 == 0, with_current=i % 3 != 0)
        for i, ct in enumerate([1700000000, 1700000500.25, 1690000000.123456, "1695000000", None, "bad", 1710000000])
    ]
    chatgpt.append(_chatgpt_convo(rng, None, 1700001000, branchy=False, with_current=True))
    claude = [_claude_convo(rng, f"u{i}", f"2026-0{1 + i % 9}-0{1 + i % 8}T10:00:0{i % 10}Z") for i in range(8)]
    claude.append({"uuid": "short", "name": "x", "created_at": "2026-01-01", "chat_messages": [{"sender": "human", "text": "hi"}]})
    # Ties on created_at make pandas' unstable sort pick either copy.
    dup_newer = dict(claude[0], name="Duplicate wins", created_at="2026-12-01T00:00:00Z")
    manifest = {"data_files": [{"export_url": "https://example.com/x.zip"}]}

    def enc(obj) -> bytes:
        return json.dumps(obj, ensure_ascii=False).encode("utf-8")

    files = {
        "conversations.json": enc(chatgpt),
        "claude_wrapped.json": enc({"conversations": claude[:4]}),
        "claude_list.json": b"\xef\xbb\xbf" + enc(claude),
        "manifest.json": enc(manifest),
        "lines.jsonl": b"\n".join([enc(claude[5]), b"not json", b"", enc(dup_newer)]),
        "single.json": enc(claude[6]),
        "nested.zip": _zip({"conversations-000.json": enc(claude[2:6]), "__MACOSX/conversations-000.json": b"junk",
                            "readme.txt": b"skip", "inner/deeper.zip": _zip({"x.json": enc([claude[7]])})}),
        "bad.json": b"{not json",
    }
    cases = []
    for name, data in files.items():
        cases.append((name, data))
    cases.append(("export.zip", _zip({k: v for k, v in files.items() if k not in ("manifest.json",)})))
    cases.append(("manifest_only.zip", _zip({"manifest.json": files["manifest.json"]})))
    cases.append(("empty.json", b"[]"))

    out = []
    for name, data in cases:
        case = {"name": name, "b64": base64.b64encode(data).decode("ascii")}
        try:
            df = parser.parse_export_file(name, data)
            case["rows"] = json.loads(df.to_json(orient="records", force_ascii=False))
        except parser.ExportFormatError as exc:
            case["error"] = str(exc)
        out.append(case)
    return out


def engineer_cases() -> dict:
    profs = profiles()
    text = _conversation(random.Random(9), 20)
    selected_sets = [
        [],
        [{"id": "a", "title": "Python API bug", "full_text": text, "preview": text[:300], "created_at": "2026-09-01T10:00:00+00:00",
          "num_messages": 12, "source_app": "chatgpt", "similarity": 0.61234,
          "matched": [{"start_char": 900, "end_char": 1700, "similarity": 0.6}, {"start_char": 3000, "end_char": 3800, "similarity": 0.5}]},
         {"id": "b", "title": "Cover letter", "excerpt": "Precomputed excerpt from the device.", "preview": "",
          "created_at": "2026-08-01", "num_messages": 3, "source": "claude", "similarity": 0.4449},
         {"id": "c", "title": "", "preview": "only a preview here", "created_at": "2026-07-01T00:00:00Z", "num_messages": 1,
          "source_app": "gemini", "similarity": None}],
    ]
    contexts = [
        {"selected": s, "out": list(engineer_core.build_conversation_context(s))}
        for s in selected_sets
    ]
    profile_contexts = []
    for i, p in enumerate(profs):
        for enabled in (True, False):
            for facts in (["Fact one.", "Fact two."], []):
                prof = {"is_profile_enabled": enabled, "profile_data": p}
                ctx, adaptive = engineer_core.build_profile_context(prof, "fix my python api debug error", None, facts)
                profile_contexts.append({"profile": i, "enabled": enabled, "facts": facts, "context": ctx, "adaptive": adaptive})
    messages = []
    parts = engineer_core.build_conversation_context(selected_sets[1])[1]
    for ctx_parts in ([], parts):
        for adaptive in ({}, {"concise_bias": 0.7}, {"detail_level": 0.7}, {"concise_bias": 0, "detail_level": 0}):
            for tname, tbody, skip in (("", "", False), ("Code Review", "", False), ("Code Review", "Act as a reviewer.\n[PASTE CODE]", False),
                                       ("Code Review", "Act as a reviewer.", True), ("", "", True)):
                system, user, max_tokens = engineer_core.build_engineer_messages(
                    "fix my bug", ctx_parts, "\n[X]\n- a\n\n", adaptive, tname, tbody, skip)
                messages.append({"parts": ctx_parts, "adaptive": adaptive, "template_name": tname, "template_body": tbody,
                                 "skip": skip, "system": system, "user": user, "max_tokens": max_tokens})
    formats = [
        {"text": t, "out": prompt_format.format_engineered_prompt(t)}
        for t in ("", "   ", "Hello **world**\n\n\n\nNext", "---\nPrompt here\n---\n", "a  b\t c \n  d", "Line\n----\nMore **x** and **y**")
    ]
    return {
        "prompts": engineer_core.load_prompts(),
        "contexts": contexts,
        "profile_contexts": profile_contexts,
        "messages": messages,
        "formats": formats,
    }


def main() -> None:
    fixtures = {
        "engineer": engineer_cases(),
        "generated_with": "backend/evals/parity/golden_fixtures.py",
        "chunker": chunker_cases(),
        "retrieval": retrieval_cases(),
        "scoring": scoring_cases(),
        "parser": parser_cases(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixtures, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
