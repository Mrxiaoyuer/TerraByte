# geotest — README

This README provides a beginner-friendly walkthrough of the `geotest` demo app contained in this repository. It covers what the codebase does, how to set it up and run it locally, the overall structure, key files and components, common issues and troubleshooting, and notes on how to extend the project.

---

Table of contents
- Project overview
- Recent changes (developer notes)
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

Recent changes (developer notes)
-------------------------------
These notes reflect recent development work and updates to the demo (important if you pull the repository or continue development).

- Clean-screenshot / caption behavior
  - The capture and caption flows now temporarily remove or hide the transient results GraphicsLayer and close any open popup before calling `view.takeScreenshot()`. This makes screenshots and caption images free of UI overlays (no blue result markers or open popups).
  - UI state is restored after the screenshot (best-effort restore).

- Adaptive auto-zoom
  - `zoomToResults` behavior was added so search results are framed automatically:
    - Single result: center + sensible zoom.
    - Multiple results: compute a bounding extent and call `view.goTo({ target: extent, padding })` to frame all locations.

- TypeScript dev types
  - Added `@types/react-dom` as a dev dependency to resolve TypeScript/Next import type errors. If you run into TS errors related to CSS imports from third-party packages, see the troubleshooting section below.

- Memory bank & documentation
  - The project's memory-bank (internal documentation files under memory-bank/) was updated to reflect the recent changes (projectbrief, activeContext, techContext, systemPatterns, progress, productContext).

- .gitignore & accidental add fix
  - `.gitignore` was updated to include Python virtualenvs, caches, editor temp files, and other common unnecessary artifacts.
  - If you accidentally ran `git add .` and staged unwanted files (venvs, caches, etc.), run:
    - git restore --staged .
    - Then commit the desired changes.
  - If files were already committed and you need to remove them from the repo while keeping them locally:
    - git rm -r --cached path/to/file-or-folder
    - git commit -m "Remove sensitive/unnecessary files from repo and update .gitignore"

Capabilities
------------
- Render ArcGIS MapView (satellite basemap) in a Next.js client component.
- Take a full-view screenshot programmatically and trigger a download.
- Store the screenshot data URL in a React context (ImageContext) for other pages/components to consume.
- POST uploaded screenshots to `/api/upload` (server-side route included).
- Request captions for screenshots via `fetchCaption` (simple helper in `lib/actions.ts`).

Prerequisites
-------------
- Node.js (LTS recommended)
- npm (or pnpm / yarn — scripts assume npm)
- Browser that supports required browser APIs for file downloads (most modern browsers)

Quick start (setup & run)
-------------------------
1. From repository root open terminal and change into the demo:
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
- memory-bank/        — project documentation & session memory files (developer-only)
- package.json        — dependencies and scripts
- tsconfig.json       — TypeScript configuration
- next.config.mjs     — Next.js configuration

Key files & components explained
--------------------------------

components/map-display.tsx
- Client-side React component that dynamically imports the ArcGIS modules at runtime.
- Initializes `Map` and `MapView`, mounts to a container div, and exposes a "Capture" button.
- Capture flow:
  1. Temporarily removes/hides result GraphicsLayer and closes popups.
  2. Calls `view.takeScreenshot({ quality: 0.9 })`.
  3. Normalizes the screenshot result into a base64 data URL (handles strings, `.data`, `.dataUrl`, or Blob shapes).
  4. Stores the data URL in `ImageContext` for other consumers.
  5. Optionally POSTs the screenshot to `/api/upload`.
  6. Calls `fetchCaption(dataUrl)` which attempts to obtain a caption from backend code (see `lib/actions.ts`).
  7. Triggers a download using a Blob and object URL fallback.

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

  Options:
  - Add a global `declarations.d.ts` or `global.d.ts` with:
    declare module '*.css';
    Then restart your TypeScript server and rebuild.
  - Alternatively, import or copy the needed ArcGIS CSS into `app/globals.css`.
  - In this demo the component avoids importing ArcGIS theme CSS via TS files to reduce friction.

2) Screenshot reliability
- `view.takeScreenshot()` works in most cases but may fail in some browsers or for very large view sizes.
- For robustness, consider:
  - Retry with reduced pixel ratio on failure.
  - Composite canvases found under the map container into one image as a last resort (watch for CORS/security regarding tainted canvases).

3) Where uploaded images are stored (dev)
- The `app/api/upload/route.ts` writes uploads into `public/uploads/`. This is fine for local testing, but not for production use. Replace with a cloud storage service for production.

4) Git / accidental add notes
- `.gitignore` was updated to include common venv and tooling files. If you staged unwanted files, unstage them with:
  git restore --staged .
- To remove already committed files from the repository index while keeping local copies:
  git rm -r --cached path/to/file-or-folder
  git commit -m "Remove sensitive/unnecessary files from repo and update .gitignore"

Development tips & extension points
----------------------------------
- Reintroducing cropped area captures:
  - When you want to allow the user to draw a rectangle/polygon and only capture that area, add the Sketch widget from `@arcgis/core/widgets/Sketch`, capture the drawn geometry, then:
    - Either pass the extent to `view.takeScreenshot({ area: extent })` (supported in many ArcGIS versions).
    - Or take a full screenshot and then map screen coordinates -> image pixels and crop the canvas (be careful to calculate pixel scaling when screenshot dimensions differ from viewport).
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
