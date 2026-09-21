// ============================================================================
//  ArcEngine — ArcActor & ArcComponent (Entity-Component System)
// ----------------------------------------------------------------------------
//  AI-friendly Entity-Component architecture for ArcEngine actors.
//  Includes built-in standard components:
//    - HealthComponent: hit points, damage, healing, death callbacks
//    - ColliderComponent: spatial collision & trigger boundaries
//    - MeshComponent: procedural or wrapped Babylon.js mesh representation
//    - SoundEmitterComponent: spatial Web Audio integration with ProceduralAudio
//
//  Fully compatible with Babylon.js, vanilla browser scripts, and Node.js testing.
// ============================================================================

/**
 * @typedef {Object} Vector3Like
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} ActorDefinition
 * @property {string} [id]
 * @property {string} [name]
 * @property {string[]|Set<string>} [tags]
 * @property {Vector3Like|[number, number, number]} [position]
 * @property {Vector3Like|[number, number, number]} [rotation]
 * @property {Vector3Like|[number, number, number]|number} [scale]
 * @property {BABYLON.Mesh|null} [mesh]
 * @property {BABYLON.Scene|null} [scene]
 * @property {boolean} [active]
 * @property {Array<ArcComponent|Object>} [components]
 */

/**
 * @typedef {Object} HealthComponentOptions
 * @property {number} [maxHp=100]
 * @property {number} [hp]
 * @property {boolean} [invulnerable=false]
 * @property {((source: any, actor: ArcActor) => void)|null} [onDeath]
 * @property {((amount: number, source: any, actor: ArcActor) => void)|null} [onDamage]
 * @property {((amount: number, actor: ArcActor) => void)|null} [onHeal]
 */

/**
 * @typedef {Object} ColliderComponentOptions
 * @property {number} [radius=10]
 * @property {number} [height=20]
 * @property {string|number} [layer='default']
 * @property {boolean} [isTrigger=false]
 * @property {Vector3Like} [offset]
 * @property {((other: ColliderComponent, actor: ArcActor) => void)|null} [onTriggerEnter]
 * @property {((other: ColliderComponent, actor: ArcActor) => void)|null} [onTriggerExit]
 */

/**
 * @typedef {Object} MeshComponentOptions
 * @property {BABYLON.Mesh|null} [mesh]
 * @property {'box'|'sphere'|'cylinder'|'plane'|string|null} [shape]
 * @property {number|[number, number, number]|{width?:number, height?:number, depth?:number, diameter?:number, size?:number}} [size]
 * @property {number|string|BABYLON.Color3|null} [color]
 * @property {BABYLON.Material|null} [material]
 * @property {boolean} [visible=true]
 * @property {number} [alpha=1.0]
 * @property {boolean} [wireframe=false]
 */

/**
 * @typedef {Object} SoundEmitterComponentOptions
 * @property {number} [refDistance=100]
 * @property {number} [maxDistance=4096]
 * @property {number} [rolloff=1.2]
 * @property {number} [volume=1.0]
 */

/**
 * Safe accessor for global BABYLON object in browser and test runtimes.
 * @returns {any}
 */
function getBabylon() {
    if (typeof BABYLON !== 'undefined') return BABYLON;
    if (typeof window !== 'undefined' && (/** @type {any} */ (window)).BABYLON) return (/** @type {any} */ (window)).BABYLON;
    if (typeof globalThis !== 'undefined' && (/** @type {any} */ (globalThis)).BABYLON) return (/** @type {any} */ (globalThis)).BABYLON;
    return null;
}

/**
 * Safe accessor for global ProceduralAudio facade in browser and test runtimes.
 * @returns {any}
 */
function getProceduralAudio() {
    if (typeof ProceduralAudio !== 'undefined') return ProceduralAudio;
    if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ProceduralAudio) return (/** @type {any} */ (window)).ProceduralAudio;
    if (typeof globalThis !== 'undefined' && (/** @type {any} */ (globalThis)).ProceduralAudio) return (/** @type {any} */ (globalThis)).ProceduralAudio;
    return null;
}

/**
 * Parse numeric/hex/string color to BABYLON.Color3.
 * @param {number|string|BABYLON.Color3|Object} color
 * @param {any} B - BABYLON namespace
 * @returns {BABYLON.Color3|null}
 */
function parseBabylonColor(color, B) {
    if (!B || color === null || color === undefined) return null;
    if (B.Color3 && color instanceof B.Color3) {
        return color.clone ? color.clone() : color;
    }
    if (typeof color === 'number') {
        const r = ((color >> 16) & 0xff) / 255;
        const g = ((color >> 8) & 0xff) / 255;
        const b = (color & 0xff) / 255;
        return new B.Color3(r, g, b);
    }
    if (typeof color === 'string') {
        if (color.startsWith('#') && typeof B.Color3.FromHexString === 'function') {
            return B.Color3.FromHexString(color);
        }
        if (color.startsWith('0x') || color.startsWith('0X')) {
            const num = parseInt(color, 16);
            const r = ((num >> 16) & 0xff) / 255;
            const g = ((num >> 8) & 0xff) / 255;
            const b = (num & 0xff) / 255;
            return new B.Color3(r, g, b);
        }
        if (typeof B.Color3.FromHexString === 'function') {
            try {
                return B.Color3.FromHexString(color);
            } catch {
                return new B.Color3(1, 1, 1);
            }
        }
    }
    if (typeof color === 'object' && color !== null) {
        return new B.Color3(Number(color.r || 0), Number(color.g || 0), Number(color.b || 0));
    }
    return new B.Color3(1, 1, 1);
}

// ============================================================================
//  1. ArcComponent (Base Class)
// ============================================================================

/**
 * Base class for all components attached to an ArcActor.
 */
class ArcComponent {
    /**
     * @param {string} [name='Component'] - Component identifier name.
     */
    constructor(name = 'Component') {
        /** @type {ArcActor | null} Reference to parent actor */
        this.actor = null;
        /** @type {string} Component name */
        this.name = name;
        /** @type {boolean} Whether component actively executes update logic */
        this.enabled = true;
    }

