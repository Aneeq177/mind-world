import io
import json
import zipfile

import pytest

from services.parser import (
    MANIFEST_MESSAGE,
    NOT_FOUND_MESSAGE,
    ExportFormatError,
    parse_export_file,
)

LONG = "This message is long enough to pass the minimum conversation length filter."


def _claude_convo(uuid="c1", name="Claude chat"):
    return {
        "uuid": uuid,
        "name": name,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "chat_messages": [
            {"sender": "human", "text": LONG},
            {"sender": "assistant", "text": LONG},
        ],
    }


def _chatgpt_convo(cid="g1"):
    return {
        "id": cid,
        "title": "ChatGPT chat",
        "create_time": 1700000000,
        "update_time": 1700000000,
        "current_node": "n2",
        "mapping": {
            "n1": {"id": "n1", "parent": None, "message": {
                "author": {"role": "user"}, "content": {"parts": [LONG]}}},
            "n2": {"id": "n2", "parent": "n1", "message": {
                "author": {"role": "assistant"}, "content": {"parts": [LONG]}}},
        },
    }


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data if isinstance(data, bytes) else json.dumps(data))
    return buf.getvalue()


def test_claude_json_list():
    df = parse_export_file("conversations.json", json.dumps([_claude_convo()]).encode())
    assert list(df["source"]) == ["claude"]


def test_claude_json_with_bom():
    data = "\ufeff" + json.dumps([_claude_convo()])
    df = parse_export_file("conversations.json", data.encode("utf-8"))
    assert len(df) == 1


def test_claude_zip():
    df = parse_export_file("export.zip", _zip({"conversations.json": [_claude_convo()]}))
    assert list(df["source"]) == ["claude"]


def test_claude_nested_zip_new_export_format():
    inner = _zip({"conversations.json": [_claude_convo("a"), _claude_convo("b")]})
    outer = _zip({
        "conversations-000.zip": inner,
        "projects-000.zip": _zip({"projects.json": [{"uuid": "p1", "name": "Proj"}]}),
    })
    df = parse_export_file("claude-export.zip", outer)
    assert sorted(df["uuid"]) == ["a", "b"]


def test_jsonl():
    lines = "\n".join(json.dumps(_claude_convo(u)) for u in ("a", "b"))
    df = parse_export_file("conversations.jsonl", lines.encode())
    assert sorted(df["uuid"]) == ["a", "b"]


def test_chatgpt_zip_detected_by_content():
    df = parse_export_file("anything.zip", _zip({
        "conversations.json": [_chatgpt_convo()],
        "shared_conversations.json": [{"id": "s1", "conversation_id": "g1", "title": "x"}],
    }))
    assert list(df["source"]) == ["chatgpt"]


def test_chatgpt_json_detected_by_content():
    df = parse_export_file("conversations.json", json.dumps([_chatgpt_convo()]).encode())
    assert list(df["source"]) == ["chatgpt"]


def test_duplicates_across_files_are_merged():
    df = parse_export_file("x.zip", _zip({
        "a/conversations.json": [_claude_convo("same")],
        "b/conversations.json": [_claude_convo("same")],
    }))
    assert len(df) == 1


def test_manifest_gives_download_instructions():
    manifest = {"data_files": [
        {"filename": "conversations-000.zip", "export_url": "https://example.com/x"},
    ]}
    with pytest.raises(ExportFormatError) as e:
        parse_export_file("manifest.json", json.dumps(manifest).encode())
    assert str(e.value) == MANIFEST_MESSAGE


@pytest.mark.parametrize("content", [
    b"not json at all",
    json.dumps({"hello": "world"}).encode(),
    _zip({"readme.txt": b"hi"}),
])
def test_unrecognised_files(content):
    with pytest.raises(ExportFormatError) as e:
        parse_export_file("file.json", content)
    assert str(e.value) == NOT_FOUND_MESSAGE


def test_friendly_messages_avoid_old_extension_override():
    # The published extension replaces any server message containing this phrase.
    for msg in (MANIFEST_MESSAGE, NOT_FOUND_MESSAGE):
        assert "No conversations" not in msg
