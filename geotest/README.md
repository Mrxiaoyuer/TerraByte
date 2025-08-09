# geotest — README

This README provides a beginner-friendly walkthrough of the `geotest` demo app contained in this repository. It covers what the codebase does, how to set it up and run it locally, the overall structure, key files and components, common issues and troubleshooting, and notes on how to extend the project.

---

Table of contents
- Project overview
- Capabilities
- Prerequisites
- Quick start (setup & run)
- Project structure and file breakdown
- Key components explained
- Common issues & troubleshooting
- Development tips & extension points
- Testing & deployment notes
- Where to look next

---

Project overview
----------------
`geotest` is a small demo Next.js application that shows a map (satellite basemap) and a single "Capture" flow:
- Display a MapView (ArcGIS) in the browser.
- Allow taking a screenshot of the current MapView (via `view.takeScreenshot()`).
- Convert screenshot to a downloadable file, store it in a simple ImageContext, optionally POST it to a backend upload route, and send it to a captioning helper.

This project is intended as a small wrapper / playground for working with ArcGIS Web SDK in a Next.js app and experimenting with map snapshots, uploads and image caption flows.

Capabilities
------------
- Render ArcGIS MapView (satellite basemap) in a Next.js client component.
- Take a full-view screenshot programmatically and trigger a download.
- Store the screenshot data URL in a React context (ImageContext) for other pages/components to consume.
- POST uploaded screenshots to `/api/upload` (server-side route included).
- Request captions for screenshots via `fetchCaption` (simple helper in `lib/actions.ts`).

Note: Some more advanced features (area cropping, multi-stage screenshot fallbacks and a big in-app debug overlay) were present previously; the current version is intentionally simplified for readability. Those features can be reintroduced if needed.

Prerequisites
-------------
- Node.js (LTS recommended)
- npm (or pnpm / yarn — scripts assume npm)
- Browser that supports required browser APIs for file downloads (most modern browsers)

Quick start (setup & run)
-------------------------
1. Open a terminal in the `demos/geotest` directory:
   - If you're at the repository root, run:
     cd geotest

2. Install dependencies:
   npm install

3. Start the development server:
   npm run dev

4. Open the app:
   http://localhost:3000

Scripts available (from package.json)
- `dev` — run Next.js in development mode
- `build` — build production artifacts
- `start` — start a production server (after `build`)

Project structure (top-level important files and directories)
-------------------------------------------------------------
(This is a short, human-oriented tree — not every file is listed.)

- app/
  - layout.tsx        — Next.js app layout (global wrappers)
  - page.tsx          — main page that renders MapDisplay and other controls
  - globals.css       — global styles for the app
  - api/
    - upload/route.ts — server-side route that receives screenshot uploads
- components/
  - map-display.tsx   — main map component (ArcGIS MapView + Capture button)
  - arcgis-overrides.css — CSS tweaks to style ArcGIS controls / overrides
- contexts/
  - ImageContext.tsx  — React Context that holds the last-captured image dataURL
  - InputCaption.tsx  — simple context/provider used for captions / location input
- lib/
  - actions.ts        — helper functions (e.g., `fetchCaption`) used by the app
  - types.ts          — any shared TypeScript types
- public/
  - uploads/          — server-side uploaded images are stored here (local dev)
- package.json        — dependencies and scripts
- tsconfig.json       — TypeScript configuration
- next.config.mjs     — Next.js configuration (project-specific flags)

Key files & components explained
--------------------------------

components/map-display.tsx
- Client-side React component that dynamically imports the ArcGIS modules at runtime.
- Initializes `Map` and `MapView`, mounts to a container div, and exposes a "Capture" button.
- Capture flow:
  1. Calls `view.takeScreenshot({ quality: 0.9 })`.
  2. Normalizes the screenshot result into a base64 data URL (handles strings, `.data`, `.dataUrl`, or Blob shapes).
  3. Stores the data URL in `ImageContext` for other consumers.
  4. Optionally POSTs the screenshot to `/api/upload`.
  5. Calls `fetchCaption(dataUrl)` which attempts to obtain a caption from backend code (see `lib/actions.ts`).
  6. Triggers a download using a Blob and object URL fallback.

contexts/ImageContext.tsx
- Simple React Context to store the last-captured image's data URL and provide a setter to other components.

app/api/upload/route.ts
- API route that receives a JSON POST with `{ dataUrl, filename }` and writes the uploaded file to `public/uploads/` (local dev). Useful to test upload flow and getting a URL back to the saved file.

