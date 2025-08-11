import os
import json
import asyncio
import logging
from typing import Any, Optional

logger = logging.getLogger("azure_client")
logging.basicConfig(level=logging.INFO)

# Try importing AzureOpenAI from the openai package. If not available, users should install openai.
try:
    from openai import AzureOpenAI  # type: ignore
except Exception:
    AzureOpenAI = None  # type: ignore


def build_azure_client() -> Optional[Any]:
    """
    Build and return an AzureOpenAI client if possible and if credentials exist.
    Returns None otherwise.
    """
    if AzureOpenAI is None:
        logger.info("openai.AzureOpenAI SDK not available.")
        return None

    # Read credentials from a user config file at ~/.azure/gpt-4o-mini.config (JSON).
    # Expected JSON example:
    # {
    #   "endpoint": "https://your-endpoint.openai.azure.com/",
    #   "password": "your-subscription-key",
    #   "deployment": "gpt-4o-mini"
    # }
    config_path = os.path.expanduser("~/.azure/gpt-4o-mini.config")
    endpoint = None
    subscription_key = None
    deployment = os.getenv("DEPLOYMENT_NAME", "gpt-4o-mini")

    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            # support a few common key names
            endpoint = cfg.get("endpoint") or cfg.get("url")
            subscription_key = cfg.get("password") or cfg.get("api_key") or cfg.get("key")
            deployment = cfg.get("deployment") or deployment
        except Exception as e:
            logger.warning("Failed to parse Azure config at %s: %s", config_path, e)

    # Fallback to environment variables if config doesn't provide values (do NOT use hardcoded credentials)
    if not endpoint:
        endpoint = os.getenv("ENDPOINT_URL")
    if not subscription_key:
        subscription_key = os.getenv("AZURE_OPENAI_API_KEY")

    if not endpoint or not subscription_key:
        logger.info("Azure OpenAI credentials not found in config (%s) or environment variables.", config_path)
        return None

    try:
        client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=subscription_key,
            api_version="2025-01-01-preview",
        )
        # attach deployment for convenience
        client._deployment = deployment  # type: ignore
        return client
    except Exception as e:
        logger.exception("Failed to create AzureOpenAI client: %s", e)
        return None


def _blocking_create_completion(client: Any, messages: Any, deployment: Optional[str] = None, **kwargs) -> Any:
    """
    Blocking call wrapper around the AzureOpenAI client's chat completion create method.
    Returns whatever the SDK returns (object or dict) for further parsing.
    """
    deployment_name = deployment or getattr(client, "_deployment", None)
    if not deployment_name:
        # allow caller to pass model in kwargs if desired
        deployment_name = kwargs.get("model") or os.getenv("DEPLOYMENT_NAME", "gpt-4o-mini")

    completion = client.chat.completions.create(
        model=deployment_name,
        messages=messages,
        **kwargs,
    )
    return completion


async def create_chat_completion(client: Any, messages: Any, deployment: Optional[str] = None, max_tokens: int = 200, temperature: float = 0.2, **kwargs) -> str:
    """
    Async wrapper that calls the Azure chat completions API (in a thread) and returns the generated text.
    It will attempt to extract the model-generated text from common SDK response shapes and return a string.
    """
    if client is None:
        raise RuntimeError("Azure client is None")

    def blocking_call():
        return _blocking_create_completion(client, messages, deployment=deployment, max_tokens=max_tokens, temperature=temperature, stream=False, **kwargs)

    try:
        completion = await asyncio.to_thread(blocking_call)
    except Exception as e:
        logger.exception("Azure create completion failed: %s", e)
        raise

    # Try to extract text from known SDK shapes
    try:
        # If SDK exposes to_json, prefer it
        if hasattr(completion, "to_json"):
            raw = completion.to_json()
            raw_text = raw if isinstance(raw, str) else json.dumps(raw)
            # Try to extract choices -> message -> content
            try:
                parsed = json.loads(raw_text)
                if isinstance(parsed, dict):
                    choices = parsed.get("choices")
                    if choices and isinstance(choices, list) and len(choices) > 0:
                        msg = choices[0].get("message", {}).get("content")
                        if msg:
                            return msg
            except Exception:
                pass

        # SDK object with .choices attribute
        if hasattr(completion, "choices") and isinstance(getattr(completion, "choices"), list):
            try:
                ch = completion.choices[0]
                if isinstance(ch, dict):
                    text = ch.get("message", {}).get("content") or ch.get("text")
                    if text:
                        return text
                else:
                    # object shape
                    msg = getattr(ch, "message", None)
                    if msg and isinstance(msg, dict):
                        return msg.get("content") or ""
                    if msg and hasattr(msg, "content"):
                        return getattr(msg, "content")
            except Exception:
                pass

        # Fallback to string conversion
        return str(completion)
    except Exception as e:
        logger.exception("Failed to parse completion: %s", e)
        return str(completion)


def parse_json_or_text(text: str) -> Any:
    """
    Attempt to parse JSON from the model text. If JSON exists, return parsed object.
    Otherwise, return the raw text string.
    """
    if not text:
        return ""

    text = text.strip()
    # Try direct JSON parse
    try:
        obj = json.loads(text)
        return obj
    except Exception:
        pass

    # Try to find JSON substring
    try:
        start = text.index("{")
        end = text.rindex("}")
        maybe = text[start : end + 1]
        obj = json.loads(maybe)
        return obj
    except Exception:
        pass

    # No JSON found: return raw text
    return text
