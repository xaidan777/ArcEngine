// progression.mjs — the PURE payout rules: the single source of truth for how a raid
// becomes credits and career statistics.
//
// Why this file exists: the client has always computed its own reward in
// `js/RaidRules.js:resolveRaidSettlement`, and online a modified client could claim any
// number it liked. The server now owns the money, so the formula lives here as plain
// exported functions that take no store, touch no disk and can be tested in isolation.
//
// Nothing in here trusts its input. A room can be corrupted, a transport can forward a
// half-filled object, and a replay can arrive twice — every count is coerced to a sane
// non-negative integer and every credit total stays a non-negative integer. A client can
// never call these functions directly, but defense in depth is cheap.

// Payout table, in credits. The numbers are deliberately flat and small: a raid is worth
// roughly one good item, so the economy cannot be farmed into hyperinflation.
//   - extractionBonus: the reward for surviving at all. It is the floor of a win, so a
//     lootless extraction still pays better than dying.
//   - driveValue: an ARC drive is the raid's primary objective and pays best per unit.
//   - killValue: a machine put down on the way out.
//   - lossKillValue: consolation on a loss. It is less than half of killValue, and a loss
//     pays no loot and no extraction bonus, so for the SAME raid a loss is always strictly
//     worse than a win with the same kills: 40*k < 250 + 100*k for every k >= 0.
//   - lootShare: extracted backpack loot converts to credits 1:1. The value is already a
//     credit figure, so anything else would just hide a second exchange rate.
/** @satisfies {Record<string, number>} */
export const PAYOUT = {
    extractionBonus: 250,
    driveValue: 150,
    killValue: 100,
    lossKillValue: 40,
    lootShare: 1,
};

// Ceilings that keep one absurd result from minting money or overflowing a JSON number.
export const MAX_PAYOUT_CREDITS = 1000000;
export const MAX_COUNT = 100000;

// Coerce anything (NaN, Infinity, -3, '7', null, undefined, an object) to a non-negative
// integer no greater than `max`. This is the only place the coercion is written, so the
// account store and the payout rules cannot disagree about what "0 kills" means.
/**
 * @param {any} value
 * @param {number} [max]
 * @returns {number}
 */
export function safeInt(value, max = MAX_COUNT) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(0, Math.floor(n)), Math.max(0, Math.floor(max)));
}

// Coerce a credit-like number the same way, with the money ceiling applied.
/**
 * @param {any} value
 * @returns {number}
 */
export function safeCredits(value) {
    return safeInt(value, MAX_PAYOUT_CREDITS);
}

// Turn one player's raid into credits.
//
// A WIN pays the extraction bonus, every collected drive, every kill and the extracted
// loot value. A LOSS pays a smaller consolation for kills only: the loot was dropped with
// the body, so it is worth nothing, and there is no survival bonus. The result is always
// `{ credits, breakdown }`, where `breakdown` is the itemised arithmetic so a UI (or a
// test) can explain the number instead of trusting it.
/**
 * @param {{ won?: boolean, drives?: number, kills?: number, extracted?: boolean, backpackValue?: number } | null} [raid]
 * @returns {{ credits: number, breakdown: { won: boolean, extracted: boolean, drives: number, kills: number, loot: number, extraction: number, drivePayout: number, killPayout: number, lootPayout: number, consolation: number, total: number } }}
 */
export function raidPayout(raid = {}) {
    const input = raid && typeof raid === 'object' ? raid : {};
    const { won = false, drives = 0, kills = 0, extracted = false, backpackValue = 0 } = input;
    const isWin = !!won;
    const didExtract = !!extracted;
    const driveCount = safeInt(drives);
    const killCount = safeInt(kills);
    // Loot only counts when the player actually carried it out. A loss drops everything.
    const loot = isWin && didExtract ? safeCredits(backpackValue) : 0;

    const extraction = isWin ? PAYOUT.extractionBonus : 0;
    // Drives are the objective of the raid: a win is credited for them, a wipe is not.
    const drivePayout = isWin ? driveCount * PAYOUT.driveValue : 0;
    const killPayout = killCount * (isWin ? PAYOUT.killValue : PAYOUT.lossKillValue);
    const lootPayout = Math.floor(loot * PAYOUT.lootShare);
    const consolation = isWin ? 0 : killPayout;

    // Each term is already non-negative; the sum is floored and capped so the invariant
    // "credits is a non-negative integer" holds even for absurd inputs.
    const total = safeCredits(extraction + drivePayout + killPayout + lootPayout);
    return {
        credits: total,
        breakdown: {
            won: isWin,
            extracted: didExtract,
            drives: driveCount,
            kills: killCount,
            loot,
            extraction: safeCredits(extraction),
            drivePayout: safeCredits(drivePayout),
            killPayout: safeCredits(killPayout),
            lootPayout: safeCredits(lootPayout),
            consolation: safeCredits(consolation),
            total,
        },
    };
}

