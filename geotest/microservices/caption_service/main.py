from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import logging
import base64
from typing import List, Optional

app = FastAPI(title="Caption Service (template)")

# Allow CORS from localhost:3000 (adjust if different)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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


class QueryRequest(BaseModel):
    query: Optional[str] = None
    b64_image: Optional[str] = None


class QueryResponseModel(BaseModel):
    lat_longs: List[List[float]]
    input_caption: str
    captions: List[str]


def dummy_infer_from_b64(data_url: str) -> str:
    """
    Placeholder inference function.

    - Expects a data URL like "data:image/png;base64,....".
    - Currently does not perform real model inference.
    - Replace the body of this function with actual decoding + model inference code.
    """
    try:
        header, b64 = data_url.split(",", 1)
        # Optionally decode for future use:
        # image_bytes = base64.b64decode(b64)
        # e.g., load with PIL.Image.open(io.BytesIO(image_bytes)) and run model
        _ = b64[:32]  # no-op to reference variable
    except Exception:
        logger.warning("Invalid data URL received in dummy_infer_from_b64")
    # Deterministic placeholder caption for testing
    return "A small satellite view showing buildings and streets (placeholder caption)."


@app.post("/process_caption", response_model=CaptionResponse)
async def process_caption(req: CaptionRequest):
    if not req.image:
        raise HTTPException(status_code=400, detail="Missing image in request")

    try:
        caption = dummy_infer_from_b64(req.image)
        return {"caption": caption}
    except Exception as e:
        logger.exception("Inference failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process_query", response_model=QueryResponseModel)
async def process_query(req: QueryRequest):
    # This is a stubbed response for development/testing
    logger.info("Received process_query request: query=%s, image=%s", req.query, bool(req.b64_image))

    # Generate 10 deterministic dummy coordinates near a default center (New York City).
    # This keeps behavior predictable for development and UI testing.
    center_lat = 40.7128
    center_lon = -74.0060

    lat_longs = []
    captions = []
    for i in range(10):
        # Create a small grid of points around the center
        row = i // 5
        col = i % 5
        lat_offset = (row - 1) * 0.0125  # rows: -0.0125, 0, 0.0125, etc.
        lon_offset = (col - 2) * 0.02    # cols: -0.04, -0.02, 0, 0.02, 0.04
        lat = round(center_lat + lat_offset + (i * 0.0001), 6)
        lon = round(center_lon + lon_offset + (i * 0.0001), 6)
        lat_longs.append([lat, lon])
        captions.append(f"Dummy location {i + 1}")

    return {
        "lat_longs": lat_longs,
        "input_caption": req.query or "",
        "captions": captions,
    }
