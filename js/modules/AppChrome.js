/**
 * AppChrome — shared app-shell extras for every NAVADA Atlas page.
 *
 *  1. Splash cover: a one-per-session "NAVADA ATLAS" title that fades into the app.
 *  2. Background switcher: black / white / pink / blue, applied to the page, the
 *     Three.js scene (organ pages) and the 3Dmol viewer (molecule page), and
 *     remembered across visits.
 *
 * Self-initializing and engine-agnostic: it finds the running app via its
 * window handle, so no per-page code changes are needed. Dependency-free (no
 * bare imports) so it also runs on the molecule page, which has no import map.
 */

const BG_OPTIONS = [
    { key: 'black', label: 'Black', hex: '#06080c' },
    { key: 'white', label: 'White', hex: '#eef1f6' },
    { key: 'pink',  label: 'Pink',  hex: '#ffd3e6' },
    { key: 'blue',  label: 'Blue',  hex: '#123a7a' },
];
const BG_STORE = 'navada_atlas_bg';
const SPLASH_STORE = 'navada_atlas_splash';

let currentHex = null;

function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function findThreeApp() {
    for (const k of Object.keys(window)) {
        if (!k.startsWith('navada')) continue;
        const a = window[k];
        if (a && a.sceneManager && a.sceneManager.scene) return a;
    }
    return null;
}

function findMolecule() {
    const a = window.navadaMolecule;
    return a && a.viewer ? a : null;
}

// Push the colour into whichever 3D engine this page uses. Returns true once done.
function applyEngineBg(hex) {
    const app = findThreeApp();
    if (app) {
        try {
            const sc = app.sceneManager.scene;
            if (sc.background && sc.background.set) sc.background.set(hex);
            if (sc.fog && sc.fog.color) sc.fog.color.set(hex);
            app.sceneManager.render && app.sceneManager.render();
        } catch (_) {}
        return true;
    }
    const mol = findMolecule();
    if (mol) {
        try { mol.viewer.setBackgroundColor(hex); mol.viewer.render(); } catch (_) {}
        return true;
    }
    return false;
}

function applyBg(hex) {
    currentHex = hex;
    document.documentElement.style.background = hex;
    document.body.classList.toggle('bg-light', luminance(hex) > 0.6);
    const vc = document.getElementById('viewer-container');
    if (vc) vc.style.background = hex;
    applyEngineBg(hex);
    markSwatch();
}

function markSwatch() {
    document.querySelectorAll('.bg-swatch').forEach((b) =>
        b.classList.toggle('active', BG_OPTIONS.find((o) => o.key === b.dataset.bg)?.hex === currentHex));
}

function setBg(hex) {
    try { localStorage.setItem(BG_STORE, hex); } catch (_) {}
    applyBg(hex);
}

function injectSwatches() {
    const atlas = document.getElementById('atlas-view');
    if (!atlas || document.getElementById('sec-bg')) return;
    const sec = document.createElement('div');
    sec.className = 'p-section'; sec.id = 'sec-bg';
    sec.innerHTML = '<div class="p-title">Background</div><div class="bg-swatches"></div>';
    atlas.insertBefore(sec, atlas.querySelector('.p-foot'));
    const wrap = sec.querySelector('.bg-swatches');
    for (const o of BG_OPTIONS) {
        const b = document.createElement('button');
        b.className = 'bg-swatch'; b.type = 'button'; b.dataset.bg = o.key;
        b.style.background = o.hex; b.title = o.label; b.setAttribute('aria-label', `${o.label} background`);
        b.addEventListener('click', () => setBg(o.hex));
        wrap.appendChild(b);
    }
    markSwatch();
}

function splash() {
    let shown; try { shown = sessionStorage.getItem(SPLASH_STORE); } catch (_) {}
    if (shown) return;
    const el = document.createElement('div');
    el.id = 'splash';
    el.innerHTML = '<span class="splash-mark">NAVADA</span><span class="splash-word">ATLAS</span>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => el.classList.add('hide'), 1400);
    setTimeout(() => {
        el.remove();
        try { sessionStorage.setItem(SPLASH_STORE, '1'); } catch (_) {}
    }, 2300);
}

function init() {
    let saved; try { saved = localStorage.getItem(BG_STORE); } catch (_) {}
    const hex = saved || BG_OPTIONS[0].hex;
    applyBg(hex);
    splash();
    injectSwatches();

    // The 3D app initialises asynchronously (model / structure load) — keep
    // re-applying the colour until the engine exists so it isn't left on default.
    if (!applyEngineBg(hex)) {
        let tries = 0;
        const t = setInterval(() => {
            if (applyEngineBg(hex) || ++tries > 40) clearInterval(t);
        }, 400);
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
