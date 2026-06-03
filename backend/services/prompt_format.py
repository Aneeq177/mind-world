"""Normalize engineered prompts for readable plain-text display and injection."""
import re


_SECTION_HEADERS = [
    "CONTEXT FROM YOUR HISTORY",
    "CONTEXT ABOUT ME",
    "WHO YOU ARE",
    "WHAT YOU HAVE ALREADY EXPLORED",
    "WHAT HAS BEEN DECIDED OR RULED OUT",
    "WHAT HAS BEEN DECIDED",
    "MY REQUEST",
    "YOUR QUESTION",
    "YOUR TASK",
    "WHAT I NEED FROM YOU",
    "ROLE",
    "TASK",
    "CONSTRAINTS",
    "OUTPUT FORMAT",
    "BACKGROUND",
]


def format_engineered_prompt(text: str) -> str:
    if not text or not text.strip():
        return text or ""

    s = text.strip()

    # Remove --- dividers (common model artifact)
    s = re.sub(r"\n*---+\n*", "\n\n", s)
    s = re.sub(r"^---+\s*", "", s)
    s = re.sub(r"\s*---+\s*$", "", s)

    # Strip markdown bold markers for cleaner plain text in chat inputs
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)

    # Put section headers on their own lines with spacing before them
    for header in _SECTION_HEADERS:
        pattern = rf"(?<!\n)\s*({re.escape(header)}\s*(?:\(relevant to this question\))?\s*:)"
        s = re.sub(pattern, r"\n\n\1", s, flags=re.IGNORECASE)

    # One bullet per line: • or - mid-paragraph
    s = re.sub(r"\s+[•·]\s+", "\n• ", s)
    s = re.sub(r"(?<=\S)\s+-\s+(?=[A-Za-z])", "\n- ", s)

    # Numbered lists: newline before "1." "2." when jammed together
    s = re.sub(r"(?<=\S)\s+(\d+\.\s+)", r"\n\n\1", s)

    # Ensure line break after colon-ended headers when content follows on same line
    s = re.sub(
        r"((?:WHO YOU ARE|WHAT YOU HAVE|WHAT HAS BEEN|MY REQUEST|YOUR QUESTION|YOUR TASK)[^\n]*:)\s+",
        r"\1\n\n",
        s,
        flags=re.IGNORECASE,
    )

    # Collapse excessive whitespace
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)

    # Trim stray spaces on bullet lines
    lines = []
    for line in s.split("\n"):
        stripped = line.strip()
        if stripped.startswith("•") or stripped.startswith("-"):
            stripped = re.sub(r"^[•\-]\s*", lambda m: m.group(0).replace(" ", "") + " ", stripped, count=1)
            if stripped.startswith("•"):
                stripped = "• " + stripped[1:].lstrip()
            elif stripped.startswith("-"):
                stripped = "- " + stripped[1:].lstrip()
        lines.append(stripped)
    s = "\n".join(lines)

    return s.strip()
