import pytest

from services.personalization import profile_has_personal_facts
from services.query_intent import is_about_me


@pytest.mark.parametrize("draft", [
    "Should I pursue a masters?",
    "What school should I go to?",
    "which college should i pick",
    "is an mba worth it for me",
    "write my bio for twitter",
    "help me with my cover letter for google",
    "Help me write this application essay about my background",
    "should my internship go on my resume",
    "tell me about myself",
    "what are my strengths and weaknesses",
])
def test_about_me(draft):
    assert is_about_me(draft)


@pytest.mark.parametrize("draft", [
    "which tablet should i get",
    "which program should i use to edit videos",
    "what should i do with 2 days in new york",
    "fix the bug in my resume parser code",
    "my kubernetes pod keeps going into crashloopbackoff",
    "write a linkedin message to an austin startup founder",
    "zendrop or spocket, which one should i use for my store",
    "",
])
def test_not_about_me(draft):
    assert not is_about_me(draft)


def test_profile_personal_facts():
    assert not profile_has_personal_facts({})
    assert not profile_has_personal_facts({"domains": {"coding": {"confidence": 0.9}}})
    assert not profile_has_personal_facts({"entities": {"schools": [], "roles": []}})
    assert profile_has_personal_facts({"background": "CS student"})
    assert profile_has_personal_facts({"entities": {"schools": ["UT Austin"]}})
    assert profile_has_personal_facts({"confirmed_anchors": {"summary": "AI tools and grad school"}})