    /**
     * Lifecycle hook called when component is attached to an actor.
     * @param {ArcActor} actor
     */
    onAttach(actor) {
        this.actor = actor;
    }

    /**
     * Lifecycle hook called every simulation tick.
     * @param {number} dt - Delta time in seconds.
     */
    onUpdate(dt) {
        // Base implementation does nothing; override in subclasses.
    }

    /**
     * Lifecycle hook called when component is detached from its actor.
     */
    onDetach() {
        this.actor = null;
    }

    /**
     * Lifecycle hook called when component is permanently destroyed.
     */
    onDestroy() {
        // Base implementation does nothing; override in subclasses.
    }

    /**
     * Clean serializable representation for AI introspection and state saving.
     * @returns {Record<string, any>}
     */
    toJSON() {
        return {
            type: this.name,
            enabled: this.enabled
        };
    }
}

// ============================================================================
//  2. Standard Built-in Components
// ============================================================================

/**
 * HealthComponent: manages health points, damage intake, healing, and death events.
 */
class HealthComponent extends ArcComponent {
    /**
     * @param {HealthComponentOptions|number} [options=100]
     */
    constructor(options = {}) {
        super('Health');

        /** @type {number} */
        let maxHp = 100;
        /** @type {number|undefined} */
        let hp;
        /** @type {boolean} */
        let invulnerable = false;
        /** @type {((source: any, actor: ArcActor) => void)|null} */
        let onDeath = null;
        /** @type {((amount: number, source: any, actor: ArcActor) => void)|null} */
        let onDamage = null;
        /** @type {((amount: number, actor: ArcActor) => void)|null} */
        let onHeal = null;

        if (typeof options === 'number') {
            maxHp = options;
        } else if (options && typeof options === 'object') {
            if (options.maxHp !== undefined) maxHp = Number(options.maxHp);
            else if ((/** @type {any} */ (options)).max_hp !== undefined) maxHp = Number((/** @type {any} */ (options)).max_hp);

            if (options.hp !== undefined) hp = Number(options.hp);
            if (options.invulnerable !== undefined) invulnerable = Boolean(options.invulnerable);
            if (typeof options.onDeath === 'function') onDeath = options.onDeath;
            if (typeof options.onDamage === 'function') onDamage = options.onDamage;
            if (typeof options.onHeal === 'function') onHeal = options.onHeal;
        }

        this.maxHp = Math.max(1, maxHp);
        this.hp = hp !== undefined ? Math.max(0, Math.min(this.maxHp, hp)) : this.maxHp;
        this.invulnerable = invulnerable;
        this.onDeath = onDeath;
        this.onDamage = onDamage;
        this.onHeal = onHeal;
    }

    /**
     * Check if actor is dead.
     * @returns {boolean}
     */
    isDead() {
        return this.hp <= 0;
    }

    /**
     * Inflict damage on actor.
     * @param {number} amount - Positive damage amount.
     * @param {any} [source=null] - Damage dealer or weapon source.
     * @returns {number} Actual damage deducted.
     */
    takeDamage(amount, source = null) {
        if (this.isDead() || this.invulnerable || !amount || amount <= 0) {
            return 0;
        }

        const actualDamage = Math.min(this.hp, Math.max(0, Number(amount)));
        this.hp -= actualDamage;

        if (this.onDamage) {
            try {
                this.onDamage(actualDamage, source, this.actor);
            } catch (err) {
                console.error('HealthComponent: error in onDamage callback', err);
            }
        }

        if (this.actor && typeof this.actor.emit === 'function') {
            this.actor.emit('damage', {
                amount: actualDamage,
                source,
                hp: this.hp,
                maxHp: this.maxHp
            });
        }

        if (this.isDead()) {
            if (this.onDeath) {
                try {
                    this.onDeath(source, this.actor);
                } catch (err) {
                    console.error('HealthComponent: error in onDeath callback', err);
                }
            }
            if (this.actor && typeof this.actor.emit === 'function') {
                this.actor.emit('death', { source, actor: this.actor });
            }
        }

        return actualDamage;
    }

    /**
     * Heal actor.
     * @param {number} amount - Positive health amount to restore.
     * @returns {number} Actual health restored.
     */
    heal(amount) {
        if (this.isDead() || !amount || amount <= 0) {
            return 0;
        }

        const actualHeal = Math.min(this.maxHp - this.hp, Math.max(0, Number(amount)));
        this.hp += actualHeal;

        if (this.onHeal) {
            try {
                this.onHeal(actualHeal, this.actor);
            } catch (err) {
                console.error('HealthComponent: error in onHeal callback', err);
            }
        }

        if (this.actor && typeof this.actor.emit === 'function') {
            this.actor.emit('heal', {
                amount: actualHeal,
                hp: this.hp,
                maxHp: this.maxHp
            });
        }

        return actualHeal;
    }

    /**
     * Directly set health points clamped between 0 and maxHp.
     * @param {number} value
     */
    setHp(value) {
        this.hp = Math.max(0, Math.min(this.maxHp, Number(value)));
    }

    /**
     * @override
     * @returns {Record<string, any>}
     */
    toJSON() {
        return {
            type: this.name,
            hp: this.hp,
            maxHp: this.maxHp,
            isDead: this.isDead(),
            invulnerable: this.invulnerable
        };
    }
}

/**
 * ColliderComponent: geometric collision and trigger detection helper.
 */
class ColliderComponent extends ArcComponent {
    /**
     * @param {ColliderComponentOptions} [options]
     */
    constructor(options = {}) {
        super('Collider');

        this.radius = typeof options.radius === 'number' ? options.radius : 10;
        this.height = typeof options.height === 'number' ? options.height : 20;
        this.layer = options.layer !== undefined ? options.layer : 'default';
        this.isTrigger = Boolean(options.isTrigger);

        /** @type {Vector3Like} */
        this.offset = {
            x: options.offset ? Number(options.offset.x || 0) : 0,
            y: options.offset ? Number(options.offset.y || 0) : 0,
            z: options.offset ? Number(options.offset.z || 0) : 0
        };

        this.onTriggerEnter = typeof options.onTriggerEnter === 'function' ? options.onTriggerEnter : null;
        this.onTriggerExit = typeof options.onTriggerExit === 'function' ? options.onTriggerExit : null;
    }

