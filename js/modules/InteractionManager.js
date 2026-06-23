/**
 * InteractionManager - Raycast-based picking for the segmented brain.
 *
 * Handles hover (cursor tooltip) and click (select) against the region meshes.
 * Emits regionId strings; the app maps those to metadata + visual state.
 */

import * as THREE from 'three';

export class InteractionManager {
    constructor(camera, domElement, meshes, callbacks = {}) {
        this.camera = camera;
        this.domElement = domElement;
        this.meshes = meshes;            // array of THREE.Mesh, each .userData.regionId set
        this.onSelect = callbacks.onSelect || (() => {});
        this.onHover = callbacks.onHover || (() => {});

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.hovered = null;
        this._downPos = null;

        this._onMove = this._onMove.bind(this);
        this._onDown = this._onDown.bind(this);
        this._onUp = this._onUp.bind(this);

        domElement.addEventListener('pointermove', this._onMove);
        domElement.addEventListener('pointerdown', this._onDown);
        domElement.addEventListener('pointerup', this._onUp);
    }

    _setPointer(e) {
        const r = this.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    }

    _pick() {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.meshes, false);
        return hits.length ? hits[0].object : null;
    }

    _onMove(e) {
        this._setPointer(e);
        const obj = this._pick();
        const id = obj ? obj.userData.regionId : null;
        if (id !== this.hovered) {
            this.hovered = id;
            this.domElement.style.cursor = id ? 'pointer' : 'grab';
            this.onHover(id, e.clientX, e.clientY);
        } else if (id) {
            this.onHover(id, e.clientX, e.clientY); // keep tooltip following cursor
        }
    }

    _onDown(e) {
        this._downPos = { x: e.clientX, y: e.clientY };
    }

    _onUp(e) {
        // Treat as a click only if the pointer barely moved (so orbit-drag doesn't select)
        if (!this._downPos) return;
        const dx = e.clientX - this._downPos.x;
        const dy = e.clientY - this._downPos.y;
        this._downPos = null;
        if (Math.hypot(dx, dy) > 5) return;
        this._setPointer(e);
        const obj = this._pick();
        this.onSelect(obj ? obj.userData.regionId : null);
    }
}
