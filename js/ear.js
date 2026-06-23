/**
 * NAVADA OtoAtlas — interactive segmented ear.
 *
 * Fifth organ in the NAVADA Atlas. Reuses the shared platform modules and adds
 * ear-specific managers: a sound-conduction heatmap + live auditory behaviour
 * (EarActivity — loudness, frequency, balance) and an audiogram / system-tone
 * telemetry dashboard (EarTelemetry). The middle-ear ossicle chain buzzes with
 * the live sound as a travelling wave.
 */

import * as THREE from 'three';
import { SceneManager } from './modules/SceneManager.js';
import { OrganModel } from './modules/OrganModel.js';
import { CameraController } from './modules/CameraController.js';
import { LightingManager } from './modules/LightingManager.js';
import { InteractionManager } from './modules/InteractionManager.js';
import { ExplodeManager } from './modules/ExplodeManager.js';
import { EarActivity, SCENARIOS } from './modules/EarActivity.js';
import { EarTelemetry } from './modules/EarTelemetry.js';
import { TutorManager } from './modules/TutorManager.js';

// the outer ear (auricle) — faded by X-ray to reveal the middle & inner ear inside
const OUTER_IDS = new Set(['Helix', 'Antihelix', 'Concha of auricle', 'Lobule of auricle']);
// the conduction chain that buzzes with sound, in travelling-wave order
const CHAIN_ORDER = ['Tympanic membrane', 'Malleus', 'Incus', 'Stapes'];
const norm = (s) => (s || '').toLowerCase().replace(/[._]+/g, ' ').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

class NavadaEar {
    constructor() {
        this.container = document.getElementById('viewer-container');
        this.loadingEl = document.getElementById('loading');

        this.sceneManager = new SceneManager(this.container);
        this.lighting = new LightingManager(this.sceneManager.scene);
        this.lighting.setLightingPreset('medical');
        this.camera = new CameraController(this.sceneManager.camera, this.sceneManager.renderer.domElement);

        this.regions = {};
        this.normToKey = new Map();
        this.idToMesh = new Map();
        this.meshes = [];
        this.chain = [];
        this.selected = null;
        this._tAcc = 0;
        this.clock = new THREE.Clock();

        this.animate = this.animate.bind(this);
        window.addEventListener('resize', () => this.sceneManager.onWindowResize());
    }

    async init() {
        try {
            this.regions = await fetch('data/ear-regions.json').then(r => r.json());
            for (const key in this.regions) this.normToKey.set(norm(key), key);

            this.earModel = new OrganModel(this.sceneManager.scene);
            await this.earModel.load('models/ear.glb');

            this._prepareMeshes();
            this._addHelpers();
            this._frameModel();

            this.interaction = new InteractionManager(
                this.sceneManager.camera, this.sceneManager.renderer.domElement, this.meshes,
                { onSelect: (id) => this.select(id), onHover: (id, x, y) => this._hover(id, x, y) });
            this.explode = new ExplodeManager(this.meshes);
            this.activity = new EarActivity(this.sceneManager.scene, this.idToMesh, this.regions);

            this.telemetry = new EarTelemetry(
                { trace: document.getElementById('telemetry'), sys: document.getElementById('sysbars'),
                  bands: document.getElementById('bands') },
                { status: document.getElementById('tele-status'),
                  db: document.getElementById('tele-db'),
                  freq: document.getElementById('tele-freq'),
                  balance: document.getElementById('tele-balance') },
                this.activity);
            this.telemetry.setScenario('rest', SCENARIOS.rest);

            this.tutor = new TutorManager(
                { log: document.getElementById('tutor-log'), input: document.getElementById('tutor-text'),
                  send: document.getElementById('tutor-send'), status: document.getElementById('tutor-status') },
                () => ({
                    organ: 'ear',
                    region: this.selected && this.regions[this.selected]
                        ? `${this.regions[this.selected].name} — ${this.regions[this.selected].function}` : null,
                    scenario: this.activity ? SCENARIOS[this.activity.active].name : null,
                }));

            this._buildUI();
            this.loadingEl.classList.add('hidden');
            this.animate();
            console.log('NAVADA OtoAtlas ready —', this.meshes.length, 'parts');
        } catch (err) {
            console.error(err);
            this.loadingEl.innerHTML = `<p style="color:#f66;max-width:420px;text-align:center">
                Failed to load.<br><small>${err.message}</small></p>`;
        }
    }