    /**
     * Get absolute 3D position of collider in world coordinates.
     * @returns {Vector3Like}
     */
    getWorldPosition() {
        const actorPos = this.actor ? this.actor.position : { x: 0, y: 0, z: 0 };
        return {
            x: (actorPos.x || 0) + this.offset.x,
            y: (actorPos.y || 0) + this.offset.y,
            z: (actorPos.z || 0) + this.offset.z
        };
    }

    /**
     * Check if this collider intersects another collider (cylindrical 3D volume).
     * @param {ColliderComponent} other
     * @returns {boolean}
     */
    intersects(other) {
        if (!other || typeof other.getWorldPosition !== 'function') return false;

        const p1 = this.getWorldPosition();
        const p2 = other.getWorldPosition();

        const dx = p1.x - p2.x;
        const dz = p1.z - p2.z;
        const radSum = (this.radius || 0) + (other.radius || 0);

        if (dx * dx + dz * dz > radSum * radSum) {
            return false;
        }

        const halfH1 = (this.height || 0) * 0.5;
        const halfH2 = (other.height || 0) * 0.5;
        const dy = Math.abs(p1.y - p2.y);

        return dy <= (halfH1 + halfH2);
    }

    /**
     * @override
     * @returns {Record<string, any>}
     */
    toJSON() {
        return {
            type: this.name,
            radius: this.radius,
            height: this.height,
            layer: this.layer,
            isTrigger: this.isTrigger,
            offset: { x: this.offset.x, y: this.offset.y, z: this.offset.z }
        };
    }
}

/**
 * MeshComponent: wraps Babylon.js mesh or creates procedural shapes (box, sphere, cylinder).
 */
class MeshComponent extends ArcComponent {
    /**
     * @param {MeshComponentOptions} [options]
     */
    constructor(options = {}) {
        super('Mesh');

        /** @type {BABYLON.Mesh | any | null} */
        this.mesh = options.mesh || null;
        /** @type {'box'|'sphere'|'cylinder'|'plane'|string|null} */
        this.shape = options.shape || null;
        /** @type {any} */
        this.size = options.size !== undefined ? options.size : 10;
        /** @type {number|string|BABYLON.Color3|null} */
        this.color = options.color !== undefined ? options.color : null;
        /** @type {BABYLON.Material | any | null} */
        this.material = options.material || null;
        /** @type {boolean} */
        this.visible = options.visible !== undefined ? Boolean(options.visible) : true;
        /** @type {number} */
        this.alpha = typeof options.alpha === 'number' ? Math.max(0, Math.min(1, options.alpha)) : 1.0;
        /** @type {boolean} */
        this.wireframe = Boolean(options.wireframe);
        /** @type {boolean} */
        this._ownsMesh = false;
    }

    /**
     * Procedurally build a standard primitive mesh and material using BABYLON.MeshBuilder.
     * @param {MeshComponentOptions} [options]
     * @param {BABYLON.Scene | any} [scene]
     * @returns {BABYLON.Mesh | any | null}
     */
    createProceduralMesh(options = {}, scene = null) {
        const B = getBabylon();
        if (!B || !B.MeshBuilder) {
            return null;
        }

        const targetScene = scene || (this.actor ? this.actor.scene : null) ||
            (typeof World3D !== 'undefined' && (/** @type {any} */ (World3D)).view ? (/** @type {any} */ (World3D)).view.scene : null) ||
            (B.Engine ? B.Engine.LastCreatedScene : null);

        const shape = String(options.shape || this.shape || 'box').toLowerCase();
        const size = options.size !== undefined ? options.size : this.size;
        const name = (this.actor ? `${this.actor.name}_mesh` : `mesh_${Date.now()}`);

        let mesh = null;

        if (shape === 'box') {
            let width = 10, height = 10, depth = 10;
            if (Array.isArray(size)) {
                width = size[0] ?? 10;
                height = size[1] ?? size[0] ?? 10;
                depth = size[2] ?? size[0] ?? 10;
            } else if (typeof size === 'number') {
                width = height = depth = size;
            } else if (size && typeof size === 'object') {
                width = size.width ?? size.w ?? size.size ?? 10;
                height = size.height ?? size.h ?? size.size ?? 10;
                depth = size.depth ?? size.d ?? size.size ?? 10;
            }
            mesh = B.MeshBuilder.CreateBox(name, { width, height, depth }, targetScene);
        } else if (shape === 'sphere') {
            let diameter = 10;
            let diameterX, diameterY, diameterZ;
            if (Array.isArray(size)) {
                diameterX = size[0] ?? 10;
                diameterY = size[1] ?? size[0] ?? 10;
                diameterZ = size[2] ?? size[0] ?? 10;
            } else if (typeof size === 'number') {
                diameter = size;
            } else if (size && typeof size === 'object') {
                diameter = size.diameter ?? size.d ?? size.size ?? 10;
                diameterX = size.diameterX;
                diameterY = size.diameterY;
                diameterZ = size.diameterZ;
            }
            const sphereOpts = { diameter, segments: 16 };
            if (diameterX !== undefined) sphereOpts.diameterX = diameterX;
            if (diameterY !== undefined) sphereOpts.diameterY = diameterY;
            if (diameterZ !== undefined) sphereOpts.diameterZ = diameterZ;
            mesh = B.MeshBuilder.CreateSphere(name, sphereOpts, targetScene);
        } else if (shape === 'cylinder') {
            let height = 20, diameter = 10;
            let diameterTop, diameterBottom;
            if (Array.isArray(size)) {
                height = size[0] ?? 20;
                diameter = size[1] ?? 10;
            } else if (typeof size === 'number') {
                height = size * 2;
                diameter = size;
            } else if (size && typeof size === 'object') {
                height = size.height ?? size.h ?? 20;
                diameter = size.diameter ?? size.d ?? 10;
                diameterTop = size.diameterTop;
                diameterBottom = size.diameterBottom;
            }
            const cylOpts = { height, diameter, tessellation: 24 };
            if (diameterTop !== undefined) cylOpts.diameterTop = diameterTop;
            if (diameterBottom !== undefined) cylOpts.diameterBottom = diameterBottom;
            mesh = B.MeshBuilder.CreateCylinder(name, cylOpts, targetScene);
        } else if (shape === 'plane') {
            let width = 10, height = 10;
            if (Array.isArray(size)) {
                width = size[0] ?? 10;
                height = size[1] ?? size[0] ?? 10;
            } else if (typeof size === 'number') {
                width = height = size;
            } else if (size && typeof size === 'object') {
                width = size.width ?? size.size ?? 10;
                height = size.height ?? size.size ?? 10;
            }
            mesh = B.MeshBuilder.CreatePlane(name, { width, height }, targetScene);
        }

        if (mesh) {
            this.mesh = mesh;
            this._ownsMesh = true;

            const colorVal = options.color !== undefined ? options.color : this.color;
            if (colorVal !== null && colorVal !== undefined && B.StandardMaterial) {
                const mat = new B.StandardMaterial(`${name}_mat`, targetScene);
                const col3 = parseBabylonColor(colorVal, B);
                if (col3) {
                    mat.diffuseColor = col3;
                    if (B.Color3) mat.emissiveColor = new B.Color3(0.08, 0.08, 0.08);
                }
                mat.wireframe = Boolean(options.wireframe !== undefined ? options.wireframe : this.wireframe);
                mat.alpha = options.alpha !== undefined ? options.alpha : this.alpha;
                mesh.material = mat;
                this.material = mat;
            }

            mesh.isVisible = this.visible;
            if ('visibility' in mesh) {
                mesh.visibility = this.visible ? this.alpha : 0;
            }

            if (this.actor) {
                this.actor.mesh = mesh;
                this.syncTransformToMesh();
            }

            // Register with World3D toon pipeline if available
            if (typeof World3D !== 'undefined' && (/** @type {any} */ (World3D)).view && typeof (/** @type {any} */ (World3D)).addObject === 'function') {
                try {
                    (/** @type {any} */ (World3D)).addObject((/** @type {any} */ (World3D)).view, mesh, 'actor');
                } catch {
                    // Safe ignore in unit test/headless setups
                }
            }
        }

        return mesh;
    }

