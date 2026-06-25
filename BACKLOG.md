# NAVADA NeuroAtlas — Backlog

Status of pending / planned work. ✅ done · 🔜 next · 💡 idea

## Deployment & infra
- ✅ **Vercel mirror (backup/failover)** — live at `https://neuroatlas-mu.vercel.app` (project `leeakparevas-projects/neuroatlas`). Static served direct; `/api/chat` + `/api/health` are serverless functions in `api/`. `NVIDIA_API_KEY` set in Vercel env (preview+prod). Cloudflare→ASUS stays PRIMARY; Vercel is the cloud failover (stayed-up alternative when ASUS Docker is down). GOTCHA: `api/chat.js` MUST be a Node.js serverless handler `(req,res)` with `res.json()` + `maxDuration:60` in vercel.json — the edge `(req)=>Response` signature silently hangs to a 60s FUNCTION_INVOCATION_TIMEOUT on the Node runtime, and edge's own ~25s cap is too short for Llama 3.3 70B. `api/health.js` stays edge (instant). Deployment Protection (Vercel auth) is ON — disable in dashboard for fully public access.
- ✅ **Cloudflare deploy** — live at `neuroatlas.navada-edge-server.uk` via the NAVADA tunnel (id `7c9e3c36`), direct ingress to `navada-neuroatlas:8099`.
- ✅ **Containerise** — runs as `navada-neuroatlas` on ASUS Docker (`restart: always`, port 8099).
- 💡 **Service worker** — offline caching for a true installable PWA (requires HTTPS / the Cloudflare domain).
- 💡 Move the NVIDIA key from `.env` to **Azure Key Vault** and inject at container start.

## Backend
- ✅ Threaded server (handles concurrent requests; no more single-request hangs).
- 🔜 **Stream the AI tutor (SSE)** — token-by-token replies instead of waiting for the full response.
- 🔜 **RAG grounding** — embed `regions.json` + the npj BACLoS paper (NVIDIA `nv-embedqa`) so tutor answers are precise and citeable.
- 💡 Rate-limiting + simple auth on `/api/chat` before it's public.
- 💡 Session logging / lightweight analytics (which regions are explored).

## Learning features
- 🔜 **Quiz mode** — hide names, ask the user to identify each part; score + streak.
- 🔜 **"Label all" mode** — show every region's callout at once for revision.
- 💡 **Real EEG/ErrP data** — replay the BNCI Horizon 2020 ErrP dataset (013-2015) in the telemetry; later, live ingest via Lab Streaming Layer + a Muse/OpenBCI headset.
- 💡 Auto-generate / verify region functions from **Neurosynth / NeuroQuery**.
- 💡 More scenarios (caffeine, alcohol, concussion, ageing) + LLM-generated "ask anything" scenarios.

## Visual / model
- 💡 Semi-transparent **head + ear** so the ErrP→mastoid path lands on the real NAVADA_9 wear location.
- 💡 Cross-section / clipping-plane slicing.
- 💡 Deeper segmentation tier (gyrus-level) as an optional "advanced" toggle.

## Polish & QA
- 🔜 Physical **iPhone QA** pass (spacing, bottom-sheet feel, install).
- 💡 Accessibility (keyboard nav, ARIA, reduced-motion).
- 💡 Basic tests for region metadata ↔ GLB node-name parity.
- 💡 Loading progress bar wired to GLTF load percentage.

## Vision — personal health simulator
- 🔜 **Load real user data** — ingest from consumer devices and replay on the 3D model (e.g. Apple Watch ECG/HR over the last week). Heart + lungs data already exists on wearables; brain needs the NAVADA_9 EEG earpiece (research phase). Use as a visual aid for conversations with healthcare professionals. NOT a medical device / not diagnostic.
- 💡 Per-user profiles + data import (Apple Health, pulse oximeter, spirometer); timeline scrubber to replay a day/week on the model.