// Normalise `perPlayer` — a Map, an array of `{ id, kills, deaths }`, or a plain object
// keyed by player id — into a list. Missing/garbage entries become an empty list, never a
// crash: a corrupted room must not take the whole settlement path down with it.
/**
 * @param {any} perPlayer
 * @returns {Array<{ id: string, kills: number, deaths: number }>}
 */
function participantList(perPlayer) {
    if (!perPlayer) return [];
    if (perPlayer instanceof Map) return [...perPlayer.values()].filter(Boolean);
    if (Array.isArray(perPlayer)) return perPlayer.filter(Boolean);
    if (typeof perPlayer === 'object') {
        return Object.entries(perPlayer).map(([id, stats]) => ({ id, ...(stats && typeof stats === 'object' ? stats : {}) }));
    }
    return [];
}

// Settle a whole room: what each participant earned.
//
// `outcome` is the server-owned room result from `server/simulation.mjs:endRaid` —
// `{ won, reason, survivors[], casualties[], drives }`. `perPlayer` carries the only things
// the room tracks per person (`kills`, `deaths`); everything else is derived from the
// outcome so a client cannot inflate its own share. Drives are shared objective progress and
// are credited to the players who actually carried them out.
/**
 * @param {{ won?: boolean, reason?: string, survivors?: string[], casualties?: string[], drives?: number }} [outcome]
 * @param {any} [perPlayer]
 * @returns {Array<{ playerId: string, won: boolean, extracted: boolean, kills: number, deaths: number, drives: number, value: number }>}
 */
export function summarizeRaid(outcome = {}, perPlayer = null) {
    const room = outcome && typeof outcome === 'object' ? outcome : {};
    const roomWon = !!room.won;
    const survivors = Array.isArray(room.survivors) ? room.survivors.filter(id => typeof id === 'string' && id) : [];
    const casualties = Array.isArray(room.casualties) ? room.casualties.filter(id => typeof id === 'string' && id) : [];
    const roomDrives = safeInt(room.drives);
    const survivorSet = new Set(survivors);
    const casualtySet = new Set(casualties);

    // Seed with the reported per-player statistics, then make sure every survivor and
    // casualty is present even if the transport dropped its row.
    /** @type {Map<string, { kills: number, deaths: number, loot: number }>} */
    const byId = new Map();
    for (const entry of participantList(perPlayer)) {
        if (!entry || entry.id === undefined || entry.id === null) continue;
        const id = String(entry.id);
        if (!id) continue;
        // `loot` is the credit value the room recorded for that player's searches. It is the
        // only per-player loot figure and it must be carried into the payout: dropping it here
        // silently paid extraction bonuses with none of the loot the raid was fought for.
        byId.set(id, { kills: safeInt(entry.kills), deaths: safeInt(entry.deaths), loot: safeCredits(entry.loot) });
    }
    for (const id of [...survivors, ...casualties]) {
        if (!byId.has(id)) byId.set(id, { kills: 0, deaths: 0, loot: 0 });
    }

    /** @type {Array<{ playerId: string, won: boolean, extracted: boolean, kills: number, deaths: number, drives: number, value: number }>} */
    const results = [];
    for (const [playerId, stats] of byId) {
        const extracted = survivorSet.has(playerId);
        // A raid is only "won" for the player who personally made it out: a casualty of an
        // otherwise successful raid still lost their kit.
        const won = roomWon && extracted;
        const deaths = casualtySet.has(playerId) ? Math.max(1, stats.deaths) : stats.deaths;
        // Drives are a room objective, so they are credited only to those who extracted.
        const drives = extracted ? roomDrives : 0;
        // Loot the player actually carried out of the raid, paid at `PAYOUT.lootShare` (1:1).
        // `raidPayout` already zeroes it for anyone who did not extract.
        const { credits } = raidPayout({ won, drives, kills: stats.kills, extracted, backpackValue: stats.loot });
        results.push({ playerId, won, extracted, kills: stats.kills, deaths, drives, loot: stats.loot, value: credits });
    }
    return results;
}