    /**
     * Updates material diffuse color.
     * @param {number|string|BABYLON.Color3} color
     */
    setColor(color) {
        this.color = color;
        const B = getBabylon();
        if (this.material && B) {
            const col3 = parseBabylonColor(color, B);
            if (col3 && this.material.diffuseColor) {
                this.material.diffuseColor = col3;
            }
        }
    }

    /**
     * Control mesh visibility.
     * @param {boolean} visible
     */
    setVisibility(visible) {
        this.visible = Boolean(visible);
        if (this.mesh) {
            this.mesh.isVisible = this.visible;
            if ('visibility' in this.mesh) {
                this.mesh.visibility = this.visible ? this.alpha : 0;
            }
        }
    }

    /**
     * Control material/mesh alpha opacity.
     * @param {number} alpha - 0.0 to 1.0
     */
    setAlpha(alpha) {
        this.alpha = Math.max(0, Math.min(1, Number(alpha)));
        if (this.mesh && 'visibility' in this.mesh) {
            this.mesh.visibility = this.visible ? this.alpha : 0;
        }
        if (this.material && 'alpha' in this.material) {
            this.material.alpha = this.alpha;
        }
    }

    /**
     * Synchronize position, rotation and scale from actor to mesh.
     */
    syncTransformToMesh() {
        if (!this.mesh || !this.actor) return;

        if (this.mesh.position) {
            this.mesh.position.x = this.actor.position.x;
            this.mesh.position.y = this.actor.position.y;
            this.mesh.position.z = this.actor.position.z;
        }
        if (this.mesh.rotation) {
            this.mesh.rotation.x = this.actor.rotation.x;
            this.mesh.rotation.y = this.actor.rotation.y;
            this.mesh.rotation.z = this.actor.rotation.z;
        }
        if (this.mesh.scaling) {
            this.mesh.scaling.x = this.actor.scale.x;
            this.mesh.scaling.y = this.actor.scale.y;
            this.mesh.scaling.z = this.actor.scale.z;
        }
    }

    /**
     * Synchronize position, rotation and scale from mesh back to actor.
     */
    syncTransformFromMesh() {
        if (!this.mesh || !this.actor) return;

        if (this.mesh.position) {
            this.actor.position.x = this.mesh.position.x;
            this.actor.position.y = this.mesh.position.y;
            this.actor.position.z = this.mesh.position.z;
        }
        if (this.mesh.rotation) {
            this.actor.rotation.x = this.mesh.rotation.x;
            this.actor.rotation.y = this.mesh.rotation.y;
            this.actor.rotation.z = this.mesh.rotation.z;
        }
        if (this.mesh.scaling) {
            this.actor.scale.x = this.mesh.scaling.x;
            this.actor.scale.y = this.mesh.scaling.y;
            this.actor.scale.z = this.mesh.scaling.z;
        }
    }

    /**
     * @override
     * @param {ArcActor} actor
     */
    onAttach(actor) {
        super.onAttach(actor);

        if (!this.mesh && actor.mesh) {
            this.mesh = actor.mesh;
        }

        if (!this.mesh && this.shape) {
            this.createProceduralMesh({ shape: this.shape, size: this.size, color: this.color }, actor.scene);
        }

        if (this.mesh) {
            actor.mesh = this.mesh;
            this.syncTransformToMesh();
        }
    }

    /**
     * @override
     * @param {number} dt
     */
    onUpdate(dt) {
        if (this.mesh && this.actor) {
            this.syncTransformToMesh();
        }
    }

    /**
     * @override
     */
    onDetach() {
        if (this.actor && this.actor.mesh === this.mesh) {
            this.actor.mesh = null;
        }
        super.onDetach();
    }

