/**
 * NAVADA MolecularAtlas — molecular-scale viewer for the NAVADA Atlas platform.
 *
 * Unlike the organ pages (Three.js + GLB), this page renders real molecular
 * structures with 3Dmol.js, fetched live by id from the RCSB Protein Data Bank
 * (pdb:) or PubChem (cid:). No local model files, no GLB conversion — the
 * structure files themselves are the 3D asset. Catalogue: data/molecules.json.
 *
 * Reuses the shared TutorManager so the AI Doc is context-aware (organ:'molecular').
 */
import { TutorManager } from './modules/TutorManager.js';

const $ = (id) => document.getElementById(id);
const STYLES = ['cartoon', 'stick', 'sphere'];

class MolecularAtlas {
    constructor() {
        this.viewer = null;
        this.catalogue = [];
        this.active = null;        // active structure entry
        this.selectedSite = null;  // active site object
        this.baseStyle = 'cartoon';
        this.surfaceOn = false;
    }

    async init() {
        // 3Dmol viewer in the shared full-screen container.
        this.viewer = window.$3Dmol.createViewer($('viewer-container'), {
            backgroundColor: '#08060d',
            antialias: true,
        });

        const data = await fetch('data/molecules.json').then((r) => r.json());
        this.catalogue = data.structures || [];

        this._buildStructureList();
        this._buildStyleButtons();
        this._wireControls();
        this._wireTutor();
        this._wirePanelChrome();
        this._buildTour();

        if (this.catalogue.length) await this.loadStructure(this.catalogue[0]);
    }

