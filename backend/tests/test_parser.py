import io
import json
import zipfile

from services.parser import parse_chatgpt


def _node(node_id, parent, children, role=None, text=None, **msg_extra):
    message = None
    if role is not None:
        content = msg_extra.pop("content", None) or {"content_type": "text", "parts": [text]}
        message = {"id": node_id, "author": {"role": role}, "content": content, **msg_extra}
    return {"id": node_id, "parent": parent, "children": children, "message": message}


def _zip(convos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("conversations.json", json.dumps(convos))
    return buf.getvalue()


def _convo(mapping_nodes, current_node, **extra):
    return {
        "id": "conv-1",
        "title": "Test chat",
        "create_time": 1700000000,
        "update_time": 1700000100,
        # Deliberately shuffled: dict order must not decide message order.
        "mapping": {n["id"]: n for n in reversed(mapping_nodes)},
        "current_node": current_node,
        **extra,
    }


def _messages(df):
    return df.iloc[0]["full_text"].split("\n\n")


def test_follows_current_branch_in_order_and_drops_abandoned_branches():
    nodes = [
        _node("root", None, ["u1"]),
        _node("u1", "root", ["a1_old", "a1"], "user", "How do I add a status column in SQL?"),
        _node("a1_old", "u1", [], "assistant", "OLD regenerated answer that was discarded."),
        _node("a1", "u1", ["u2_old", "u2"], "assistant", "Use ALTER TABLE orders ADD COLUMN status."),
        _node("u2_old", "a1", [], "user", "OLD edited question that was replaced."),
        _node("u2", "a1", ["a2"], "user", "And default it to PENDING?"),
        _node("a2", "u2", [], "assistant", "Add DEFAULT 'PENDING' to the column definition."),
    ]
    df = parse_chatgpt(_zip([_convo(nodes, "a2")]))

    assert _messages(df) == [
        "[user] How do I add a status column in SQL?",
        "[assistant] Use ALTER TABLE orders ADD COLUMN status.",
        "[user] And default it to PENDING?",
        "[assistant] Add DEFAULT 'PENDING' to the column definition.",
    ]
    assert "OLD" not in df.iloc[0]["full_text"]
    assert df.iloc[0]["num_messages"] == 4


def test_skips_tool_calls_hidden_messages_and_non_text_content():
    nodes = [
        _node("root", None, ["sys"]),
        _node("sys", "root", ["ctx"], "system", "You are ChatGPT."),
        _node("ctx", "sys", ["u1"], "user", "My custom instructions",
              metadata={"is_visually_hidden_from_conversation": True}),
        _node("u1", "ctx", ["call"], "user", "Best areas to invest in Dubai real estate?"),
        _node("call", "u1", ["tool"], "assistant", '{"query": "best areas dubai"}', recipient="web"),
        _node("tool", "call", ["code"], "tool", "search results..."),
        _node("code", "tool", ["a1"], "assistant", None,
              content={"content_type": "code", "text": "print(1)"}),
        _node("a1", "code", [], "assistant", None,
              content={"content_type": "multimodal_text",
                       "parts": [{"asset_pointer": "file-service://img"},
                                 "Dubai Marina and JVC rank highest for rental yield."]}),
    ]
    df = parse_chatgpt(_zip([_convo(nodes, "a1")]))

    assert _messages(df) == [
        "[user] Best areas to invest in Dubai real estate?",
        "[assistant] Dubai Marina and JVC rank highest for rental yield.",
    ]


def test_without_current_node_follows_newest_child_from_root():
    nodes = [
        _node("root", None, ["u1"]),
        _node("u1", "root", ["a1_old", "a1"], "user", "Plan a two day trip to New York please."),
        _node("a1_old", "u1", [], "assistant", "OLD itinerary."),
        _node("a1", "u1", [], "assistant", "Day 1: Central Park. Day 2: Times Square."),
    ]
    convo = _convo(nodes, None)
    del convo["current_node"]
    df = parse_chatgpt(_zip([convo]))

    assert _messages(df) == [
        "[user] Plan a two day trip to New York please.",
        "[assistant] Day 1: Central Park. Day 2: Times Square.",
    ]


def test_conversation_id_fallback_and_short_chats_skipped():
    long_nodes = [
        _node("root", None, ["u1"]),
        _node("u1", "root", ["a1"], "user", "Explain how transformers use attention in detail."),
        _node("a1", "u1", [], "assistant", "Attention weighs every token against every other token."),
    ]
    long_convo = _convo(long_nodes, "a1")
    del long_convo["id"]
    long_convo["conversation_id"] = "conv-from-new-export"

    short_convo = _convo([_node("root", None, ["u1"]), _node("u1", "root", [], "user", "hi")], "u1")
    short_convo["id"] = "conv-short"

    df = parse_chatgpt(_zip([long_convo, short_convo]))

    assert list(df["uuid"]) == ["conv-from-new-export"]