    _prepareMeshes() {
        this.earModel.model.traverse((o) => {
            if (!o.isMesh) return;
            const id = this.normToKey.get(norm(o.name))
                || (o.parent ? this.normToKey.get(norm(o.parent.name)) : null);
            if (!id) return;
            o.userData.regionId = id;
            const mat = o.material.clone();
            mat.transparent = true; mat.opacity = 1;
            const r = this.regions[id];
            if (r && r.color) mat.color.set(r.color);
            mat.userData.baseColor = mat.color.clone();
            mat.emissive = mat.emissive || new THREE.Color(0, 0, 0);
            o.material = mat;
            this.idToMesh.set(id, o);
            this.meshes.push(o);
        });
        // capture base scale of the conduction chain so it can buzz with sound
        CHAIN_ORDER.forEach((id, i) => {
            const mesh = this.idToMesh.get(id);
            if (mesh) this.chain.push({ mesh, baseScale: mesh.scale.clone(), phase: i * 0.9 });
        });
    }

    _addHelpers() {
        this.axes = new THREE.AxesHelper(2.2);
        this.axes.visible = false;
        this.sceneManager.scene.add(this.axes);
        this.grid = new THREE.GridHelper(7, 14, 0xfbbf24, 0x3a2e10);
        this.grid.position.y = -1.7;
        this.grid.visible = false;
        this.sceneManager.scene.add(this.grid);
    }

    _frameModel() {
        const sphere = this.earModel.getBoundingSphere();
        const dist = this.earModel.getOptimalCameraDistance(this.sceneManager.camera.fov);
        this.camera.camera.position.set(dist * 0.55, dist * 0.22, dist * 0.82);
        this.camera.setTarget(this.earModel.getCenter());
        this.camera.setZoomLimits(sphere.radius * 0.6, sphere.radius * 6);
        this._homeCam = this.camera.camera.position.clone();
    }

    select(id) {
        if (this.selected && this.idToMesh.has(this.selected)) {
            this.idToMesh.get(this.selected).material.emissive.setRGB(0, 0, 0);
        }
        this.selected = id;
        const info = document.getElementById('info');
        if (!id || !this.regions[id]) {
            info.innerHTML = ''; info.style.display = 'none';
            this.leaderMesh = null;
            document.getElementById('leader-svg').style.display = 'none';
            document.getElementById('leader-label').style.display = 'none';
            this._syncList(null); return;
        }
        const mesh = this.idToMesh.get(id), mat = mesh.material, r = this.regions[id];
        mat.emissive.set(r.color || '#ffffff'); mat.emissiveIntensity = 1.2;
        info.style.display = 'block';
        info.innerHTML = `
            <div class="info-head">
                <span class="swatch" style="background:${r.color}"></span>
                <div><h3>${r.name}</h3><span class="info-sys">${r.system}</span></div>
            </div>
            <p class="info-fn">${r.function}</p>`;
        this.leaderMesh = mesh;
        this.leaderColor = r.color || '#fbbf24';
        const label = document.getElementById('leader-label');
        label.textContent = r.name;
        label.style.borderColor = this.leaderColor;
        label.style.display = 'block';
        document.getElementById('leader-svg').style.display = 'block';
        document.getElementById('leader-line').setAttribute('stroke', this.leaderColor);
        document.getElementById('leader-dot').setAttribute('fill', this.leaderColor);
        this._syncList(id);
    }

    _hover(id, x, y) {
        const tip = document.getElementById('tooltip');
        if (!id || !this.regions[id]) { tip.style.display = 'none'; return; }
        tip.textContent = this.regions[id].name;
        tip.style.display = 'block';
        tip.style.left = (x + 14) + 'px'; tip.style.top = (y + 14) + 'px';
    }

