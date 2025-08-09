export type QueryResponse = {
  lat_longs: [number, number][];
  input_caption: string;
  captions: string[];
};

async function fetchLatLongs(query: string, image: string | null): Promise<QueryResponse> {
  try {
    let response;
    if (image) {
      response = await fetch("http://127.0.0.1:8000/process_query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, b64_image: image }),
      });
    } else {
      response = await fetch("http://127.0.0.1:8000/process_query", {
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
      type: "",
    };
  });

  return { locations, inputCaption: data.input_caption || "" };
}

export async function fetchCaption(image: string) {
  try {
    const response = await fetch("http://127.0.0.1:8000/process_caption", {
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