// --- LEVELING & XP -----------------------------------------------------------
// Formula: XP(level) = Math.floor(500 * Math.pow(level - 1, 1.4))
export function xpForLevel(level) {
    const l = Math.max(1, Math.min(30, safeInt(level)));
    if (l === 1) return 0;
    return Math.floor(500 * Math.pow(l - 1, 1.4));
}

export function calcLevel(xp) {
    const safeXp = safeInt(xp, 10000000);
    let level = 1;
    for (let l = 2; l <= 30; l++) {
        if (safeXp >= xpForLevel(l)) {
            level = l;
        } else {
            break;
        }
    }
    const currentLevelBaseXp = xpForLevel(level);
    const nextLevelXp = level < 30 ? xpForLevel(level + 1) : currentLevelBaseXp;
    const progressInLevel = level < 30 ? safeXp - currentLevelBaseXp : 0;
    const neededForNext = level < 30 ? nextLevelXp - currentLevelBaseXp : 0;
    return {
        level,
        xp: safeXp,
        currentLevelBaseXp,
        nextLevelXp,
        progressInLevel,
        neededForNext,
        percent: neededForNext > 0 ? Math.min(100, Math.floor((progressInLevel / neededForNext) * 100)) : 100
    };
}

// --- SKILL TREE DEFINITIONS --------------------------------------------------
export const SKILL_TREE = {
    resilience: {
        id: 'resilience',
        nameRu: 'Стойкость',
        nameEn: 'Resilience',
        descRu: 'Повышение физической выживаемости, запаса здоровья и защиты от урона.',
        descEn: 'Enhances physical survivability, maximum health pool, and damage resistance.',
        skills: {
            vitality_1: {
                id: 'vitality_1',
                nameRu: 'Закалка I',
                nameEn: 'Vitality I',
                descRu: '+10 к максимальному здоровью (HP).',
                descEn: '+10 Maximum Health (HP).',
                req: null,
                tier: 1,
                bonus: { maxHp: 10 }
            },
            vitality_2: {
                id: 'vitality_2',
                nameRu: 'Закалка II',
                nameEn: 'Vitality II',
                descRu: '+15 к максимальному здоровью (суммарно +25 HP).',
                descEn: '+15 Maximum Health (total +25 HP).',
                req: 'vitality_1',
                tier: 2,
                bonus: { maxHp: 15 }
            },
            shield_regen_1: {
                id: 'shield_regen_1',
                nameRu: 'Энергоконденсатор I',
                nameEn: 'Shield Booster I',
                descRu: '+20% к скорости восстановления щита.',
                descEn: '+20% Shield recharge rate.',
                req: null,
                tier: 1,
                bonus: { shieldRegenMult: 0.20 }
            },
            shield_regen_2: {
                id: 'shield_regen_2',
                nameRu: 'Энергоконденсатор II',
                nameEn: 'Shield Booster II',
                descRu: '+30% к скорости восстановления щита (суммарно +50%).',
                descEn: '+30% Shield recharge rate (total +50%).',
                req: 'shield_regen_1',
                tier: 2,
                bonus: { shieldRegenMult: 0.30 }
            },
            armor_plating: {
                id: 'armor_plating',
                nameRu: 'Бронепластины',
                nameEn: 'Armor Plating',
                descRu: '-15% получаемого урона по здоровью.',
                descEn: '-15% incoming health damage.',
                req: 'vitality_2',
                tier: 3,
                bonus: { damageReduction: 0.15 }
            },
            juggernaut: {
                id: 'juggernaut',
                nameRu: 'Джаггернаут',
                nameEn: 'Juggernaut',
                descRu: '-50% урона от падения и защита от оглушения при взрывах.',
                descEn: '-50% fall damage and stagger immunity from explosions.',
                req: 'armor_plating',
                tier: 4,
                bonus: { fallDamageReduction: 0.50, staggerImmune: true }
            }
        }
    },
    agility: {
        id: 'agility',
        nameRu: 'Мобильность',
        nameEn: 'Agility',
        descRu: 'Скорость перемещения, манёвренность и переносимый вес.',
        descEn: 'Movement speed, maneuverability, and carry weight capacity.',
        skills: {
            endurance_1: {
                id: 'endurance_1',
                nameRu: 'Выносливость I',
                nameEn: 'Endurance I',
                descRu: '+20 к максимальному запасу сил.',
                descEn: '+20 Maximum Stamina.',
                req: null,
                tier: 1,
                bonus: { maxStamina: 20 }
            },
            endurance_2: {
                id: 'endurance_2',
                nameRu: 'Выносливость II',
                nameEn: 'Endurance II',
                descRu: '+30 к максимальному запасу сил (суммарно +50).',
                descEn: '+30 Maximum Stamina (total +50).',
                req: 'endurance_1',
                tier: 2,
                bonus: { maxStamina: 30 }
            },
            sprinter: {
                id: 'sprinter',
                nameRu: 'Спринтер',
                nameEn: 'Sprinter',
                descRu: '+8% к базовой скорости спринта.',
                descEn: '+8% Sprint speed.',
                req: null,
                tier: 1,
                bonus: { sprintSpeedMult: 0.08 }
            },
            pack_mule_1: {
                id: 'pack_mule_1',
                nameRu: 'Вьючный Мул I',
                nameEn: 'Pack Mule I',
                descRu: '+5 кг к лимиту переносимого веса без штрафа.',
                descEn: '+5 KG maximum carry weight capacity.',
                req: 'sprinter',
                tier: 2,
                bonus: { carryWeightBonus: 5 }
            },
            pack_mule_2: {
                id: 'pack_mule_2',
                nameRu: 'Вьючный Мул II',
                nameEn: 'Pack Mule II',
                descRu: '+10 кг к лимиту веса (суммарно +15 кг).',
                descEn: '+10 KG maximum carry weight capacity (total +15 KG).',
                req: 'pack_mule_1',
                tier: 3,
                bonus: { carryWeightBonus: 10 }
            },
            swift_stride: {
                id: 'swift_stride',
                nameRu: 'Легкий Шаг',
                nameEn: 'Swift Stride',
                descRu: '-30% расхода выносливости при беге и прыжках.',
                descEn: '-30% Stamina consumption while running and jumping.',
                req: 'endurance_2',
                tier: 4,
                bonus: { sprintDrainReduction: 0.30 }
            }
        }
    },
    scavenging: {
        id: 'scavenging',
        nameRu: 'Выживание',
        nameEn: 'Scavenging',
        descRu: 'Эффективность сбора ресурсов, защита ценного лута и обнаружение угроз.',
        descEn: 'Looting efficiency, valuable preservation, and threat detection.',
        skills: {
            salvage_eye_1: {
                id: 'salvage_eye_1',
                nameRu: 'Острый Глаз I',
                nameEn: 'Salvage Eye I',
                descRu: '+10% к стоимости эвакуированного лута.',
                descEn: '+10% Value on extracted loot.',
                req: null,
                tier: 1,
                bonus: { lootValueBonus: 0.10 }
            },
            salvage_eye_2: {
                id: 'salvage_eye_2',
                nameRu: 'Острый Глаз II',
                nameEn: 'Salvage Eye II',
                descRu: '+20% к стоимости эвакуированного лута (суммарно +30%).',
                descEn: '+20% Value on extracted loot (total +30%).',
                req: 'salvage_eye_1',
                tier: 2,
                bonus: { lootValueBonus: 0.20 }
            },
            safe_pocket_plus: {
                id: 'safe_pocket_plus',
                nameRu: 'Гермокарман',
                nameEn: 'Reinforced Pocket',
                descRu: '+1 слот к Защищённому Карману (сохраняется при гибели).',
                descEn: '+1 Safe Pocket slot (retained on casualty).',
                req: null,
                tier: 1,
                bonus: { extraSafePocketSlots: 1 }
            },
            fast_hands: {
                id: 'fast_hands',
                nameRu: 'Ловкие Пальцы',
                nameEn: 'Fast Hands',
                descRu: '+35% к скорости обыска контейнеров и взаимодействия с объектами.',
                descEn: '+35% faster container looting and interaction speed.',
                req: 'salvage_eye_1',
                tier: 2,
                bonus: { interactSpeedMult: 0.35 }
            },
            sonar_tuning: {
                id: 'sonar_tuning',
                nameRu: 'Сонарный Резонатор',
                nameEn: 'Sonar Tuner',
                descRu: '+40% к дальности сканирования датчиков и сонара.',
                descEn: '+40% Sensor ping and threat radar range.',
                req: 'safe_pocket_plus',
                tier: 3,
                bonus: { radarRangeBonus: 0.40 }
            },
            apex_harvester: {
                id: 'apex_harvester',
                nameRu: 'Жнец Апекса',
                nameEn: 'Apex Harvester',
                descRu: '25% шанс извлечь дополнительное Флюкс-Ядро из уничтоженного автомата.',
                descEn: '25% chance to extract an extra Flux Core from destroyed automata.',
                req: 'sonar_tuning',
                tier: 4,
                bonus: { doubleCoreChance: 0.25 }
            }
        }
    }
};

