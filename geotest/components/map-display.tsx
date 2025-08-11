"use client";

import { useEffect, useRef, useState, useContext } from "react";
import { ImageContext } from "@/contexts/ImageContext";
import { LocationsContext } from "@/contexts/InputCaption";
import { fetchCaption, searchLocations } from "@/lib/actions";
import "./arcgis-overrides.css";

/**
 * Simplified ArcGIS MapDisplay with selection + thumbnail overlay support
 *
 * Changes made:
 * - Results panel is hidden when there are no search results.
 * - Clicking a result recenters the map, zooms to level 18, and marks that result with a star marker.
 * - If a thumbnail is available it is added as a picture-marker overlay at the selected location.
 * - Clicking the star (or selecting a result) opens the popup with the thumbnail as a fallback.
 *
 * Notes:
 * - Uses inline SVG data URIs for the star marker to avoid adding static assets.
 * - Keeps dynamic imports of @arcgis/core modules so ArcGIS code runs in the browser.
 */

export default function MapDisplay() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const resultsLayerRef = useRef<any>(null);
  const overlayGraphicRef = useRef<any>(null); // for thumbnail overlay graphic
  const [loading, setLoading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [caption, setCaption] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const imageContext = useContext(ImageContext);
  if (!imageContext) throw new Error("MapDisplay must be used within an ImageContext Provider");
  const { setImage } = imageContext;

  const locationsContext = useContext(LocationsContext);
  if (!locationsContext) throw new Error("MapDisplay must be used within a LocationsContext Provider");
  const { locations } = locationsContext;

  // Inline star SVG data URL (small, yellow star)
  const STAR_SVG_DATA_URL = (() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ffd54f'><path d='M12 .587l3.668 7.431L23.6 9.75l-5.8 5.657L19.336 24 12 20.013 4.664 24l1.536-8.593L.4 9.75l7.932-1.732z'/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  })();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;
    if (viewRef.current) return;

    let view: any;
    let Map: any;
    let MapView: any;

    const init = async () => {
      try {
        const [MapModule, MapViewModule] = await Promise.all([
          import("@arcgis/core/Map"),
          import("@arcgis/core/views/MapView"),
        ]);
        Map = MapModule.default;
        MapView = MapViewModule.default;

        // Ensure container is empty before creating a new MapView. This prevents duplicate
        // ArcGIS DOM nodes when React Strict Mode or re-mounting occurs during development.
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }

        const map = new Map({
          basemap: "satellite",
        });

        view = new MapView({
          container: containerRef.current!,
          map,
          center: [-96.793, 32.784],
          zoom: 18,
        });

        await view.when();
        viewRef.current = view;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[geotest] MapView init failed:", err);
      }
    };

    init();

    return () => {
      try {
        if (view) {
          try {
            view.destroy();
          } catch {}
          view = null;
        }

        if (viewRef.current) {
          try {
            viewRef.current.destroy();
          } catch {}
          viewRef.current = null;
        }

        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTakeScreenshot() {
    const view = viewRef.current;
    if (!view) {
      // eslint-disable-next-line no-console
      console.warn("[geotest] view not ready for screenshot");
      return;
    }

    setLoading(true);
    let _resultsLayerPreviouslyVisible = false;
    let _popupWasOpen = false;
    let _layerWasOnMap = false;
    let _clearedResultsLayer = false;
    try {
      try {
        await clearResultsLayer();
        _clearedResultsLayer = true;
      } catch (e) {
        try {
          if (resultsLayerRef.current) {
            if (typeof resultsLayerRef.current.visible !== "undefined") {
              _resultsLayerPreviouslyVisible = !!resultsLayerRef.current.visible;
              resultsLayerRef.current.visible = false;
            } else if (typeof (resultsLayerRef.current as any).hide === "function") {
              (resultsLayerRef.current as any).hide();
            }
          }
        } catch {}
      }

      try {
        if (view && view.popup) {
          if (typeof view.popup.visible !== "undefined") {
            _popupWasOpen = !!view.popup.visible;
            try {
              view.popup.visible = false;
            } catch {}
          } else if (typeof (view.popup as any).close === "function") {
            _popupWasOpen = true;
            try {
              (view.popup as any).close();
            } catch {}
          } else if (typeof (view.popup as any).hide === "function") {
            _popupWasOpen = true;
            try {
              (view.popup as any).hide();
            } catch {}
          }
        }
      } catch (e) {}

      const result = await view.takeScreenshot({ quality: 0.9 });
      let dataUrl: string | null = null;

      if (!result) {
        console.warn("[geotest] takeScreenshot returned no result");
        setLoading(false);
        return;
      }

      if (typeof result === "string") {
        dataUrl = result;
      } else if (result && typeof result.data === "string") {
        dataUrl = result.data;
      } else if (result && typeof (result as any).dataUrl === "string") {
        dataUrl = (result as any).dataUrl;
      } else if (result instanceof Blob || (result && result.data instanceof Blob)) {
        const blob = result instanceof Blob ? result : result.data;
        dataUrl = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(String(reader.result));
          reader.onerror = (e) => rej(e);
          reader.readAsDataURL(blob as Blob);
        });
      }

      if (!dataUrl) {
        console.warn("[geotest] could not derive dataUrl from screenshot result");
        setLoading(false);
        return;
      }

      try {
        setImage && setImage(dataUrl);
      } catch {}

      try {
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, filename: `geotest-${Date.now()}.png` }),
        });
        const json = await uploadRes.json().catch(() => null);
        console.log("[geotest] upload response:", json);
      } catch (e) {
        console.warn("[geotest] upload failed:", e);
      }

      try {
        const res = await fetchCaption(dataUrl);
        if (res && (res.caption || (res as any).input_caption)) {
          setCaption((res as any).caption || (res as any).input_caption);
        }
      } catch (e) {
        console.warn("[geotest] caption request failed:", e);
      }

      try {
        const base64 = dataUrl.split(",")[1];
        const mime = dataUrl.split(",")[0].split(":")[1].split(";")[0];
        const byteString = atob(base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: mime });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `geotest-screenshot-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        console.warn("[geotest] download failed:", e);
      }
    } catch (err) {
      console.error("[geotest] screenshot failed:", err);
    } finally {
      try {
        if (resultsLayerRef.current && _layerWasOnMap) {
          if (view && view.map && typeof view.map.add === "function") {
            try {
              view.map.add(resultsLayerRef.current);
            } catch {
              try {
                view.map.layers && typeof view.map.layers.add === "function" && view.map.layers.add(resultsLayerRef.current);
              } catch {}
            }
          } else if (view && view.map && view.map.layers && typeof view.map.layers.add === "function") {
            try {
              view.map.layers.add(resultsLayerRef.current);
            } catch {}
          }
        }
      } catch (e) {}

      try {
        if (resultsLayerRef.current) {
          if (typeof resultsLayerRef.current.visible !== "undefined") {
            resultsLayerRef.current.visible = _resultsLayerPreviouslyVisible;
          } else if (typeof (resultsLayerRef.current as any).show === "function") {
            (resultsLayerRef.current as any).show();
          }
        }
      } catch (e) {}

      try {
        if (view && view.popup) {
          if (typeof view.popup.visible !== "undefined") {
            view.popup.visible = _popupWasOpen;
          } else if (_popupWasOpen && typeof (view.popup as any).open === "function") {
            try {
              (view.popup as any).open();
            } catch {}
          }
        }
      } catch (e) {}

      setLoading(false);
    }
  }

  async function handleRequestCaption() {
    const view = viewRef.current;
    if (!view) {
      console.warn("[geotest] view not ready for caption");
      return;
    }

    setLoading(true);
    let _popupWasOpen = false;
    let _clearedResultsLayer = false;
    try {
      try {
        await clearResultsLayer();
        _clearedResultsLayer = true;
      } catch (e) {
        try {
          if (resultsLayerRef.current) {
            if (typeof resultsLayerRef.current.visible !== "undefined") {
              resultsLayerRef.current.visible = false;
            } else if (typeof (resultsLayerRef.current as any).hide === "function") {
              (resultsLayerRef.current as any).hide();
            }
          }
        } catch {}
      }

      try {
        if (view && view.popup) {
          if (typeof view.popup.visible !== "undefined") {
            _popupWasOpen = !!view.popup.visible;
            try {
              view.popup.visible = false;
            } catch {}
          } else if (typeof (view.popup as any).close === "function") {
            _popupWasOpen = true;
            try {
              (view.popup as any).close();
            } catch {}
          } else if (typeof (view.popup as any).hide === "function") {
            _popupWasOpen = true;
            try {
              (view.popup as any).hide();
            } catch {}
          }
        }
      } catch (e) {}

      const result = await view.takeScreenshot({ quality: 0.9 });
      let dataUrl: string | null = null;

      if (!result) {
        console.warn("[geotest] takeScreenshot returned no result for caption");
        setLoading(false);
        return;
      }

      if (typeof result === "string") {
        dataUrl = result;
      } else if (result && typeof result.data === "string") {
        dataUrl = result.data;
      } else if (result && typeof (result as any).dataUrl === "string") {
        dataUrl = (result as any).dataUrl;
      } else if (result instanceof Blob || (result && result.data instanceof Blob)) {
        const blob = result instanceof Blob ? result : result.data;
        dataUrl = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(String(reader.result));
          reader.onerror = (e) => rej(e);
          reader.readAsDataURL(blob as Blob);
        });
      }

      if (!dataUrl) {
        console.warn("[geotest] could not derive dataUrl from screenshot result for caption");
        setLoading(false);
        return;
      }

      try {
        setImage && setImage(dataUrl);
      } catch {}

      try {
        const res = await fetchCaption(dataUrl);
        console.log("[geotest] caption service response:", res);
        if (res && (res.caption || (res as any).input_caption)) {
          const text = (res as any).caption || (res as any).input_caption;
          setCaption(text);
        } else {
          setCaption("No caption returned");
        }
      } catch (e) {
        console.warn("[geotest] caption request failed:", e);
        setCaption("Caption request failed");
      }
    } catch (err) {
      console.error("[geotest] caption flow failed:", err);
    } finally {
      try {
        if (_clearedResultsLayer && results && results.length) {
          try {
            await addMarkersToMap(results);
          } catch {}
        }
      } catch {}

      try {
        if (view && view.popup) {
          if (typeof view.popup.visible !== "undefined") {
            view.popup.visible = _popupWasOpen;
          } else if (_popupWasOpen && typeof (view.popup as any).open === "function") {
            try {
              (view.popup as any).open();
            } catch {}
          }
        }
      } catch (e) {}

      setLoading(false);
    }
  }

  // ----- Search / results helpers -----
  async function clearResultsLayer() {
    const view = viewRef.current;
    if (!view) return;
    try {
      // Robust removal:
      // 1) Remove layers that match our id/title marker ("geotest-results")
      // 2) For all layers, remove any graphics that have attributes.resultId
      // 3) Also clear view.graphics (global graphics) of any resultId-marked graphics
      // 4) Clear refs (resultsLayerRef and overlayGraphicRef)
      try {
        const layersCollection = view.map && view.map.layers;
        const allLayers: any[] = [];

        if (layersCollection) {
          const items = layersCollection.items || layersCollection;
          if (Array.isArray(items)) {
            allLayers.push(...items.slice());
          } else if (typeof layersCollection.forEach === "function") {
            layersCollection.forEach((l: any) => {
              allLayers.push(l);
            });
          } else {
            // fallback if layersCollection itself is a single layer
            allLayers.push(layersCollection);
          }
        }

        // Helper: remove a layer safely
        const safeRemoveLayer = (layer: any) => {
          try {
            if (!layer) return;
            // If the layer has id/title matching our marker, remove the whole layer
            if (layer.id === "geotest-results" || layer.title === "geotest-results") {
              try {
                layersCollection && layersCollection.remove && layersCollection.remove(layer);
              } catch {}
              try {
                view.map && view.map.remove && view.map.remove(layer);
              } catch {}
              try {
                layer.removeAll && layer.removeAll();
              } catch {}
              return;
            }

            // Otherwise, try to remove any graphics inside the layer that were added by our search flow
            const gfxs = layer.graphics && (layer.graphics.items || layer.graphics);
            if (Array.isArray(gfxs) && gfxs.length) {
              // iterate copy to avoid mutation issues
              for (const g of gfxs.slice()) {
                try {
                  const attr = g && g.attributes;
                  if (attr && typeof attr.resultId !== "undefined") {
                    try {
                      layer.remove && layer.remove(g);
                    } catch {}
                    try {
                      layer.graphics && layer.graphics.remove && layer.graphics.remove(g);
                    } catch {}
                    try {
                      g.remove && g.remove();
                    } catch {}
                  }
                } catch {}
              }
            }
          } catch {}
        };

        for (const l of allLayers) {
          safeRemoveLayer(l);
        }
      } catch (e) {
        // ignore errors during best-effort removal
      }

      // Also remove graphics from view.graphics (global graphics collection) that match resultId
      try {
        const viewGraphics = view.graphics && (view.graphics.items || view.graphics);
        if (Array.isArray(viewGraphics) && viewGraphics.length) {
          for (const g of viewGraphics.slice()) {
            try {
              const attr = g && g.attributes;
              if (attr && typeof attr.resultId !== "undefined") {
                try {
                  view.graphics && view.graphics.remove && view.graphics.remove(g);
                } catch {}
                try {
                  g.remove && g.remove();
                } catch {}
              }
            } catch {}
          }
        }
      } catch (e) {
        // ignore
      }

      // Also remove/clear the layer referenced by our ref (if present)
      if (resultsLayerRef.current) {
        try {
          view.map && view.map.remove && view.map.remove(resultsLayerRef.current);
        } catch {}
        try {
          resultsLayerRef.current.removeAll && resultsLayerRef.current.removeAll();
        } catch {}
        resultsLayerRef.current = null;
      }

      // Remove overlay graphic if present
      try {
        if (overlayGraphicRef.current) {
          try {
            // try remove from layer if possible
            if (resultsLayerRef.current && resultsLayerRef.current.remove) {
              try {
                resultsLayerRef.current.remove(overlayGraphicRef.current);
              } catch {}
            }
            // try removing from view.graphics as a fallback
            view.graphics && view.graphics.remove && view.graphics.remove(overlayGraphicRef.current);
          } catch {}
          overlayGraphicRef.current = null;
        }
      } catch (e) {}
    } catch (e) {
      console.warn("[geotest] clearResultsLayer failed", e);
    }
  }

  async function addMarkersToMap(locations: any[]) {
    const view = viewRef.current;
    if (!view || !locations || locations.length === 0) return;

    const [
      GraphicsLayerModule,
      GraphicModule,
      PointModule,
      SimpleMarkerSymbolModule,
    ] = await Promise.all([
      import("@arcgis/core/layers/GraphicsLayer"),
      import("@arcgis/core/Graphic"),
      import("@arcgis/core/geometry/Point"),
      import("@arcgis/core/symbols/SimpleMarkerSymbol"),
    ]);

    const GraphicsLayer = GraphicsLayerModule.default;
    const Graphic = (GraphicModule as any).default || (GraphicModule as any);
    const Point = (PointModule as any).default || (PointModule as any);
    const SimpleMarkerSymbol = (SimpleMarkerSymbolModule as any).default || (SimpleMarkerSymbolModule as any);

    await clearResultsLayer();

    const layer = new GraphicsLayer();
    // mark this layer so it can be found and removed reliably later
    try {
      layer.id = "geotest-results";
      layer.title = "geotest-results";
    } catch {}
    const graphics: any[] = [];

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const latitude = loc.lat;
      const longitude = loc.lng;

      const point = new Point({
        longitude,
        latitude,
      });

      const symbol = new SimpleMarkerSymbol({
        color: [0, 128, 255],
        outline: { color: [255, 255, 255], width: 1 },
        size: 10,
      });

      const graphic = new Graphic({
        geometry: point,
        symbol,
        attributes: {
          resultId: loc.id || i,
          name: loc.name,
          address: loc.address,
          thumbnail: loc.thumbnail || null,
        },
        popupTemplate: {
          title: loc.name || `Result ${i + 1}`,
          content: loc.thumbnail
            ? `<div>${loc.address ? loc.address : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}<br/><img src="${loc.thumbnail}" style="max-width:160px;margin-top:6px;border-radius:6px;"/></div>`
            : loc.address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        },
      });

      graphics.push(graphic);
    }

    layer.addMany && layer.addMany(graphics);
    try {
      view.map && view.map.add && view.map.add(layer);
    } catch {
      try {
        view.map && view.map.layers && view.map.layers.add && view.map.layers.add(layer);
      } catch {}
    }

    resultsLayerRef.current = layer;

    // If something is already selected, re-apply selection visuals
    if (selectedId !== null) {
      try {
        await applySelectionVisual(selectedId);
      } catch {}
    }
  }

  async function applySelectionVisual(resultId: string | number | null) {
    const view = viewRef.current;
    if (!view || !resultsLayerRef.current) return;

    const GraphicModule = await import("@arcgis/core/Graphic");
    const PictureMarkerSymbolModule = await import("@arcgis/core/symbols/PictureMarkerSymbol");

    const Graphic = (GraphicModule as any).default || (GraphicModule as any);
    const PictureMarkerSymbol = (PictureMarkerSymbolModule as any).default || (PictureMarkerSymbolModule as any);

    const layer = resultsLayerRef.current;
    const graphics = layer.graphics ? layer.graphics.items || layer.graphics : [];

    // Clear any existing overlay graphic we added previously
    try {
      if (overlayGraphicRef.current) {
        try {
          layer.remove && layer.remove(overlayGraphicRef.current);
        } catch {}
        overlayGraphicRef.current = null;
      }
    } catch {}

    for (let i = 0; i < graphics.length; i++) {
      const g = graphics[i];
      const attr = g.attributes || {};
      const id = attr.resultId;
      if (id === resultId) {
        // highlight this graphic by changing color/size (yellow)
        try {
          const SimpleMarkerSymbolModule = await import("@arcgis/core/symbols/SimpleMarkerSymbol");
          const SimpleMarkerSymbol = (SimpleMarkerSymbolModule as any).default || (SimpleMarkerSymbolModule as any);
          g.symbol = new SimpleMarkerSymbol({
            style: "circle",
            color: [255, 200, 0],
            size: 14,
            outline: { color: [255, 255, 255], width: 1 },
          });
        } catch (e) {
          // keep existing symbol if we fail to change it
          console.warn("[geotest] failed to set selected marker symbol", e);
        }

        // If this result has a thumbnail, add an overlay picture-marker slightly above the point
        const thumb = attr.thumbnail;
        if (thumb) {
          try {
            const picture = new PictureMarkerSymbol({
              url: thumb,
              width: "200px",
              height: "200px",
              // anchor/offset can be adjusted as needed
              // yoffset to lift the image above the star marker
              yoffset: -110,
            });
            const point = g.geometry;
            const overlayGraphic = new Graphic({
              geometry: point,
              symbol: picture,
              attributes: { overlayFor: id },
            });
            layer.add && layer.add(overlayGraphic);
            overlayGraphicRef.current = overlayGraphic;
          } catch (e) {
            // If picture marker overlay fails (CORS / large image), open popup as fallback
            try {
              view.popup.open({
                location: g.geometry,
                title: attr.name || "Result",
                content: attr.thumbnail ? `<img src="${attr.thumbnail}" style="max-width:320px;border-radius:6px;"/>` : attr.address || "",
              });
            } catch {}
          }
        } else {
          // open popup when no thumbnail overlay available
          try {
            view.popup.open({
              location: g.geometry,
              title: attr.name || "Result",
              content: attr.address || "",
            });
          } catch {}
        }
      } else {
        // reset other graphics to default simple marker
        try {
          // recreate a small blue circle marker
          const SimpleMarkerSymbolModule = await import("@arcgis/core/symbols/SimpleMarkerSymbol");
          const SimpleMarkerSymbol = (SimpleMarkerSymbolModule as any).default || (SimpleMarkerSymbolModule as any);
          g.symbol = new SimpleMarkerSymbol({
            color: [0, 128, 255],
            outline: { color: [255, 255, 255], width: 1 },
            size: 10,
          });
        } catch {}
      }
    }
  }

  async function zoomToResults(locations: any[]) {
    const view = viewRef.current;
    if (!view || !locations || locations.length === 0) return;

    if (locations.length === 1) {
      const first = locations[0];
      try {
        await view.goTo({ center: [first.lng, first.lat], zoom: 15 }, { duration: 900, easing: "ease-in-out" });
      } catch {
        try {
          await view.goTo({ center: [first.lng, first.lat], zoom: 12 }, { duration: 900, easing: "ease-in-out" });
        } catch {}
      }
      return;
    }

    let minLat = Number.POSITIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;

    for (const loc of locations) {
      if (loc.lat < minLat) minLat = loc.lat;
      if (loc.lat > maxLat) maxLat = loc.lat;
      if (loc.lng < minLng) minLng = loc.lng;
      if (loc.lng > maxLng) maxLng = loc.lng;
    }

    if (minLat === maxLat) {
      minLat -= 0.01;
      maxLat += 0.01;
    }
    if (minLng === maxLng) {
      minLng -= 0.01;
      maxLng += 0.01;
    }

      try {
        const ExtentModule = await import("@arcgis/core/geometry/Extent");
        const Extent = (ExtentModule as any).default || ExtentModule;
        const extentGeom = new Extent({
          xmin: minLng,
          ymin: minLat,
          xmax: maxLng,
          ymax: maxLat,
          spatialReference: { wkid: 4326 },
        });
        await view.goTo({ target: extentGeom, padding: 50 }, { duration: 900, easing: "ease-in-out" });
      } catch (e) {
      const first = locations[0];
      try {
        await view.goTo({ center: [first.lng, first.lat], zoom: 12 }, { duration: 900, easing: "ease-in-out" });
      } catch {}
    }
  }

  async function handleSearchSubmit() {
    if (!query || !query.trim()) return;
    const view = viewRef.current;
    setResultsLoading(true);
    try {
      const res = await searchLocations(query.trim(), null);
      const locs = res.locations || [];
      console.log("[geotest] search results:", locs);
      setResults(locs);
      setResultsOpen(true);
      await addMarkersToMap(locs);
      if (locs.length) {
        await zoomToResults(locs);
      } else {
        // clear selection if no results
        setSelectedId(null);
      }
    } catch (e) {
      console.error("[geotest] search failed:", e);
      setResults([]);
      await clearResultsLayer();
      setSelectedId(null);
    } finally {
      setResultsLoading(false);
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Left: search input + button (compact) */}
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 19999, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={query}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearchSubmit();
            }
          }}
          placeholder="Search places (e.g., 'coffee near central park')"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(8,12,24,0.6)",
            color: "#dbe7ff",
            outline: "none",
            minWidth: 280,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
          }}
        />

        <button
          onClick={handleSearchSubmit}
          style={{
            marginLeft: 4,
            background: "#0b2740",
            color: "white",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.06)",
            cursor: "pointer",
          }}
          disabled={resultsLoading || !query.trim()}
        >
          {resultsLoading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Right: capture + caption (moved to top-right) */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 19999, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={handleRequestCaption}
          style={{
            background: "#083041",
            color: "white",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.06)",
            cursor: "pointer",
          }}
          disabled={loading}
        >
          {loading ? "Working..." : "Caption"}
        </button>

        <button
          onClick={handleTakeScreenshot}
          style={{
            background: "#081024",
            color: "white",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.06)",
            cursor: "pointer",
          }}
          disabled={loading}
        >
          {loading ? "Capturing..." : "Capture"}
        </button>
      </div>

      {caption && (
        <div
          style={{
            position: "absolute",
            top: 60,
            right: 12,
            zIndex: 19999,
            background: "rgba(6,10,20,0.96)",
            color: "#dbe7ff",
            padding: 10,
            borderRadius: 10,
            maxWidth: "36vw",
            minWidth: 240,
            maxHeight: "40vh",
            overflowY: "auto",
            border: "1px solid rgba(255,255,255,0.04)",
            boxShadow: "0 10px 26px rgba(3,8,18,0.6)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <button onClick={() => setCaption(null)} style={{ background: "transparent", color: "#dbe7ff", border: "none", cursor: "pointer", fontSize: 16 }}>
              ✕
            </button>
          </div>
          <div style={{ color: "#dbe7ff", lineHeight: 1.45, fontSize: 14, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{caption}</div>
        </div>
      )}

      {/* Only show results panel when there are results */}
      {results.length > 0 && resultsOpen && (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 80,
            width: 360,
            maxWidth: "40vw",
            zIndex: 19999,
            background: "rgba(6,10,20,0.96)",
            color: "#dbe7ff",
            padding: 8,
            borderRadius: 10,
            boxShadow: "0 10px 26px rgba(3,8,18,0.6)",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.04)",
            maxHeight: "56vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ fontWeight: 700, color: "#e6f0ff" }}>Results</div>
            <div style={{ fontSize: 12, color: "rgba(219,231,255,0.7)" }}>{results.length} item{results.length !== 1 ? "s" : ""}</div>
            <button onClick={() => setResultsOpen(false)} style={{ background: "transparent", color: "#dbe7ff", border: "none", cursor: "pointer", fontSize: 16 }}>
              ✕
            </button>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {results.map((r, idx) => (
              <div
                key={r.id || idx}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.02)",
                  cursor: "pointer",
                  transition: "background 120ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                onClick={async () => {
                  try {
                    const view = viewRef.current;
                    if (!view) return;

                    // smooth staged movement: zoom out -> pan -> zoom in (extended animation)
                    const targetZoom = 17;
                    const currentZoom = typeof view.zoom === "number" ? view.zoom : (view?.camera && view.camera.zoom) || targetZoom;

                    try {
                      if (currentZoom >= targetZoom) {
                        // zoom out first to provide a visible transition when already zoomed in
                        const zoomOut = Math.max(6, Math.floor(currentZoom) - 8);
                        await view.goTo({ zoom: zoomOut }, { duration: 1800, easing: "ease-in-out" });
                        // small pause to make staging feel deliberate
                        await new Promise((res) => setTimeout(res, 150));
                      }
                    } catch (e) {
                      console.warn("[geotest] initial zoom-out failed", e);
                    }

                    // pan to target center more noticeably
                    try {
                      await view.goTo({ center: [r.lng, r.lat] }, { duration: 2200, easing: "ease-in-out" });
                      await new Promise((res) => setTimeout(res, 150));
                    } catch (e) {
                      console.warn("[geotest] pan to target failed", e);
                    }

                    // then smoothly zoom back in to target level
                    try {
                      await view.goTo({ zoom: targetZoom }, { duration: 2200, easing: "ease-in-out" });
                    } catch (e) {
                      console.warn("[geotest] final zoom-in failed", e);
                    }

                    // mark selected result and apply visuals (highlight + overlay)
                    const id = r.id || idx;
                    setSelectedId(id);
                    try {
                      // apply selection visual which will attempt to overlay thumbnail if present
                      await applySelectionVisual(id);
                    } catch (e) {
                      console.warn("[geotest] applySelectionVisual failed", e);
                    }

                    // If thumbnail is present but overlay failed, ensure popup shows image as fallback
                    try {
                      // small delay to allow picture marker to render if used
                      await new Promise((res) => setTimeout(res, 120));
                      // open popup if overlay isn't present
                      const layer = resultsLayerRef.current;
                      const graphics = layer ? (layer.graphics ? layer.graphics.items || layer.graphics : []) : [];
                      let found = null;
                      for (let i = 0; i < graphics.length; i++) {
                        const g = graphics[i];
                        if (g.attributes && g.attributes.resultId === id) {
                          found = g;
                          break;
                        }
                      }
                      if (found) {
                        // if overlayGraphicRef is not set, open popup as accessible fallback
                        if (!overlayGraphicRef.current) {
                          view.popup.open({
                            location: found.geometry,
                            title: found.attributes.name || "Result",
                            content: found.attributes.thumbnail ? `<img src="${found.attributes.thumbnail}" style="max-width:320px;border-radius:6px;"/>` : found.attributes.address || "",
                          });
                        }
                      }
                    } catch (e) {}
                  } catch (e) {
                    console.warn("[geotest] result click failed", e);
                  }
                }}
              >
                {/* thumbnail (if available) or numeric badge */}
                {r.thumbnail ? (
                  <div style={{ width: 34, height: 34, borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
                    <img src={r.thumbnail} alt={`thumb-${idx}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </div>
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: "rgba(255,255,255,0.06)", color: "#dbe7ff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                    {idx + 1}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#e6f0ff" }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(219,231,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.address}</div>
                </div>
                {/* show star badge for selected item in list */}
                <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {selectedId === (r.id || idx) ? <img src={STAR_SVG_DATA_URL} style={{ width: 22, height: 22 }} alt="selected" /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
