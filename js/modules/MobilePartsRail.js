/**
 * MobilePartsRail — a swipeable filmstrip of body parts for mobile.
 *
 * On phones the parts list is hidden and you have to tap tiny meshes on the
 * model. This adds a horizontal rail pinned to the bottom: swipe (or tap the
 * chips / use the ‹ › steppers) to walk through every part. Each selection
 * highlights the part, shows its info card, and flies the camera in to frame
 * that single 3D part so you actually see it.
 *
 * Fully self-contained and DOM-driven: it finds the running organ app via its
 * `window.navada*` handle and reuses the app's own `select(id)` + `meshes` +
 * `camera`, so it needs no changes to any organ's code. Drop the markup + this
 * script into a page and it wires itself up once the parts list is populated.
 */

import * as THREE from 'three';

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

// Find the active organ app (window.navadaBrain / navadaHeart / navadaSkull …).
function findApp() {
    for (const k of Object.keys(window)) {
        if (!k.startsWith('navada')) continue;
        const a = window[k];
        if (a && Array.isArray(a.meshes) && a.camera && typeof a.select === 'function') return a;
    }
    return null;
}

// Frame the camera on a single part, keeping the current viewing angle.
function focusPart(app, id) {
    const meshes = app.meshes.filter((m) => m.userData && m.userData.regionId === id);
    if (!meshes.length) return;
    const box = new THREE.Box3();
    for (const m of meshes) { m.updateWorldMatrix(true, false); box.expandByObject(m); }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const cam = app.camera.camera;
    const ctrls = app.camera.controls;

    const fov = (cam.fov * Math.PI) / 180;
    let dist = (size * 0.5) / Math.tan(fov / 2) * 1.9 + size * 0.25;
    dist = Math.max(ctrls.minDistance * 1.05, Math.min(ctrls.maxDistance * 0.95, dist));

    const dir = new THREE.Vector3().subVectors(cam.position, ctrls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.2, 1);
    dir.normalize();
    const endPos = center.clone().add(dir.multiplyScalar(dist));

    tweenCamera(app, endPos, center);
}

// Frame the whole model again (used to zoom back out after inspecting a part).
function frameAll(app) {
    if (!app.meshes.length) return;
    const box = new THREE.Box3();
    for (const m of app.meshes) { m.updateWorldMatrix(true, false); box.expandByObject(m); }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const cam = app.camera.camera;
    const ctrls = app.camera.controls;
    const fov = (cam.fov * Math.PI) / 180;
    let dist = (size * 0.5) / Math.tan(fov / 2) * 1.15;
    dist = Math.max(ctrls.minDistance * 1.05, Math.min(ctrls.maxDistance * 0.95, dist));
    const dir = new THREE.Vector3().subVectors(cam.position, ctrls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.2, 1);
    dir.normalize();
    tweenCamera(app, center.clone().add(dir.multiplyScalar(dist)), center);
}

function tweenCamera(app, endPos, endTarget, dur = 520) {
    const cam = app.camera.camera;
    const ctrls = app.camera.controls;
    const startPos = cam.position.clone();
    const startTgt = ctrls.target.clone();
    const t0 = performance.now();
    if (app.__railTween) cancelAnimationFrame(app.__railTween);
    const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        cam.position.lerpVectors(startPos, endPos, e);
        ctrls.target.lerpVectors(startTgt, endTarget, e);
        ctrls.update();
        if (t < 1) app.__railTween = requestAnimationFrame(frame);
        else app.__railTween = null;
    };
    app.__railTween = requestAnimationFrame(frame);
}

