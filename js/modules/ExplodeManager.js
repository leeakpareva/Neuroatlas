/**
 * ExplodeManager - Pulls the brain apart along radial directions.
 *
 * Each part moves outward from the assembly centre by `amount`, revealing the
 * deep structures inside. Works regardless of whether node translations were
 * baked into geometry, because directions are derived from each part's world
 * bounding-box centre.
 */

import * as THREE from 'three';

export class ExplodeManager {
    constructor(meshes) {
        this.meshes = meshes;
        this.parts = [];

        const centroid = new THREE.Vector3();
        const box = new THREE.Box3();
        const tmp = new THREE.Vector3();

        // First pass: home position + world centre of each part
        const centres = [];
        for (const m of meshes) {
            box.setFromObject(m);
            const c = box.getCenter(new THREE.Vector3());
            centres.push(c);
            centroid.add(c);
        }
        centroid.multiplyScalar(1 / Math.max(1, meshes.length));

        // Overall radius (for scaling the explode distance sensibly)
        let radius = 0;
        for (const c of centres) radius = Math.max(radius, c.distanceTo(centroid));
        this.radius = radius || 1;

        // Second pass: store direction (local) for each mesh
        for (let i = 0; i < meshes.length; i++) {
            const m = meshes[i];
            const worldDir = tmp.copy(centres[i]).sub(centroid);
            // convert world direction to the mesh's parent local space
            const parent = m.parent;
            const localDir = worldDir.clone();
            if (parent) {
                const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
                // rotation/scale only — direction, so use a delta of two points
                const p0 = centroid.clone().applyMatrix4(inv);
                const p1 = centres[i].clone().applyMatrix4(inv);
                localDir.copy(p1).sub(p0);
            }
            if (localDir.lengthSq() < 1e-9) localDir.set(0, 0, 0);
            this.parts.push({
                mesh: m,
                home: m.position.clone(),
                dir: localDir,
            });
        }
    }

    /** amount: 0 (assembled) .. 1 (fully exploded) */
    setAmount(amount) {
        const k = amount * 1.4; // multiplier of each part's own offset vector
        for (const p of this.parts) {
            p.mesh.position.copy(p.home).addScaledVector(p.dir, k);
        }
    }

    reset() {
        for (const p of this.parts) p.mesh.position.copy(p.home);
    }
}