    // X-ray: fade the outer ear so the eardrum, ossicles & inner ear show
    setReveal(on) {
        for (const [id, mesh] of this.idToMesh)
            if (OUTER_IDS.has(id)) mesh.material.opacity = on ? 0.16 : 1;
    }

    _runScenario(key) {
        if (key === 'rest') this.activity.clear(); else this.activity.apply(key);
        if (this.selected) this.select(this.selected);
        this.telemetry.setScenario(key, SCENARIOS[key]);
        document.getElementById('scn-desc').textContent = SCENARIOS[key].desc;
        document.querySelectorAll('[data-key]').forEach(b => b.classList.toggle('active', b.dataset.key === key));
        document.getElementById('legend').style.display = key === 'rest' ? 'none' : 'flex';
    }

    _buildUI() {
        const bySys = {};
        for (const id in this.regions) (bySys[this.regions[id].system] ||= []).push(id);
        const list = document.getElementById('region-list'); list.innerHTML = '';
        for (const sys of Object.keys(bySys)) {
            const h = document.createElement('div'); h.className = 'list-sys'; h.textContent = sys; list.appendChild(h);
            for (const id of bySys[sys]) {
                const r = this.regions[id];
                const item = document.createElement('button');
                item.className = 'list-item'; item.dataset.id = id;
                item.innerHTML = `<span class="dot" style="background:${r.color}"></span>${r.name}`;
                item.onclick = () => this.select(id);
                list.appendChild(item);
            }
        }
        document.getElementById('search').addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            list.querySelectorAll('.list-item').forEach(it => it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none');
        });

        const ex = document.getElementById('explode');
        const mex = document.getElementById('mexplode');
        const setExplode = (v) => { this.explode.setAmount(v / 100); if (ex) ex.value = v; if (mex) mex.value = v; };
        ex.addEventListener('input', () => setExplode(ex.value));
        if (mex) mex.addEventListener('input', () => setExplode(mex.value));
        document.getElementById('reveal').addEventListener('change', (e) => this.setReveal(e.target.checked));
        document.getElementById('autorotate').addEventListener('change', (e) => {
            this.camera.enableAutoRotate(e.target.checked);
            const mr = document.getElementById('mobile-rotate'); if (mr) mr.classList.toggle('active', e.target.checked);
        });
        document.getElementById('show-axes').addEventListener('change', (e) => this.axes.visible = e.target.checked);
        document.getElementById('show-grid').addEventListener('change', (e) => this.grid.visible = e.target.checked);
        document.getElementById('reset').addEventListener('click', () => {
            setExplode(0); this.explode.reset();
            ['reveal', 'autorotate', 'show-axes', 'show-grid'].forEach(idd => document.getElementById(idd).checked = false);
            this.setReveal(false); this.camera.enableAutoRotate(false);
            const mr = document.getElementById('mobile-rotate'); if (mr) mr.classList.remove('active');
            this.axes.visible = false; this.grid.visible = false;
            this._runScenario('rest'); this.select(null);
            this.camera.camera.position.copy(this._homeCam);
            this.camera.setTarget(this.earModel.getCenter());
        });

        const conceptWrap = document.getElementById('scenarios'); conceptWrap.innerHTML = '';
        const actWrap = document.getElementById('activities'); actWrap.innerHTML = '';
        for (const key of Object.keys(SCENARIOS)) {
            const s = SCENARIOS[key];
            const b = document.createElement('button');
            b.dataset.key = key;
            b.onclick = () => this._runScenario(key);
            if (s.cat === 'activity') { b.className = 'act-btn'; b.textContent = s.name; actWrap.appendChild(b); }
            else { b.className = 'scn-btn' + (key === 'rest' ? ' active' : ''); b.textContent = s.name; conceptWrap.appendChild(b); }
        }
        document.getElementById('scn-desc').textContent = SCENARIOS.rest.desc;

        const panel = document.getElementById('panel');
        const closePanel = () => {
            panel.classList.add('collapsed'); panel.classList.remove('chat-only');
            document.getElementById('reopen').classList.add('show');
            document.body.classList.remove('panel-open');
        };
        document.getElementById('collapse-btn').onclick = closePanel;
        document.getElementById('reopen').onclick = () => {
            panel.classList.remove('collapsed', 'chat-only');
            document.getElementById('reopen').classList.remove('show');
            document.body.classList.add('panel-open');
        };