// --- VENDOR TRUST TIERS ------------------------------------------------------
export const VENDOR_TRUST_TIERS = [
    { level: 1, minTrust: 0, titleRu: 'Незнакомец', titleEn: 'Stranger', discount: 0 },
    { level: 2, minTrust: 500, titleRu: 'Проверенный', titleEn: 'Recognized', discount: 0.05 },
    { level: 3, minTrust: 1500, titleRu: 'Доверенный партнер', titleEn: 'Trusted Partner', discount: 0.10 },
    { level: 4, minTrust: 3000, titleRu: 'Брат по оружию', titleEn: 'Brother-in-Arms', discount: 0.15 }
];

export function getVendorTrustLevel(trustXp) {
    const xp = safeInt(trustXp);
    let current = VENDOR_TRUST_TIERS[0];
    let next = VENDOR_TRUST_TIERS[1];
    for (let i = 0; i < VENDOR_TRUST_TIERS.length; i++) {
        if (xp >= VENDOR_TRUST_TIERS[i].minTrust) {
            current = VENDOR_TRUST_TIERS[i];
            next = VENDOR_TRUST_TIERS[i + 1] || null;
        }
    }
    const progress = next ? xp - current.minTrust : 0;
    const needed = next ? next.minTrust - current.minTrust : 0;
    return {
        level: current.level,
        titleRu: current.titleRu,
        titleEn: current.titleEn,
        discount: current.discount,
        trust: xp,
        nextLevelTrust: next ? next.minTrust : current.minTrust,
        progressInTier: progress,
        neededForNext: needed,
        percent: needed > 0 ? Math.min(100, Math.floor((progress / needed) * 100)) : 100
    };
}