    // ---- Guided voice tour (Grok TTS) -----------------------------------
    _speak(text) {
        return new Promise((resolve) => {
            this._narrResolve = resolve;
            fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }) })
                .then((r) => { if (!r.ok) throw new Error('tts'); return r.blob(); })
                .then((b) => {
                    const u = URL.createObjectURL(b);
                    const a = new Audio(u); this._curAudio = a;
                    a.onended = () => { URL.revokeObjectURL(u); resolve(); };
                    a.onerror = () => resolve();
                    a.play().catch(() => resolve());
                })
                .catch(() => setTimeout(resolve, 3000));
        });
    }
    _stopTour() {
        this._stop = true;
        if (this._curAudio) { try { this._curAudio.pause(); } catch (_) {} }
        if (this._narrResolve) { this._narrResolve(); this._narrResolve = null; }
    }
    async _runTour() {
        if (this._touring) { this._stopTour(); return; }
        this._touring = true; this._stop = false;
        const btn = $('tour-btn'), pill = $('tour-stop');
        if (btn) { btn.textContent = '■ Stop tour'; btn.classList.add('touring'); }
        if (pill) pill.classList.add('show');
        const panel = $('panel');
        if (panel && window.matchMedia('(max-width: 760px)').matches) {
            panel.classList.add('collapsed');
            $('reopen')?.classList.add('show');
            document.body.classList.remove('panel-open');
        }
        const s = this.active;
        if (s) {
            await this._speak(`${s.name}. ${s.summary || ''}`);
            for (const site of (s.sites || [])) {
                if (this._stop) break;
                const el = [...document.querySelectorAll('#region-list .list-item')]
                    .find((n) => n.querySelector('.li-name')?.textContent === site.name);
                this.selectSite(site, el);
                await new Promise((r) => setTimeout(r, 160));
                if (this._stop) break;
                await this._speak(`${site.name}. ${site.function || ''}`);
                if (this._stop) break;
                await new Promise((r) => setTimeout(r, 250));
            }
        }
        this._endTour();
    }
    _endTour() {
        this._stop = true; this._touring = false;
        if (this._curAudio) { try { this._curAudio.pause(); } catch (_) {} this._curAudio = null; }
        const btn = $('tour-btn'), pill = $('tour-stop');
        if (btn) { btn.textContent = '▶ Guided tour'; btn.classList.remove('touring'); }
        if (pill) pill.classList.remove('show');
        if (this.viewer) { this.viewer.zoomTo(); this.viewer.render(); }
    }
    _buildTour() {
        const atlas = $('atlas-view');
        if (!atlas || $('tour-btn')) return;
        const sec = document.createElement('div');
        sec.className = 'p-section'; sec.id = 'sec-tour';
        sec.innerHTML = '<button id="tour-btn" class="btn tour-btn">▶ Guided tour</button>' +
            '<div class="tour-hint">Auto-plays this structure and its sites, narrated in Grok’s voice.</div>';
        atlas.insertBefore(sec, atlas.querySelector('.p-foot'));
        const pill = document.createElement('button');
        pill.id = 'tour-stop'; pill.className = 'tour-stop'; pill.textContent = '■ Stop tour';
        document.body.appendChild(pill);
        $('tour-btn').addEventListener('click', () => this._runTour());
        pill.addEventListener('click', () => this._stopTour());
    }

    // ---- Catalogue UI ----------------------------------------------------
    _buildStructureList() {
        const list = $('structure-list');
        list.innerHTML = '';
        for (const s of this.catalogue) {
            const el = document.createElement('button');
            el.className = 'list-item';
            el.dataset.id = s.id;
            el.innerHTML = `<span class="li-dot" style="background:${s.color}"></span>` +
                `<span class="li-name">${s.name}</span>` +
                `<span class="li-cat cat-${s.category}">${s.category}</span>`;
            el.addEventListener('click', () => this.loadStructure(s));
            list.appendChild(el);
        }
    }

    _buildStyleButtons() {
        const wrap = $('style-buttons');
        wrap.innerHTML = '';
        for (const name of STYLES) {
            const b = document.createElement('button');
            b.className = 'act-btn';
            b.dataset.style = name;
            b.textContent = name[0].toUpperCase() + name.slice(1);
            b.addEventListener('click', () => this.setBaseStyle(name));
            wrap.appendChild(b);
        }
    }

    _markActive(selector, attr, value) {
        document.querySelectorAll(selector).forEach((el) => {
            el.classList.toggle('active', el.dataset[attr] === value);
        });
    }

    // ---- Loading a structure --------------------------------------------
    async loadStructure(s) {
        this.active = s;
        this.selectedSite = null;
        this.surfaceOn = false;
        $('surface').checked = false;
        this.baseStyle = s.defaultStyle || 'cartoon';
        this._markActive('#structure-list .list-item', 'id', s.id);
        this._syncRail(s.id);
        $('struct-summary').textContent = s.summary || '';
        $('loading').style.display = 'flex';
        $('info').classList.remove('show');
        $('info').innerHTML = '';

        const query = `${s.source.type}:${s.source.id}`;
        this.viewer.clear();

        await new Promise((resolve) => {
            window.$3Dmol.download(query, this.viewer, {}, () => resolve());
        });

        if (s.hideWater) this.viewer.setStyle({ resn: 'HOH' }, {});
        this.applyBaseStyle();
        this._buildSiteList();
        this.viewer.zoomTo();
        this.viewer.render();
        $('loading').style.display = 'none';

        if (this.tutor) this.tutor._add?.('assistant', `Loaded ${s.name}. Click a highlighted site, or ask me anything about it.`);
    }

    applyBaseStyle() {
        const s = this.active;
        const colorProp = s.category === 'drug' || this.baseStyle !== 'cartoon'
            ? { color: 'spectrum' } : { color: 'spectrum' };
        const styleObj = {};
        if (this.baseStyle === 'cartoon') styleObj.cartoon = colorProp;
        else if (this.baseStyle === 'stick') styleObj.stick = { radius: 0.18 };
        else styleObj.sphere = { scale: 0.3 };

        // Small molecules (no protein backbone) always need sticks to be visible.
        this.viewer.setStyle({}, styleObj);
        if (this.baseStyle === 'cartoon') this.viewer.addStyle({ hetflag: true }, { stick: { radius: 0.18 } });
        if (s.hideWater) this.viewer.setStyle({ resn: 'HOH' }, {});
        this._reapplySiteHighlights();
        this._markActive('#style-buttons .act-btn', 'style', this.baseStyle);
    }

    setBaseStyle(name) {
        this.baseStyle = name;
        this.applyBaseStyle();
        if (this.surfaceOn) this._addSurface();
        this.viewer.render();
    }

    // ---- Sites -----------------------------------------------------------
    _buildSiteList() {
        const list = $('region-list');
        list.innerHTML = '';
        const sites = this.active.sites || [];
        $('sites-hint').textContent = sites.length ? `${sites.length} sites` : 'whole molecule';
        for (const site of sites) {
            const el = document.createElement('button');
            el.className = 'list-item';
            el.innerHTML = `<span class="li-dot" style="background:${site.color}"></span>` +
                `<span class="li-name">${site.name}</span>`;
            el.addEventListener('click', () => this.selectSite(site, el));
            list.appendChild(el);
        }
    }

    _reapplySiteHighlights() {
        for (const site of (this.active.sites || [])) {
            const sel = this._sel(site);
            if (site.style === 'stick') this.viewer.addStyle(sel, { stick: { radius: 0.3, color: site.color } });
            else this.viewer.addStyle(sel, { cartoon: { color: site.color } });
        }
    }

    _sel(site) {
        // Pass the catalogue selection straight through to 3Dmol's atom selector.
        return JSON.parse(JSON.stringify(site.sel || {}));
    }

    selectSite(site, el) {
        this.selectedSite = site;
        document.querySelectorAll('#region-list .list-item').forEach((n) => n.classList.remove('active'));
        el?.classList.add('active');
        this.applyBaseStyle();

        // Emphasise the chosen site.
        const sel = this._sel(site);
        this.viewer.addStyle(sel, { stick: { radius: 0.35, color: site.color } });
        this.viewer.zoomTo(sel);
        this.viewer.render();

        const info = $('info');
        info.innerHTML = `<h3 style="color:${site.color}">${site.name}</h3><p>${site.function || ''}</p>`;
        info.classList.add('show');
    }

    // ---- Display extras --------------------------------------------------
    _addSurface() {
        this.viewer.addSurface(window.$3Dmol.SurfaceType.VDW, {
            opacity: 0.72, color: this.active.color || '#9b8cff',
        }, { hetflag: false });
    }

    _wireControls() {
        $('surface').addEventListener('change', (e) => {
            this.surfaceOn = e.target.checked;
            this.viewer.removeAllSurfaces();
            if (this.surfaceOn) this._addSurface();
            this.viewer.render();
        });
        $('spin').addEventListener('change', (e) => {
            this.viewer.spin(e.target.checked ? 'y' : false);
        });
        $('reset').addEventListener('click', () => {
            this.selectedSite = null;
            this.surfaceOn = false;
            $('surface').checked = false;
            $('spin').checked = false;
            this.viewer.spin(false);
            this.viewer.removeAllSurfaces();
            this.applyBaseStyle();
            this.viewer.zoomTo();
            this.viewer.render();
            $('info').classList.remove('show');
            document.querySelectorAll('#region-list .list-item').forEach((n) => n.classList.remove('active'));
        });
    }

    // ---- Tutor + panel chrome -------------------------------------------
    _wireTutor() {
        this.tutor = new TutorManager(
            { log: $('tutor-log'), input: $('tutor-text'), send: $('tutor-send'), status: $('tutor-status') },
            () => ({
                organ: 'molecular',
                region: this.selectedSite ? `${this.selectedSite.name} — ${this.selectedSite.function || ''}` : null,
                scenario: this.active ? `${this.active.name} (${this.active.category})` : null,
            }),
        );
    }

    _wirePanelChrome() {
        const panel = $('panel');
        const reopen = $('reopen');
        // mobile panel behaves like the organ pages: a bottom sheet you can
        // close to the ☰ pill and reopen, plus a focused AI chat mode.
        const closePanel = () => {
            panel.classList.add('collapsed'); panel.classList.remove('chat-only');
            reopen?.classList.add('show');
            document.body.classList.remove('panel-open');
        };
        $('collapse-btn')?.addEventListener('click', closePanel);
        reopen?.addEventListener('click', () => {
            panel.classList.remove('collapsed', 'chat-only');
            reopen.classList.remove('show');
            document.body.classList.add('panel-open');
        });
        $('mobile-agent')?.addEventListener('click', () => {
            const chatOpen = panel.classList.contains('chat-only') && !panel.classList.contains('collapsed');
            if (chatOpen) { closePanel(); return; }
            $('nav-atlas')?.click();
            panel.classList.add('chat-only'); panel.classList.remove('collapsed');
            reopen?.classList.remove('show');
            document.body.classList.add('panel-open');
            setTimeout(() => $('tutor-text')?.focus(), 160);
        });
        $('nav-atlas')?.addEventListener('click', () => {
            $('nav-atlas').classList.add('active'); $('nav-about').classList.remove('active');
            $('atlas-view').hidden = false; $('about-view').hidden = true;
        });
        $('nav-about')?.addEventListener('click', () => {
            $('nav-about').classList.add('active'); $('nav-atlas').classList.remove('active');
            $('about-view').hidden = false; $('atlas-view').hidden = true;
        });
        window.addEventListener('resize', () => this.viewer && this.viewer.resize());

        // start collapsed on phones so the 3D fills the screen (pill reopens it)
        if (window.matchMedia('(max-width: 760px)').matches) {
            panel.classList.add('collapsed');
            reopen?.classList.add('show');
        }
        this._buildStructureRail();
    }

    // Mobile bottom rail: swipe to browse the catalogue, tap a chip to load it.
    // Tap-to-load (not swipe-auto-load) because each structure is a live network
    // fetch from the PDB / PubChem — auto-loading on scroll would hammer them.
    _buildStructureRail() {
        const rail = $('parts-rail');
        if (!rail || !this.catalogue.length) return;
        const track = rail.querySelector('.pr-track');
        track.innerHTML = '';
        const chips = [];
        this.catalogue.forEach((s) => {
            const chip = document.createElement('button');
            chip.className = 'pr-chip'; chip.type = 'button'; chip.dataset.id = s.id;
            chip.innerHTML = `<span class="pr-dot" style="background:${s.color}"></span>` +
                `<span class="pr-name">${s.name}</span>`;
            chip.addEventListener('click', () => { this.loadStructure(s); this._centerChip(chip); });
            track.appendChild(chip);
            chips.push(chip);
        });
        this._railChips = chips;
        const idxOf = () => chips.findIndex((c) => c.dataset.id === (this.active && this.active.id));
        rail.querySelector('.pr-prev')?.addEventListener('click', () => {
            const i = ((idxOf() <= 0 ? chips.length : idxOf()) - 1 + chips.length) % chips.length;
            chips[i].click();
        });
        rail.querySelector('.pr-next')?.addEventListener('click', () => {
            chips[(idxOf() + 1) % chips.length].click();
        });
        this._syncRail(this.active && this.active.id);
    }

    _syncRail(id) {
        (this._railChips || []).forEach((c) => c.classList.toggle('active', c.dataset.id === id));
    }

    _centerChip(chip) {
        try { chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch (_) {}
    }
}

const app = new MolecularAtlas();
window.navadaMolecule = app;
app.init().catch((e) => {
    console.error('[MolecularAtlas]', e);
    const l = $('loading');
    if (l) l.querySelector('p').textContent = 'Failed to load: ' + e.message;
});
