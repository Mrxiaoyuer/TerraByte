# geotest — README

This README provides a beginner-friendly walkthrough of the `geotest` demo app contained in this repository. It covers what the codebase does, how to set it up and run it locally, the overall structure, key files and components, common issues and troubleshooting, and notes on how to extend the project.

---

Table of contents
- Project overview
- Notable new changes (recent)
- Capabilities
- Prerequisites
- Quick start (setup & run)
- Microservices & Azure config
- Project structure and file breakdown
- Key components explained
- Common issues & troubleshooting
- Git / .gitignore notes
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

Notable new changes (recent)
----------------------------
- Smoother result navigation:
  - Clicking a search result now performs a staged, deliberate transition: zoom out → pan to target → zoom in. The movement uses longer durations and short pauses between stages to make navigation feel smoother when you're already zoomed-in (e.g., level 18).
  - Transition durations are implemented in the client map component (components/map-display.tsx) and are configurable if you want different pacing.
- Azure client credential handling (microservices):
  - The microservices' Azure/OpenAI helper (geotest/microservices/common/azure_client.py) no longer contains a hard-coded subscription key.
  - Credentials are read from a user config file at `~/.azure/gpt-4o-mini.config` (JSON) by default. The SDK will also fall back to environment variables if the config file is missing or incomplete.
  - A placeholder config file was created for local development at `~/.azure/gpt-4o-mini.config`. Replace the placeholders with your real endpoint and key, and secure the file (chmod 600).
- Microservices import guidance:
  - The memory bank and microservices docs now explain a previously reported ModuleNotFoundError (No module named 'common') and provide three resolution options:
    - Add `__init__.py` files and use package-relative imports,
    - Convert imports to relative imports (inside microservices),
    - Or set `PYTHONPATH` when running uvicorn in dev to include `geotest/microservices`.
- Memory bank: documentation files have been added/updated to capture project brief, product context, activeContext, systemPatterns, techContext, and progress.

Capabilities
------------
- Render ArcGIS MapView (satellite basemap) in a Next.js client component.
- Take a full-view screenshot programmatically and trigger a download.
- Store the screenshot data URL in a React context (ImageContext) for other pages/components to consume.
- POST uploaded screenshots to `/api/upload` (server-side route included).
- Request captions for screenshots via `fetchCaption` (helper in `lib/actions.ts`).
- Smooth staged navigation to selected results (see Notable changes).

Prerequisites
-------------
- Node.js (LTS recommended)
- npm
- Python 3.10+ (for microservices, optional if you only run frontend)
- Browser that supports required browser APIs for file downloads (most modern browsers)

Quick start (setup & run)
-------------------------
1. Frontend
   - From repo root:
     cd geotest
     npm install
     npm run dev
   - Open the app:
     http://localhost:3000

2. Microservices (optional — captioning & query processing)
   - From repo root:
     cd geotest/microservices
     python -m venv .venv
     source .venv/bin/activate
     pip install -r requirements.txt
   - Start caption service:
     cd caption_service
     export PYTHONPATH="$PWD/.."  # optional if you have package import issues
     uvicorn main:app --reload --port 8001

Developer scripts (convenience)
- start_docker_compose.sh (repo root)
  - Purpose: builds and starts the full docker-compose stack (web, caption_service, process_query, caddy).
  - Usage:
      chmod +x start_docker_compose.sh
      ./start_docker_compose.sh
  - Notes:
    - The script auto-detects whether your system uses `docker compose` or `docker-compose`.
    - It will prompt to use sudo if your user cannot access the Docker socket.
    - Recent compose logs are saved to docker_logs.txt in the repo root for quick diagnostics.