// --- FIELD CONTRACTS DEFINITIONS ---------------------------------------------
export const CONTRACT_DEFINITIONS = {
    // MARCO (Weapons / Combat)
    contract_patrol_clear: {
        id: 'contract_patrol_clear',
        vendor: 'marco',
        titleRu: 'Зачистка патрулей',
        titleEn: 'Patrol Sweep',
        descRu: 'Уничтожьте 3 воздушных дрона-разведчика (Spotter) в секторе.',
        descEn: 'Eliminate 3 aerial Spotter drones in the sector.',
        type: 'kill_spotter',
        targetCount: 3,
        inOneRound: false,
        rewards: { xp: 400, credits: 800, trust: 150, items: [] }
    },
    contract_sentinel_hunt: {
        id: 'contract_sentinel_hunt',
        vendor: 'marco',
        titleRu: 'Охота на Стража',
        titleEn: 'Sentinel Hunt',
        descRu: 'Ликвидируйте тяжелого боевого робота Sentinel и эвакуируйтесь.',
        descEn: 'Neutralize an armored Sentinel combat automaton and extract.',
        type: 'kill_sentinel',
        targetCount: 1,
        inOneRound: true,
        rewards: { xp: 650, credits: 1500, trust: 250, items: [{ id: 'core_flux_1', count: 1 }] }
    },

    // ELENA (Medical / Biology)
    contract_biogel_sample: {
        id: 'contract_biogel_sample',
        vendor: 'elena',
        titleRu: 'Образцы биогеля',
        titleEn: 'Bio-Gel Samples',
        descRu: 'Эвакуируйте из рейда 2 упаковки медицинских компонентов или биогеля.',
        descEn: 'Extract from a raid carrying 2 medical components or bio-gels.',
        type: 'extract_medical',
        targetCount: 2,
        inOneRound: false,
        rewards: { xp: 350, credits: 700, trust: 160, items: [{ id: 'medkit_field', count: 2 }] }
    },
    contract_flawless_extraction: {
        id: 'contract_flawless_extraction',
        vendor: 'elena',
        titleRu: 'Чистая эвакуация',
        titleEn: 'Flawless Extraction',
        descRu: 'Завершите рейд и успешно эвакуируйтесь, сохранив здоровье выше 80%.',
        descEn: 'Complete a raid and extract successfully with health above 80%.',
        type: 'extract_healthy',
        targetCount: 1,
        inOneRound: true,
        rewards: { xp: 500, credits: 1200, trust: 200, items: [] }
    },

    // BRUNO (Quartermaster / Supplies)
    contract_copper_cables: {
        id: 'contract_copper_cables',
        vendor: 'bruno',
        titleRu: 'Сбор проводки',
        titleEn: 'Copper Salvage',
        descRu: 'Соберите и эвакуируйте 4 медных кабеля для ремонта Цитадели.',
        descEn: 'Salvage and extract with 4 copper cables for Citadel maintenance.',
        type: 'extract_cables',
        targetCount: 4,
        inOneRound: false,
        rewards: { xp: 300, credits: 600, trust: 140, items: [] }
    },
    contract_heavy_payload: {
        id: 'contract_heavy_payload',
        vendor: 'bruno',
        titleRu: 'Тяжелый груз',
        titleEn: 'Heavy Payload',
        descRu: 'Успешно эвакуируйтесь из рейда с весом снаряжения не менее 25 кг.',
        descEn: 'Extract from a raid carrying at least 25 KG of gear and salvage.',
        type: 'extract_weight',
        targetCount: 25,
        inOneRound: true,
        rewards: { xp: 450, credits: 1000, trust: 180, items: [] }
    },

    // SOFIA (Omega Labs / Electronics & Cybernetics)
    contract_data_retrieval: {
        id: 'contract_data_retrieval',
        vendor: 'sofia',
        titleRu: 'Перехват данных',
        titleEn: 'Data Intercept',
        descRu: 'Найдите и эвакуируйте 2 зашифрованных накопителя данных.',
        descEn: 'Recover and extract with 2 encrypted Data Drives.',
        type: 'extract_drives',
        targetCount: 2,
        inOneRound: false,
        rewards: { xp: 600, credits: 1400, trust: 240, items: [{ id: 'core_flux_1', count: 1 }] }
    },
    contract_circuit_salvage: {
        id: 'contract_circuit_salvage',
        vendor: 'sofia',
        titleRu: 'Микросхемы Апекс',
        titleEn: 'Apex Microchips',
        descRu: 'Добудьте 3 микрочипа из сбитых автоматов.',
        descEn: 'Salvage 3 microchips from downed automata.',
        type: 'extract_chips',
        targetCount: 3,
        inOneRound: false,
        rewards: { xp: 400, credits: 900, trust: 170, items: [] }
    }
};

