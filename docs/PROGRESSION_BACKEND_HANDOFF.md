# BlackWater Protocol: Архитектура Прогрессии, Экономики и Механик (Backend Handoff для DeepSeek)

**Дата**: 2026-09-20  
**Назначение**: Техническая спецификация для DeepSeek (Backend-разработчика) по развитию и сопровождению серверной логики прогрессии, дерева навыков, доверия торговцев, оперативных контрактов и мастерской.  
**Сеттинг**: BlackWater Protocol (оригинальный лор без нарушения авторских прав Embark Studios / ARC Raiders).

---

## 1. Концепция и Источник Истины (Single Source of Truth)

1. **Сервер — единственный владелец состояния прогрессии**:
   - Опыт (XP), уровень игрока (Level 1–30), доступные очки навыков (`skillPoints`), дерево прокачанных перков (`skills`), репутация торговцев (`vendorTrust`), активные и завершённые контракты (`contracts`), уровни верстаков (`stationLevels`) хранятся и изменяются **исключительно на сервере**.
   - Клиент отображает актуальное состояние, полученное через `GET /progression` и `GET /account`. Клиенту запрещено локально начислять XP, открывать навыки без подтверждения сервера или самовольно завершать контракты.

2. **Защита от авторских прав (Терминологический словарь)**:
   - База операторов: **Цитадель Blackwater** (`Blackwater Citadel` / `Сперанца-09`).
   - Поверхность: **Периметр / Зона Отчуждения** (`The Surface` / `Exclusion Zone`).
   - Противники: **Автоматы Апекс / Дроны ATU** (`APEX Automata` / `ATU Units` — Spotter, Sentinel, Cricket, Screamer).
   - Энергоядра: **Флюкс-Ядра** (`Flux Cores` / `Apex Cores`).
   - Валюта: **Кредиты (CR)** и **Жетоны Допуска (Clearance Tokens)**.
   - Дерево навыков: **Специализации** — `Стойкость (Resilience)`, `Мобильность (Agility)`, `Выживание (Scavenging)`.
   - Торговцы: **Марко** (Оружие), **Д-р Елена** (Медицина), **Бруно** (Снабжение), **София** (Кибернетика).

---

## 2. Структура Данных Аккаунта (`server/accounts.mjs`)

Каждый аккаунт в `accounts.json` расширен следующими полями:

```json
{
  "id": "uuid-v4",
  "name": "Raider_Alpha",
  "credits": 8500,
  "arcCores": 2,
  "level": 4,
  "xp": 3250,
  "skillPoints": 1,
  "skills": {
    "resilience": { "vitality_1": true, "shield_regen_1": true },
    "agility": { "sprinter": true },
    "scavenging": {}
  },
  "vendorTrust": {
    "marco": 450,
    "elena": 1200,
    "bruno": 300,
    "sofia": 850
  },
  "contracts": {
    "active": [
      { "id": "contract_patrol_clear", "progress": 2, "completed": false, "acceptedAt": 1789912000000 }
    ],
    "completed": [
      { "id": "contract_copper_cables", "claimedAt": 1789905000000 }
    ]
  },
  "stationLevels": {
    "armory": 2,
    "medlab": 1,
    "gear": 1,
    "electronics": 1,
    "recycler": 1
  },
  "unlockedBlueprints": [
    "bp_rubezh_t2",
    "bp_optic_reddot"
  ],
  "stats": {
    "raids": 12,
    "extractions": 8,
    "kills": 34,
    "deaths": 4
  }
}
```

---

## 3. Модуль Прогрессии (`server/progression.mjs`)

### 3.1. Кривая уровней (Leveling Formula)
- Формула XP для уровня $L$ ($1 \le L \le 30$):
  $$\text{XP}(L) = \lfloor 500 \cdot (L - 1)^{1.4} \rfloor$$
- При $L=1$: $0$ XP.
- При $L=2$: $500$ XP.
- При $L=3$: $1320$ XP.
- При $L=10$: $10\,900$ XP.
- За каждый новый уровень игрок получает $+1$ Очко Навыка (`skillPoint`).

### 3.2. Матрица Дерева Навыков (`SKILL_TREE`)
Дерево разбито на 3 ветки по 6 навыков:

