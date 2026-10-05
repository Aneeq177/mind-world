"""Server half of the Improve parity gate (driven by tests/js/improve_parity.mjs).

Reads cases the extension produced (its on-device candidates and the exact
/engineer_prompt_stateless body it sent) and runs each through:

  cloud   POST /engineer_prompt, with retrieval returning those same candidates
  relay   POST /engineer_prompt_stateless with the extension's body

Anthropic is replaced by the same deterministic stub the JS side uses, so the
only thing compared is what the model would have been asked. Prints
{case_id: {path: {system, user, max_tokens, sources, route}}} as JSON.

  backend\\venv\\Scripts\\python.exe backend/evals/parity/improve_paths.py cases.json
"""
import copy
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-parity")

import anthropic  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from services import database, embedder, retrieval  # noqa: E402

CAPTURE: list[dict] = []


def stub_reply(user: str, fixed: dict) -> str:
    """Mirror of anthropicReply in tests/js/improve_parity.mjs."""
    if user.startswith("DRAFT:") and "\n\nCANDIDATES:\n" in user:
        payload = json.loads(user.split("\n\nCANDIDATES:\n", 1)[1])
        return json.dumps({"ranked_ids": [c["id"] for c in payload]})
    if user.startswith("USER DRAFT:"):
        return json.dumps({"facts": fixed["facts"]})
    if user.startswith("DRAFT:"):
        return json.dumps({"queries": fixed["rewrites"]})
    return "ENGINEERED"


class _Msg:
    def __init__(self, text):
        self.content = [type("Block", (), {"type": "text", "text": text})()]


class FakeAnthropic:
    fixed: dict = {}

    def __init__(self, *a, **k):
        self.messages = self

    def create(self, *, system, messages, max_tokens, **_):
        user = messages[0]["content"]
        text = stub_reply(user, FakeAnthropic.fixed)
        if text == "ENGINEERED":
            CAPTURE.append({"system": system, "user": user, "max_tokens": max_tokens})
        return _Msg(text)


class _Result:
    def __init__(self, data, count=0):
        self.data, self.count = data, count


class FakeSupabase:
    """knowledge_nodes lookups by id (pinned chats, selected details) and the
    no-memory diagnostics counts."""

    def __init__(self, rows: dict, count: int):
        self.rows, self.count, self.ids = rows, count, None

    def table(self, _name):
        self.ids = None
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def in_(self, _col, ids):
        self.ids = list(ids)
        return self

    def execute(self):
        if self.ids is None:
            return _Result([], self.count)
        return _Result([copy.deepcopy(self.rows[i]) for i in self.ids if i in self.rows], self.count)


def run(cases: list[dict], fixed: dict) -> dict:
    FakeAnthropic.fixed = fixed
    anthropic.Anthropic = FakeAnthropic
    main._user_id = lambda *a, **k: "parity-user"
    main._check_improve_quota = lambda *a, **k: {}
    main._charge_improve_quota = lambda *a, **k: None
    database.log_growth_event = lambda *a, **k: None
    embedder.get_embedding_model = lambda: type("M", (), {"encode": lambda self, x, **k: np.zeros((len(x), 384))})()

    route_seen: list[str] = []
    real_route = retrieval.memory_route
    retrieval.memory_route = lambda draft, profile: route_seen.append(real_route(draft, profile)) or route_seen[-1]

    client = TestClient(main.app)
    out = {}
    for case in cases:
        rows = {c["id"]: c for c in case["conversations"]}
        database.get_supabase = lambda: FakeSupabase(rows, len(rows))
        database.get_personal_profile = lambda _uid: copy.deepcopy(case["profile"])
        database.get_prompt_template_by_name = (
            lambda name: {"name": name, "template": case["template_body"]} if case.get("template_body") else None
        )
        retrieval.retrieve_candidates = lambda *a, **k: copy.deepcopy(case["candidates"])
        retrieval.retrieve_about_me = lambda *a, **k: copy.deepcopy(case["candidates"])

        result = {}
        route_seen.clear()
        CAPTURE.clear()
        body = {
            "email": "parity@example.com", "access_token": "t", "message": case["draft"],
            "template": case.get("template") or "none", "skip_memory": case.get("skip", False),
            "api_key": None,
        }
        if case.get("pinned_ids"):
            body["conversation_ids"] = case["pinned_ids"]
        res = client.post("/engineer_prompt", json=body, headers={"X-MW-Client": main.MW_CLIENT_SECRET})
        result["cloud"] = _capture(res, route_seen[-1] if route_seen else None)

        CAPTURE.clear()
        res = client.post("/engineer_prompt_stateless", json=case["relay_body"], headers={"X-MW-Client": main.MW_CLIENT_SECRET})
        result["relay"] = _capture(res, case["relay_body"].get("memory_route"))
        out[case["id"]] = result
    return out


def _capture(res, route) -> dict:
    if res.status_code != 200:
        return {"error": f"{res.status_code} {res.text[:300]}"}
    data = res.json()
    sent = CAPTURE[-1] if CAPTURE else {}
    return {
        **sent,
        "sources": [s.get("id") for s in data.get("sources_used") or []],
        "memory_status": (data.get("memory") or {}).get("status"),
        "route": route,
    }


if __name__ == "__main__":
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(run(spec["cases"], spec["fixed"])))