// --- WORKSHOP STATIONS & RECIPES ---------------------------------------------
export const WORKSHOP_STATIONS_CATALOG = {
    armory: {
        id: 'armory',
        nameRu: 'Оружейный цех',
        nameEn: 'Armory Station',
        descRu: 'Производство огнестрельного оружия, патронов и модулей.',
        descEn: 'Manufacture firearms, ammunition, and weapon attachments.',
        upgradeCosts: {
            2: { credits: 800, materials: [{ id: 'salvage_copper_1', count: 3 }, { id: 'salvage_scrap_metal', count: 5 }] },
            3: { credits: 2000, materials: [{ id: 'core_flux_1', count: 1 }, { id: 'salvage_circuit_2', count: 4 }] }
        }
    },
    medlab: {
        id: 'medlab',
        nameRu: 'Био-Лаборатория',
        nameEn: 'Bio-Synthesis Lab',
        descRu: 'Синтез стимуляторов, полевых аптечек и коагулянтов.',
        descEn: 'Synthesize combat stims, field medkits, and coagulants.',
        upgradeCosts: {
            2: { credits: 600, materials: [{ id: 'salvage_biogel', count: 3 }] },
            3: { credits: 1600, materials: [{ id: 'core_flux_1', count: 1 }, { id: 'salvage_biogel', count: 6 }] }
        }
    },
    gear: {
        id: 'gear',
        nameRu: 'Бронецех',
        nameEn: 'Gear & Armor Forge',
        descRu: 'Ковка композитных бронепластин и силовых ядер щита.',
        descEn: 'Forge composite armor plates and tactical shield cores.',
        upgradeCosts: {
            2: { credits: 750, materials: [{ id: 'salvage_scrap_metal', count: 6 }] },
            3: { credits: 1800, materials: [{ id: 'core_flux_1', count: 1 }, { id: 'salvage_copper_1', count: 5 }] }
        }
    },
    electronics: {
        id: 'electronics',
        nameRu: 'Кибернетика',
        nameEn: 'Cybernetics Bay',
        descRu: 'Оптические сенсоры, чипы сонара и высокоточные прицелы.',
        descEn: 'Optical sensors, sonar microchips, and precision sights.',
        upgradeCosts: {
            2: { credits: 900, materials: [{ id: 'salvage_circuit_2', count: 4 }] },
            3: { credits: 2200, materials: [{ id: 'core_flux_1', count: 2 }, { id: 'salvage_circuit_2', count: 6 }] }
        }
    },
    recycler: {
        id: 'recycler',
        nameRu: 'Утилизатор',
        nameEn: 'Recycler & Salvage',
        descRu: 'Разборка повреждённого снаряжения на базовые материалы.',
        descEn: 'Dismantle damaged gear and junk into raw crafting materials.',
        upgradeCosts: {
            2: { credits: 500, materials: [{ id: 'salvage_scrap_metal', count: 4 }] },
            3: { credits: 1200, materials: [{ id: 'salvage_copper_1', count: 4 }] }
        }
    }
};