    /**
     * @override
     */
    onDestroy() {
        if (this.mesh && this._ownsMesh && typeof this.mesh.dispose === 'function') {
            try {
                if (!this.mesh.isDisposed || !this.mesh.isDisposed()) {
                    this.mesh.dispose();
                }
            } catch { /* ignored */ }
        }
        if (this.material && this._ownsMesh && typeof this.material.dispose === 'function') {
            try {
                if (!this.material.isDisposed || !this.material.isDisposed()) {
                    this.material.dispose();
                }
            } catch { /* ignored */ }
        }
        this.mesh = null;
        this.material = null;
        super.onDestroy();
    }

    /**
     * @override
     * @returns {Record<string, any>}
     */
    toJSON() {
        return {
            type: this.name,
            shape: this.shape,
            size: this.size,
            color: this.color,
            visible: this.visible,
            alpha: this.alpha,
            hasMesh: Boolean(this.mesh)
        };
    }
}

/**
 * SoundEmitterComponent: spatial procedural sound emitter integrating with ProceduralAudio.
 */
class SoundEmitterComponent extends ArcComponent {
    /**
     * @param {SoundEmitterComponentOptions} [options]
     */
    constructor(options = {}) {
        super('SoundEmitter');

        this.refDistance = typeof options.refDistance === 'number' ? options.refDistance : 100;
        this.maxDistance = typeof options.maxDistance === 'number' ? options.maxDistance : 4096;
        this.rolloff = typeof options.rolloff === 'number' ? options.rolloff : 1.2;
        this.volume = typeof options.volume === 'number' ? options.volume : 1.0;
    }

    /**
     * Current 3D spatial position coordinates for audio panning.
     * @returns {Vector3Like}
     */
    getSpatialPosition() {
        if (this.actor && this.actor.position) {
            return {
                x: Number(this.actor.position.x || 0),
                y: Number(this.actor.position.y || 0),
                z: Number(this.actor.position.z || 0)
            };
        }
        return { x: 0, y: 0, z: 0 };
    }

    /**
     * Trigger weapon audio at the actor's current 3D position.
     * @param {string} caliber - 'heavy_kinetic' | 'shotgun_shell' | 'light_kinetic' | 'energy_cell' | etc.
     * @param {boolean} [isPlayer=false]
     * @param {number|string} [tier=2]
     * @returns {any}
     */
    playWeapon(caliber, isPlayer = false, tier = 2) {
        const audio = getProceduralAudio();
        if (audio && audio.weapon && typeof audio.weapon.play === 'function') {
            return audio.weapon.play(caliber, this.getSpatialPosition(), isPlayer, tier);
        }
        return null;
    }

    /**
     * Trigger impact audio at the actor's current 3D position.
     * @param {string} [surfaceType='concrete'] - 'concrete' | 'metal' | 'dirt'
     * @returns {any}
     */
    playImpact(surfaceType = 'concrete') {
        const audio = getProceduralAudio();
        if (audio && audio.combat && typeof audio.combat.playImpact === 'function') {
            return audio.combat.playImpact(surfaceType, this.getSpatialPosition());
        }
        return null;
    }

    /**
     * Trigger ARC machine vocalization or action sound at the actor's position.
     * @param {string} soundType - e.g. 'cricketChitter', 'cricketLeapCharge', 'screamerScream', 'spotterSiren'
     * @returns {any}
     */
    playArcSound(soundType) {
        const audio = getProceduralAudio();
        if (!audio || !audio.arc) return null;

        const normalized = soundType.startsWith('play')
            ? soundType
            : `play${soundType.charAt(0).toUpperCase()}${soundType.slice(1)}`;

        if (typeof audio.arc[normalized] === 'function') {
            return audio.arc[normalized](this.getSpatialPosition());
        }
        if (typeof audio.arc[soundType] === 'function') {
            return audio.arc[soundType](this.getSpatialPosition());
        }
        return null;
    }

    /**
     * Trigger foley/movement sound at actor's position.
     * @param {'footstep'|'land'|'jump'|'gear'} [action='footstep']
     * @param {string} [surface='concrete']
     * @param {Object} [options]
     * @returns {any}
     */
    playFoley(action = 'footstep', surface = 'concrete', options = {}) {
        const audio = getProceduralAudio();
        if (!audio || !audio.foley) return null;

        const opts = { ...options, position: this.getSpatialPosition() };
        if (action === 'footstep' && typeof audio.foley.playFootstep === 'function') {
            return audio.foley.playFootstep(surface, opts);
        }
        if (action === 'land' && typeof audio.foley.playJumpLand === 'function') {
            return audio.foley.playJumpLand(surface, opts);
        }
        if (action === 'jump' && typeof audio.foley.playJumpLaunch === 'function') {
            return audio.foley.playJumpLaunch(opts);
        }
        if (action === 'gear' && typeof audio.foley.playGearRustle === 'function') {
            return audio.foley.playGearRustle(opts);
        }
        return null;
    }

    /**
     * Generic audio trigger routing to ProceduralAudio submodules with spatial positioning.
     * @param {string} category - 'weapon' | 'combat' | 'foley' | 'arc'
     * @param {string} soundName - Method name on category proxy
     * @param {...any} args
     * @returns {any}
     */
    play(category, soundName, ...args) {
        const audio = getProceduralAudio();
        if (audio && audio[category] && typeof audio[category][soundName] === 'function') {
            return audio[category][soundName](...args, this.getSpatialPosition());
        }
        return null;
    }

    /**
     * @override
     * @returns {Record<string, any>}
     */
    toJSON() {
        return {
            type: this.name,
            volume: this.volume,
            refDistance: this.refDistance,
            maxDistance: this.maxDistance,
            rolloff: this.rolloff
        };
    }
}

// ============================================================================
//  3. ArcActor Class
// ============================================================================

let _nextActorId = 1;

/**
 * Entity container in the Entity-Component architecture.
 */
