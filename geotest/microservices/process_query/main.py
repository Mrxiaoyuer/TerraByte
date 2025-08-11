from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import requests
import math
import os
import sys
import asyncio
import logging
import json

# Ensure microservices/common is importable when running via uvicorn from this directory
# Add the parent directory (microservices) to sys.path so we can import common.azure_client
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from common.azure_client import build_azure_client, create_chat_completion, parse_json_or_text

logger = logging.getLogger("process_query")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="process_query")

# Allow local dev frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: Optional[str] = None
    b64_image: Optional[str] = None


def centroid_from_bbox(bbox: Any) -> Optional[List[float]]:
    """
    Accept multiple bbox shapes:
      - [minx, miny, maxx, maxy]
      - {"xmin":..., "ymin":..., "xmax":..., "ymax":...}
      - {"left":..., "bottom":..., "right":..., "top":...} (less common)
    Returns [lat, lon] (y, x) as floats when possible.
    """
    if not bbox:
        return None
    try:
        if isinstance(bbox, list) and len(bbox) >= 4:
            minx, miny, maxx, maxy = bbox[0], bbox[1], bbox[2], bbox[3]
            cx = (minx + maxx) / 2.0
            cy = (miny + maxy) / 2.0
            return [float(cy), float(cx)]
        if isinstance(bbox, dict):
            # try common keys
            keys = bbox.keys()
            if {"xmin", "ymin", "xmax", "ymax"}.issubset(keys):
                minx = bbox["xmin"]
                miny = bbox["ymin"]
                maxx = bbox["xmax"]
                maxy = bbox["ymax"]
                cx = (minx + maxx) / 2.0
                cy = (miny + maxy) / 2.0
                return [float(cy), float(cx)]
            if {"left", "bottom", "right", "top"}.issubset(keys):
                minx = bbox["left"]
                miny = bbox["bottom"]
                maxx = bbox["right"]
                maxy = bbox["top"]
                cx = (minx + maxx) / 2.0
                cy = (miny + maxy) / 2.0
                return [float(cy), float(cx)]
    except Exception:
        return None
    return None