- geotest/start_microservices.sh
  - Purpose: convenience script to run both microservices locally (uvicorn) for development without docker.
  - Usage:
      cd geotest
      chmod +x start_microservices.sh
      ./start_microservices.sh
  - Notes:
    - The script runs uvicorn for caption_service and process_query and writes logs to geotest/microservices/*.log.
    - If you see ModuleNotFoundError for `common`, either set PYTHONPATH to include geotest/microservices (example below) or request the package-layout refactor recorded in the memory bank.

Quick tip — PYTHONPATH workaround for local microservices
- If you get import errors when running microservices with uvicorn, set PYTHONPATH before starting:
    cd geotest/microservices
    export PYTHONPATH="$PWD:$PYTHONPATH"
    # then start the caption service
    cd caption_service
    uvicorn main:app --reload --port 8001

Scripts available (from package.json)
- `dev` — run Next.js in development mode
- `build` — build production artifacts
- `start` — start a production server (after `build`)

Microservices & Azure config
----------------------------
- New behavior: credentials are loaded from a per-user config at:
  ~/.azure/gpt-4o-mini.config

  Expected JSON shape:
  {
    "endpoint": "https://your-endpoint.openai.azure.com/",
    "password": "your-subscription-key",
    "deployment": "gpt-4o-mini"
  }

- The microservice helper will:
  - Read the config file first (if present),
  - Support common key names (endpoint/url, password/api_key/key, deployment),
  - Fall back to ENDPOINT_URL and AZURE_OPENAI_API_KEY environment variables if the config file is absent or missing keys.
- Security: keep this file private and DO NOT commit it. Recommended:
  chmod 600 ~/.azure/gpt-4o-mini.config

Project structure (top-level important files and directories)
-------------------------------------------------------------
- app/
  - layout.tsx        — Next.js app layout (global wrappers)
  - page.tsx          — main page that renders MapDisplay and other controls
  - globals.css       — global styles for the app
  - api/
    - upload/route.ts — server-side route that receives screenshot uploads
- components/
  - map-display.tsx   — main map component (ArcGIS MapView + Capture button). Includes new staged navigation and smoother transitions.
  - arcgis-overrides.css — CSS tweaks to style ArcGIS controls / overrides
- contexts/
  - ImageContext.tsx  — React Context that holds the last-captured image dataURL
  - InputCaption.tsx  — simple context/provider used for captions / location input
- lib/
  - actions.ts        — helper functions (e.g., `fetchCaption`) used by the app
  - types.ts          — any shared TypeScript types
- microservices/
  - caption_service/ — FastAPI captioning microservice
  - process_query/ — FastAPI search/query service
  - common/azure_client.py — helper that builds Azure OpenAI client (now reads user config)
- public/
  - uploads/          — server-side uploaded images are stored here (local dev)
- package.json
- tsconfig.json
- next.config.mjs

Key files & components explained
--------------------------------

components/map-display.tsx
- Client-side React component that dynamically imports ArcGIS modules at runtime.
- Initializes `Map` and `MapView`, mounts to a container div, and exposes a "Capture" flow and Search panel.
- New selection navigation:
  - When you click a search result, the component performs a staged animation: zoom out (longer), pan to the target center (longer), then zoom back in (longer). This creates a smoother perceived transition when the map is already zoomed in.
  - Selection visuals: selected marker's symbol changes to a highlighted marker, and if a thumbnail exists a PictureMarkerSymbol overlay is attempted (popup as fallback for CORS/large images).
- Capture flow unchanged:
  1. Calls `view.takeScreenshot({ quality: 0.9 })`.
  2. Normalizes the screenshot result into a base64 data URL (handles strings, `.data`, `.dataUrl`, or Blob shapes).
  3. Stores the data URL in `ImageContext` for other consumers.
  4. POSTs the screenshot to `/api/upload` (dev-only).
  5. Triggers `fetchCaption(dataUrl)` to request captioning (microservice or mock).

microservices/common/azure_client.py
- Builds an AzureOpenAI client by reading credentials from the user config file (`~/.azure/gpt-4o-mini.config`) or environment variables.
- This file no longer contains hard-coded secrets.

Common issues & troubleshooting
--------------------------------
1) ArcGIS SDK CSS import TypeScript error
- You may encounter a TypeScript error like:
  > Cannot find module '@arcgis/core/assets/esri/themes/light/main.css' or its corresponding type declarations.
- Fixes:
  - Add a global `declarations.d.ts` or `global.d.ts` in `geotest` with:
    declare module '*.css';
  - Or import/copy ArcGIS CSS into `app/globals.css`.

2) Microservice import path issues (ModuleNotFoundError)
- Fix options:
  - Add `__init__.py` files to make microservices a package and use package-relative imports, OR
  - Use relative imports inside microservices (e.g., `from .common.azure_client import ...`), OR
  - Set PYTHONPATH to include `geotest/microservices` when running uvicorn (example in Quick start).

3) Image overlay fails: likely CORS or large image; use popup fallback or serve images with proper CORS headers or as data URLs.

4) Credentials: update `~/.azure/gpt-4o-mini.config` with your real endpoint and key; restart microservices after editing.

Git / .gitignore notes
----------------------
- The repository `.gitignore` already excludes:
  - node_modules/, .next/, build artifacts, logs
  - local env files (.env*), dev uploads (public/uploads and geotest/public/uploads), and Python virtualenvs (venv/.venv/).
  - memory-bank/ is ignored (so local in-memory documentation is not committed).
- Specific reminders for the changes made:
  - The Azure config file lives in the user's home directory (`~/.azure/gpt-4o-mini.config`) and thus is outside the repository — it will not be committed. Keep it private.
  - If you create any local run scripts or temp files (e.g., `.env`, `.venv` inside microservices), the current `.gitignore` already excludes common virtualenv and env patterns. If you use a different directory name for venv, add it to `.gitignore`.
  - If you accidentally committed secrets, remove them from the index with:
    git rm -r --cached path/to/secret
    then commit and push.
- Suggestion: if you want to be extra safe, add an explicit ignore for local user configs inside the repo root (if you ever create a copy) by adding:
  /.azure/
  to .gitignore or maintain that in your global gitignore (`~/.gitignore_global`).

Development tips & extension points
----------------------------------
- Reintroduce cropped area captures by using Sketch widget or by cropping the screenshot canvas.
- Extract the screenshot normalization and fallback logic into a helper (lib/capture.ts) for reuse and testing.
- Add a small run script that sets PYTHONPATH and launches microservices in the proper order for local dev.
- Consider persisting capture metadata (filename, timestamp, location, caption) to a small DB for review.

Testing & deployment notes
--------------------------
- This demo is a Next.js (App Router) application. Build it with:
  npm run build
  npm start
- For microservices, ensure credentials are provided securely (either via the home config file or environment variables) before starting.
- For production:
  - Replace local `public/uploads` with cloud storage (S3) and secure captioning endpoints behind authentication and rate limits.

Where to look next (quick roadmap for contributors)
--------------------------------------------------
- `components/map-display.tsx` — primary area to change map behavior and capture logic (staged navigation implemented here).
- `microservices/common/azure_client.py` — updated to read user config; replace with vault / secret manager for production.
- `microservices/` — run and test caption and process_query microservices locally.
- `lib/actions.ts` — inspect `fetchCaption` to change captioning backend logic.

Contact & contributing
----------------------
This repo is a demo / learning sandbox. If you want to add features:
- Keep changes modular (helpers under `lib/`, UI components under `components/`).
- Avoid large single-file components; extract helpers for capture/cropping/uploading.
- Add documentation in this README describing any non-obvious behavior (e.g., staging timings, config locations).

---