1. **Стойкость (Resilience)**:
   - `vitality_1` (Tier 1, Req: null) -> `+10 Max HP`
   - `vitality_2` (Tier 2, Req: `vitality_1`) -> `+15 Max HP` (суммарно +25 HP)
   - `shield_regen_1` (Tier 1, Req: null) -> `+20% Shield Recharge Rate`
   - `shield_regen_2` (Tier 2, Req: `shield_regen_1`) -> `+30% Shield Recharge Rate` (суммарно +50%)
   - `armor_plating` (Tier 3, Req: `vitality_2`) -> `-15% Incoming Health Damage`
   - `juggernaut` (Tier 4, Req: `armor_plating`) -> `-50% Fall Damage & Stagger Immunity`

2. **Мобильность (Agility)**:
   - `endurance_1` (Tier 1, Req: null) -> `+20 Max Stamina`
   - `endurance_2` (Tier 2, Req: `endurance_1`) -> `+30 Max Stamina` (суммарно +50)
   - `sprinter` (Tier 1, Req: null) -> `+8% Sprint Speed`
   - `pack_mule_1` (Tier 2, Req: `sprinter`) -> `+5 KG Carry Weight Capacity`
   - `pack_mule_2` (Tier 3, Req: `pack_mule_1`) -> `+10 KG Carry Weight Capacity` (суммарно +15 KG)
   - `swift_stride` (Tier 4, Req: `endurance_2`) -> `-30% Stamina Drain while running/jumping`

3. **Выживание (Scavenging)**:
   - `salvage_eye_1` (Tier 1, Req: null) -> `+10% Extracted Loot Value`
   - `salvage_eye_2` (Tier 2, Req: `salvage_eye_1`) -> `+20% Extracted Loot Value` (суммарно +30%)
   - `safe_pocket_plus` (Tier 1, Req: null) -> `+1 Safe Pocket Slot`
   - `fast_hands` (Tier 2, Req: `salvage_eye_1`) -> `+35% Container Looting & Interaction Speed`
   - `sonar_tuning` (Tier 3, Req: `safe_pocket_plus`) -> `+40% Radar/Sonar Threat Detection Range`
   - `apex_harvester` (Tier 4, Req: `sonar_tuning`) -> `25% Chance to Extract Extra Flux Core from Automata`

### 3.3. Уровни Доверия Торговцев (Vendor Trust Tiers)
| Уровень Доверия | Мин. Trust XP | Звание (RU) | Звание (EN) | Скидка в магазине |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | 0 | Незнакомец | Stranger | 0% |
| **Tier 2** | 500 | Проверенный | Recognized | 5% |
| **Tier 3** | 1500 | Доверенный партнер | Trusted Partner | 10% |
| **Tier 4** | 3000 | Брат по оружию | Brother-in-Arms | 15% |

### 3.4. Каталог Оперативных Контрактов (`CONTRACT_DEFINITIONS`)
- `contract_patrol_clear` (Марко): уничтожить 3 дрона Spotter. Награда: 400 XP, 800 CR, 150 Trust.
- `contract_sentinel_hunt` (Марко): уничтожить 1 робота Sentinel. Награда: 650 XP, 1500 CR, 250 Trust, 1x Флюкс-Ядро.
- `contract_biogel_sample` (Елена): эвакуировать 2 ед. биогеля/медикаментов. Награда: 350 XP, 700 CR, 160 Trust, 2x Аптечки.
- `contract_flawless_extraction` (Елена): эвакуироваться с HP > 80%. Награда: 500 XP, 1200 CR, 200 Trust.
- `contract_copper_cables` (Бруно): эвакуировать 4 медных кабеля. Награда: 300 XP, 600 CR, 140 Trust.
- `contract_heavy_payload` (Бруно): эвакуироваться с грузом $\ge 25$ кг. Награда: 450 XP, 1000 CR, 180 Trust.
- `contract_data_retrieval` (София): эвакуировать 2 диска данных. Награда: 600 XP, 1400 CR, 240 Trust, 1x Флюкс-Ядро.
- `contract_circuit_salvage` (София): эвакуировать 3 микрочипа. Награда: 400 XP, 900 CR, 170 Trust.

---

## 4. HTTP API Эндпоинты (`server/main.mjs`)

Все защищённые маршруты требуют заголовок:  
`Authorization: Bearer <token>`

