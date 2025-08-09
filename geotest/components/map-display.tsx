"use client";

import { useEffect, useRef, useState, useContext } from "react";
import { ImageContext } from "@/contexts/ImageContext";
import { LocationsContext } from "@/contexts/InputCaption";
import { fetchCaption } from "@/lib/actions";
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
  const [loading, setLoading] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

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

        const map = new Map({
          basemap: "satellite",
        });

        view = new MapView({
          container: containerRef.current!,
          map,
          center: [-74.006, 40.7128],
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
        if (view) view.destroy();
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
    try {
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
      setLoading(false);
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 19999 }}>
        <button
          onClick={handleTakeScreenshot}
          style={{
            background: "#081024",
            color: "white",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #223046",
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
            background: "rgba(8,12,24,0.95)",
            color: "#dbe7ff",
            padding: 12,
            borderRadius: 10,
            maxWidth: 360,
            border: "1px solid #333c4d",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setCaption(null)} style={{ background: "transparent", color: "#fff", border: "none", cursor: "pointer" }}>
              ✕
            </button>
          </div>
          <p>{caption}</p>
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