class ArcActor {
    /**
     * @param {ActorDefinition} [options]
     */
    constructor(options = {}) {
        /** @type {string} Unique actor identifier */
        this.id = options.id || `actor_${_nextActorId++}`;
        /** @type {string} Human-readable actor name */
        this.name = options.name || this.id;
        /** @type {Set<string>} Classification and query tags */
        this.tags = new Set();
        if (Array.isArray(options.tags)) {
            for (const t of options.tags) if (t) this.tags.add(String(t));
        } else if (options.tags instanceof Set) {
            for (const t of options.tags) if (t) this.tags.add(String(t));
        }

        /** @type {Vector3Like} World position */
        this.position = { x: 0, y: 0, z: 0 };
        /** @type {Vector3Like} Euler rotation angles (radians) */
        this.rotation = { x: 0, y: 0, z: 0 };
        /** @type {Vector3Like} 3D scale factors */
        this.scale = { x: 1, y: 1, z: 1 };

        if (options.position) this.setPosition(options.position);
        if (options.rotation) this.setRotation(options.rotation);
        if (options.scale) this.setScale(options.scale);

        /** @type {BABYLON.Mesh | any | null} Attached visual mesh */
        this.mesh = options.mesh || null;
        /** @type {BABYLON.Scene | any | null} Active Babylon.js scene */
        this.scene = options.scene || null;
        /** @type {boolean} Active simulation state */
        this.active = options.active !== undefined ? Boolean(options.active) : true;
        /** @type {boolean} Whether actor has been disposed */
        this.destroyed = false;
        /** @type {boolean} Whether actor has been disposed */
        this.isDestroyed = false;

        /** @type {Map<string, ArcComponent>} Component storage */
        this.components = new Map();
        /** @type {Map<string, Set<Function>>} Event listener storage */
        this._listeners = new Map();

        if (this.mesh) {
            this._syncMesh();
        }
    }

    // =========================================================================
    //  Component Management
    // =========================================================================

    /**
     * Add and attach a component to this actor.
     * @param {ArcComponent|Object} component - Instance or component descriptor.
     * @returns {ArcComponent} The attached component instance.
     */
    addComponent(component) {
        if (!component) {
            throw new Error('ArcActor.addComponent: invalid null or undefined component');
        }

        /** @type {ArcComponent} */
        let compInstance;

        if (component instanceof ArcComponent) {
            compInstance = component;
        } else if (typeof component === 'object') {
            const compDef = /** @type {any} */ (component);
            const typeName = compDef.type || compDef.name || compDef.component;
            const CompClass = ArcActor.getRegisteredComponent(typeName);
            if (CompClass) {
                compInstance = new CompClass(compDef);
            } else {
                // Fallback: create generic ArcComponent wrapping properties
                compInstance = new ArcComponent(typeName || 'CustomComponent');
                Object.assign(compInstance, compDef);
            }
        } else {
            throw new Error('ArcActor.addComponent: component must be an ArcComponent or configuration object');
        }

        // If a component with the same name already exists, detach it first
        if (this.components.has(compInstance.name)) {
            this.removeComponent(compInstance.name);
        }

        this.components.set(compInstance.name, compInstance);

        try {
            compInstance.onAttach(this);
        } catch (err) {
            console.error(`ArcActor: error in onAttach for component '${compInstance.name}'`, err);
        }

        if (compInstance instanceof MeshComponent && compInstance.mesh) {
            this.mesh = compInstance.mesh;
        }

        return compInstance;
    }

    /**
     * Retrieve a component by name (case-insensitive, with/without 'Component' suffix) or class constructor.
     * @template {ArcComponent} [T=ArcComponent]
     * @param {string | (new (...args: any[]) => T) | Function} nameOrClass
     * @returns {T | ArcComponent | null}
     */
    getComponent(nameOrClass) {
        if (!nameOrClass) return null;

        // Lookup by class constructor
        if (typeof nameOrClass === 'function') {
            for (const comp of this.components.values()) {
                if (comp instanceof nameOrClass || comp.constructor === nameOrClass) {
                    return /** @type {T} */ (comp);
                }
            }
            return null;
        }

        const query = String(nameOrClass);
        // Direct key lookup
        if (this.components.has(query)) {
            return this.components.get(query) || null;
        }

        // Fuzzy match: case-insensitive with or without 'Component' suffix
        const lower = query.toLowerCase();
        const cleanLower = lower.endsWith('component') ? lower.slice(0, -9) : lower;

        for (const [key, comp] of this.components.entries()) {
            const kLower = key.toLowerCase();
            const kClean = kLower.endsWith('component') ? kLower.slice(0, -9) : kLower;
            if (kLower === lower || kClean === cleanLower) {
                return comp;
            }
            if (comp.name) {
                const cLower = comp.name.toLowerCase();
                const cClean = cLower.endsWith('component') ? cLower.slice(0, -9) : cLower;
                if (cLower === lower || cClean === cleanLower) {
                    return comp;
                }
            }
        }

        return null;
    }

    /**
     * Check if actor has a specific component.
     * @param {string | Function} nameOrClass
     * @returns {boolean}
     */
    hasComponent(nameOrClass) {
        return this.getComponent(/** @type {any} */ (nameOrClass)) !== null;
    }

    /**
     * Remove and detach a component from this actor.
     * @param {string | Function} nameOrClass
     * @returns {boolean} True if component was found and removed.
     */
    removeComponent(nameOrClass) {
        const comp = this.getComponent(/** @type {any} */ (nameOrClass));
        if (!comp) return false;

        try {
            if (typeof comp.onDetach === 'function') comp.onDetach();
        } catch (err) {
            console.error(`ArcActor: error in onDetach for component '${comp.name}'`, err);
        }

        try {
            if (typeof comp.onDestroy === 'function') comp.onDestroy();
        } catch (err) {
            console.error(`ArcActor: error in onDestroy for component '${comp.name}'`, err);
        }

        for (const [key, val] of this.components.entries()) {
            if (val === comp) {
                this.components.delete(key);
                break;
            }
        }

        if (this.mesh && comp instanceof MeshComponent && this.mesh === comp.mesh) {
            this.mesh = null;
        }

        return true;
    }

    // =========================================================================
    //  Tag Management
    // =========================================================================

