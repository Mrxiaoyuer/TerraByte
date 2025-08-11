export type QueryResponse = {
  lat_longs: [number, number][];
  input_caption: string;
  captions: string[];
  thumbnails?: (string | null)[];
};

/**
 * Resolve backend base URLs depending on runtime environment.
 * - When running the app locally (localhost / 127.0.0.1) we want the client
 *   to call the microservices directly on their mapped host ports so requests
 *   actually reach the FastAPI containers.
 * - When running behind the reverse proxy (Caddy / terrabyte.live) we keep
 *   relative paths so the proxy can route `/api/...` to the correct service.
 */
function resolveBackends() {
  if (typeof window === "undefined") {
    // Server-side / build-time: keep relative paths (Next.js server will proxy or serve)
    return {
      processQueryBase: "",
      processCaptionBase: "",
    };
  }

  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  if (isLocalhost) {
    // When developing locally we know Compose maps:
    // - process_query -> host:8000
    // - caption_service -> host:8001
    return {
      processQueryBase: "http://127.0.0.1:8000",
      processCaptionBase: "http://127.0.0.1:8001",
    };
  }

  // Default: use relative /api paths so a reverse proxy (Caddy) can route them.
  return {
    processQueryBase: "",
    processCaptionBase: "",
  };
}

async function fetchLatLongs(query: string, image: string | null): Promise<QueryResponse> {
  try {
    const { processQueryBase } = resolveBackends();

    // Build endpoint respecting whether we want absolute host:port (local dev)
    // or a relative path that will be forwarded by the proxy in production.
    const endpoint = processQueryBase ? `${processQueryBase}/process_query` : "/api/process_query";

    let response;
    if (image) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, b64_image: image }),
      });
    } else {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data: QueryResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching lat/lng data:", error);
    return { lat_longs: [], input_caption: "", captions: [] };
  }
}

export async function searchLocations(query: string, image: string | null) {
  const data = await fetchLatLongs(query, image);
  if (!data || data.lat_longs.length === 0) {
    return { locations: [], inputCaption: "" };
  }

  const locations = data.lat_longs.map((pair, i) => {
    const [lat, lng] = pair;
    return {
      id: `${i + 1}`,
      name: `Location ${i + 1}`,
      address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      lat,
      lng,
      distance: 0,
      caption: (data.captions && data.captions[i]) ? (data.captions[i].charAt(0).toUpperCase() + data.captions[i].slice(1)) : "",
      thumbnail: (data.thumbnails && data.thumbnails[i]) ? data.thumbnails[i] : null,
      type: "",
    };
  });

  return { locations, inputCaption: data.input_caption || "" };
}

export async function fetchCaption(image: string) {
  try {
    const { processCaptionBase } = resolveBackends();
    const endpoint = processCaptionBase ? `${processCaptionBase}/process_caption` : "/api/process_caption";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching caption:", error);
    return null;
  }
}