## Done (recent)
- ✅ **Diseases & conditions (heart pilot)** — new control section on the heart: Heart Attack (akinetic ischemic LV + ST elevation), Viral Myocarditis (inflamed, weak+irregular, low-voltage ECG), Dilated Cardiomyopathy (enlarged heart, feeble beat, wide QRS). Each is a distinct 3D motion + ECG signature, built on the existing scenario/heatmap engine (no external 3D-disease API). DISEASES map in HeartActivity (beatAmp/dilate/akinetic + ECG flags). Live on ASUS Docker + Vercel. Pattern is ready to extend to the other organs.
- ✅ **GutAtlas** — seventh organ: colon-focused large intestine (`gut.html` + `js/gut.js`), duodenum + 4 colon segments (ascending/transverse/descending/sigmoid) + appendix. Peristaltic wave travels down the colon, motility/transit telemetry with a 4-segment transit wave, orange theme. Scenarios incl. after-eating, high-fibre, constipation, diarrhoea, appendicitis. Wearable tie: gut-health apps + microbiome tests. Tutor organ-aware (`gut`). Live on ASUS Docker + Vercel. (Z-Anatomy has no small-intestine/caecum/rectum mesh, so it's colon-focused.)
- ✅ **GlucoAtlas** — sixth organ: 6 metabolic organs (`gluco.html` + `js/gluco.js`), stomach + duodenum + pancreas + liver + gallbladder + spleen, grouped digestive/glucose-control/accessory. No beat cycle — drives blood glucose (mg/dL), insulin, glucagon, GLP-1; the gut churns (peristalsis) and the pancreas pulses with insulin. Continuous-glucose telemetry with in-range band + hormone bars, magenta theme. Scenarios incl. fasting/meal/sugary/exercise/hypo/diabetes. Wearable tie: CGMs. Tutor organ-aware (`gluco`). Live on ASUS Docker + Vercel. (Kidney was skipped — Z-Anatomy only segments it into 3 coarse parts.)
- ✅ **OtoAtlas** — fifth organ: segmented 11-part right ear (`ear.html` + `js/ear.js`), outer ear (helix/antihelix/concha/earlobe) + middle ear (eardrum + malleus/incus/stapes + Eustachian tube) + inner ear (cochlea + vestibule). No beat/breath cycle — drives loudness (dB), pitch and balance; the ossicle chain buzzes with the sound as a travelling wave. Sound-level VU trace + 6-band audiogram telemetry, amber theme. Extracted via `ear-viewer/build_ear_glb.py`; gltfpack needs `-cc -kn` to keep named parts. Tutor organ-aware (`ear`). Live on ASUS Docker + Vercel mirror.
- ✅ **OptosAtlas** — fourth organ: segmented 12-part right eye (`eye.html` + `js/eye.js`), cornea/iris/lens/segments + 6 extraocular muscles + levator. No beat/breath cycle — drives pupil (mm), accommodation and gaze; the eyeball rotates to follow gaze with idle micro-saccades. Pupillometry + muscle-tone telemetry, violet theme. (`.r`/`.l` laterality stripped at GLB export so node names map cleanly.)
- ✅ **RespiroAtlas** — third organ: segmented 7-part lungs (`lungs.html` + `js/lungs.js`), 3 right lobes + 2 left lobes + trachea + diaphragm. Breathing animation, spirogram + lobe-ventilation telemetry, RR/SpO₂/tidal readouts, emerald theme. Extracted via `lung-viewer/build_lungs_glb.py` (single-primitive-per-part fix).
- ✅ **Health-simulator reframe** — About sections on all 3 pages updated; AI tutor renamed **NAVADA AI Doc** (page- + part-aware); header restructured (organ switcher stacked under "NAVADA NeuroAtlas", 🧠/🫀/🫁).
- ✅ **CardioAtlas** — second organ: segmented 17-part heart (`heart.html` + `js/heart.js`), same engine (explode, click-to-label, heatmap, telemetry, AI tutor). Blue/red oxygenation colour-coding, live ECG + chamber-pressure dashboard, beating-heart animation, organ switcher in the topbar. NeuroAtlas is now the multi-organ **NAVADA Atlas** platform (shared modules + `OrganModel.js` so new organs drop in).
- ✅ Segmented 32-part brain from Z-Anatomy, colour-coded, web-optimised GLB.
- ✅ Click-to-select + colour leader-line labels.
- ✅ Explode/assemble, X-ray reveal, axes/grid toggles.
- ✅ Activity heatmap, flash on select, ErrP overlay + animated signal path.
- ✅ Live telemetry (EEG trace, frequency bands, system bars, NAVADA_9 readouts).
- ✅ AI tutor (NVIDIA Llama 3.3 70B), context-aware, key server-side.
- ✅ NAVADA branding, About page, PWA manifest + icons, mobile bottom-sheet UI.
