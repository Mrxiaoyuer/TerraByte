from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import logging
import base64
import os
import sys
import json
import asyncio
from typing import Optional

# Ensure microservices/common is importable when running via uvicorn from this directory
# Add the parent directory (microservices) to sys.path so we can import common.azure_client
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from common.azure_client import build_azure_client, create_chat_completion, parse_json_or_text

app = FastAPI(title="Caption Service (Azure-backed)")

# Allow CORS from localhost:3000 (adjust if different)
app.add_middleware(
    CORSMiddleware,
    # Allow frontend dev server on ports 3000 and 3001 (localhost and 127.0.0.1)
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("caption_service")
logging.basicConfig(level=logging.INFO)


class CaptionRequest(BaseModel):
    image: str  # expect dataURL like "data:image/png;base64,...."


class CaptionResponse(BaseModel):
    caption: str


def dummy_infer_from_b64(data_url: str) -> str:
    """
    Deterministic fallback caption for development when Azure credentials are not provided
    or the Azure call fails.
    """
    try:
        header, b64 = data_url.split(",", 1)
        # Optionally decode for future use:
        # image_bytes = base64.b64decode(b64)
        _ = b64[:32]  # reference variable so linter won't complain
    except Exception:
        logger.warning("Invalid data URL received in dummy_infer_from_b64")
    return "A small satellite view showing buildings and streets (placeholder caption)."




async def call_azure_caption(client, data_url: str) -> str:
    """
    Use the shared create_chat_completion helper to request a caption.
    Returns the parsed caption string (or raises).
    """
    system_message = {
        "role": "system",
        "content": "You are a concise assistant that produces a single short factual caption describing the contents of a satellite or aerial image. Respond with JSON exactly like: {\"caption\":\"short caption here\"} whenever possible. Keep caption <= 48 words."
    }

    user_message = {
        "role": "user",
        "content": [
            {"type": "text", "text": "Generate a caption for this image."},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }

    messages = [system_message, user_message]

    try:
        raw_text = await create_chat_completion(client, messages, max_tokens=200, temperature=0.2)
        return parse_caption_text(raw_text)
    except Exception as e:
        logger.exception("Azure caption call failed via shared helper: %s", e)
        raise


def parse_caption_text(text: str) -> str:
    """
    Robust parsing of the model's returned text. Attempts JSON parse first,
    then falls back to extracting a short line of text.
    """
    if not text:
        return ""

    # If text looks like JSON somewhere in the output, attempt to find and parse it.
    text = text.strip()
    # Try direct json parse
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and "caption" in obj:
            cap = obj.get("caption") or ""
            return str(cap).strip()
    except Exception:
        pass

    # If the model returned additional surrounding text, try to extract JSON substring
    try:
        start = text.index("{")
        end = text.rindex("}")
        maybe = text[start : end + 1]
        obj = json.loads(maybe)
        if isinstance(obj, dict) and "caption" in obj:
            cap = obj.get("caption") or ""
            return str(cap).strip()
    except Exception:
        pass

    # Fallback: return first non-empty line, trimmed and limited to a reasonable length
    first_line = text.splitlines()[0].strip()
    if first_line:
        return first_line[:400].strip()
    return text[:400].strip()


@app.post("/process_caption", response_model=CaptionResponse)
async def process_caption(req: CaptionRequest):
    """
    Accepts a data URL image and returns a short caption.

    Behavior:
      - If Azure OpenAI SDK and credentials are available, call the Azure deployment (gpt-4o-mini by default).
      - Attempt to parse JSON {"caption":"..."} from the model output.
      - If Azure is not configured or the call fails, fall back to the deterministic dummy_infer_from_b64.
    """
    if not req.image:
        raise HTTPException(status_code=400, detail="Missing image in request")

    client = build_azure_client()
    if client is None:
        # No Azure client available — use fallback
        logger.info("Azure client not available; using dummy fallback caption.")
        caption = dummy_infer_from_b64(req.image)
        return {"caption": caption}


    try:
        caption = await call_azure_caption(client, req.image)
        # ensure non-empty caption
        if not caption:
            logger.warning("Azure returned empty caption; falling back to dummy caption.")
            caption = dummy_infer_from_b64(req.image)
        return {"caption": caption}
    except Exception as e:
        logger.exception("Caption generation failed; returning fallback caption. Error: %s", e)
        # On failure, return fallback caption instead of error to keep frontend robust.
        caption = dummy_infer_from_b64(req.image)
        return {"caption": caption}