function build(app, els) {
    const { track } = els;
    const srcItems = document.querySelectorAll('#region-list .list-item');
    if (!srcItems.length) return false;

    track.innerHTML = '';
    const chips = [];
    const idToChip = new Map();

    srcItems.forEach((it) => {
        const id = it.dataset.id;
        if (!id) return;
        const dot = it.querySelector('.dot');
        const color = dot ? dot.style.background || '#8a93a3' : '#8a93a3';
        const name = it.textContent.trim();
        const chip = document.createElement('button');
        chip.className = 'pr-chip';
        chip.dataset.id = id;
        chip.type = 'button';
        chip.innerHTML = `<span class="pr-dot" style="background:${color}"></span><span class="pr-name">${name}</span>`;
        // tap a part to fly in; tap it again to zoom back out to the whole model
        chip.addEventListener('click', () => {
            if (app.selected === id) { app.select(null); frameAll(app); setActive(null); }
            else choose(id, true);
        });
        track.appendChild(chip);
        chips.push(chip);
        idToChip.set(id, chip);
    });

    // Start suppressed so the initial scroll-snap settling doesn't auto-select
    // the first part — the app should open on the whole model, not zoomed in.
    let suppress = true;
    let settleTimer = null;
    setTimeout(() => { suppress = false; }, 1000);

    const setActive = (id) => chips.forEach((c) => c.classList.toggle('active', c.dataset.id === id));

    const center = (chip) => {
        if (!chip) return;
        suppress = true;
        chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => { suppress = false; }, 480);
    };

    function choose(id, doCenter) {
        app.select(id);
        focusPart(app, id);
        setActive(id);
        if (doCenter) center(idToChip.get(id));
    }

    // Swipe → select whichever chip is nearest the centre of the rail.
    track.addEventListener('scroll', () => {
        if (suppress) return;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            const r = track.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            let best = null, bestD = Infinity;
            for (const c of chips) {
                const cr = c.getBoundingClientRect();
                const d = Math.abs(cr.left + cr.width / 2 - cx);
                if (d < bestD) { bestD = d; best = c; }
            }
            if (best && best.dataset.id !== app.selected) {
                app.select(best.dataset.id);
                focusPart(app, best.dataset.id);
                setActive(best.dataset.id);
            }
        }, 120);
    }, { passive: true });

    const step = (dir) => {
        if (!chips.length) return;
        let i = chips.findIndex((c) => c.dataset.id === app.selected);
        i = (i < 0 ? (dir > 0 ? -1 : 0) : i) + dir;
        i = (i + chips.length) % chips.length;
        choose(chips[i].dataset.id, true);
    };
    els.prev.addEventListener('click', () => step(-1));
    els.next.addEventListener('click', () => step(1));

    // Keep the rail in sync when a part is picked elsewhere (tapping the model,
    // the desktop list, reset, etc.) — the app toggles `.list-item.active`.
    const listMo = new MutationObserver(() => {
        const active = document.querySelector('#region-list .list-item.active');
        const id = active ? active.dataset.id : null;
        setActive(id);
        if (id && !suppress) center(idToChip.get(id));
    });
    listMo.observe(document.getElementById('region-list'), {
        attributes: true, subtree: true, attributeFilter: ['class'],
    });

    return true;
}

function init() {
    // The organ switcher has 9 tabs and overflows on phones — bring the current
    // page's tab into view so users know where they are and can reach the rest.
    const activeTab = document.querySelector('.organ-switch a.active');
    if (activeTab && isMobile()) {
        try { activeTab.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (_) {}
    }

    const rail = document.getElementById('parts-rail');
    if (!rail || document.getElementById('region-list') == null) return;
    const els = {
        rail,
        track: rail.querySelector('.pr-track'),
        prev: rail.querySelector('.pr-prev'),
        next: rail.querySelector('.pr-next'),
    };
    if (!els.track || !els.prev || !els.next) return;

    let built = false;
    const tryBuild = () => {
        if (built) return;
        const app = findApp();
        if (app && build(app, els)) { built = true; return true; }
        return false;
    };

    if (tryBuild()) return;
    // The parts list is populated asynchronously after the model loads — retry
    // until the app + list are ready, then stop.
    const listEl = document.getElementById('region-list');
    const mo = new MutationObserver(() => { if (tryBuild()) mo.disconnect(); });
    mo.observe(listEl, { childList: true });
    let tries = 0;
    const poll = setInterval(() => { if (tryBuild() || ++tries > 60) clearInterval(poll); }, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
