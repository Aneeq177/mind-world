from pydantic import BaseModel
from typing import Optional

class ConversationPoint(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    num_messages: int
    char_count: int
    x: float
    y: float
    z: float
    preview: str
    source: str
    cluster_id: int
    region: str
    color: str

class ProcessResponse(BaseModel):
    conversations: list[ConversationPoint]
    total: int
    sources: dict

class BlendRequest(BaseModel):
    conversation_ids: list[str]
    question: str
    email: str
    api_key: Optional[str] = None

class BlendResponse(BaseModel):
    claude_url: str
    chatgpt_url: str
    summaries: list[dict]

class GenerateQuestionsRequest(BaseModel):
    goal: str
    template: Optional[str] = "none"
    api_key: Optional[str] = None

class UpdateProfileRequest(BaseModel):
    email: str
    is_profile_enabled: bool
