/**
 * GuidedTour — a narrated auto-play tour of an organ, spoken in Grok's voice.
 *
 * Adds a "Guided tour" button to the controls panel. When started it flies the
 * camera part-to-part, selecting each (highlight + info card + leader line) and
 * speaking its name + description via the server's /api/tts endpoint (xAI Grok
 * TTS, key stays server-side). A floating Stop pill ends it early.
 *
 * Self-initializing; finds the running organ app via its window handle. Three.js
 * organ pages only (needs scene meshes + camera).
 */

import * as THREE from 'three';

let touring = false, stopFlag = false, curAudio = null, narrResolve = null;

function findApp() {
    for (const k of Object.keys(window)) {
        if (!k.startsWith('navada')) continue;
        const a = window[k];
        if (a && Array.isArray(a.meshes) && a.camera && typeof a.select === 'function' && a.regions) return a;
    }
    return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boxOf(app, ids) {
    const box = new THREE.Box3();
    const set = ids ? new Set(ids) : null;
    for (const m of app.meshes) {
        if (set && !set.has(m.userData && m.userData.regionId)) continue;
        m.updateWorldMatrix(true, false); box.expandByObject(m);
    }
    return box;
}

function frame(app, ids, pad = 1.9) {
    const box = ids ? boxOf(app, ids) : boxOf(app, null);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const cam = app.camera.camera, ctrls = app.camera.controls;
    const fov = (cam.fov * Math.PI) / 180;
    let dist = (size * 0.5) / Math.tan(fov / 2) * pad + size * 0.2;
    dist = Math.max(ctrls.minDistance * 1.05, Math.min(ctrls.maxDistance * 0.95, dist));
    const dir = new THREE.Vector3().subVectors(cam.position, ctrls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.2, 1);
    dir.normalize();
    const endPos = center.clone().add(dir.multiplyScalar(dist));
    const startPos = cam.position.clone(), startTgt = ctrls.target.clone();
    const t0 = performance.now(), dur = 620;
    const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        cam.position.lerpVectors(startPos, endPos, e);
        ctrls.target.lerpVectors(startTgt, center, e);
        ctrls.update();
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function speak(text) {
    return new Promise((resolve) => {
        narrResolve = resolve;
        fetch('/api/tts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        }).then((r) => {
            if (!r.ok) throw new Error('tts');
            return r.blob();
        }).then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = new Audio(url); curAudio = a;
            a.onended = () => { URL.revokeObjectURL(url); resolve(); };
            a.onerror = () => { resolve(); };
            a.play().catch(() => resolve());
        }).catch(() => setTimeout(resolve, 3200)); // silent fallback if TTS unavailable
    });
}

function orderedIds(app) {
    const items = document.querySelectorAll('#region-list .list-item');
    const ids = [];
    items.forEach((it) => { if (it.dataset.id) ids.push(it.dataset.id); });
    return ids.length ? ids : Object.keys(app.regions);
}

async function runTour(app, btn, stopPill) {
    touring = true; stopFlag = false;
    btn.textContent = '■ Stop tour'; btn.classList.add('touring');
    stopPill.classList.add('show');
    const organ = (app.tutor && app.tutor.context) ? '' : '';
    const ids = orderedIds(app);
    await speak('Welcome to the NAVADA atlas guided tour. Let us look at each part.');
    for (const id of ids) {
        if (stopFlag) break;
        const r = app.regions[id];
        if (!r) continue;
        app.select(id);
        frame(app, [id]);
        await sleep(120);
        if (stopFlag) break;
        await speak(`${r.name}. ${r.function || ''}`);
        if (stopFlag) break;
        await sleep(250);
    }
    endTour(app, btn, stopPill);
}

function endTour(app, btn, stopPill) {
    stopFlag = true; touring = false;
    if (curAudio) { try { curAudio.pause(); } catch (_) {} curAudio = null; }
    app.select(null);
    frame(app, null);
    btn.textContent = '▶ Guided tour'; btn.classList.remove('touring');
    stopPill.classList.remove('show');
}

function stopNow() {
    stopFlag = true;
    if (curAudio) { try { curAudio.pause(); } catch (_) {} }
    if (narrResolve) { narrResolve(); narrResolve = null; }
}

function build(app) {
    const atlas = document.getElementById('atlas-view');
    if (!atlas || document.getElementById('tour-btn')) return;

    // button in the controls panel
    const sec = document.createElement('div');
    sec.className = 'p-section'; sec.id = 'sec-tour';
    sec.innerHTML = '<button id="tour-btn" class="btn tour-btn">▶ Guided tour</button>' +
        '<div class="tour-hint">Auto-plays through every part, narrated in Grok’s voice.</div>';
    atlas.insertBefore(sec, atlas.querySelector('.p-foot'));
    const btn = sec.querySelector('#tour-btn');

    // floating Stop pill (only visible while touring)
    const stopPill = document.createElement('button');
    stopPill.id = 'tour-stop'; stopPill.className = 'tour-stop'; stopPill.textContent = '■ Stop tour';
    document.body.appendChild(stopPill);

    const beginClose = () => {
        // close the panel so the model is visible during the tour
        const panel = document.getElementById('panel');
        if (panel && window.matchMedia('(max-width: 760px)').matches) {
            panel.classList.add('collapsed'); panel.classList.remove('chat-only');
            document.getElementById('reopen')?.classList.add('show');
            document.body.classList.remove('panel-open');
        }
    };

    btn.addEventListener('click', () => {
        if (touring) { stopNow(); return; }
        beginClose();
        runTour(app, btn, stopPill);
    });
    stopPill.addEventListener('click', stopNow);
}

function init() {
    let built = false;
    const tryBuild = () => {
        if (built) return true;
        const app = findApp();
        if (app && document.querySelector('#region-list .list-item')) { build(app); built = true; return true; }
        return false;
    };
    if (tryBuild()) return;
    const rl = document.getElementById('region-list');
    if (rl) {
        const mo = new MutationObserver(() => { if (tryBuild()) mo.disconnect(); });
        mo.observe(rl, { childList: true });
    }
    let n = 0;
    const t = setInterval(() => { if (tryBuild() || ++n > 60) clearInterval(t); }, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