lib/actions.ts
- Small helpers such as `fetchCaption(dataUrl)` which proxies screenshot images to a captioning service endpoint (or a mock). See the file for details.

Notable things, warnings & troubleshooting
------------------------------------------

1) ArcGIS SDK CSS import TypeScript error
- You may encounter a TypeScript error like:
  > Cannot find module '@arcgis/core/assets/esri/themes/light/main.css' or its corresponding type declarations.

  This happens when TypeScript/Next is asked to import raw CSS from a node module without a CSS module declaration. Options to fix:
  - Add a global `declarations.d.ts` or `global.d.ts` in `geotest` with:
    declare module '*.css';
    Then restart your TypeScript server and rebuild.
  - Alternatively, avoid importing ArcGIS CSS from JS; instead import or copy the needed ArcGIS CSS into your app's global CSS (e.g., add `@import` to `app/globals.css` or include the files via `public/`).
  - In the simplified `map-display.tsx` we intentionally did not import the ArcGIS theme CSS via JS to avoid the TS error; however ArcGIS controls will look best if their CSS is included. You can add ArcGIS CSS to the global stylesheet or add a `.d.ts` declaration.

2) ArcGIS library size & bundling
- `@arcgis/core` is a relatively large library. To avoid bundling it on the server, the component dynamically imports ArcGIS modules (`import("@arcgis/core/Map")`) and the component is a client component ("use client") so the heavy code runs in the browser.

3) Screenshot reliability
- `view.takeScreenshot()` works in most cases but may fail in some browsers or for very large view sizes. Previous versions of this component included multi-stage fallbacks (pixel ratio reduction and manual canvas compositing). Those were removed to simplify the code. If you need robust cross-browser behavior, consider adding a small fallback strategy:
  - Retry with reduced pixel ratio on failure.
  - Composite canvases found under the map container into one image as a last resort (watch for CORS-security/tainted canvases).

4) Where uploaded images are stored (dev)
- The `app/api/upload/route.ts` present in this demo writes uploads into `public/uploads/`. This is fine for local testing, but not for production use. Replace with a cloud storage service (S3, etc.) for production.

5) TypeScript, CSS imports, and Next.js
- If you import third-party CSS directly from node_modules, you might need to configure Next.js appropriately or add CSS declarations.
- If you run into type errors related to CSS imports, add a declaration file as described above.

Development tips & extension points
----------------------------------
- Reintroducing cropped area captures:
  - When you want to allow the user to draw a rectangle/polygon and only capture that area, add the Sketch widget from `@arcgis/core/widgets/Sketch`, capture the drawn geometry, then:
    - Either pass the extent to `view.takeScreenshot({ area: extent })` (supported in many ArcGIS versions).
    - Or take a full screenshot and then map map screen coordinates -> image pixels and crop the canvas (be careful to calculate pixel scaling when screenshot dimensions differ from viewport).
- Splitting complexity:
  - If you want advanced capture logic and fallbacks, implement the capture logic in a separate helper (e.g., `lib/capture.ts`) and keep `map-display.tsx` focused on UI & wiring.
- Debugging:
  - Use the browser console heavily. The simplified version logs key events to console. If you prefer UI-visible logs (temporary debug overlay), implement a small toggleable overlay component.
- Production readiness:
  - Replace the demo upload with a real storage solution.
  - Add input sanitization and size checks for uploads.
  - Consider rate-limiting or authentication for upload/caption endpoints in production.

Testing & deployment notes
--------------------------
- This demo is a Next.js (App Router) application. Build it with:
  npm run build
  npm start
- For development:
  npm run dev
- For deployment to Vercel (or other providers), ensure `@arcgis/core` is installed and that dynamic imports are allowed (ArcGIS runs in the browser so dynamic import is preferred). Also ensure that you handle storing uploaded files in a managed store rather than local `public/uploads`.

Where to look next (quick roadmap for contributors)
--------------------------------------------------
- `components/map-display.tsx` — primary area to change map behavior and capture logic.
- `contexts/ImageContext.tsx` — expand to store more metadata (filename, timestamp, caption).
- `app/api/upload/route.ts` — replace with production storage adapter.
- `lib/actions.ts` — wire to a real captioning service or model.

Contact & contributing
----------------------
This repo is a demo / learning sandbox. If you want to add features:
- Keep changes modular (helpers under `lib/`, UI components under `components/`).
- Avoid large single-file components; extract helpers for capture/cropping/uploading.
- Add documentation in this README describing any non-obvious behavior.

---