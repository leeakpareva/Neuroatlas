/**
 * NAVADA SkeletonAtlas — interactive segmented human skeleton.
 *
 * A static-anatomy organ page (no telemetry/scenarios — a skeleton doesn't cycle).
 * Reuses the platform's shared modules: scene, camera, lighting, raycasting and
 * radial explode. Each of the 246 bones is individually colour-coded, clickable
 * and labelled, with an X-ray that fades the ribcage & sternum to reveal the
 * spine tucked inside.
 */

import * as THREE from 'three';
import { SceneManager } from './modules/SceneManager.js';
import { OrganModel } from './modules/OrganModel.js';
import { CameraController } from './modules/CameraController.js';
import { LightingManager } from './modules/LightingManager.js';
import { InteractionManager } from './modules/InteractionManager.js';
import { ExplodeManager } from './modules/ExplodeManager.js';
import { TutorManager } from './modules/TutorManager.js';

// the outer chest bones — X-ray fades these so the spine inside shows
const VAULT_IDS = new Set(['Ribcage', 'Sternum']);
const norm = (s) => (s || '').toLowerCase().replace(/[._]+/g, ' ').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();

class NavadaSkeleton {
    constructor() {
        this.container = document.getElementById('viewer-container');
        this.loadingEl = document.getElementById('loading');

        this.sceneManager = new SceneManager(this.container);
        this.lighting = new LightingManager(this.sceneManager.scene);
        this.lighting.setLightingPreset('medical');
        this.camera = new CameraController(this.sceneManager.camera, this.sceneManager.renderer.domElement);

        this.regions = {};
        this.normToKey = new Map();
        this.idToMeshes = new Map();   // a part = several meshes (L/R, many teeth)
        this.meshes = [];
        this.selected = null;
        this.clock = new THREE.Clock();

        this.animate = this.animate.bind(this);
        window.addEventListener('resize', () => this.sceneManager.onWindowResize());
    }

    async init() {
        try {
            this.regions = await fetch('data/skeleton-regions.json').then((r) => r.json());
            for (const key in this.regions) this.normToKey.set(norm(key), key);

            this.skullModel = new OrganModel(this.sceneManager.scene);
            await this.skullModel.load('models/skeleton.glb');

            this._prepareMeshes();
            this._addHelpers();
            this._frameModel();

            this.interaction = new InteractionManager(
                this.sceneManager.camera, this.sceneManager.renderer.domElement, this.meshes,
                { onSelect: (id) => this.select(id), onHover: (id, x, y) => this._hover(id, x, y) });
            this.explode = new ExplodeManager(this.meshes);

            this.tutor = new TutorManager(
                { log: document.getElementById('tutor-log'), input: document.getElementById('tutor-text'),
                  send: document.getElementById('tutor-send'), status: document.getElementById('tutor-status') },
                () => ({
                    organ: 'skeleton',
                    region: this.selected && this.regions[this.selected]
                        ? `${this.regions[this.selected].name} — ${this.regions[this.selected].function}` : null,
                    scenario: null,
                }));

            this._buildUI();
            this.loadingEl.classList.add('hidden');
            this.animate();
            console.log('NAVADA SkeletonAtlas ready —', this.meshes.length, 'meshes /', this.idToMeshes.size, 'parts');
        } catch (err) {
            console.error(err);
            this.loadingEl.innerHTML = `<p style="color:#f66;max-width:420px;text-align:center">
                Failed to load.<br><small>${err.message}</small></p>`;
        }
    }

    _prepareMeshes() {
        this.skullModel.model.traverse((o) => {
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
            if (!this.idToMeshes.has(id)) this.idToMeshes.set(id, []);
            this.idToMeshes.get(id).push(o);
            this.meshes.push(o);
        });
    }