async def extract_content_and_bbox(user_input: str) -> Dict[str, Any]:
    """
    Use Azure OpenAI (via common.azure_client) to parse a free-form user input
    into: { content: str, location: Optional[str], bbox: Optional[list] }
    bbox is expected as [minx, miny, maxx, maxy] (lon/lat order).
    If Azure isn't available or parsing fails, return content=user_input and bbox=None.
    """
    client = build_azure_client()
    if client is None:
        logger.info("Azure client not available; skipping assistant parse.")
        return {"content": user_input, "location": None, "bbox": None}

    system_message = {
        "role": "system",
        "content": (
            "You are a strict parser. Given a user's search string which may contain both a search query "
            "and a human location, return a JSON object ONLY with keys: content, location, bbox. "
            "content: concise search keywords (string). "
            "location: the human readable location (string)."
            "bbox: the rough min max coorinates of the location, a list [minx, miny, maxx, maxy] representing lon/lat coordinates in WGS84. "
            "Respond with JSON only, no explanation."
        ),
    }

    user_message = {"role": "user", "content": f"User input: {user_input}\nRespond with JSON only."}

    messages = [system_message, user_message]

    try:
        raw_text = await create_chat_completion(client, messages, max_tokens=200, temperature=0.0)
        parsed = parse_json_or_text(raw_text)
        print(parsed)
        if isinstance(parsed, dict):
            # normalize keys
            content = parsed.get("content") or parsed.get("query") or user_input
            location = parsed.get("location") or parsed.get("place") or None
            bbox = parsed.get("bbox") if "bbox" in parsed else None
            # Validate bbox shape
            if isinstance(bbox, list) and len(bbox) >= 4:
                try:
                    bbox = [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
                except Exception:
                    bbox = None
            else:
                bbox = None
            return {"content": content, "location": location, "bbox": bbox}
        else:
            # if parse returned text or failed, fallback to raw user_input
            logger.info("Assistant parse returned non-JSON; falling back to raw input.")
            return {"content": user_input, "location": None, "bbox": None}
    except Exception as e:
        logger.exception("Assistant parsing failed: %s", e)
        return {"content": user_input, "location": None, "bbox": None}


@app.post("/process_query")
async def process_query(req: QueryRequest):
    """
    Receives { query?: string, b64_image?: string }
    Uses the assistant to extract content + bbox (if possible), calls the GeoSearch /tiles/search endpoint and normalizes results:
    Returns JSON with:
      - lat_longs: [[lat, lon], ...]
      - input_caption: string (extracted content or original query)
      - captions: [caption1, caption2, ...]
      - thumbnails: [dataUrl|null, ...] (order matches lat_longs)
    """
    GEOSERVER_URL = "http://xf1.net:8086/tiles/search"

    # Determine content and bbox via assistant (if query present)
    content = req.query or ""
    bbox = None
    if req.query:
        parsed = await extract_content_and_bbox(req.query)
        content = parsed.get("content") or content
        bbox = parsed.get("bbox")

    payload = {}
    if content:
        payload["text"] = content

    # Only include bbox if assistant returned one (minx,miny,maxx,maxy)
    if bbox:
        # GeoSearch expects a bbox object with explicit min/max points wrapped under "bbox".
        # Construct the payload as:
        # {
        #   "bbox": {
        #     "bbox": {
        #       "min": {"x": min_lon, "y": min_lat},
        #       "max": {"x": max_lon, "y": max_lat}
        #     },
        #     "srid": 4326
        #   }
        # }
        try:
            minx = float(bbox[0])
            miny = float(bbox[1])
            maxx = float(bbox[2])
            maxy = float(bbox[3])
            bbox_inner = {
                "min": {"x": minx, "y": miny},
                "max": {"x": maxx, "y": maxy},
            }
            bbox_obj = {
                "bbox": bbox_inner,
                "srid": 4326,
            }
            payload["bbox"] = bbox_obj
            logger.info("Including bbox in payload: %s", bbox_obj)
        except Exception:
            logger.warning("Invalid bbox returned by assistant, skipping bbox in payload: %s", repr(bbox))
            pass

    # Do not include images for process_query per requirements (skip req.b64_image)

    try:
        # Log payload for debugging (helps verify bbox shape sent)
        try:
            logger.info("Posting to GEOSERVER %s payload: %s", GEOSERVER_URL, json.dumps(payload))
        except Exception:
            logger.info("Posting to GEOSERVER %s (payload could not be serialized)", GEOSERVER_URL)

        # requests is blocking; run in thread to avoid blocking event loop
        def do_post():
            return requests.post(GEOSERVER_URL, json=payload, timeout=15)

        resp = await asyncio.to_thread(do_post)
        # Log response for debugging
        try:
            logger.info("GeoServer response status: %s, body: %s", resp.status_code, resp.text[:1000])
        except Exception:
            logger.info("GeoServer response received (status: %s)", resp.status_code)
    except Exception as e:
        logger.exception("Error contacting geosearch server: %s", e)
        raise HTTPException(status_code=502, detail=f"Error contacting geosearch server: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Geosearch returned {resp.status_code}")

    try:
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Invalid JSON from geosearch: {e}")

    tiles = data.get("tiles", []) if isinstance(data, dict) else []
    lat_longs: List[List[float]] = []
    captions: List[str] = []
    thumbnails: List[Optional[str]] = []

    for tile in tiles:
        # default values
        latlon = None
        caption_text = ""
        thumb = None

        metadata = tile.get("metadata", {}) if isinstance(tile, dict) else {}
        # try to extract bbox from several possible shapes (metadata.bbox, nested bbox, or metadata.misc.bbox)
        bbox_meta = None
        if isinstance(metadata, dict):
            raw_bbox = metadata.get("bbox")
            # sometimes the bbox is wrapped: metadata.bbox.bbox
            if raw_bbox is None and isinstance(metadata.get("bbox"), dict) and "bbox" in metadata.get("bbox"):
                raw_bbox = metadata.get("bbox").get("bbox")
            # sometimes bbox is in misc
            if raw_bbox is None and isinstance(metadata.get("misc"), dict):
                raw_bbox = metadata.get("misc").get("bbox")
            # normalize various bbox shapes into a list [minx, miny, maxx, maxy]
            if isinstance(raw_bbox, dict):
                # unwrap if nested under 'bbox' key
                if "bbox" in raw_bbox and not isinstance(raw_bbox.get("bbox"), list):
                    raw_bbox = raw_bbox.get("bbox")
                # handle { min: { x, y }, max: { x, y } }
                if isinstance(raw_bbox, dict) and "min" in raw_bbox and "max" in raw_bbox:
                    try:
                        minx = raw_bbox["min"].get("x")
                        miny = raw_bbox["min"].get("y")
                        maxx = raw_bbox["max"].get("x")
                        maxy = raw_bbox["max"].get("y")
                        if None not in (minx, miny, maxx, maxy):
                            bbox_meta = [minx, miny, maxx, maxy]
                    except Exception:
                        bbox_meta = None
                else:
                    # try common key names
                    if {"xmin", "ymin", "xmax", "ymax"}.issubset(raw_bbox.keys()):
                        bbox_meta = [raw_bbox["xmin"], raw_bbox["ymin"], raw_bbox["xmax"], raw_bbox["ymax"]]
                    elif {"left", "bottom", "right", "top"}.issubset(raw_bbox.keys()):
                        bbox_meta = [raw_bbox["left"], raw_bbox["bottom"], raw_bbox["right"], raw_bbox["top"]]
            elif isinstance(raw_bbox, list):
                bbox_meta = raw_bbox
        # compute centroid from normalized bbox (if any)
        latlon = centroid_from_bbox(bbox_meta)
        # fallback: metadata might contain lat/lon keys if bbox parsing failed
        if not latlon and isinstance(metadata, dict):
            maybe_lat = None
            maybe_lon = None
            for k in ["lat", "latitude", "y"]:
                if k in metadata and metadata[k] is not None:
                    maybe_lat = metadata[k]
                    break
            for k in ["lon", "lng", "longitude", "x"]:
                if k in metadata and metadata[k] is not None:
                    maybe_lon = metadata[k]
                    break
            if maybe_lat is not None and maybe_lon is not None:
                try:
                    latlon = [float(maybe_lat), float(maybe_lon)]
                except Exception:
                    latlon = None

        # caption
        if isinstance(metadata, dict) and metadata.get("caption"):
            try:
                caption_text = str(metadata.get("caption"))
            except Exception:
                caption_text = ""

        # thumbnail: look for data.base64_data
        data_node = tile.get("data") if isinstance(tile, dict) else None
        if isinstance(data_node, dict) and data_node.get("base64_data"):
            base64_data = data_node.get("base64_data")
            mime = "image/jpeg"
            # try to parse a "{mime},base64" style in data_node.type
            try:
                t = data_node.get("type")
                if t and isinstance(t, str) and "," in t:
                    mime = t.split(",")[0]
            except Exception:
                pass
            thumb = f"data:{mime};base64,{base64_data}"

        # push results (only if we have at least lat/lon or thumbnail)
        if latlon:
            lat_longs.append([float(latlon[0]), float(latlon[1])])
            captions.append(caption_text)
            thumbnails.append(thumb)
        else:
            # If no latlon but thumbnail exists, include as placeholder latlon (0,0) or skip.
            # We'll include only when latlon exists to match frontend expectations.
            continue

    result = {
        "lat_longs": lat_longs,
        "input_caption": content or "",
        "captions": captions,
        "thumbnails": thumbnails,
    }

    return result