    /**
     * Add a classification tag.
     * @param {string} tag
     * @returns {this}
     */
    addTag(tag) {
        if (tag) this.tags.add(String(tag));
        return this;
    }

    /**
     * Check if actor possesses a tag.
     * @param {string} tag
     * @returns {boolean}
     */
    hasTag(tag) {
        return this.tags.has(String(tag));
    }

    /**
     * Remove a classification tag.
     * @param {string} tag
     * @returns {boolean} True if tag was removed.
     */
    removeTag(tag) {
        return this.tags.delete(String(tag));
    }

    /**
     * Retrieve all tags as an array.
     * @returns {string[]}
     */
    getTags() {
        return Array.from(this.tags);
    }

    // =========================================================================
    //  Transform Management
    // =========================================================================

    /**
     * Set world position. Accepts (x, y, z), [x, y, z], or {x, y, z}.
     * @param {number|Vector3Like|[number, number, number]} x
     * @param {number} [y]
     * @param {number} [z]
     * @returns {this}
     */
    setPosition(x, y, z) {
        let nx = 0, ny = 0, nz = 0;

        if (Array.isArray(x)) {
            nx = x[0] ?? 0;
            ny = x[1] ?? 0;
            nz = x[2] ?? 0;
        } else if (x && typeof x === 'object') {
            nx = x.x ?? 0;
            ny = x.y ?? 0;
            nz = x.z ?? 0;
        } else {
            nx = typeof x === 'number' ? x : 0;
            ny = typeof y === 'number' ? y : 0;
            nz = typeof z === 'number' ? z : 0;
        }

        this.position.x = Number(nx);
        this.position.y = Number(ny);
        this.position.z = Number(nz);

        this._syncMeshPosition();
        return this;
    }

    /**
     * Set Euler rotation angles in radians. Accepts (x, y, z), [x, y, z], or {x, y, z}.
     * @param {number|Vector3Like|[number, number, number]} x
     * @param {number} [y]
     * @param {number} [z]
     * @returns {this}
     */
    setRotation(x, y, z) {
        let nx = 0, ny = 0, nz = 0;

        if (Array.isArray(x)) {
            nx = x[0] ?? 0;
            ny = x[1] ?? 0;
            nz = x[2] ?? 0;
        } else if (x && typeof x === 'object') {
            nx = x.x ?? 0;
            ny = x.y ?? 0;
            nz = x.z ?? 0;
        } else {
            nx = typeof x === 'number' ? x : 0;
            ny = typeof y === 'number' ? y : 0;
            nz = typeof z === 'number' ? z : 0;
        }

        this.rotation.x = Number(nx);
        this.rotation.y = Number(ny);
        this.rotation.z = Number(nz);

        this._syncMeshRotation();
        return this;
    }

    /**
     * Set 3D scale factors. Accepts uniform number (s), (x, y, z), [x, y, z], or {x, y, z}.
     * @param {number|Vector3Like|[number, number, number]} x
     * @param {number} [y]
     * @param {number} [z]
     * @returns {this}
     */
    setScale(x, y, z) {
        let nx = 1, ny = 1, nz = 1;

        if (typeof x === 'number' && y === undefined && z === undefined) {
            nx = ny = nz = x;
        } else if (Array.isArray(x)) {
            nx = x[0] ?? 1;
            ny = x[1] ?? 1;
            nz = x[2] ?? 1;
        } else if (x && typeof x === 'object') {
            nx = x.x ?? 1;
            ny = x.y ?? 1;
            nz = x.z ?? 1;
        } else {
            nx = typeof x === 'number' ? x : 1;
            ny = typeof y === 'number' ? y : 1;
            nz = typeof z === 'number' ? z : 1;
        }

        this.scale.x = Number(nx);
        this.scale.y = Number(ny);
        this.scale.z = Number(nz);

        this._syncMeshScale();
        return this;
    }

    _syncMesh() {
        this._syncMeshPosition();
        this._syncMeshRotation();
        this._syncMeshScale();
    }

    _syncMeshPosition() {
        if (this.mesh && this.mesh.position) {
            this.mesh.position.x = this.position.x;
            this.mesh.position.y = this.position.y;
            this.mesh.position.z = this.position.z;
        }
    }

    _syncMeshRotation() {
        if (this.mesh && this.mesh.rotation) {
            this.mesh.rotation.x = this.rotation.x;
            this.mesh.rotation.y = this.rotation.y;
            this.mesh.rotation.z = this.rotation.z;
        }
    }

    _syncMeshScale() {
        if (this.mesh && this.mesh.scaling) {
            this.mesh.scaling.x = this.scale.x;
            this.mesh.scaling.y = this.scale.y;
            this.mesh.scaling.z = this.scale.z;
        }
    }

    // =========================================================================
    //  Event System
    // =========================================================================

    /**
     * Register an event listener callback.
     * @param {string} event
     * @param {Function} callback
     * @returns {() => void} Unsubscribe function.
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Remove an event listener callback.
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        const set = this._listeners.get(event);
        if (set) {
            set.delete(callback);
            if (set.size === 0) {
                this._listeners.delete(event);
            }
        }
    }

    /**
     * Dispatch an event to registered listeners.
     * @param {string} event
     * @param {...any} args
     */
    emit(event, ...args) {
        const set = this._listeners.get(event);
        if (!set) return;
        for (const callback of set) {
            try {
                callback(...args);
            } catch (err) {
                console.error(`ArcActor: error in event handler for '${event}'`, err);
            }
        }
    }

    // =========================================================================
    //  Simulation & Lifecycle
    // =========================================================================

    /**
     * Advance simulation tick for all active components.
     * @param {number} dt - Delta time in seconds.
     */
    update(dt) {
        if (!this.active || this.isDestroyed) return;

        for (const component of this.components.values()) {
            if (component && component.enabled && typeof component.onUpdate === 'function') {
                try {
                    component.onUpdate(dt);
                } catch (err) {
                    console.error(`ArcActor: error updating component '${component.name}'`, err);
                }
            }
        }
    }