        const atlasView = document.getElementById('atlas-view');
        const aboutView = document.getElementById('about-view');
        const navAtlas = document.getElementById('nav-atlas');
        const navAbout = document.getElementById('nav-about');
        navAtlas.onclick = () => {
            atlasView.hidden = false; aboutView.hidden = true;
            navAtlas.classList.add('active'); navAbout.classList.remove('active');
        };
        navAbout.onclick = () => {
            atlasView.hidden = true; aboutView.hidden = false;
            navAbout.classList.add('active'); navAtlas.classList.remove('active');
        };

        const mAgent = document.getElementById('mobile-agent');
        if (mAgent) mAgent.onclick = () => {
            const chatOpen = panel.classList.contains('chat-only') && !panel.classList.contains('collapsed');
            if (chatOpen) { closePanel(); return; }
            navAtlas.click();
            panel.classList.add('chat-only'); panel.classList.remove('collapsed');
            document.getElementById('reopen').classList.remove('show');
            document.body.classList.add('panel-open');
            setTimeout(() => document.getElementById('tutor-text').focus(), 160);
        };

        const mRotate = document.getElementById('mobile-rotate');
        if (mRotate) mRotate.onclick = () => {
            const on = !mRotate.classList.contains('active');
            mRotate.classList.toggle('active', on);
            this.camera.enableAutoRotate(on);
            const cb = document.getElementById('autorotate'); if (cb) cb.checked = on;
        };

        if (window.matchMedia('(max-width: 760px)').matches) {
            panel.classList.add('collapsed');
            document.getElementById('reopen').classList.add('show');
        }
        this.select(null);
    }

    _syncList(id) {
        document.querySelectorAll('.list-item').forEach(it => it.classList.toggle('active', it.dataset.id === id));
    }

    _updateLeader() {
        if (!this.leaderMesh) return;
        const cam = this.sceneManager.camera;
        const canvas = this.sceneManager.renderer.domElement;
        const W = canvas.clientWidth, H = canvas.clientHeight;
        const c = new THREE.Box3().setFromObject(this.leaderMesh).getCenter(new THREE.Vector3());
        const p = c.clone().project(cam);
        const svg = document.getElementById('leader-svg');
        const label = document.getElementById('leader-label');
        if (p.z > 1) { svg.style.display = 'none'; label.style.display = 'none'; return; }
        svg.style.display = 'block'; label.style.display = 'block';
        const sx = (p.x * 0.5 + 0.5) * W;
        const sy = (-p.y * 0.5 + 0.5) * H;
        const side = sx > W * 0.62 ? -1 : 1;
        const lx = sx + side * 80;
        const ly = sy - 60;
        label.style.left = lx + 'px';
        label.style.top = ly + 'px';
        label.style.transform = side < 0 ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
        const line = document.getElementById('leader-line');
        const labelAnchorX = lx + (side < 0 ? -2 : 2);
        line.setAttribute('x1', sx); line.setAttribute('y1', sy);
        line.setAttribute('x2', labelAnchorX); line.setAttribute('y2', ly);
        const dot = document.getElementById('leader-dot');
        dot.setAttribute('cx', sx); dot.setAttribute('cy', sy);
    }

    animate() {
        requestAnimationFrame(this.animate);
        const dt = Math.min(0.05, this.clock.getDelta());
        this._tAcc += dt;
        this.camera.update();
        if (this.activity) this.activity.update(dt);
        if (this.telemetry) this.telemetry.update(dt);
        // the conduction chain buzzes with the sound — a travelling wave along the ossicles
        if (this.chain.length && this.activity) {
            const v = this.activity.vibration;
            for (const { mesh, baseScale, phase } of this.chain) {
                const pulse = 1 + v * 0.05 * Math.sin(this._tAcc * 40 - phase);
                mesh.scale.copy(baseScale).multiplyScalar(pulse);
            }
        }
        this._updateLeader();
        this.sceneManager.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new NavadaEar();
    app.init();
    window.navadaEar = app;
});