    _addHelpers() {
        this.axes = new THREE.AxesHelper(2.2);
        this.axes.visible = false;
        this.sceneManager.scene.add(this.axes);
        this.grid = new THREE.GridHelper(7, 14, 0xe8d8a0, 0x40381f);
        this.grid.position.y = -1.7;
        this.grid.visible = false;
        this.sceneManager.scene.add(this.grid);
    }

    _frameModel() {
        const sphere = this.skullModel.getBoundingSphere();
        const dist = this.skullModel.getOptimalCameraDistance(this.sceneManager.camera.fov);
        this.camera.camera.position.set(dist * 0.5, dist * 0.18, dist * 0.86);
        this.camera.setTarget(this.skullModel.getCenter());
        this.camera.setZoomLimits(sphere.radius * 0.55, sphere.radius * 6);
        this._homeCam = this.camera.camera.position.clone();
    }

    _setEmissive(id, on, color) {
        for (const mesh of (this.idToMeshes.get(id) || [])) {
            if (on) { mesh.material.emissive.set(color || '#ffffff'); mesh.material.emissiveIntensity = 1.1; }
            else mesh.material.emissive.setRGB(0, 0, 0);
        }
    }

    select(id) {
        if (this.selected) this._setEmissive(this.selected, false);
        this.selected = id;
        const info = document.getElementById('info');
        if (!id || !this.regions[id]) {
            info.innerHTML = ''; info.style.display = 'none';
            this.leaderMesh = null;
            document.getElementById('leader-svg').style.display = 'none';
            document.getElementById('leader-label').style.display = 'none';
            this._syncList(null); return;
        }
        const r = this.regions[id];
        this._setEmissive(id, true, r.color || '#ffffff');
        info.style.display = 'block';
        info.innerHTML = `
            <div class="info-head">
                <span class="swatch" style="background:${r.color}"></span>
                <div><h3>${r.name}</h3><span class="info-sys">${r.system}</span></div>
            </div>
            <p class="info-fn">${r.function}</p>`;
        // leader points at the largest mesh of the part
        const ms = this.idToMeshes.get(id) || [];
        this.leaderMesh = ms[0] || null;
        this.leaderColor = r.color || '#e8d8a0';
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

    // X-ray: fade the ribcage & sternum so the spine inside the chest shows
    setReveal(on) {
        for (const [id, ms] of this.idToMeshes)
            if (VAULT_IDS.has(id)) for (const mesh of ms) mesh.material.opacity = on ? 0.12 : 1;
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
            list.querySelectorAll('.list-item').forEach((it) => it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none');
        });

        const ex = document.getElementById('explode');
        const mex = document.getElementById('mexplode');
        const setExplode = (v) => { this.explode.setAmount(v / 100); if (ex) ex.value = v; if (mex) mex.value = v; };
        if (ex) ex.addEventListener('input', () => setExplode(ex.value));
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
            ['reveal', 'autorotate', 'show-axes', 'show-grid'].forEach((idd) => document.getElementById(idd).checked = false);
            this.setReveal(false); this.camera.enableAutoRotate(false);
            const mr = document.getElementById('mobile-rotate'); if (mr) mr.classList.remove('active');
            this.axes.visible = false; this.grid.visible = false;
            this.select(null);
            this.camera.camera.position.copy(this._homeCam);
            this.camera.setTarget(this.skullModel.getCenter());
        });

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
        document.querySelectorAll('.list-item').forEach((it) => it.classList.toggle('active', it.dataset.id === id));
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
        line.setAttribute('x1', sx); line.setAttribute('y1', sy);
        line.setAttribute('x2', lx + (side < 0 ? -2 : 2)); line.setAttribute('y2', ly);
        const dot = document.getElementById('leader-dot');
        dot.setAttribute('cx', sx); dot.setAttribute('cy', sy);
    }

    animate() {
        requestAnimationFrame(this.animate);
        this.clock.getDelta();
        this.camera.update();
        this._updateLeader();
        this.sceneManager.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new NavadaSkeleton();
    app.init();
    window.navadaSkeleton = app;
});
