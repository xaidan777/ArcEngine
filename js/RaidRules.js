// Pure gameplay rules. No renderer, input devices, UI or storage dependencies.
/** @satisfies {Record<string, any>} */
const RaidRules = {
    canAct(state) {
        return state.phase === 'raid' && !state.paused && state.player.hp > 0;
    },

    busy(state) {
        return state.reloadTimer > 0 || state.healTimer > 0 || state.searchTimer > 0 || (state.useItemTimer > 0);
    },

    movement(keys, touch) {
        const fKey = (typeof KeyBindings !== 'undefined') ? KeyBindings.get('moveForward') : 'KeyW';
        const bKey = (typeof KeyBindings !== 'undefined') ? KeyBindings.get('moveBackward') : 'KeyS';
        const rKey = (typeof KeyBindings !== 'undefined') ? KeyBindings.get('moveRight') : 'KeyD';
        const lKey = (typeof KeyBindings !== 'undefined') ? KeyBindings.get('moveLeft') : 'KeyA';
        let forward = Number(keys.has(fKey) || keys.has('KeyW')) - Number(keys.has(bKey) || keys.has('KeyS'));
        let right = Number(keys.has(rKey) || keys.has('KeyD')) - Number(keys.has(lKey) || keys.has('KeyA'));
        if (touch.id != null) {
            forward -= ShooterRules.clamp((touch.y - touch.startY) / 55, -1, 1);
            right += ShooterRules.clamp((touch.x - touch.startX) / 55, -1, 1);
        }
        return { forward, right, moving: Math.hypot(forward, right) > 0.05 };
    },

    // Exhaustion has hysteresis: holding sprint cannot alternate run/walk every tick.
    tickStamina(state, wantsSprint, dt, config) {
        const step = Math.max(0, dt);
        const sprinting = wantsSprint && !state.exhausted && state.value > 0;
        if (sprinting) {
            state.value = Math.max(0, state.value - config.drain * step);
            state.delay = config.delay;
            if (state.value <= 0) state.exhausted = true;
        } else {
            const recovering = Math.max(0, step - state.delay);
            state.delay = Math.max(0, state.delay - step);
            state.value = Math.min(config.max, state.value + config.regen * recovering);
            if (state.value >= config.restart) state.exhausted = false;
        }
        return sprinting;
    },

    movePlayer(player, input, sprinting, dt, config, blockers, bounds) {
        const { forward, right, heading } = input;
        const dir = ShooterRules.normalize(Math.cos(heading) * forward - Math.sin(heading) * right,
            Math.sin(heading) * forward + Math.cos(heading) * right);
        const scale = forward < 0 ? 0.85 : right && !forward ? 0.92 : 1;
        const postureMult = config.postureSpeedMult != null ? config.postureSpeedMult : 1.0;
        const speed = config.speed * scale * (sprinting ? 1.35 : 1) * postureMult;
        const moved = ShooterRules.resolveCircleMovement(player, { x: dir.x * speed * dt, y: dir.y * speed * dt }, config.radius, blockers);
        player.x = ShooterRules.clamp(moved.x, 50, bounds.width - 50);
        player.y = ShooterRules.clamp(moved.y, 50, bounds.height - 50);
    },

    /**
     * Tactical movement posture modifiers (stand, crouch, prone).
     * @param {'stand'|'crouch'|'prone'|string} [posture='stand']
     * @returns {{ id: string, eyeHeight: number, speedMult: number, noiseMult: number, spreadMult: number, recoilMult: number }}
     */
    getPostureModifiers(posture = 'stand') {
        if (typeof POSTURE_CROUCH !== 'undefined' && posture === 'crouch') return POSTURE_CROUCH;
        if (typeof POSTURE_PRONE !== 'undefined' && posture === 'prone') return POSTURE_PRONE;
        if (typeof POSTURE_STAND !== 'undefined') return POSTURE_STAND;
        return { id: 'stand', eyeHeight: 64, speedMult: 1.00, noiseMult: 1.00, spreadMult: 1.00, recoilMult: 1.00 };
    },

    /**
     * Whether a container can be searched from where the player stands.
     *
     * Reach is measured from the two COLLISION EDGES, not centre to centre: a crate has its own
     * radius and the operator occupies one too, so a centre-to-centre test made a crate
     * unsearchable whenever the interact range was smaller than crate radius + player radius —
     * the player physically cannot stand that close. Measured before this change: 0 of the 149
     * standing positions inside `GAME_INTERACT_RANGE` of a crate could start a search.
     *
     * Line of sight ignores the container itself: a crate that the player is standing at is in
     * its own cover set, and testing against it reported "no line of sight" to the very box
     * being searched.
     *
     * @param {{x: number, y: number, radius?: number}} player
     * @param {any} box container record; `radius` is its collision footprint
     * @param {Array<{x: number, y: number, radius?: number}>} [blockers] full cover set
     * @param {number} [range] reach between the two collision edges, px
     * @returns {boolean}
     */
    canSearch(player, box, blockers = [], range = 0) {
        if (!box || box.opened) return false;
        const reach = Math.max(0, Number(range) || 0) + (Math.max(0, Number(box.radius) || 0));
        if (ShooterRules.distanceSq(player, box) > reach * reach) return false;
        const cover = [];
        for (const blocker of blockers) {
            if (blocker === box) continue;                                   // never its own occluder
            if (Math.abs(blocker.x - box.x) < 1e-6 && Math.abs(blocker.y - box.y) < 1e-6) continue;  // same spawn
            cover.push(blocker);
        }
        return ShooterRules.hasLineOfSight(player, box, cover);
    },

    // Resource containers retain the remainder, including when the player is full.
    transferResource(current, available, capacity) {
        const moved = Math.max(0, Math.min(available, capacity - current));
        return { current: current + moved, remaining: available - moved, moved };
    },

    hear(enemy, source, radius) {
        if (enemy.dead || enemy.dormant || ShooterRules.distanceSq(enemy, source) > radius * radius) return false;
        if (enemy.state === 'patrol' || enemy.state === 'investigate') {
            enemy.state = 'investigate';
            enemy.alert = Math.max(enemy.alert, 1);
            enemy.lastX = source.x;
            enemy.lastY = source.y;
        }
        return true;
    },

    // --- ARC RAIDERS MODULAR ENGINE LOGIC ---

    getItemDef(itemIdOrDef) {
        if (!itemIdOrDef) return null;
        if (typeof itemIdOrDef === 'object') return itemIdOrDef;
        if (typeof ARC_ITEMS !== 'undefined' && ARC_ITEMS[itemIdOrDef]) {
            return ARC_ITEMS[itemIdOrDef];
        }
        return null;
    },

    getItemWeight(item) {
        if (!item) return 0;
        const w = Number(item.weight != null ? item.weight : 0);
        return Math.max(0, w);
    },

    /**
     * Calculates the total weight in kg of equipped gear, backpack and quick slots.
     * @param {Record<string, any>} loadout
     * @param {Array<any>} [backpack]
     * @returns {number}
     */
    calculateLoadoutWeight(loadout = {}, backpack = []) {
        let total = 0;
        const slotKeys = ['primary', 'secondary', 'sidearm', 'shieldCore', 'suitMod', 'gadget1', 'gadget2', 'augment'];
        for (const k of slotKeys) {
            if (loadout[k]) total += this.getItemWeight(loadout[k]);
        }
        if (Array.isArray(loadout.quickSlots)) {
            for (const it of loadout.quickSlots) {
                if (it) total += this.getItemWeight(it);
            }
        }
        if (Array.isArray(loadout.safePocket)) {
            for (const it of loadout.safePocket) {
                if (it) total += this.getItemWeight(it);
            }
        }
        if (Array.isArray(backpack)) {
            for (const it of backpack) {
                if (it) total += this.getItemWeight(it);
            }
        }
        return Math.round(total * 10) / 10;
    },

    /**
     * Returns the encumbrance tier and movement/stamina/noise multipliers.
     * @param {number} weightKg
     * @param {Record<string, any>} [augment]
     * @returns {any}
     */
    getEncumbrance(weightKg, augment = null) {
        const w = Math.max(0, Number.isFinite(weightKg) ? weightKg : 0);
        const maxW = augment && Number.isFinite(augment.maxWeight) ? augment.maxWeight : (typeof GAME_WEIGHT_HEAVY_MAX !== 'undefined' ? GAME_WEIGHT_HEAVY_MAX : 40.0);
        const lightThreshold = augment ? maxW * 0.375 : (typeof GAME_WEIGHT_LIGHT_MAX !== 'undefined' ? GAME_WEIGHT_LIGHT_MAX : 15.0);
        const mediumThreshold = augment ? maxW * 0.75 : (typeof GAME_WEIGHT_MEDIUM_MAX !== 'undefined' ? GAME_WEIGHT_MEDIUM_MAX : 30.0);
        const heavyThreshold = maxW;

        const tiers = typeof ARC_ENCUMBRANCE_TIERS !== 'undefined' ? ARC_ENCUMBRANCE_TIERS : {
            LIGHT: { id: 'light', maxWeight: lightThreshold, speedMult: 1.05, sprintMult: 1.05, staminaDrainMult: 0.85, staminaRegenMult: 1.15, noiseMult: 0.7, jumpBlocked: false, grappleBlocked: false, sprintBlocked: false },
            MEDIUM: { id: 'medium', maxWeight: mediumThreshold, speedMult: 1.00, sprintMult: 1.00, staminaDrainMult: 1.00, staminaRegenMult: 1.00, noiseMult: 1.0, jumpBlocked: false, grappleBlocked: false, sprintBlocked: false },
            HEAVY: { id: 'heavy', maxWeight: heavyThreshold, speedMult: 0.88, sprintMult: 0.85, staminaDrainMult: 1.30, staminaRegenMult: 0.70, noiseMult: 1.4, jumpBlocked: false, grappleBlocked: false, sprintBlocked: false },
            OVERENCUMBERED: { id: 'overencumbered', maxWeight: Infinity, speedMult: 0.50, sprintMult: 0.50, staminaDrainMult: 2.00, staminaRegenMult: 0.35, noiseMult: 1.8, jumpBlocked: true, grappleBlocked: true, sprintBlocked: true },
        };

        let result;
        if (w <= lightThreshold) result = Object.assign({}, tiers.LIGHT);
        else if (w <= mediumThreshold) result = Object.assign({}, tiers.MEDIUM);
        else if (w <= heavyThreshold) result = Object.assign({}, tiers.HEAVY);
        else result = Object.assign({}, tiers.OVERENCUMBERED);

        if (augment) {
            if (augment.noiseMultiplier) result.noiseMult *= augment.noiseMultiplier;
            if (augment.sprintSpeedMultiplier) result.sprintMult *= augment.sprintSpeedMultiplier;
        }
        return result;
    },

    /**
     * Verifies if an item can be safely stored in the secure Safe Pocket.
     * Weapons, backpacks, and heavy ARC batteries are strictly prohibited.
     * @param {any} item
     * @returns {boolean}
     */
    canPlaceInSafePocket(item) {
        if (!item) return false;
        if (item.category === 'weapons' || item.slotType === 'primary' || item.slotType === 'secondary' || item.slotType === 'sidearm') {
            return false;
        }
        if (item.category === 'armor' && item.slotType === 'shieldCore') {
            return false;
        }
        if (item.slotType === 'backpack') {
            return false;
        }
        if (item.safePocketBlacklist === true || item.id === 'arc_battery') {
            return false;
        }
        return true;
    },

    /**
     * Pre-raid deployment validation check.
     * @param {Record<string, any>} loadout
     * @param {Array<any>} [backpack]
     * @returns {{ valid: boolean, errors: string[], weight?: number }}
     */
    validatePreRaid(loadout = {}, backpack = []) {
        const errors = [];
        const hasWeapon = !!(loadout.primary || loadout.secondary || loadout.sidearm);
        if (!hasWeapon) {
            errors.push('No weapon equipped. Primary or sidearm required.');
        }

        const totalWeight = this.calculateLoadoutWeight(loadout, backpack);
        const maxDeployWeight = loadout.augment && Number.isFinite(loadout.augment.maxWeight)
            ? loadout.augment.maxWeight
            : (typeof GAME_WEIGHT_HEAVY_MAX !== 'undefined' ? GAME_WEIGHT_HEAVY_MAX : 40.0);
        if (totalWeight > maxDeployWeight) {
            errors.push(`Overencumbered: ${totalWeight} kg exceeds maximum deploy limit of ${maxDeployWeight} kg.`);
        }

        return { valid: errors.length === 0, errors, weight: totalWeight };
    },

    /**
     * Layered two-tier damage application: Tactical Shield -> Health.
     * @param {{ hp: number, maxHp?: number, shield?: number, maxShield?: number }} entity
     * @param {number} amount
     * @param {{ damageType?: string, shieldPierceFraction?: number }} [options]
     * @returns {{ dealtToShield: number, dealtToHp: number, shieldBroken: boolean, isDead: boolean }}
     */
    applyDamage(entity, amount, options = {}) {
        const dmg = Math.max(0, Number(amount || 0));
        let dealtToShield = 0;
        let dealtToHp = 0;
        let shieldBroken = false;

        const currentShield = Math.max(0, entity.shield || 0);
        if (currentShield > 0) {
            const absorbed = Math.min(currentShield, dmg);
            entity.shield = currentShield - absorbed;
            dealtToShield = absorbed;
            if (entity.shield <= 0) {
                entity.shield = 0;
                shieldBroken = true;
            }
            const remainder = dmg - absorbed;
            if (remainder > 0) {
                entity.hp = Math.max(0, (entity.hp || 0) - remainder);
                dealtToHp = remainder;
            }
        } else {
            entity.hp = Math.max(0, (entity.hp || 0) - dmg);
            dealtToHp = dmg;
        }

        return {
            dealtToShield,
            dealtToHp,
            shieldBroken,
            isDead: (entity.hp || 0) <= 0
        };
    },

    /**
     * Resolves death drop protocol: items in Safe Pocket are retained;
     * all other weapons, gear, and backpack items are dropped into a death crate.
     * @param {Record<string, any>} loadout
     * @param {Array<any>} backpack
     * @returns {{ retained: any[], dropped: any[] }}
     */
    resolveDeathDrop(loadout = {}, backpack = []) {
        const retained = [];
        const dropped = [];

        // Safe pocket is never lost
        if (Array.isArray(loadout.safePocket)) {
            for (const it of loadout.safePocket) {
                if (it) retained.push(it);
            }
        }

        // Equipped items dropped on death
        const equipSlots = ['primary', 'secondary', 'sidearm', 'shieldCore', 'suitMod', 'augment', 'gadget1', 'gadget2'];
        for (const slot of equipSlots) {
            if (loadout[slot]) {
                dropped.push(loadout[slot]);
            }
        }

        if (Array.isArray(loadout.quickSlots)) {
            for (const it of loadout.quickSlots) {
                if (it) dropped.push(it);
            }
        }

        if (Array.isArray(backpack)) {
            for (const it of backpack) {
                if (it) dropped.push(it);
            }
        }

        return { retained, dropped };
    },

    /**
     * Checks if a hit on a Sentinel machine targets its weak rear power core or front armor.
     * @param {{ x: number, y: number }} hitPoint
     * @param {{ x: number, y: number, heading?: number }} sentinel
     * @returns {{ isWeakspot: boolean, isFrontArmor: boolean, multiplier: number }}
     */
    checkSentinelHitZone(hitPoint, sentinel) {
        const dx = hitPoint.x - sentinel.x;
        const dy = hitPoint.y - sentinel.y;
        const hitAngle = Math.atan2(dy, dx);
        const heading = sentinel.heading || 0;

        // Angle difference relative to heading
        let diff = Math.abs(hitAngle - heading);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

        // Rear is opposite heading (diff close to PI). The arc is authored on the machine
        // table (`rearCoreAngleDeg`), so a tuning change there moves this too.
        const rearDiff = Math.PI - diff;
        const coreHalfAngle = ((typeof ARC_MACHINE_TYPES !== 'undefined' && ARC_MACHINE_TYPES.SENTINEL
            ? ARC_MACHINE_TYPES.SENTINEL.rearCoreAngleDeg : 110) / 2) * (Math.PI / 180);

        if (rearDiff <= coreHalfAngle) {
            return { isWeakspot: true, isFrontArmor: false, multiplier: 3.0 };
        }

        // The riot plate covers the visible shield face, not half the machine. The former
        // `PI * 0.55` was a 198-degree arc, so a clean broadside hit counted as a frontal
        // plate hit and walking around the Sentinel changed nothing.
        const frontHalfAngle = (90 / 2) * (Math.PI / 180);
        if (diff <= frontHalfAngle) {
            return { isWeakspot: false, isFrontArmor: true, multiplier: 0.10 };
        }

        return { isWeakspot: false, isFrontArmor: false, multiplier: 1.0 };
    },

    /**
     * Checks if a hit on a Stalker Hound targets its exposed rear cooling spine.
     * @param {{ x: number, y: number }} hitPoint
     * @param {{ x: number, y: number, heading?: number }} stalker
     * @returns {{ isWeakspot: boolean, isFrontArmor: boolean, multiplier: number }}
     */
    checkStalkerHitZone(hitPoint, stalker) {
        const dx = hitPoint.x - stalker.x;
        const dy = hitPoint.y - stalker.y;
        const hitAngle = Math.atan2(dy, dx);
        const heading = stalker.heading || 0;

        let diff = Math.abs(hitAngle - heading);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

        const rearDiff = Math.PI - diff;
        const spineHalfAngle = (100 / 2) * (Math.PI / 180);

        if (rearDiff <= spineHalfAngle) {
            return { isWeakspot: true, isFrontArmor: false, multiplier: 1.75 };
        }
        return { isWeakspot: false, isFrontArmor: false, multiplier: 1.0 };
    },

    /**
     * Checks if a hit on a Bombard Mortar targets its rear ammo loading vent or front armor.
     * @param {{ x: number, y: number }} hitPoint
     * @param {{ x: number, y: number, heading?: number, isDeployed?: boolean }} bombard
     * @returns {{ isWeakspot: boolean, isFrontArmor: boolean, multiplier: number }}
     */
    checkBombardHitZone(hitPoint, bombard) {
        const dx = hitPoint.x - bombard.x;
        const dy = hitPoint.y - bombard.y;
        const hitAngle = Math.atan2(dy, dx);
        const heading = bombard.heading || 0;

        let diff = Math.abs(hitAngle - heading);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

        const rearDiff = Math.PI - diff;
        const ventHalfAngle = (90 / 2) * (Math.PI / 180);

        if (rearDiff <= ventHalfAngle) {
            return { isWeakspot: true, isFrontArmor: false, multiplier: 2.0 };
        }
        if (bombard.isDeployed && diff <= Math.PI * 0.45) {
            return { isWeakspot: false, isFrontArmor: true, multiplier: 0.60 };
        }
        return { isWeakspot: false, isFrontArmor: false, multiplier: 1.0 };
    },

    /**
     * Calculates tactical flanking position for an ARC unit around a target.
     * @param {{ x: number, y: number }} unit
     * @param {{ x: number, y: number }} target
     * @param {number} flankAngleRad (positive for right, negative for left)
     * @param {number} preferredDist
     * @returns {{ x: number, y: number }}
     */
    calculateFlankPosition(unit, target, flankAngleRad, preferredDist) {
        const toUnitAngle = Math.atan2(unit.y - target.y, unit.x - target.x);
        const flankAngle = toUnitAngle + flankAngleRad;
        return {
            x: target.x + Math.cos(flankAngle) * preferredDist,
            y: target.y + Math.sin(flankAngle) * preferredDist
        };
    },

    /**
     * Checks if a player wallet can afford a given price in Credits and/or ARC Cores.
     * @param {{ credits: number, arcCores?: number, tokens?: number }} wallet
     * @param {number | { price?: number, credits?: number, arcCores?: number }} price
     * @returns {boolean}
     */
    canAfford(wallet, price) {
        if (!wallet) return false;
        const crCost = typeof price === 'number' ? price : (price.price != null ? price.price : (price.credits || 0));
        const coresCost = typeof price === 'object' && price.arcCores ? price.arcCores : 0;

        const currentCr = Number(wallet.credits || 0);
        const currentCores = Number(wallet.arcCores || 0);

        return currentCr >= crCost && currentCores >= coresCost;
    },

    /**
     * Executes a purchase transaction from a trader.
     * @param {{ credits: number, arcCores?: number }} wallet
     * @param {any[]} stash
     * @param {any} itemDef
     * @param {number | { price?: number, credits?: number, arcCores?: number }} price
     * @returns {{ success: boolean, item?: any, error?: string }}
     */
    executePurchase(wallet, stash, itemDef, price) {
        if (!this.canAfford(wallet, price)) {
            return { success: false, error: 'insufficient_funds' };
        }
        const crCost = typeof price === 'number' ? price : (price.price != null ? price.price : (price.credits || 0));
        const coresCost = typeof price === 'object' && price.arcCores ? price.arcCores : 0;

        wallet.credits = (wallet.credits || 0) - crCost;
        if (coresCost > 0) {
            wallet.arcCores = Math.max(0, (wallet.arcCores || 0) - coresCost);
        }

        const boughtItem = Object.assign({}, itemDef, {
            id: 'item_' + Date.now() + '_' + Math.floor(Math.random() * 1000000)
        });
        stash.push(boughtItem);

        return { success: true, item: boughtItem };
    },

    /**
     * Quick-sells all junk materials from stash, converting them to credits.
     * Keeps high-tier cores, quantum logic drives and non-materials intact.
     * @param {any[]} stash
     * @returns {{ creditsEarned: number, junkCount: number, remainingStash: any[] }}
     */
    sellJunk(stash) {
        if (!Array.isArray(stash)) return { creditsEarned: 0, junkCount: 0, remainingStash: [] };
        let creditsEarned = 0;
        let junkCount = 0;
        const remainingStash = [];

        for (const item of stash) {
            if (!item) continue;
            // High tier cores, quest drives, and high rarity items are preserved
            const isProtected = item.type === 'core' ||
                                item.id === 'memory_core' ||
                                item.id === 'data_drive' ||
                                (item.name && item.name.toUpperCase().includes('DATA DRIVE')) ||
                                item.rarity === 'Legendary' ||
                                item.rarity === 'Epic';

            const isJunkMaterial = (item.category === 'materials' || item.type === 'scrap' || item.type === 'sensor' || item.type === 'explosive') && !isProtected;

            if (isJunkMaterial) {
                const val = Number(item.value || 50);
                creditsEarned += val;
                junkCount += Math.max(1, Number(item.count || 1));
            } else {
                remainingStash.push(item);
            }
        }

        return { creditsEarned, junkCount, remainingStash };
    },

    /**
     * Resolves the required ammunition caliber for a weapon.
     * @param {any} weapon
     * @returns {string}
     */
    getWeaponCaliber(weapon) {
        if (!weapon) return 'heavy_kinetic';
        if (weapon.caliber) return weapon.caliber;
        const name = (weapon.name || '').toUpperCase();
        if (name.includes('SHOTGUN') || name.includes('VULCANO')) return 'shotgun_shell';
        if (name.includes('REVOLVER') || name.includes('SMG') || name.includes('LIGHT') || name.includes('RATTLER')) return 'light_kinetic';
        if (name.includes('SNIPER') || name.includes('LANCE') || name.includes('DMR') || name.includes('HIGH')) return 'high_caliber';
        if (name.includes('PLASMA') || name.includes('ENERGY')) return 'energy_cell';
        return 'heavy_kinetic';
    },

    /**
     * Validates loadout and backpack readiness before deploying into raid.
     * Evaluates 4 core operational readiness vectors:
     *  1. Weapon Presence (Primary or Secondary long-gun / sidearm).
     *  2. Caliber / Ammunition Compatibility.
     *  3. Weight & Encumbrance limit (Hard max 40.0 kg).
     *  4. Weapon Durability condition (> 20%).
     * @param {Record<string, any>} [loadout={}]
     * @param {any[]} [backpack=[]]
     * @returns {{
     *   canDeploy: boolean,
     *   weight: number,
     *   maxWeight: number,
     *   encumbrance: any,
     *   checks: {
     *     weapon: { pass: boolean, labelRu: string, labelEn: string, detailRu: string, detailEn: string },
     *     ammo: { pass: boolean, labelRu: string, labelEn: string, detailRu: string, detailEn: string, warning: boolean },
     *     weight: { pass: boolean, labelRu: string, labelEn: string, detailRu: string, detailEn: string },
     *     durability: { pass: boolean, labelRu: string, labelEn: string, detailRu: string, detailEn: string, warning: boolean }
     *   },
     *   warnings: string[],
     *   errors: string[]
     * }}
     */
    validatePreRaidChecklist(loadout = {}, backpack = []) {
        const errors = [];
        const warnings = [];

        // 1. Weapon check
        const primary = loadout.primary || null;
        const secondary = loadout.secondary || null;
        const equippedWeapons = [primary, secondary].filter(Boolean);
        const hasWeapon = equippedWeapons.length > 0;

        let weaponDetailRu = hasWeapon
            ? equippedWeapons.map(w => w.name + (w.durability != null ? ` (${w.durability}%)` : '')).join(' + ')
            : 'Оружие не экипировано';
        let weaponDetailEn = hasWeapon
            ? equippedWeapons.map(w => w.name + (w.durability != null ? ` (${w.durability}%)` : '')).join(' + ')
            : 'No weapon equipped';

        if (!hasWeapon) {
            errors.push('NO_WEAPON');
        }

        // 2. Ammo check
        let hasAmmo = true;
        let ammoMissingCalibers = [];
        const carriedItems = [
            ...(Array.isArray(backpack) ? backpack : []),
            ...(Array.isArray(loadout.quickSlots) ? loadout.quickSlots : []),
            ...(Array.isArray(loadout.safePocket) ? loadout.safePocket : [])
        ].filter(Boolean);

        for (const w of equippedWeapons) {
            const cal = this.getWeaponCaliber(w);
            const matchingAmmo = carriedItems.some(it =>
                it.category === 'ammo' &&
                (it.caliber === cal || (it.id && it.id.includes(cal)) || (it.name && it.name.toUpperCase().includes(cal.toUpperCase())))
            );
            if (!matchingAmmo && !(w.reserveAmmo > 0) && !(w.count > 10)) {
                hasAmmo = false;
                if (!ammoMissingCalibers.includes(cal)) ammoMissingCalibers.push(cal);
            }
        }

        let ammoDetailRu = hasAmmo
            ? (equippedWeapons.length > 0 ? 'Калибры согласованы, боезапас в наличии' : 'Оружие отсутствует')
            : `Не найден боезапас: ${ammoMissingCalibers.join(', ')}`;
        let ammoDetailEn = hasAmmo
            ? (equippedWeapons.length > 0 ? 'Calibers matched, ammunition supplied' : 'No weapons active')
            : `Missing ammunition for: ${ammoMissingCalibers.join(', ')}`;

        if (!hasAmmo && hasWeapon) {
            warnings.push('MISSING_AMMO');
        }

        // 3. Weight check. The hard limit follows the equipped frame: a LOOTER frame raises it to
// 45 kg, an ENFORCER to 55 kg. A flat 40 kg contradicted both `getEncumbrance` and
// `validatePreRaid`, and blocked a load the rest of the game called merely HEAVY.
        const weight = this.calculateLoadoutWeight(loadout, backpack);
        const maxWeight = (loadout.augment && Number.isFinite(loadout.augment.maxWeight))
            ? loadout.augment.maxWeight
            : (typeof GAME_WEIGHT_HEAVY_MAX !== 'undefined' ? GAME_WEIGHT_HEAVY_MAX : 40.0);
        const encumbrance = this.getEncumbrance(weight, loadout.augment || null);
        const weightOk = weight <= maxWeight;

        let weightDetailRu = `${weight} / ${maxWeight} KG [${encumbrance.nameRu || encumbrance.id.toUpperCase()}]`;
        let weightDetailEn = `${weight} / ${maxWeight} KG [${encumbrance.nameEn || encumbrance.id.toUpperCase()}]`;

        if (!weightOk) {
            errors.push('OVERENCUMBERED');
            weightDetailRu += ' — ПЕРЕГРУЗ (ВЫХОД ЗАБЛОКИРОВАН)';
            weightDetailEn += ' — OVERLOADED (DEPLOYMENT BLOCKED)';
        }

        // 4. Durability check
        let durabilityOk = true;
        let lowDurabilityWeapons = [];
        for (const w of equippedWeapons) {
            if (typeof w.durability === 'number' && w.durability <= 20) {
                durabilityOk = false;
                lowDurabilityWeapons.push(`${w.name} (${w.durability}%)`);
            }
        }

        let durabilityDetailRu = durabilityOk
            ? 'Состояние оружия в пределах нормы'
            : `Критический износ: ${lowDurabilityWeapons.join(', ')}`;
        let durabilityDetailEn = durabilityOk
            ? 'Weapon condition operational'
            : `Critical weapon wear: ${lowDurabilityWeapons.join(', ')}`;

        if (!durabilityOk) {
            warnings.push('CRITICAL_WEAR');
        }

        const canDeploy = errors.length === 0;

        return {
            canDeploy,
            weight,
            maxWeight,
            encumbrance,
            checks: {
                weapon: {
                    pass: hasWeapon,
                    labelRu: '01 / ОРУЖИЕ',
                    labelEn: '01 / WEAPONRY',
                    detailRu: weaponDetailRu,
                    detailEn: weaponDetailEn
                },
                ammo: {
                    pass: hasAmmo,
                    warning: !hasAmmo && hasWeapon,
                    labelRu: '02 / БОЕПРИПАСЫ',
                    labelEn: '02 / AMMUNITION',
                    detailRu: ammoDetailRu,
                    detailEn: ammoDetailEn
                },
                weight: {
                    pass: weightOk,
                    labelRu: '03 / МАССА И ЗАГРУЗКА',
                    labelEn: '03 / WEIGHT & LOAD',
                    detailRu: weightDetailRu,
                    detailEn: weightDetailEn
                },
                durability: {
                    pass: durabilityOk,
                    warning: !durabilityOk,
                    labelRu: '04 / ИЗНОС СНАРЯЖЕНИЯ',
                    labelEn: '04 / DURABILITY',
                    detailRu: durabilityDetailRu,
                    detailEn: durabilityDetailEn
                }
            },
            warnings,
            errors
        };
    },

    /**
     * Apply the Armory-3 workshop discount to a weapon recipe. Returns the recipe unchanged
     * when it does not qualify, so the caller can always use the result directly.
     * @param {Record<string, any>} profile
     * @param {Record<string, any>} recipe
     * @returns {Record<string, any>} the recipe, discounted or untouched
     */
    workshopRecipe(profile, recipe) {
        if (!recipe || recipe.stationDiscountApplied || recipe.category !== 'weapons' || this.getStationLevel(profile, 'station_armory') < 3) return recipe;
        return { ...recipe, stationDiscountApplied: true, credits: Math.ceil((recipe.credits || 0) * 0.75), materials: (recipe.materials || []).map(m => ({ ...m, count: Math.ceil(m.count * 0.75) })) };
    },

    /**
     * Checks if player has required credits, base items, and materials to craft a recipe.
     * @param {any[]} stash
     * @param {{credits?: number}} wallet
     * @param {Record<string, any>} recipe
     * @returns {{ canCraft: boolean, missingMaterials: string[], missingCredits: number, missingBaseWeapon: boolean }}
     */
    canCraft(stash = [], wallet = { credits: 0 }, recipe) {
        recipe = this.workshopRecipe(wallet, recipe);
        if (!recipe) return { canCraft: false, missingMaterials: [], missingCredits: 0, missingBaseWeapon: false };
        const credits = Number(wallet.credits || 0);
        const requiredCredits = Number(recipe.credits || 0);
        const missingCredits = Math.max(0, requiredCredits - credits);

        let missingBaseWeapon = false;
        if (recipe.baseWeaponId) {
            const hasBase = stash.some(item =>
                (item.id === recipe.baseWeaponId || (item.name && item.name.toUpperCase().includes(recipe.baseWeaponId.toUpperCase())))
            );
            if (!hasBase) missingBaseWeapon = true;
        }

        const missingMaterials = [];
        if (Array.isArray(recipe.materials)) {
            for (const req of recipe.materials) {
                const reqType = req.type.toLowerCase();
                let available = 0;
                for (const item of stash) {
                    const itemType = (item.type || '').toLowerCase();
                    const itemId = (item.id || '').toLowerCase();
                    const itemName = (item.name || '').toLowerCase();
                    if (itemType === reqType || itemId === reqType || itemName.includes(reqType)) {
                        available += Number(item.count || 1);
                    }
                }
                if (available < req.count) {
                    missingMaterials.push(`${req.type}: ${available}/${req.count}`);
                }
            }
        }

        const canCraft = missingCredits === 0 && !missingBaseWeapon && missingMaterials.length === 0;
        return { canCraft, missingMaterials, missingCredits, missingBaseWeapon };
    },

    /**
     * Executes crafting transaction: deducts credits & materials, removes base weapon if required,
     * and adds the crafted item to stash.
     * @param {any[]} stash
     * @param {{credits: number}} wallet
     * @param {Record<string, any>} recipe
     * @returns {{ success: boolean, item?: any, wallet: any, stash: any[] }}
     */
    executeCraft(stash, wallet, recipe) {
        recipe = this.workshopRecipe(wallet, recipe);
        const check = this.canCraft(stash, wallet, recipe);
        if (!check.canCraft) return { success: false, wallet, stash };

        wallet.credits -= Number(recipe.credits || 0);

        if (recipe.baseWeaponId) {
            const idx = stash.findIndex(item =>
                item.id === recipe.baseWeaponId || (item.name && item.name.toUpperCase().includes(recipe.baseWeaponId.toUpperCase()))
            );
            if (idx !== -1) stash.splice(idx, 1);
        }

        if (Array.isArray(recipe.materials)) {
            for (const req of recipe.materials) {
                const reqType = req.type.toLowerCase();
                let needed = req.count;
                for (let i = stash.length - 1; i >= 0 && needed > 0; i--) {
                    const item = stash[i];
                    const itemType = (item.type || '').toLowerCase();
                    const itemId = (item.id || '').toLowerCase();
                    const itemName = (item.name || '').toLowerCase();
                    if (itemType === reqType || itemId === reqType || itemName.includes(reqType)) {
                        const count = Number(item.count || 1);
                        if (count <= needed) {
                            needed -= count;
                            stash.splice(i, 1);
                        } else {
                            item.count -= needed;
                            needed = 0;
                        }
                    }
                }
            }
        }

        const catalogDef = (typeof ARC_ITEMS !== 'undefined' && ARC_ITEMS[recipe.resultId]) ? ARC_ITEMS[recipe.resultId] : null;
        const craftedItem = recipe.result ? JSON.parse(JSON.stringify(recipe.result)) : catalogDef ? JSON.parse(JSON.stringify(catalogDef)) : {
            id: recipe.resultId,
            name: recipe.nameEn || recipe.id,
            nameRu: recipe.nameRu || recipe.id,
            category: recipe.category,
            tier: 'III',
            rarity: 'Epic',
            value: 1200,
            weight: 2.0
        };

        craftedItem.id = recipe.resultId + '_' + Date.now();
        if (recipe.count && recipe.count > 1) craftedItem.count = recipe.count;
        stash.push(craftedItem);

        return { success: true, item: craftedItem, wallet, stash };
    },

    /**
     * Dismantles an item from stash into salvage crafting materials.
     * @param {any[]} stash
     * @param {any} item
     * @returns {{ success: boolean, dismantled: any, gained: any[], stash: any[] }}
     */
    dismantleItem(stash, item) {
        if (!item || !stash) return { success: false, dismantled: null, gained: [], stash };
        const idx = stash.findIndex(i => i.id === item.id);
        if (idx === -1) return { success: false, dismantled: null, gained: [], stash };

        stash.splice(idx, 1);
        const gained = [];

        if (item.category === 'weapons') {
            gained.push({ id: 'scrap_' + Date.now() + '_1', type: 'scrap', name: 'ROBOT PARTS', nameRu: 'ДЕТАЛИ РОБОТА', category: 'materials', count: 2, weight: 3.0, value: 130 });
            gained.push({ id: 'elec_' + Date.now() + '_2', type: 'electronics', name: 'CIRCUITRY', nameRu: 'ЭЛЕКТРОНИКА', category: 'materials', count: 1, weight: 0.5, value: 120 });
        } else if (item.category === 'armor') {
            gained.push({ id: 'scrap_' + Date.now() + '_1', type: 'scrap', name: 'ROBOT PARTS', nameRu: 'ДЕТАЛИ РОБОТА', category: 'materials', count: 2, weight: 3.0, value: 130 });
            gained.push({ id: 'fab_' + Date.now() + '_2', type: 'fabric', name: 'BALLISTIC FABRIC', nameRu: 'БАЛЛИСТИЧЕСКАЯ ТКАНЬ', category: 'materials', count: 1, weight: 0.4, value: 90 });
        } else {
            gained.push({ id: 'scrap_' + Date.now() + '_1', type: 'scrap', name: 'ROBOT PARTS', nameRu: 'ДЕТАЛИ РОБОТА', category: 'materials', count: 1, weight: 1.5, value: 65 });
        }

        for (const g of gained) stash.push(g);
        return { success: true, dismantled: item, gained, stash };
    },

    /**
     * Resolves end-of-raid settlement with guaranteed Safe Pocket preservation.
     * @param {boolean} won
     * @param {Record<string, any>} [loadout={}]
     * @param {any[]} [backpack=[]]
     * @param {any[]} [safePocket=[]]
     * The result is EXTENDED by the caller: `Game.finish` adds the run's own statistics
     * (kills, drives, health percent, weight) before the settlement is shown or sent. They are
     * declared optional here rather than left out, because an open-ended record would hide a
     * typo in the very fields the result screen reads.
     * @returns {{
     *   won: boolean,
     *   savedLoot: any[],
     *   lostItems: any[],
     *   extractedValue: number,
     *   safePocketProtectedCount: number,
     *   sentinelKilled?: boolean,
     *   spotterKilled?: boolean,
     *   kills?: number,
     *   drives?: number,
     *   hpPercent?: number,
     *   weight?: number
     * }}
     */
    resolveRaidSettlement(won, loadout = {}, backpack = [], safePocket = []) {
        const safeItems = Array.isArray(safePocket) ? safePocket.filter(Boolean) : [];
        const backpackItems = Array.isArray(backpack) ? backpack.filter(Boolean) : [];

        if (won) {
            const savedLoot = [...backpackItems, ...safeItems];
            const extractedValue = savedLoot.reduce((sum, it) => sum + Number(it.value || 50), 0);
            return {
                won: true,
                savedLoot,
                lostItems: [],
                extractedValue,
                safePocketProtectedCount: safeItems.length
            };
        } else {
            const savedLoot = [...safeItems];
            // `Object.values(loadout)` walked the quickSlots/safePocket ARRAYS as if each were a
            // single lost item, and it missed nothing only by accident. Build the list from the
            // same slot table the death drop uses, so the reported loss matches what is taken.
            const lostEquipped = [];
            for (const slot of ['primary', 'secondary', 'sidearm', 'shield', 'shieldCore', 'suitMod', 'augment', 'gadget1', 'gadget2']) {
                if (loadout[slot]) lostEquipped.push(loadout[slot]);
            }
            for (const it of (Array.isArray(loadout.quickSlots) ? loadout.quickSlots : [])) {
                if (it) lostEquipped.push(it);
            }
            const lostItems = [...backpackItems, ...lostEquipped];
            const extractedValue = savedLoot.reduce((sum, it) => sum + Number(it.value || 50), 0);
            return {
                won: false,
                savedLoot,
                lostItems,
                extractedValue,
                safePocketProtectedCount: safeItems.length
            };
        }
    },

    /**
     * Determines safe pocket capacity based on equipped augment and profile upgrade.
     * @param {Record<string, any>} [loadout]
     * @param {Record<string, any>} [profile]
     * @returns {number}
     */
    getSafePocketCapacity(loadout = {}, profile = {}) {
        let baseSlots = 1;
        if (loadout.augment && Number.isFinite(loadout.augment.safePocketSlots)) {
            baseSlots = loadout.augment.safePocketSlots;
        } else if (profile.safePocketTier) {
            baseSlots = Math.max(1, Number(profile.safePocketTier) || 1);
        }
        return Math.min(4, Math.max(1, baseSlots));
    },

    /**
     * Unlocks a blueprint permanently in the player profile.
     * @param {Record<string, any>} profile
     * @param {string} blueprintId
     * @returns {{ success: boolean, blueprintId: string }}
     */
    learnBlueprint(profile, blueprintId) {
        if (!profile || !blueprintId) return { success: false, blueprintId };
        profile.unlockedBlueprints = Array.isArray(profile.unlockedBlueprints) ? profile.unlockedBlueprints : [];
        if (!profile.unlockedBlueprints.includes(blueprintId)) {
            profile.unlockedBlueprints.push(blueprintId);
        }
        return { success: true, blueprintId };
    },

    /**
     * Checks if a crafting recipe is unlocked for the player.
     * @param {Record<string, any>} profile
     * @param {string} recipeId
     * @returns {boolean}
     */
    isRecipeUnlocked(profile, recipeId) {
        if (typeof ARC_CRAFTING_RECIPES === 'undefined') return true;
        const recipe = ARC_CRAFTING_RECIPES[recipeId];
        if (!recipe) return false;
        if (!recipe.blueprintRequired) return true;
        const unlocked = profile && Array.isArray(profile.unlockedBlueprints) ? profile.unlockedBlueprints : [];
        return unlocked.includes(recipe.blueprintRequired);
    },

    /**
     * Checks if player carries a Raider Bunker Key in backpack or safe pocket.
     * @param {Array<any>} [backpack]
     * @param {Array<any>} [safePocket]
     * @returns {boolean}
     */
    canOpenRaiderHatch(backpack = [], safePocket = []) {
        const hasKey = (arr) => Array.isArray(arr) && arr.some(it => it && it.id === 'raider_hatch_key');
        return hasKey(backpack) || hasKey(safePocket);
    },

    /**
     * Consumes 1 Raider Bunker Key from backpack or safe pocket.
     * @param {Array<any>} [backpack]
     * @param {Array<any>} [safePocket]
     * @returns {boolean}
     */
    consumeHatchKey(backpack = [], safePocket = []) {
        for (const list of [backpack, safePocket]) {
            if (!Array.isArray(list)) continue;
            const idx = list.findIndex(it => it && it.id === 'raider_hatch_key');
            if (idx !== -1) {
                if (list[idx].count && list[idx].count > 1) {
                    list[idx].count--;
                } else {
                    list.splice(idx, 1);
                }
                return true;
            }
        }
        return false;
    },

    /**
     * Claims passive Scrappy drone yield from Speranza workshop.
     * @param {Record<string, any>} profile
     * @returns {{ scrap: number, credits: number }}
     */
    claimScrappyYield(profile = {}) {
        const scrappyStation = typeof ARC_WORKSHOP_STATIONS !== 'undefined' ? ARC_WORKSHOP_STATIONS.SCRAPPY : null;
        const base = scrappyStation ? scrappyStation.baseDrop : { scrap: 15, credits: 100 };
        const level = (profile.stations && profile.stations.station_scrappy) || 1;
        const yieldMult = 1 + (level - 1) * 0.5;
        const scrap = Math.round(base.scrap * yieldMult);
        const credits = Math.round(base.credits * yieldMult);
        return { scrap, credits };
    },

    /**
     * Gets the current level of a Speranza workshop station.
     * @param {Record<string, any>} profile
     * @param {string} stationId
     * @returns {number}
     */
    getStationLevel(profile = {}, stationId) {
        if (!profile || !profile.stations || !stationId) return 1;
        return Number(profile.stations[stationId]) || 1;
    },

    /**
     * Checks if player can afford to upgrade a workshop station to the next level.
     * @param {Record<string, any>} profile
     * @param {any[]} stash
     * @param {string} stationId
     * @returns {{ canUpgrade: boolean, isMaxLevel: boolean, nextLevel: number, missingCredits: number, missingMaterials: string[], cost?: any }}
     */
    canUpgradeStation(profile = {}, stash = [], stationId) {
        const currentLevel = this.getStationLevel(profile, stationId);
        if (currentLevel >= 3) {
            return { canUpgrade: false, isMaxLevel: true, nextLevel: 3, missingCredits: 0, missingMaterials: [] };
        }
        const nextLevel = currentLevel + 1;
        const station = typeof ARC_WORKSHOP_STATIONS !== 'undefined' ? Object.values(ARC_WORKSHOP_STATIONS).find(s => s.id === stationId) : null;
        // `upgradeCosts` is optional on a station, so the union type does not expose it. Read it
        // through a widened view rather than narrowing the whole registry type.
        const stationCosts = /** @type {Record<string, any>|null} */ (station);
        const costs = (stationCosts && stationCosts.upgradeCosts && stationCosts.upgradeCosts[nextLevel])
            || (typeof ARC_STATION_UPGRADE_COSTS !== 'undefined' ? ARC_STATION_UPGRADE_COSTS[nextLevel] : { credits: 600, materials: [{ type: 'scrap', count: 4 }] });
        if (!costs) return { canUpgrade: false, isMaxLevel: true, nextLevel, missingCredits: 0, missingMaterials: [] };

        const credits = Number(profile.credits || 0);
        const missingCredits = Math.max(0, (costs.credits || 0) - credits);
        const missingMaterials = [];

        if (Array.isArray(costs.materials)) {
            for (const req of costs.materials) {
                const reqType = req.type.toLowerCase();
                let available = 0;
                for (const item of stash) {
                    const itemType = (item.type || '').toLowerCase();
                    const itemId = (item.id || '').toLowerCase();
                    const itemName = (item.name || '').toLowerCase();
                    if (itemType === reqType || itemId === reqType || itemName.includes(reqType)) {
                        available += Number(item.count || 1);
                    }
                }
                if (available < req.count) {
                    missingMaterials.push(`${req.type}: ${available}/${req.count}`);
                }
            }
        }

        const canUpgrade = missingCredits === 0 && missingMaterials.length === 0;
        return { canUpgrade, isMaxLevel: false, nextLevel, missingCredits, missingMaterials, cost: costs };
    },

    /**
     * Executes station level upgrade: deducts credits & materials and advances level.
     * @param {Record<string, any>} profile
     * @param {any[]} stash
     * @param {string} stationId
     * @returns {{ success: boolean, newLevel: number }}
     */
    upgradeStation(profile, stash = [], stationId) {
        const check = this.canUpgradeStation(profile, stash, stationId);
        if (!check.canUpgrade) return { success: false, newLevel: this.getStationLevel(profile, stationId) };

        profile.credits = Math.max(0, (profile.credits || 0) - (check.cost?.credits || 0));

        if (Array.isArray(check.cost?.materials)) {
            for (const req of check.cost.materials) {
                const reqType = req.type.toLowerCase();
                let needed = req.count;
                for (let i = stash.length - 1; i >= 0 && needed > 0; i--) {
                    const item = stash[i];
                    const itemType = (item.type || '').toLowerCase();
                    const itemId = (item.id || '').toLowerCase();
                    const itemName = (item.name || '').toLowerCase();
                    if (itemType === reqType || itemId === reqType || itemName.includes(reqType)) {
                        const count = Number(item.count || 1);
                        if (count <= needed) {
                            needed -= count;
                            stash.splice(i, 1);
                        } else {
                            item.count -= needed;
                            needed = 0;
                        }
                    }
                }
            }
        }

        profile.stations = profile.stations || {};
        profile.stations[stationId] = check.nextLevel;
        return { success: true, newLevel: check.nextLevel };
    },

    /**
     * Checks if a weapon is compatible with a given attachment.
     * @param {Record<string, any>} weapon
     * @param {Record<string, any>} attachment
     * @returns {boolean}
     */
    canAttach(weapon, attachment) {
        if (!weapon || !attachment) return false;
        const slots = weapon.compatibleSlots || (typeof ARC_ATTACHMENT_SLOTS !== 'undefined' ? ARC_ATTACHMENT_SLOTS : ['optic', 'muzzle', 'mag', 'stock']);
        const slotType = attachment.slotType;
        return !!(slotType && slots.includes(slotType));
    },

    /**
     * Calculates the effective weapon stats taking installed attachments into account.
     * @param {Record<string, any>} weapon
     * @param {Record<string, any>} [attachments]
     * @returns {{
     *   damage: number,
     *   fireRate: number,
     *   range: number,
     *   magSize: number,
     *   weight: number,
     *   recoilMult: number,
     *   adsTimeMult: number,
     *   swayMult: number,
     *   noiseMult: number,
     *   zoom: number,
     *   muzzleFlash: boolean,
     *   reloadTimeMult: number,
     *   fireMode?: string,
     *   archetype?: string
     * }}
     */
    getWeaponEffectiveStats(weapon, attachments) {
        if (!weapon) {
            return {
                damage: 0, fireRate: 0, range: 0, magSize: 0, weight: 0,
                recoilMult: 1, adsTimeMult: 1, swayMult: 1, noiseMult: 1,
                zoom: 1, muzzleFlash: true, reloadTimeMult: 1,
                fireMode: 'auto', archetype: 'assault_rifle'
            };
        }

        const mods = attachments || weapon.attachments || {};
        let damage = weapon.damage || 34;
        let fireRate = weapon.fireRate || 70;
        let range = weapon.range || 75;
        let magSize = weapon.magSize || 20;
        let weight = weapon.weight || 4.5;
        let recoilMult = 1.0;
        let adsTimeMult = 1.0;
        let swayMult = 1.0;
        let noiseMult = 1.0;
        let zoom = 1.0;
        let muzzleFlash = true;
        let reloadTimeMult = 1.0;

        for (const slot of ['optic', 'muzzle', 'mag', 'stock']) {
            const mod = mods[slot];
            if (!mod) continue;

            if (mod.weight) weight += mod.weight;
            if (mod.recoilMult) recoilMult *= mod.recoilMult;
            if (mod.adsTimeMult) adsTimeMult *= mod.adsTimeMult;
            if (mod.swayMult) swayMult *= mod.swayMult;
            if (mod.noiseMult) noiseMult *= mod.noiseMult;
            if (mod.reloadTimeMult) reloadTimeMult *= mod.reloadTimeMult;
            if (mod.zoom && mod.zoom > zoom) zoom = mod.zoom;
            if (mod.rangeBonus) range += mod.rangeBonus;
            if (mod.damageBonus) damage += mod.damageBonus;
            if (mod.muzzleFlash === false) muzzleFlash = false;
            if (mod.magCapacityMult) magSize = Math.round(magSize * mod.magCapacityMult);
        }

        return {
            damage: Math.round(damage),
            fireRate,
            fireMode: weapon.fireMode || 'auto',
            archetype: weapon.archetype || 'assault_rifle',
            range,
            magSize,
            weight: Math.round(weight * 10) / 10,
            recoilMult: Math.round(recoilMult * 100) / 100,
            adsTimeMult: Math.round(adsTimeMult * 100) / 100,
            swayMult: Math.round(swayMult * 100) / 100,
            noiseMult: Math.round(noiseMult * 100) / 100,
            zoom,
            muzzleFlash,
            reloadTimeMult: Math.round(reloadTimeMult * 100) / 100
        };
    },

    /**
     * Attaches an attachment to a weapon in-place, returning the previously installed attachment (if any).
     * @param {Record<string, any>} weapon
     * @param {string} slot
     * @param {Record<string, any>} attachment
     * @returns {Record<string, any> | null} previous attachment or null
     */
    attachModule(weapon, slot, attachment) {
        if (!weapon || !slot || !attachment) return null;
        if (!this.canAttach(weapon, attachment)) return null;
        if (!weapon.attachments) weapon.attachments = { optic: null, muzzle: null, mag: null, stock: null };
        const prev = weapon.attachments[slot] || null;
        weapon.attachments[slot] = Object.assign({}, attachment);
        return prev;
    },

    /**
     * Detaches an attachment from a weapon slot.
     * @param {Record<string, any>} weapon
     * @param {string} slot
     * @returns {Record<string, any> | null} detached attachment or null
     */
    detachModule(weapon, slot) {
        if (!weapon || !slot || !weapon.attachments) return null;
        const prev = weapon.attachments[slot] || null;
        weapon.attachments[slot] = null;
        return prev;
    }
};