    /**
     * Detaches and destroys all components, disposes attached mesh, and emits 'destroy'.
     */
    destroy() {
        if (this.isDestroyed) return;

        this.emit('destroy', this);

        for (const component of Array.from(this.components.values())) {
            try {
                if (typeof component.onDestroy === 'function') component.onDestroy();
                if (typeof component.onDetach === 'function') component.onDetach();
            } catch (err) {
                console.error(`ArcActor: error destroying component '${component.name}'`, err);
            }
        }
        this.components.clear();

        if (this.mesh) {
            try {
                if (typeof this.mesh.dispose === 'function' && (!this.mesh.isDisposed || !this.mesh.isDisposed())) {
                    this.mesh.dispose();
                }
            } catch { /* ignored */ }
            this.mesh = null;
        }

        this.active = false;
        this.destroyed = true;
        this.isDestroyed = true;
        this._listeners.clear();
    }

    /**
     * Clean serializable representation for AI introspection and state snapshots.
     * @returns {Record<string, any>}
     */
    toJSON() {
        /** @type {Record<string, any>} */
        const componentsObj = {};
        for (const [key, comp] of this.components.entries()) {
            if (comp && typeof comp.toJSON === 'function') {
                componentsObj[key] = comp.toJSON();
            } else if (comp) {
                componentsObj[key] = { type: comp.name || key };
            }
        }

        return {
            id: this.id,
            name: this.name,
            active: this.active,
            tags: Array.from(this.tags),
            position: [this.position.x, this.position.y, this.position.z],
            rotation: [this.rotation.x, this.rotation.y, this.rotation.z],
            scale: [this.scale.x, this.scale.y, this.scale.z],
            components: componentsObj
        };
    }

    // =========================================================================
    //  4. Declarative Factory & Registry
    // =========================================================================

    /**
     * Declarative factory method to instantiate an actor from a plain JS/JSON definition.
     * @param {ActorDefinition} [definition]
     * @param {BABYLON.Scene | any} [scene]
     * @returns {ArcActor}
     */
    static create(definition = {}, scene = null) {
        const actor = new ArcActor({
            id: definition.id,
            name: definition.name,
            tags: definition.tags,
            position: definition.position,
            rotation: definition.rotation,
            scale: definition.scale,
            mesh: definition.mesh,
            active: definition.active !== undefined ? definition.active : true,
            scene: scene || definition.scene || null
        });

        if (Array.isArray(definition.components)) {
            for (const compDef of definition.components) {
                if (!compDef) continue;
                if (compDef instanceof ArcComponent) {
                    actor.addComponent(compDef);
                } else if (typeof compDef === 'object') {
                    const type = (/** @type {any} */ (compDef)).type ||
                        (/** @type {any} */ (compDef)).name ||
                        (/** @type {any} */ (compDef)).component;
                    const CompClass = ArcActor.getRegisteredComponent(type);
                    if (CompClass) {
                        const instance = new CompClass(compDef);
                        actor.addComponent(instance);
                    } else {
                        console.warn(`ArcActor.create: unknown component type '${type}'`);
                    }
                }
            }
        }

        return actor;
    }

    /**
     * Register a custom component class for declarative instantiation via ArcActor.create.
     * @param {string} typeName
     * @param {new (...args: any[]) => ArcComponent} componentClass
     */
    static registerComponent(typeName, componentClass) {
        if (!typeName || !componentClass) return;
        ArcActor._registry.set(typeName.toLowerCase(), componentClass);
    }

    /**
     * Retrieve a registered component class by type name.
     * @param {string} typeName
     * @returns {(new (...args: any[]) => ArcComponent) | null}
     */
    static getRegisteredComponent(typeName) {
        if (!typeName) return null;
        return ArcActor._registry.get(String(typeName).toLowerCase()) || null;
    }
}

/** @type {Map<string, new (...args: any[]) => ArcComponent>} */
ArcActor._registry = new Map();

// Register standard built-in components
ArcActor.registerComponent('Health', HealthComponent);
ArcActor.registerComponent('HealthComponent', HealthComponent);
ArcActor.registerComponent('Collider', ColliderComponent);
ArcActor.registerComponent('ColliderComponent', ColliderComponent);
ArcActor.registerComponent('Mesh', MeshComponent);
ArcActor.registerComponent('MeshComponent', MeshComponent);
ArcActor.registerComponent('SoundEmitter', SoundEmitterComponent);
ArcActor.registerComponent('SoundEmitterComponent', SoundEmitterComponent);

// Expose constructors on ArcActor for direct access
/** @type {any} */ (ArcActor).ArcComponent = ArcComponent;
/** @type {any} */ (ArcActor).HealthComponent = HealthComponent;
/** @type {any} */ (ArcActor).ColliderComponent = ColliderComponent;
/** @type {any} */ (ArcActor).MeshComponent = MeshComponent;
/** @type {any} */ (ArcActor).SoundEmitterComponent = SoundEmitterComponent;

// ============================================================================
//  5. Universal Exports
// ============================================================================

if (typeof window !== 'undefined') {
    /** @type {any} */ (window).ArcActor = ArcActor;
    /** @type {any} */ (window).ArcComponent = ArcComponent;
    /** @type {any} */ (window).HealthComponent = HealthComponent;
    /** @type {any} */ (window).ColliderComponent = ColliderComponent;
    /** @type {any} */ (window).MeshComponent = MeshComponent;
    /** @type {any} */ (window).SoundEmitterComponent = SoundEmitterComponent;
}

if (typeof globalThis !== 'undefined') {
    /** @type {any} */ (globalThis).ArcActor = ArcActor;
    /** @type {any} */ (globalThis).ArcComponent = ArcComponent;
    /** @type {any} */ (globalThis).HealthComponent = HealthComponent;
    /** @type {any} */ (globalThis).ColliderComponent = ColliderComponent;
    /** @type {any} */ (globalThis).MeshComponent = MeshComponent;
    /** @type {any} */ (globalThis).SoundEmitterComponent = SoundEmitterComponent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ArcActor,
        ArcComponent,
        HealthComponent,
        ColliderComponent,
        MeshComponent,
        SoundEmitterComponent,
        default: ArcActor
    };
}