// --- CRAFTING RECIPES --------------------------------------------------------
export const CRAFTING_RECIPES = {
    craft_ammo_heavy: {
        id: 'craft_ammo_heavy',
        station: 'armory',
        minStationLevel: 1,
        nameRu: 'Тяжёлые патроны (x60)',
        nameEn: 'Heavy Ammo (x60)',
        costCredits: 100,
        materials: [{ id: 'salvage_scrap_metal', count: 2 }, { id: 'salvage_copper_1', count: 1 }],
        outputItem: { id: 'ammo_heavy_60', name: 'HEAVY AMMO (x60)', nameRu: 'ТЯЖЁЛЫЕ ПАТРОНЫ (x60)', category: 'ammo', rarity: 'Common', count: 60, weight: 1.2, value: 300 }
    },
    craft_ammo_shotgun: {
        id: 'craft_ammo_shotgun',
        station: 'armory',
        minStationLevel: 1,
        nameRu: 'Картечь 12G (x24)',
        nameEn: 'Shotgun Shells (x24)',
        costCredits: 80,
        materials: [{ id: 'salvage_scrap_metal', count: 2 }],
        outputItem: { id: 'ammo_shotgun_24', name: 'SHOTGUN SHELLS (x24)', nameRu: 'КАРТЕЧЬ (x24)', category: 'ammo', rarity: 'Common', count: 24, weight: 1.0, value: 250 }
    },
    craft_rubezh_t1: {
        id: 'craft_rubezh_t1',
        station: 'armory',
        minStationLevel: 1,
        nameRu: 'Штурмовая винтовка «Рубеж-76 Т1»',
        nameEn: 'Rubezh-76 T1 Assault Rifle',
        costCredits: 1200,
        materials: [{ id: 'salvage_scrap_metal', count: 6 }, { id: 'salvage_copper_1', count: 3 }],
        outputItem: { id: 'rubezh_76_t1', name: 'RUBEZH-76 T1', nameRu: 'РУБЕЖ-76 Т1', category: 'weapons', slot: 'primary', rarity: 'Common', tier: 'I', damage: 34, fireRate: 70, weight: 4.8, value: 3400 }
    },
    craft_tempest_t2: {
        id: 'craft_tempest_t2',
        station: 'armory',
        minStationLevel: 2,
        nameRu: 'Карабин «Буря II»',
        nameEn: 'Tempest II Carbine',
        costCredits: 2800,
        materials: [{ id: 'salvage_scrap_metal', count: 8 }, { id: 'salvage_circuit_2', count: 2 }, { id: 'core_flux_1', count: 1 }],
        outputItem: { id: 'tempest_ii', name: 'TEMPEST II', nameRu: 'БУРЯ II', category: 'weapons', slot: 'primary', rarity: 'Rare', tier: 'II', damage: 42, fireRate: 65, weight: 4.5, value: 7500 }
    },
    craft_medkit: {
        id: 'craft_medkit',
        station: 'medlab',
        minStationLevel: 1,
        nameRu: 'Полевой медкомплект',
        nameEn: 'Field Medkit',
        costCredits: 150,
        materials: [{ id: 'salvage_biogel', count: 2 }],
        outputItem: { id: 'medkit_field', name: 'FIELD MEDKIT', nameRu: 'ПОЛЕВОЙ МЕДКОМПЛЕКТ', category: 'consumables', rarity: 'Common', count: 1, weight: 0.5, value: 450, healAmount: 50 }
    },
    craft_shield_core_med: {
        id: 'craft_shield_core_med',
        station: 'gear',
        minStationLevel: 1,
        nameRu: 'Средний силовой щит',
        nameEn: 'Medium Shield Core',
        costCredits: 600,
        materials: [{ id: 'salvage_scrap_metal', count: 4 }, { id: 'salvage_circuit_2', count: 1 }],
        outputItem: { id: 'shield_core_med', name: 'MEDIUM SHIELD CORE', nameRu: 'СРЕДНИЙ ЩИТ', category: 'armor', slot: 'shieldCore', rarity: 'Common', capacity: 100, weight: 4.0, value: 1800 }
    },
    craft_optic_reddot: {
        id: 'craft_optic_reddot',
        station: 'electronics',
        minStationLevel: 1,
        nameRu: 'Коллиматор «Кобра-М»',
        nameEn: 'Red Dot Sight «Kobra-M»',
        costCredits: 400,
        materials: [{ id: 'salvage_circuit_2', count: 2 }],
        outputItem: { id: 'mod_optic_reddot', name: 'RED DOT KOBRA-M', nameRu: 'КОЛЛИМАТОР КОБРА-М', category: 'attachments', slotType: 'optic', rarity: 'Common', zoom: 1.25, adsTimeMult: 0.9, weight: 0.3, value: 1200 }
    }
};

