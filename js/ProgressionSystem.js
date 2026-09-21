// js/ProgressionSystem.js — Client-side progression, skill tree, and contracts helper.
//
// Works alongside RaidClient and MenuSystem. In online mode, acts as a presentation
// and prediction layer for data fetched from GET /progression. In offline mode, provides
// local fallback state.

const ProgressionSystem = {
    state: {
        level: 1,
        xp: 0,
        levelInfo: { level: 1, xp: 0, currentLevelBaseXp: 0, nextLevelXp: 500, progressInLevel: 0, neededForNext: 500, percent: 0 },
        skillPoints: 0,
        skills: { resilience: {}, agility: {}, scavenging: {} },
        vendorTrust: {
            marco: { level: 1, trust: 0, discount: 0, titleRu: 'Незнакомец', titleEn: 'Stranger', percent: 0 },
            elena: { level: 1, trust: 0, discount: 0, titleRu: 'Незнакомец', titleEn: 'Stranger', percent: 0 },
            bruno: { level: 1, trust: 0, discount: 0, titleRu: 'Незнакомец', titleEn: 'Stranger', percent: 0 },
            sofia: { level: 1, trust: 0, discount: 0, titleRu: 'Незнакомец', titleEn: 'Stranger', percent: 0 },
        },
        contracts: { active: [], completed: [] },
        availableContracts: [],
        stationLevels: { armory: 1, medlab: 1, gear: 1, electronics: 1, recycler: 1 },
        unlockedBlueprints: [],
        stationsCatalog: {},
        craftingRecipes: {},
        skillTree: {}
    },

    updateFromServer(prog) {
        if (!prog || typeof prog !== 'object') return;
        this.state = Object.assign(this.state, prog);
    },

    isSkillLearned(branchId, skillId) {
        return !!(this.state.skills?.[branchId]?.[skillId]);
    },

    canLearnSkill(branchId, skillId) {
        if (this.isSkillLearned(branchId, skillId)) return false;
        if ((this.state.skillPoints || 0) <= 0) return false;
        const branch = this.state.skillTree?.[branchId];
        const skill = branch?.skills?.[skillId];
        if (!skill) return false;
        if (skill.req && !this.isSkillLearned(branchId, skill.req)) return false;
        return true;
    },

    /**
     * Calculates total aggregated bonuses from all learned skills.
     */
    getActiveBonuses() {
        const bonuses = {
            maxHp: 0,
            shieldRegenMult: 0,
            damageReduction: 0,
            fallDamageReduction: 0,
            staggerImmune: false,
            maxStamina: 0,
            sprintSpeedMult: 0,
            carryWeightBonus: 0,
            sprintDrainReduction: 0,
            lootValueBonus: 0,
            extraSafePocketSlots: 0,
            interactSpeedMult: 0,
            radarRangeBonus: 0,
            doubleCoreChance: 0
        };

        const tree = this.state.skillTree;
        if (!tree) return bonuses;

        for (const [bId, learnedObj] of Object.entries(this.state.skills || {})) {
            const branch = tree[bId];
            if (!branch || !branch.skills) continue;
            for (const sId of Object.keys(learnedObj || {})) {
                const skill = branch.skills[sId];
                if (!skill || !skill.bonus) continue;
                for (const [k, v] of Object.entries(skill.bonus)) {
                    if (typeof v === 'number') {
                        bonuses[k] = (bonuses[k] || 0) + v;
                    } else if (typeof v === 'boolean') {
                        bonuses[k] = v;
                    }
                }
            }
        }
        return bonuses;
    },

    getVendorDiscount(vendorId) {
        const v = this.state.vendorTrust?.[vendorId];
        return v ? (v.discount || 0) : 0;
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = ProgressionSystem;
if (typeof window !== 'undefined') window.ProgressionSystem = ProgressionSystem;
if (typeof globalThis !== 'undefined') globalThis.ProgressionSystem = ProgressionSystem;