### 4.1. Прогрессия и Навыки
- `GET /progression`: возвращает полную сводку прогрессии (уровень, XP, SP, дерево перков, репутацию торговцев, верстаки).
- `POST /progression/skill`: вложение очка навыка.
  - Body: `{ "branchId": "resilience", "skillId": "vitality_1" }`
  - Ответ: `200 { "ok": true, "progression": { ... } }`
  - Ошибки: `no-skill-points` (400), `already-learned` (409), `missing-prerequisite` (400).
- `POST /progression/respec`: сброс всех очков навыков за кредиты (1500 CR за очко).
  - Ответ: `200 { "ok": true, "refunded": 3, "cost": 4500, "progression": { ... } }`
  - Ошибки: `no-skills-to-reset` (400), `insufficient-credits` (400).

### 4.2. Контракты Торговцев
- `GET /contracts`: список активных, выполненных и доступных контрактов.
- `POST /contracts/accept`: принятие контракта (максимум 4 одновременно).
  - Body: `{ "contractId": "contract_patrol_clear" }`
  - Ответ: `200 { "ok": true, "contracts": { ... } }`
  - Ошибки: `already-active` (409), `active-contracts-limit-reached` (409).
- `POST /contracts/claim`: завершение контракта и получение наград.
  - Body: `{ "contractId": "contract_patrol_clear" }`
  - Ответ: `200 { "ok": true, "rewards": { "xp": 400, "credits": 800, "trust": 150 }, "progression": { ... } }`
  - Ошибки: `contract-not-completed` (400), `contract-not-active` (404).

### 4.3. Мастерская и Крафт
- `POST /workshop/upgrade`: улучшение верстака (Уровень 1 -> 2 -> 3).
  - Body: `{ "stationId": "armory" }`
  - Валидация: списание кредитов и материалов (`salvage_copper_1`, `salvage_scrap_metal`, `core_flux_1`) из `account.stash`.
  - Ответ: `200 { "ok": true, "newLevel": 2, "stationLevels": { ... } }`
  - Ошибки: `max-level` (409), `insufficient-credits` (400), `missing-materials` (400).
- `POST /workshop/craft`: создание предмета по рецепту.
  - Body: `{ "recipeId": "craft_rubezh_t1" }`
  - Валидация: проверка уровня верстака, списание ресурсов и кредитов, добавление предмета в `account.stash` с уникальным `instId`.
  - Ответ: `200 { "ok": true, "item": { ... }, "stash": [ ... ], "credits": 1200 }`
  - Ошибки: `station-level-too-low` (400), `insufficient-credits` (400), `missing-materials` (400).

### 4.4. Аварийный Комплект «Рекрут»
- `POST /inventory/free-kit`: бесплатный базовый набор снаряжения (револьвер, легкий щит, патроны, бинт).
  - Доступен только если у игрока нет огнестрельного оружия в экипировке/схроне и баланс $< 500$ CR.
  - Ответ: `200 { "ok": true, "inventory": { ... } }`
  - Ошибки: `not-eligible-for-free-kit` (400).

---

## 5. Задачи для DeepSeek (План развития Backend)

1. **Синхронизация перков с боевой симуляцией (`server/simulation.mjs`)**:
   - При подключении игрока к рейду (`ws.mjs` / `RaidRoom`) передавать снимок его активных перков.
   - Авторитетно применять:
     - `maxHp`: $100 + \text{bonusHp}$ (до 125 HP).
     - `damageReduction`: расчет урона с учетом перка `armor_plating` (-15%).
     - `sprintSpeed`: множитель скорости бега в `simulation.mjs`.
2. **Серверный трекинг задач контрактов во время матча**:
   - Внутри `RaidRoom` отслеживать события: убийство Spotter/Sentinel, сбор Data Drives конкретным игроком, статус здоровья на момент эвакуации.
   - Передавать эти данные в `summarizeRaid()` для гарантированного исключения читерства со стороны клиента.
3. **Ротация ежедневных контрактов (Daily Directives)**:
   - Добавить таймер ротации (например, обновление пула контрактов каждые 24 часа в полночь по UTC).
4. **Хранение истории рейдов (Raid History Log)**:
   - Сохранять последние 20 рейдов аккаунта с детальной статистикой (карта, время, добыча, убийства, опыт).
