"""Classify drafts that are about the user themselves ("write my bio", "should
I pursue a masters?"). These need personal facts, which rarely share words
with the draft, so they're routed to the profile or to rewritten searches."""
import re

_SELF_DOCS = (
    r"bio|biography|resume|résumé|cv|cover letter|personal statement|statement of purpose|"
    r"application essay|college essay|admissions? essay|elevator pitch|linkedin (?:about|summary|headline|profile)"
)
# "my resume parser" is a coding question, not a resume.
_SOFTWARE = r"parser|code|template|builder|generator|app|website|site|project|script|function|tool|model|api"
_LIFE_TOPICS = (
    r"school|college|university|uni|masters?|master's|mba|phd|ph\.d|grad(?:uate)? school|degree|"
    r"major|career|job offer|grad program|phd program|masters program|internship"
)

_PATTERNS = [
    rf"\b(?:my|an?|the|this|that)\s+(?:\w+\s+)?(?:{_SELF_DOCS})\b(?!\s+(?:{_SOFTWARE}))",
    r"\babout (?:me|myself)\b",
    r"\bintroduc(?:e|ing) myself\b",
    r"\b(?:who am i|what do you know about me|someone like me|people like me)\b",
    r"\b(?:my|our) (?:own )?(?:background|experiences?|skills|strengths|weaknesses|story|journey|"
    r"qualifications|achievements|accomplishments|career goals|life goals)\b",
    rf"\bshould i (?:pursue|apply|attend|study|major|go (?:back )?to|get an?|do an?|transfer|switch|"
    rf"quit|accept|take the)\b.*\b(?:{_LIFE_TOPICS})\b",
    rf"\b(?:what|which) (?:{_LIFE_TOPICS})\b.*\b(?:should i|for me|suits? me|fits? me)\b",
    rf"\b(?:{_LIFE_TOPICS})\b.*\b(?:right for me|worth it for me|best for me|a good fit for me)\b",
]
_ABOUT_ME = re.compile("|".join(f"(?:{p})" for p in _PATTERNS), re.IGNORECASE)


def is_about_me(draft: str) -> bool:
    return bool(_ABOUT_ME.search((draft or "")[:2000]))
