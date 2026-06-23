/**
 * OrganModel - lean GLB loader + normaliser for the NeuroAtlas platform.
 *
 * A model-agnostic version of BrainModel: loads any segmented organ GLB,
 * centres it at the origin and scales the largest dimension to ~4 units so the
 * shared camera/explode/lighting modules behave identically across organs.
 * No procedural fallback or auto-downloader — organs ship their own GLB.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export class OrganModel {
    constructor(scene) {
        this.scene = scene;
        this.model = null;
        this.boundingBox = null;
        this.boundingSphere = new THREE.Sphere();
        this.center = new THREE.Vector3();
        this.size = new THREE.Vector3();
        this.loader = new GLTFLoader();
        // models are meshopt-compressed (~75% smaller) for fast first load
        this.loader.setMeshoptDecoder(MeshoptDecoder);
    }

    load(modelPath, onProgress = null) {
        return new Promise((resolve, reject) => {
            this.loader.load(
                modelPath,
                (gltf) => {
                    this.model = gltf.scene;
                    this._normalize();
                    this.model.traverse((c) => {
                        if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
                    });
                    this.scene.add(this.model);
                    resolve(this.model);
                },
                (p) => { if (onProgress && p.total > 0) onProgress((p.loaded / p.total) * 100); },
                (err) => reject(err)
            );
        });
    }

    _normalize() {
        const box = new THREE.Box3().setFromObject(this.model);
        const c = new THREE.Vector3(), s = new THREE.Vector3();
        box.getCenter(c); box.getSize(s);
        const scale = 4 / Math.max(s.x, s.y, s.z);
        this.model.scale.setScalar(scale);
        this.model.position.set(-c.x * scale, -c.y * scale, -c.z * scale);
        this.model.updateMatrixWorld(true);

        this.boundingBox = new THREE.Box3().setFromObject(this.model);
        this.boundingBox.getCenter(this.center);
        this.boundingBox.getSize(this.size);
        this.boundingBox.getBoundingSphere(this.boundingSphere);
        this.center.set(0, 0, 0);
    }

    getOptimalCameraDistance(fov = 75) {
        const r = this.boundingSphere.radius;
        return (r / Math.sin((fov * Math.PI) / 180 / 2)) * 1.2;
    }

    getBoundingSphere() { return this.boundingSphere; }
    getCenter() { return this.center.clone(); }
    getSize() { return this.size.clone(); }
    update() {}
}