// --- FREE SCAVENGER STARTER KIT -----------------------------------------------
export const SCAVENGER_KIT = {
    id: 'scavenger_kit',
    nameRu: 'Комплект «Рекрут»',
    nameEn: 'Scavenger Kit',
    descRu: 'Аварийное базовое снаряжение от Цитадели при полной потере экипировки.',
    descEn: 'Emergency starter kit supplied by the Citadel when completely broke.',
    loadout: {
        primary: null,
        secondary: { id: 'revolver_starter', name: 'REVOLVER I', nameRu: 'РЕВОЛЬВЕР I', category: 'weapons', slot: 'secondary', rarity: 'Common', tier: 'I', damage: 45, fireRate: 35, weight: 2.2, value: 1500 },
        shieldCore: { id: 'shield_starter', name: 'LIGHT SHIELD', nameRu: 'ЛЕГКИЙ ЩИТ', category: 'armor', slot: 'shieldCore', rarity: 'Common', capacity: 60, weight: 2.5, value: 800 },
        augment: null,
        backpack: [
            { id: 'ammo_revolver_40', name: 'LIGHT AMMO (x40)', nameRu: 'ЛЕГКИЕ ПАТРОНЫ (x40)', category: 'ammo', rarity: 'Common', count: 40, weight: 0.8, value: 200 },
            { id: 'bandage_field', name: 'FIELD BANDAGE', nameRu: 'ПОЛЕВОЙ БИНТ', category: 'consumables', rarity: 'Common', count: 2, weight: 0.3, value: 150, healAmount: 30 }
        ],
        quickSlots: [null, null, null, null],
        safePocket: [null, null]
    }
};

/** @satisfies {Record<string, any>} */
export const PROGRESSION_RULES = {
    PAYOUT,
    MAX_PAYOUT_CREDITS,
    MAX_COUNT,
    safeInt,
    safeCredits,
    raidPayout,
    summarizeRaid,
    xpForLevel,
    calcLevel,
    SKILL_TREE,
    VENDOR_TRUST_TIERS,
    getVendorTrustLevel,
    CONTRACT_DEFINITIONS,
    WORKSHOP_STATIONS_CATALOG,
    CRAFTING_RECIPES,
    SCAVENGER_KIT
};