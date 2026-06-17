"""Light cleanup of engineered prompts before display and injection."""
import re


def format_engineered_prompt(text: str) -> str:
    if not text or not text.strip():
        return text or ""

    s = text.strip()

    # Remove --- dividers (common model artifact)
    s = re.sub(r"\n*---+\n*", "\n\n", s)
    s = re.sub(r"^---+\s*", "", s)
    s = re.sub(r"\s*---+\s*$", "", s)

    # Strip markdown bold for cleaner plain text in chat inputs
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)

    # Collapse excessive whitespace
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)

    return s.strip()
