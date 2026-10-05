from services.engineer_core import (
    adaptation_hint,
    build_conversation_context,
    build_engineer_messages,
    engineer_system_prompt,
    load_prompts,
    prompt_system,
    render,
)


def test_render_replaces_named_values_and_joins_lines():
    assert render(["a {{x}}", "b {{y}}"], x=1, y="two") == "a 1\nb two"
    # Braces that aren't placeholders (JSON examples in prompts) are left alone.
    assert render('{"ids": [{{n}}]}', n=3) == '{"ids": [3]}'


def test_every_named_prompt_renders_without_leftover_placeholders():
    values = {"limit": 5, "max_facts": 6, "max_queries": 4, "adaptation_hint": "h", "core_role": "role"}
    for name, entry in load_prompts().items():
        if isinstance(entry, dict) and "system" in entry:
            system, max_tokens = prompt_system(name, **values)
            assert "{{" not in system, name
            assert max_tokens > 0


def test_adaptation_hint_thresholds():
    hints = load_prompts()["adaptation_hints"]
    assert adaptation_hint({"concise_bias": 0.7}) == hints["concise"]
    assert adaptation_hint({"detail_level": 0.7}) == hints["detail"]
    assert adaptation_hint({}) == hints["balanced"]


def test_engineer_system_prompt_ends_with_hint():
    assert engineer_system_prompt("Prefer concise wording.").endswith(
        "Adaptive preference hint: Prefer concise wording."
    )


def test_user_content_matches_the_original_layout():
    convs = [{
        "id": "c1", "title": "Resume help", "created_at": "2026-01-02T10:00:00Z",
        "num_messages": 4, "full_text": "[user] fix my resume", "similarity": 0.5,
    }]
    sources, parts = build_conversation_context(convs)
    profile_context = "\n[USER-VERIFIED PERSONALIZATION ANCHORS]\n- fact\n\n"
    system, user, max_tokens = build_engineer_messages(
        "help with resume", parts, profile_context, {}, "Career coach", "TEMPLATE BODY",
    )
    expected = (
        "ROUGH DRAFT (rewrite as a prompt for another AI — do NOT answer this):\n"
        f"help with resume\n{profile_context}"
        "\n\nPAST CONVERSATIONS (user background only — do not copy assistant replies):\n"
        "Conversation: Resume help\nDate: 2026-01-02\nMessages: 4\nContent:\n[user] fix my resume"
        "\n\nTEMPLATE SCAFFOLD (structure/persona only — merge into one prompt, do not paste verbatim):\n"
        "Template name: Career coach\nTEMPLATE BODY"
    )
    assert user == expected
    assert system == engineer_system_prompt("Balance clarity with enough detail for the task.")
    assert max_tokens == 1000
    assert sources[0]["similarity"] == 50.0


def test_skip_memory_with_template_uses_merge_prompt():
    system, user, _ = build_engineer_messages("draft", [], "", {}, "Email", "", skip_memory=True)
    assert system.startswith("You are a prompt engineer. Your ONLY job")
    assert "Merge them into ONE unified prompt" in system
    assert user.endswith("Use the 'Email' template persona as structural inspiration when rewriting the draft into a prompt for another AI.")


def test_client_excerpt_is_used_verbatim():
    _, parts = build_conversation_context([{"id": "x", "title": "T", "excerpt": "ON DEVICE EXCERPT"}])
    assert parts[0].endswith("Content:\nON DEVICE EXCERPT")
