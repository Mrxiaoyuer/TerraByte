"use client";

import { useEffect, useRef, useState, useContext } from "react";
import { ImageContext } from "@/contexts/ImageContext";
import { LocationsContext } from "@/contexts/InputCaption";
import { fetchCaption, searchLocations } from "@/lib/actions";
import "./arcgis-overrides.css";

/**
 * Simplified ArcGIS MapDisplay
 *
 * - Keeps core behavior: display a satellite basemap, allow capturing the current MapView,
 *   upload the captured image, and request an optional caption.
 * - Removed complex fallback branches, large debug overlay, sketch-based cropping, and
 *   multi-stage screenshot logic to make the file easier to read and maintain.
 *
 * Notes:
 * - The component dynamically imports @arcgis/core Map + MapView at runtime.
 * - This version intentionally avoids importing ArcGIS CSS via JS to reduce TypeScript/module errors.
 * - Capture is full-view only (no area cropping).
 */

export default function MapDisplay() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const resultsLayerRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [caption, setCaption] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(true);

  const imageContext = useContext(ImageContext);
  if (!imageContext) throw new Error("MapDisplay must be used within an ImageContext Provider");
  const { setImage } = imageContext;

  const locationsContext = useContext(LocationsContext);
  if (!locationsContext) throw new Error("MapDisplay must be used within a LocationsContext Provider");
  const { locations } = locationsContext;

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
        // Keep initialization simple: log to console so developers can inspect in browser.
        // Avoid storing large debug state in the component to keep the file minimal.
        // eslint-disable-next-line no-console
        console.error("[geotest] MapView init failed:", err);
      }
    };

    init();

    return () => {
      try {
        // destroy the locally-scoped view if it was created
        if (view) {
          try {
            view.destroy();
          } catch {}
          view = null;
        }

        // destroy any view stored on the ref and clear it
        if (viewRef.current) {
          try {
            viewRef.current.destroy();
          } catch {}
          viewRef.current = null;
        }

        // clear container DOM to remove any leftover ArcGIS nodes
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
        // Ensure any existing results layer is removed before taking a screenshot.
        // Use the clearResultsLayer helper which is more robust across SDK versions.
        try {
          await clearResultsLayer();
          _clearedResultsLayer = true;
        } catch (e) {
          // fallback: try to hide the layer if removal failed
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

        // Close the popup if open so it won't appear in screenshots
        try {
          if (view && view.popup) {
            if (typeof view.popup.visible !== "undefined") {
              _popupWasOpen = !!view.popup.visible;
              try {
                view.popup.visible = false;
              } catch {}
            } else if (typeof (view.popup as any).close === "function") {
              // close() returns a promise in some SDK versions
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
        } catch (e) {
          // ignore popup toggling errors
        }

        // Single, simple takeScreenshot call. Rely on ArcGIS API to return a usable image.
        const result = await view.takeScreenshot({ quality: 0.9 });
      let dataUrl: string | null = null;

      if (!result) {
        // eslint-disable-next-line no-console
        console.warn("[geotest] takeScreenshot returned no result");
        setLoading(false);
        return;
      }

      // result may be an object with .data (string) or other shapes; handle common ones simply
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
        // eslint-disable-next-line no-console
        console.warn("[geotest] could not derive dataUrl from screenshot result");
        setLoading(false);
        return;
      }

      // store in context for consumers
      try {
        setImage && setImage(dataUrl);
      } catch {}

      // upload to server (if API present)
      try {
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, filename: `geotest-${Date.now()}.png` }),
        });
        const json = await uploadRes.json().catch(() => null);
        // eslint-disable-next-line no-console
        console.log("[geotest] upload response:", json);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[geotest] upload failed:", e);
      }

      // optional: request caption from backend
      try {
        const res = await fetchCaption(dataUrl);
        if (res && (res.caption || (res as any).input_caption)) {
          setCaption((res as any).caption || (res as any).input_caption);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[geotest] caption request failed:", e);
      }

      // trigger download (simple object URL approach)
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
        // eslint-disable-next-line no-console
        console.warn("[geotest] download failed:", e);
      }
      } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[geotest] screenshot failed:", err);
    } finally {
      // re-add results layer to the map if we removed it (best-effort)
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
      } catch (e) {
        // ignore
      }

      // restore results layer visibility if we changed it
      try {
        if (resultsLayerRef.current) {
          if (typeof resultsLayerRef.current.visible !== "undefined") {
            resultsLayerRef.current.visible = _resultsLayerPreviouslyVisible;
          } else if (typeof (resultsLayerRef.current as any).show === "function") {
            (resultsLayerRef.current as any).show();
          }
        }
      } catch (e) {
        // ignore
      }

      // restore popup visibility/state if we changed it
      try {
        if (view && view.popup) {
          if (typeof view.popup.visible !== "undefined") {
            view.popup.visible = _popupWasOpen;
          } else if (_popupWasOpen && typeof (view.popup as any).open === "function") {
            try {
              // best-effort: attempt to reopen popup (may be no-op if no location)
              (view.popup as any).open();
            } catch {}
          }
        }
      } catch (e) {
        // ignore
      }

      setLoading(false);
    }
  }

    async function handleRequestCaption() {
      const view = viewRef.current;
      if (!view) {
        // eslint-disable-next-line no-console
        console.warn("[geotest] view not ready for caption");
        return;
      }

      setLoading(true);
      let _popupWasOpen = false;
      let _clearedResultsLayer = false;
      try {
        // Ensure results/markers are not visible in the screenshot sent to caption service.
        try {
          await clearResultsLayer();
          _clearedResultsLayer = true;
        } catch (e) {
          // fallback: try to hide the layer if removal failed
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

        // Close/hide popup if open so it won't appear in the screenshot sent to caption service
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
        } catch (e) {
          // ignore popup toggling errors
        }

        // Take screenshot (with markers/popups hidden)
        const result = await view.takeScreenshot({ quality: 0.9 });
        let dataUrl: string | null = null;

        if (!result) {
          // eslint-disable-next-line no-console
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
          // eslint-disable-next-line no-console
          console.warn("[geotest] could not derive dataUrl from screenshot result for caption");
          setLoading(false);
          return;
        }

        // store in context for consumers (keep behavior consistent with Capture)
        try {
          setImage && setImage(dataUrl);
        } catch {}

        // request caption from backend
        try {
          const res = await fetchCaption(dataUrl);
          // eslint-disable-next-line no-console
          console.log("[geotest] caption service response:", res);
          if (res && (res.caption || (res as any).input_caption)) {
            const text = (res as any).caption || (res as any).input_caption;
            setCaption(text);
          } else {
            setCaption("No caption returned");
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[geotest] caption request failed:", e);
          setCaption("Caption request failed");
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[geotest] caption flow failed:", err);
      } finally {
        // If we cleared the results layer earlier, re-add markers (best-effort) so UI preserves state
        try {
          if (_clearedResultsLayer && results && results.length) {
            try {
              await addMarkersToMap(results);
            } catch {}
          }
        } catch {}

        // restore popup visibility/state if we changed it
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
        } catch (e) {
          // ignore
        }

        setLoading(false);
      }
    }

    // ----- Search / results helpers -----
    async function clearResultsLayer() {
      const view = viewRef.current;
      if (!view) return;
      try {
        if (resultsLayerRef.current) {
          try {
            // remove from map
            view.map && view.map.remove && view.map.remove(resultsLayerRef.current);
          } catch {}
          try {
            resultsLayerRef.current.removeAll && resultsLayerRef.current.removeAll();
          } catch {}
          resultsLayerRef.current = null;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[geotest] clearResultsLayer failed", e);
      }
    }

    async function addMarkersToMap(locations: any[]) {
      const view = viewRef.current;
      if (!view || !locations || locations.length === 0) return;

      // dynamic import ArcGIS modules required for markers
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
            id: loc.id,
            name: loc.name,
            address: loc.address,
          },
          popupTemplate: {
            title: loc.name || `Result ${i + 1}`,
            content: loc.address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
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
    }

    async function zoomToResults(locations: any[]) {
      const view = viewRef.current;
      if (!view || !locations || locations.length === 0) return;

      // If there's only one location, center on it with a reasonable zoom level.
      if (locations.length === 1) {
        const first = locations[0];
        try {
          await view.goTo({ center: [first.lng, first.lat], zoom: 15 });
        } catch {
          try {
            await view.goTo({ center: [first.lng, first.lat], zoom: 12 });
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

      // small padding if only one point in a dimension
      if (minLat === maxLat) {
        minLat -= 0.01;
        maxLat += 0.01;
      }
      if (minLng === maxLng) {
        minLng -= 0.01;
        maxLng += 0.01;
      }

      // Build an ArcGIS Extent object and ask the view to goTo it with padding.
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
        // view.goTo accepts an object with target + padding for a nicer framing
        await view.goTo({ target: extentGeom, padding: 50 });
      } catch (e) {
        // fallback: center on first result if Extent or goTo with extent fails
        const first = locations[0];
        try {
          await view.goTo({ center: [first.lng, first.lat], zoom: 12 });
        } catch {}
      }
    }

    async function handleSearchSubmit() {
      if (!query || !query.trim()) return;
      const view = viewRef.current;
      setResultsLoading(true);
      try {
        // use searchLocations helper from lib/actions
        const res = await searchLocations(query.trim(), null);
        const locs = res.locations || [];
        console.log("[geotest] search results:", locs);
        setResults(locs);
        setResultsOpen(true);
        await addMarkersToMap(locs);
        if (locs.length) {
          await zoomToResults(locs);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[geotest] search failed:", e);
        setResults([]);
        await clearResultsLayer();
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

      {resultsOpen && (
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
            {results.length === 0 ? (
              <div style={{ padding: 12, color: "rgba(219,231,255,0.6)" }}>No results</div>
            ) : (
              results.map((r, idx) => (
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
                      if (view) {
                        await view.goTo({ center: [r.lng, r.lat], zoom: 15 });
                        try {
                          view.popup.open({
                            location: { longitude: r.lng, latitude: r.lat },
                            title: r.name,
                            content: r.address || `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
                          });
                        } catch {}
                      }
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.warn("[geotest] result click failed", e);
                    }
                  }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: "rgba(255,255,255,0.06)", color: "#dbe7ff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#e6f0ff" }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "rgba(219,231,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.address}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
