import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  child,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ═══════════════════════════════
// CONSTANTS
// ═══════════════════════════════
// Silpo branch UUID (Хмельницький, вул. Свободи 73 — externalId 2653)
// To change: fetch https://sf-ecom-api.silpo.ua/v1/uk/branches and pick branchId
const SILPO_BRANCH = "1edb7346-0ee4-6ec8-90f1-11a6c487168c";
const SILPO_API = "https://sf-ecom-api.silpo.ua/v1/uk/branches";

const DAYS = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П'ятниця",
  "Субота",
];
const DAYS_SH = ["НД", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const MONTHS = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];
// ── ДЕФОЛТНІ ПРИЙОМИ ЇЖІ ────────────────────────────────────────────────
// Використовуються як шаблон для нових людей. Кожна людина має свою копію
// в PEOPLE[pid].meals — її можна редагувати незалежно.
const DEFAULT_MEALS = [
  { key: "breakfast", name: "Сніданок",  time: "7:30",  ico: "🌅", cls: "ib"  },
  { key: "snack1",    name: "Перекус 1", time: "10:30", ico: "🥗", cls: "is"  },
  { key: "lunch",     name: "Обід",      time: "13:00", ico: "🍽️", cls: "il"  },
  { key: "snack2",    name: "Перекус 2", time: "16:30", ico: "🍎", cls: "is2" },
  { key: "dinner",    name: "Вечеря",    time: "19:00", ico: "🌙", cls: "id"  },
];

// Список заборонених продуктів за замовчуванням (підрядки для пошуку в назві)
const DEFAULT_FORBIDDEN = ['Лосось','Яловичина','Броколі','Свинина','Форель','Мигдаль','Горіх'];

// ── ДЕФОЛТНІ ЛЮДИ ───────────────────────────────────────────────────────
// Початковий стан PEOPLE для першого запуску. Після завантаження з Firebase
// замінюється на дані з БД. Зберігаємо id 'you'/'her' щоб не мігрувати MENU.
const DEFAULT_PEOPLE = {
  you: {
    id: 'you',
    name: 'Ти',
    color: '#c8f54a',
    age: null,
    weight: null,
    targets: { kcal: 2200, protein: 175, fat: 70, carbs: 218 },
    forbidden: [...DEFAULT_FORBIDDEN],
    meals: JSON.parse(JSON.stringify(DEFAULT_MEALS)),
    waterTarget: '3–3.5 л',
    order: 0,
  },
  her: {
    id: 'her',
    name: 'Вона',
    color: '#ff6b35',
    age: null,
    weight: null,
    targets: { kcal: 1800, protein: 100, fat: 65, carbs: 195 },
    forbidden: [...DEFAULT_FORBIDDEN],
    meals: JSON.parse(JSON.stringify(DEFAULT_MEALS)),
    waterTarget: '1.5–2 л',
    order: 1,
  },
};

// ── КАТЕГОРІЇ СІЛЬПО для авто-мапінгу ───────────────────────────────────
// Ключ — назва з INGREDIENT_POOL, значення — масив підрядків які мають
// зустрітися в sectionSlug продукту Сільпо. Без матчу — продукт відкидається.
const FOOD_CATEGORIES = {
  'Банан':                ['banany','frukty'],
  'Яблука':               ['iabluka','frukty'],
  'Апельсин':             ['tsytrus','apelsyn','frukty'],
  'Помідор':              ['pomidor','tomat','ovoch'],
  'Огірок':               ['ohirk','ovoch'],
  'Картопля':             ['kartopl','ovoch'],
  'Куряче філе':          ['kuriach','kurka','filie','miaso-pti'],
  'Яйця курячі':          ['iaits','iaitse','iaichn'],
  'Гречка':               ['hrechk','krup'],
  'Рис':                  ['rys','krup'],
  'Кефір 1%':             ['kefir'],
  'Йогурт грецький':      ['yogurt','iohurt','grets'],
  'Тунець консервований': ['tunets','rybni-konserv','konserv-rybn'],
};

// ── ПУЛ ІНГРЕДІЄНТІВ для динамічної генерації плану ─────────────────────
// Кожен інгредієнт: n=назва (узгоджена з FOOD_CATEGORIES для пошуку Сільпо),
// k=приблизна калорійність на 100г (використовується тільки для розрахунку
// порцій до моменту коли autoFillWeek підтягне точні дані з Сільпо).
// Each ingredient has full per-100g nutrition + realistic portion bounds.
// k=kcal, p=protein, f=fat, c=carbs (per 100g)
// def=default serving in grams, min/max=portion bounds (нікого не змусиш зʼїсти 1.4 кг помідорів)
// These bounds drive sane portion sizing — only "main" categories
// (protein, carb) get scaled to hit the meal's kcal target; dairy/fruit/veggie
// stay close to their default serving so the day looks like a real meal.
const INGREDIENT_POOL = {
  protein: [
    { n: 'Куряче філе',          k: 110, p: 23,  f: 1.2, c: 0,   def: 150, min: 80,  max: 250 },
    { n: 'Яйця курячі',          k: 155, p: 13,  f: 11,  c: 1.1, def: 110, min: 55,  max: 220 },
    { n: 'Тунець консервований', k: 116, p: 26,  f: 1,   c: 0,   def: 150, min: 80,  max: 250 },
  ],
  dairy: [
    { n: 'Йогурт грецький', k: 60, p: 10, f: 0.4, c: 4, def: 150, min: 100, max: 250 },
    { n: 'Кефір 1%',        k: 40, p: 3,  f: 1,   c: 4, def: 250, min: 150, max: 400 },
  ],
  carb: [
    { n: 'Гречка',   k: 343, p: 13, f: 3.4, c: 62, def: 100, min: 50,  max: 180 },
    { n: 'Рис',      k: 350, p: 7,  f: 1,   c: 78, def: 100, min: 50,  max: 180 },
    { n: 'Картопля', k: 77,  p: 2,  f: 0.1, c: 17, def: 200, min: 100, max: 350 },
  ],
  fruit: [
    { n: 'Банан',    k: 89, p: 1.1, f: 0.3, c: 23, def: 120, min: 80,  max: 240 },
    { n: 'Яблука',   k: 52, p: 0.3, f: 0.2, c: 14, def: 150, min: 100, max: 250 },
    { n: 'Апельсин', k: 47, p: 0.9, f: 0.1, c: 12, def: 150, min: 100, max: 250 },
  ],
  veggie: [
    { n: 'Огірок',  k: 16, p: 0.7, f: 0.1, c: 3.6, def: 100, min: 50, max: 200 },
    { n: 'Помідор', k: 18, p: 0.9, f: 0.2, c: 3.9, def: 100, min: 50, max: 200 },
  ],
};

// Categories that scale freely with meal kcal target (high-density "main" food).
// Other categories (dairy/fruit/veggie) stay near their default portion.
const SCALABLE_CATEGORIES = new Set(['protein', 'carb']);

// Lookup an ingredient by name across all categories
function findInPool(name) {
  for (const cat of Object.keys(INGREDIENT_POOL)) {
    const found = INGREDIENT_POOL[cat].find(i => i.n === name);
    if (found) return found;
  }
  return null;
}

// Ensure FOODS has an entry for `name`. If missing:
//   - if name is in INGREDIENT_POOL → seed with built-in nutrition
//   - otherwise → create empty stub with 0 КБЖУ
// Either way the entry exists afterwards, so enrichFoodsFromSilpo will
// pick it up and try to fetch real nutrition from Silpo.
function ensureFoodInDirectory(name) {
  const key = foodKey(name);
  if (FOODS[key]) return FOODS[key];
  const known = findInPool(name);
  if (known) {
    FOODS[key] = {
      name,
      kcal:    known.k,
      protein: known.p ?? 0,
      fat:     known.f ?? 0,
      carbs:   known.c ?? 0,
      source: 'auto',
    };
  } else {
    // Unknown ingredient (e.g. user typed it manually). Create empty stub —
    // enrichFoodsFromSilpo will try to populate КБЖУ from Silpo on next pass.
    FOODS[key] = {
      name,
      kcal: 0, protein: 0, fat: 0, carbs: 0,
      source: 'auto',
    };
  }
  if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
  return FOODS[key];
}

// Get best available nutrition for an ingredient name. Prefers FOODS
// (which may have Silpo-accurate data after enrichment); falls back to POOL.
function getIngredientNutr(name) {
  const food = FOODS[foodKey(name)];
  if (food && food.kcal > 0) {
    return { kcal: food.kcal, protein: food.protein || 0, fat: food.fat || 0, carbs: food.carbs || 0 };
  }
  const pool = findInPool(name);
  if (pool) return { kcal: pool.k, protein: pool.p || 0, fat: pool.f || 0, carbs: pool.c || 0 };
  return null;
}

// Частка денних калорій для кожного типу прийому. Якщо в людини більше/менше
// прийомів — суми нормалізуються щоб давати 100% денних ккал.
const MEAL_KCAL_SHARE = {
  breakfast: 0.25,
  lunch:     0.32,
  dinner:    0.25,
  snack:     0.09,
};

// Які категорії інгредієнтів кладемо в кожен тип прийому
const MEAL_RECIPE = {
  breakfast: ['protein', 'dairy', 'fruit'],
  lunch:     ['protein', 'carb', 'veggie', 'veggie'],
  dinner:    ['protein', 'carb', 'veggie'],
  snack:     ['dairy', 'fruit'],
};

// Класифікує слот по його назві (UA/EN). Все що не впізнане → snack.
function classifyMealSlot(slotName) {
  const n = String(slotName || '').toLowerCase();
  if (/сніданок|breakfast/.test(n)) return 'breakfast';
  if (/обід|lunch/.test(n))         return 'lunch';
  if (/вечер|dinner/.test(n))       return 'dinner';
  return 'snack';
}

// Беремо інгредієнт з категорії з ротацією по дню+слоту, оминаючи forbidden.
function pickIngredient(category, day, offset, forbidden) {
  const list = INGREDIENT_POOL[category] || [];
  if (!list.length) return null;
  const start = ((day * 3 + offset) % list.length + list.length) % list.length;
  for (let i = 0; i < list.length; i++) {
    const item = list[(start + i) % list.length];
    const blocked = forbidden.some(f =>
      item.n.toLowerCase().includes(String(f).toLowerCase())
    );
    if (!blocked) return item;
  }
  return null; // everything in this category is forbidden for this person
}

// Генерує тиждень для однієї людини на основі її профіля.
// Враховує: targets, forbidden, meal slots (з override дня якщо є).
// Не перетирає override-меню дня — використовує його для розкладу прийомів.
function generateMenuForPerson(pid) {
  const targets   = getPersonTargets(pid);
  const forbidden = getPersonForbidden(pid);
  const dailyKcal = targets.kcal || 2000;
  const personMeals = getPersonMeals(pid);

  if (!MENU[pid]) MENU[pid] = {};

  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    // Use day-specific meals if overridden, otherwise person default
    const slots = MENU[pid][day]?.meals || personMeals;
    if (!slots || !slots.length) {
      MENU[pid][day] = { totals: { ...targets } };
      continue;
    }

    // Compute kcal share per slot, normalized so they sum to 1.0
    const types = slots.map(s => classifyMealSlot(s.name));
    const rawShares = types.map(t => MEAL_KCAL_SHARE[t] || 0.1);
    const totalShare = rawShares.reduce((s, x) => s + x, 0) || 1;
    const slotKcals = rawShares.map(s => Math.round(dailyKcal * s / totalShare));

    // Build new day, preserving meals override if present
    const newDay = { totals: { ...targets } };
    if (MENU[pid][day]?.meals) newDay.meals = MENU[pid][day].meals;

    slots.forEach((slot, idx) => {
      const type = types[idx];
      const recipe = MEAL_RECIPE[type] || MEAL_RECIPE.snack;
      const mealKcal = slotKcals[idx];

      // Pick ingredients for this meal
      const picks = [];
      recipe.forEach((cat, ci) => {
        const ing = pickIngredient(cat, day, idx * 5 + ci, forbidden);
        if (!ing) return;
        ensureFoodInDirectory(ing.n);
        // Use FOODS data if present (more accurate after Silpo enrichment),
        // otherwise fall back to POOL.
        const nutr = getIngredientNutr(ing.n) || { kcal: ing.k, protein: 0, fat: 0, carbs: 0 };
        picks.push({ ing, cat, nutr });
      });

      // Step 1: assign default portions (realistic single servings).
      // Use POOL bounds when available; otherwise fall back to a 100g default.
      const portions = picks.map(pk => pk.ing.def || 100);

      // Step 2: scale only "main" categories (protein/carb) to hit the meal's
      // kcal target. Sides (dairy/fruit/veggie) stay at default — that's what
      // prevents 1.4 kg of tomatoes for dinner.
      const mainIdx = picks.map((p, i) => SCALABLE_CATEGORIES.has(p.cat) ? i : -1).filter(i => i >= 0);
      if (mainIdx.length) {
        // Compute kcal contributed by sides (fixed) and current main contribution
        let sideKcal = 0, mainKcal = 0;
        picks.forEach((p, i) => {
          const k = portions[i] * (p.nutr.kcal || p.ing.k) / 100;
          if (mainIdx.includes(i)) mainKcal += k; else sideKcal += k;
        });
        const targetMainKcal = Math.max(0, mealKcal - sideKcal);
        // Distribute targetMainKcal across main items proportionally to their
        // current share, then clamp each to [min, max].
        if (mainKcal > 0) {
          const scale = targetMainKcal / mainKcal;
          for (const i of mainIdx) {
            const ing = picks[i].ing;
            const k = (picks[i].nutr.kcal || ing.k);
            let g = portions[i] * scale;
            // Clamp to realistic bounds; snap to nearest 10g; absolute floor 20g
            g = Math.max(ing.min || 30, Math.min(ing.max || 400, g));
            portions[i] = Math.max(20, Math.round(g / 10) * 10);
          }
        }
      }

      // Step 3: build items list with embedded nutrition + Silpo link if any
      const items = picks.map((pk, i) => {
        const item = {
          n: pk.ing.n,
          g: `${portions[i]}г`,
          kcal_per_100:    pk.nutr.kcal,
          protein_per_100: pk.nutr.protein,
          fat_per_100:     pk.nutr.fat,
          carbs_per_100:   pk.nutr.carbs,
        };
        const food = FOODS[foodKey(pk.ing.n)];
        if (food?.silpoSlug) {
          item.silpoSlug       = food.silpoSlug;
          item.silpoPrice      = food.silpoPrice      ?? null;
          item.silpoPriceRatio = food.silpoPriceRatio ?? null;
        }
        return item;
      });

      newDay[slot.key] = { kcal: mealKcal, items };
    });

    MENU[pid][day] = newDay;
  }
}



// ═══════════════════════════════
// STATE
// ═══════════════════════════════
let db = null,
  MENU = {},
  DIARY = {},
  FOODS = {},
  PEOPLE = JSON.parse(JSON.stringify(DEFAULT_PEOPLE));
let curDay = new Date().getDay(),
  person = "you",
  editMode = false;
let calY = new Date().getFullYear(),
  calM = new Date().getMonth(),
  calView = "month",
  selDate = null;
let _msCtx = null, _msFoods = [], _remapKey = null;

// ── PEOPLE ACCESSORS ────────────────────────────────────────────────────
// Use these everywhere instead of hardcoding 'you'/'her' or META.
function getPerson(pid)        { return PEOPLE[pid] || DEFAULT_PEOPLE[pid] || null; }
function getPersonName(pid)    { return getPerson(pid)?.name || pid; }
function getPersonColor(pid)   { return getPerson(pid)?.color || '#c8f54a'; }
function getPersonMeals(pid)   { return getPerson(pid)?.meals || DEFAULT_MEALS; }
function getPersonTargets(pid) { return getPerson(pid)?.targets || { kcal: 2000, protein: 150, fat: 65, carbs: 200 }; }
function getPersonForbidden(pid) { return getPerson(pid)?.forbidden || []; }
function getPersonWater(pid)   { return getPerson(pid)?.waterTarget || ''; }
function getPeopleIds() {
  return Object.values(PEOPLE)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(p => p.id);
}

// Per-day meal slots: returns the day's override if set, otherwise person default.
// Use this everywhere where (pid, day) is known — never iterate getPersonMeals(p)
// for a specific day, because the day may have its own custom slot config.
function getDayMeals(pid, day) {
  return MENU[pid]?.[day]?.meals || getPersonMeals(pid);
}

// Convert "#rrggbb" to "rgba(r,g,b,a)" for inline tinted backgrounds
function hexToRgba(hex, alpha = 1) {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

// Initialize MENU from plan template so first render has valid structure
applyPlanTemplate();

// ═══════════════════════════════
// FIREBASE SETUP
// ═══════════════════════════════
window.saveFirebaseConfig = function () {
  const cfg = {
    apiKey: document.getElementById("s_apiKey").value.trim(),
    authDomain: document.getElementById("s_authDomain").value.trim(),
    databaseURL: document.getElementById("s_dbUrl").value.trim(),
    projectId: document.getElementById("s_projectId").value.trim(),
    appId: document.getElementById("s_appId").value.trim(),
    storageBucket:
      document.getElementById("s_projectId").value.trim() +
      ".appspot.com",
    messagingSenderId: "000000000000",
  };
  if (!cfg.apiKey || !cfg.databaseURL) {
    showToast("Заповни всі поля!", "err");
    return;
  }
  localStorage.setItem("fb_cfg", JSON.stringify(cfg));
  document.getElementById("setupScreen").classList.add("hide");
  initFirebase(cfg);
};

function initFirebase(cfg) {
  document.getElementById("loader").style.display = "flex";
  document.getElementById("loaderSub").textContent =
    "Підключення до Firebase...";
  try {
    const app = initializeApp(cfg);
    db = getDatabase(app);
    document.getElementById("loaderSub").textContent =
      "Завантаження меню...";
    // Load people first (their forbidden lists drive auto-migration check below)
    const peopleRef = ref(db, "racion/people");
    onValue(peopleRef, (snap) => {
      const val = snap.val();
      if (val) {
        PEOPLE = val;
        // Heal each entry against DEFAULT_PEOPLE so missing fields don't crash UI
        for (const pid of Object.keys(PEOPLE)) {
          const def = DEFAULT_PEOPLE[pid] || {};
          PEOPLE[pid] = {
            ...def,
            ...PEOPLE[pid],
            meals: PEOPLE[pid].meals || def.meals || JSON.parse(JSON.stringify(DEFAULT_MEALS)),
            forbidden: PEOPLE[pid].forbidden || def.forbidden || [],
            targets: PEOPLE[pid].targets || def.targets || { kcal: 2000, protein: 150, fat: 65, carbs: 200 },
          };
        }
      } else {
        // First-time setup: write defaults to Firebase
        PEOPLE = JSON.parse(JSON.stringify(DEFAULT_PEOPLE));
        set(ref(db, "racion/people"), PEOPLE).catch(() => {});
      }
      // Re-render menu page since person info (name, targets, water) may have changed
      if (document.querySelector('#screen-menu')) renderMenuPage();
    });

    // Load menu from Firebase, fallback to defaults
    const menuRef = ref(db, "racion/menu");
    onValue(menuRef, (snap) => {
      const val = snap.val();
      if (val) MENU = val;
      // Auto-migrate: replace menu if it contains any per-person forbidden product
      const hasForbidden = getPeopleIds().some(p => {
        const fb = getPersonForbidden(p);
        if (!fb.length) return false;
        return [0,1,2,3,4,5,6].some(d =>
          getDayMeals(p, d).some(m =>
            (MENU[p]?.[d]?.[m.key]?.items || []).some(it =>
              fb.some(f => it.n?.toLowerCase().includes(String(f).toLowerCase()))
            )
          )
        );
      });
      if (hasForbidden || !val) {
        applyPlanTemplate();
        set(ref(db, "racion/menu"), MENU);
      }
      renderMenuPage();
      setSyncStatus("ok", "Синхронізовано");
    });
    // Load diary
    const diaryRef = ref(db, "racion/diary");
    onValue(diaryRef, (snap) => {
      const val = snap.val();
      if (val) DIARY = val;
    });
    // Load foods cache
    const foodsRef = ref(db, "racion/foods");
    onValue(foodsRef, (snap) => {
      const val = snap.val();
      if (val) FOODS = val;
      // Refresh directory if it's open
      const searchScreen = document.getElementById('screen-search');
      if (searchScreen?.classList.contains('active')) renderFoodsDir();
      // Re-render menu so item 📚/↗ links pick up freshly loaded FOODS data
      if (document.getElementById('mealsList')) renderMeals();
    });
    // Show app
    document.getElementById("loader").classList.add("hide");
    document.getElementById("mainNav").style.display = "flex";
    document
      .querySelectorAll(".screen")
      .forEach((s) => s.removeAttribute("style"));
    renderDays();
    renderMenuPage();
    logToday();
  } catch (e) {
    document.getElementById("loaderSub").textContent =
      "Помилка: " + e.message;
    showToast("Помилка Firebase — перевір дані", "err");
  }
}

// Use saved config, or fall back to hardcoded FIREBASE_CONFIG, then show setup form
const savedCfg = localStorage.getItem("fb_cfg");
const bootCfg = savedCfg ? JSON.parse(savedCfg) : (window.FIREBASE_CONFIG || null);
if (bootCfg) {
  document.getElementById("setupScreen").classList.add("hide");
  try {
    initFirebase(bootCfg);
  } catch (e) {
    document.getElementById("setupScreen").classList.remove("hide");
    document.getElementById("loader").classList.add("hide");
  }
} else {
  document.getElementById("loader").classList.add("hide");
}

// ═══════════════════════════════
// SYNC HELPERS
// ═══════════════════════════════
function setSyncStatus(state, txt) {
  const dot = document
    .getElementById("syncStatus")
    .querySelector(".sdot");
  dot.className =
    "sdot" +
    (state === "syncing"
      ? " syncing"
      : state === "err"
        ? " offline"
        : "");
  document.getElementById("syncTxt").textContent = txt;
}

async function pushMenu() {
  if (!db) return;
  setSyncStatus("syncing", "Зберігаємо...");
  try {
    await set(ref(db, "racion/menu"), MENU);
    setSyncStatus("ok", "Збережено ✓");
    setTimeout(() => setSyncStatus("ok", "Синхронізовано"), 2000);
  } catch (e) {
    setSyncStatus("err", "Помилка збереження");
    showToast("Помилка синхронізації", "err");
  }
}

async function pushDiary() {
  if (!db) return;
  try {
    await set(ref(db, "racion/diary"), DIARY);
  } catch (e) {}
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function keyToDate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function logToday() {
  const d = new Date(),
    key = dateKey(d),
    dow = d.getDay();
  if (!DIARY[key]) {
    DIARY[key] = {};
    for (const pid of getPeopleIds()) {
      DIARY[key][pid] = JSON.parse(JSON.stringify(MENU[pid]?.[dow] || {}));
    }
    pushDiary();
  }
}

// ═══════════════════════════════
// SCREEN SWITCHER
// ═══════════════════════════════
window.showScreen = function (s) {
  document
    .querySelectorAll(".screen")
    .forEach((x) => x.classList.remove("active"));
  document
    .querySelectorAll(".nav-tab")
    .forEach((x) => x.classList.remove("active"));
  document.getElementById("screen-" + s).classList.add("active");
  document.getElementById("nt-" + s).classList.add("active");
  if (s === "diary") renderCal();
  if (s === "search") renderFoodsDir();
  if (s === "profile") { renderPeople(); refreshAISettingsUI(); }
};

// ═══════════════════════════════
// MENU
// ═══════════════════════════════
window.goToday = function () {
  curDay = new Date().getDay();
  renderDays();
  renderMenuPage();
};

function renderDays() {
  const sc = document.getElementById("daysScroll");
  const now = new Date();
  const todayDow = now.getDay(); // 0=Sun
  // ISO week: Mon=1..Sat=6, Sun=7
  const todayIso = todayDow === 0 ? 7 : todayDow;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (todayIso - 1));
  sc.innerHTML = "";
  [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
    // d=0 is Sunday = ISO day 7 = monday + 6
    const isoD = d === 0 ? 7 : d;
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + (isoD - 1));
    const dateNum = dt.getDate();
    const b = document.createElement("div");
    b.className =
      "day-btn" +
      (d === curDay ? " active" : "") +
      (d === todayDow && d !== curDay ? " today" : "");
    b.innerHTML = `<span class="ds">${DAYS_SH[d]}</span><span class="da">${dateNum}</span>`;
    b.onclick = () => {
      curDay = d;
      renderDays();
      renderMenuPage();
    };
    sc.appendChild(b);
  });
}

window.setPerson = function (p) {
  if (!getPerson(p)) p = getPeopleIds()[0];  // fallback if person was deleted
  person = p;
  // Active person color drives --current-person CSS variable used in
  // .meal-kc and .vitems li::before across the menu screen.
  document.body.style.setProperty('--current-person', getPersonColor(p));
  renderMenuPage();
};

// Build the person tab strip from PEOPLE; called by renderMenuPage and any
// time the people set changes (add/remove/edit person).
function renderPtabs() {
  const c = document.getElementById('ptabs');
  if (!c) return;
  const ids = getPeopleIds();
  // Self-heal: if current person was deleted, switch to first available
  if (!ids.includes(person) && ids.length) person = ids[0];
  c.innerHTML = ids.map(pid => {
    const p = getPerson(pid);
    const active = pid === person;
    const color = p?.color || '#c8f54a';
    const tgt = p?.targets || {};
    const inline = active
      ? `border-color:${color};background:${hexToRgba(color, .07)};`
      : '';
    const nameStyle = active ? `color:${color};` : '';
    return `<div class="ptab${active ? ' active' : ''}" style="${inline}" onclick="setPerson('${pid}')">
      <span class="pn" style="${nameStyle}">${escapeHtml(p?.name || pid)}</span>
      <span class="pk">${(tgt.kcal || 0).toLocaleString('uk-UA')} ккал</span>
    </div>`;
  }).join('');
}

window.toggleEdit = function () {
  editMode = !editMode;
  document.getElementById("btnEdit").classList.toggle("on", editMode);
  document.getElementById("editBanner").classList.toggle("on", editMode);
  document.getElementById("savebar").classList.toggle("on", editMode);
  document.getElementById("etr").classList.toggle("on", editMode);
  document.getElementById("dayMealsBtn").style.display = editMode ? "block" : "none";
  if (editMode) {
    const t = MENU[person][curDay].totals;
    document.getElementById("et_k").value = t.kcal;
    document.getElementById("et_p").value = t.protein;
    document.getElementById("et_f").value = t.fat;
    document.getElementById("et_c").value = t.carbs;
  }
  renderMeals();
};

window.cancelEdit = function () {
  editMode = false;
  ["btnEdit", "editBanner", "savebar", "etr"].forEach((id) =>
    document.getElementById(id).classList.remove("on"),
  );
  document.getElementById("dayMealsBtn").style.display = "none";
  renderMenuPage();
};

window.saveEdit = async function () {
  const btn = document.getElementById("bsave");
  btn.disabled = true;
  btn.textContent = "Зберігаємо...";
  const t = MENU[person][curDay].totals;
  t.kcal = parseInt(document.getElementById("et_k").value) || t.kcal;
  t.protein =
    parseInt(document.getElementById("et_p").value) || t.protein;
  t.fat = parseInt(document.getElementById("et_f").value) || t.fat;
  t.carbs = parseInt(document.getElementById("et_c").value) || t.carbs;
  await pushMenu();
  // update diary for today
  const key = dateKey(new Date()),
    dow = new Date().getDay();
  if (String(curDay) === String(dow)) {
    DIARY[key] = {};
    for (const pid of getPeopleIds()) {
      DIARY[key][pid] = JSON.parse(JSON.stringify(MENU[pid]?.[dow] || {}));
    }
    await pushDiary();
  }
  editMode = false;
  ["btnEdit", "editBanner", "savebar", "etr"].forEach((id) =>
    document.getElementById(id).classList.remove("on"),
  );
  document.getElementById("dayMealsBtn").style.display = "none";
  btn.disabled = false;
  btn.textContent = "☁️ Зберегти для обох";
  renderMenuPage();
  showToast("☁️ Збережено для обох!");
};

function renderMenuPage() {
  // Self-heal active person if it was deleted
  const ids = getPeopleIds();
  if (ids.length && !ids.includes(person)) person = ids[0];
  // Sync the active-person color variable in case of fresh load
  document.body.style.setProperty('--current-person', getPersonColor(person));
  renderPtabs();
  document.getElementById("dayLbl").textContent = DAYS[curDay];
  const pname = getPersonName(person);
  const tgt = getPersonTargets(person);
  document.getElementById("daySub").textContent =
    `${pname} · ${tgt.kcal.toLocaleString('uk-UA')} ккал`;
  document.getElementById("waterG").textContent = getPersonWater(person) || '—';
  renderMeals();
  renderTotals();
}

function renderTotals() {
  const t = MENU[person][curDay].totals;
  let kcal = 0, protein = 0, fat = 0, carbs = 0, anyAuto = false;
  getDayMeals(person, curDay).forEach(m => {
    const meal = MENU[person][curDay][m.key];
    if (!meal) return;
    const calc = calcMealNutr(meal);
    if (calc) {
      kcal    += calc.kcal;
      protein += calc.protein;
      fat     += calc.fat;
      carbs   += calc.carbs;
      anyAuto = true;
    } else {
      kcal += meal.kcal || 0;
    }
  });
  protein = Math.round(protein * 10) / 10;
  fat     = Math.round(fat     * 10) / 10;
  carbs   = Math.round(carbs   * 10) / 10;
  const pv = anyAuto ? protein + "г" : t.protein + "г";
  const fv = anyAuto ? fat     + "г" : t.fat     + "г";
  const cv = anyAuto ? carbs   + "г" : t.carbs   + "г";
  document.getElementById("totGrid").innerHTML = `
    <div class="ti2"><span class="tv">${kcal}</span><span class="tl">ккал</span></div>
    <div class="ti2"><span class="tv">${pv}</span><span class="tl">білок</span></div>
    <div class="ti2"><span class="tv">${fv}</span><span class="tl">жири</span></div>
    <div class="ti2"><span class="tv">${cv}</span><span class="tl">вуглев.</span></div>`;
}

function renderMeals() {
  const list = document.getElementById("mealsList");
  list.innerHTML = "";
  // Use day-specific meal slots if overridden; otherwise person default
  const pmeals = getDayMeals(person, curDay);
  const day = MENU[person][curDay];
  for (const m of pmeals) {
    if (!day[m.key]) day[m.key] = { kcal: 0, items: [] };
  }
  pmeals.forEach((m, idx) => {
    const meal = MENU[person][curDay][m.key];
    const card = document.createElement("div");
    card.className =
      "meal-card" +
      (idx > 0 ? " collapsed" : "") +
      (editMode ? " em" : "");
    card.id = "mc_" + m.key;
    let body = "";
    if (editMode) {
      const rows = meal.items.map((it, i) => {
        const hasN = it.kcal_per_100 != null && parseG(it.g) > 0;
        const iKc = hasN ? Math.round(parseG(it.g) * it.kcal_per_100 / 100) : 0;
        return `
  <div class="erow">
    <input class="ein ein-search" value="${(it.n||'').replace(/"/g,'&quot;')}" placeholder="🔍 Пошук в Сільпо..." readonly onclick="openMSearch('${m.key}',${i})">
    <input class="ein sm" value="${it.g||''}" placeholder="г" oninput="updG('${m.key}',${i},this.value)">
    <span class="item-kcal" id="ikcal_${m.key}_${i}" ${!hasN?'style="display:none"':''}>${iKc}кк</span>
    <button class="bdel" onclick="delRow('${m.key}',${i})">✕</button>
  </div>`;
      }).join("");
      const mCalc = calcMealNutr(meal);
      const allAuto = mCalc != null && !mCalc.partial;
      const autoTotal = mCalc != null ? mCalc.kcal : meal.kcal;
      if (allAuto) meal.kcal = autoTotal;
      body = `<div class="mbody"><div class="eitems">${rows}</div>
  <div class="emf">
    <button class="badd" onclick="addRow('${m.key}')">+ Додати</button>
    <div class="ek-wrap">
      <input class="ekc" id="ekc_${m.key}" value="${autoTotal}" oninput="updKcal('${m.key}',this.value)" ${allAuto?'style="border-color:var(--accent);color:var(--accent)"':''}>
      <span>${allAuto?'<span class="auto-lbl">авто</span> ':''} ккал</span>
    </div>
  </div></div>`;
    } else {
      const lis = meal.items.map(it => {
        const g = parseG(it.g);
        const iKcal = (it.kcal_per_100 != null && g > 0)
          ? Math.round(g * it.kcal_per_100 / 100) : null;
        const srcLink = getItemSourceLink(it);
        return `<li>${it.n || ""}${it.g ? `<span class="vgr">${it.g}</span>` : ""}${iKcal != null ? `<span class="item-kcal">${iKcal}кк</span>` : ""}${srcLink}</li>`;
      }).join("");
      body = `<div class="mbody"><ul class="vitems">${lis}</ul></div>`;
    }
    const calc = calcMealNutr(meal);
    const displayKcal = calc != null ? calc.kcal : (meal.kcal || 0);
    card.innerHTML = `
<div class="meal-hdr" onclick="toggleCard('${m.key}')">
  <div class="meal-left">
    <div class="meal-ico ${m.cls}">${m.ico}</div>
    <div><div class="meal-nm">${m.name}</div><div class="meal-tm">${m.time}</div></div>
  </div>
  <div class="meal-r">
    <div class="meal-kc" id="mkc_${m.key}">${displayKcal} ккал</div>
    <div class="arr">▼</div>
  </div>
</div>${body}`;
    list.appendChild(card);
    if (editMode) card.classList.remove("collapsed");
  });
}

window.toggleCard = (k) => {
  if (!editMode)
    document.getElementById("mc_" + k).classList.toggle("collapsed");
};
window.upd = (mk, i, f, v) => {
  MENU[person][curDay][mk].items[i][f] = v;
};
window.updKcal = (mk, v) => {
  MENU[person][curDay][mk].kcal = parseInt(v) || 0;
  const el = document.getElementById("mkc_" + mk);
  if (el) el.textContent = (parseInt(v) || 0) + " ккал";
};
window.delRow = (mk, i) => {
  MENU[person][curDay][mk].items.splice(i, 1);
  renderMeals();
};
window.addRow = (mk) => {
  MENU[person][curDay][mk].items.push({ n: "", g: "" });
  renderMeals();
  setTimeout(() => {
    const c = document.getElementById("mc_" + mk);
    if (c) {
      const rr = c.querySelectorAll(".erow");
      if (rr.length)
        rr[rr.length - 1].scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
    }
  }, 80);
};

// ═══════════════════════════════
// FOOD AUTO-CALC
// ═══════════════════════════════
function foodKey(n) {
  return n.toLowerCase().trim().replace(/[.#$[\]/\s]+/g, "_");
}

// Parse gram value from any string: "220г", "2шт", "4 яйця", "150" → grams
function parseG(g) {
  if (!g && g !== 0) return 0;
  const s = String(g).trim().toLowerCase();
  const n = parseFloat(s.replace(/[^\d.]/g, "")) || 0;
  if (!n) return 0;
  if (/яйц/.test(s)) return Math.round(n * 55); // 1 яйце ≈ 55г
  return n;
}

// Calculate nutrition for a meal from its items' Silpo data
// Returns { kcal, protein, fat, carbs, partial } or null if no data at all
function calcMealNutr(meal) {
  const items = meal.items || [];
  let kcal = 0, protein = 0, fat = 0, carbs = 0, count = 0;
  for (const it of items) {
    const g = parseG(it.g);
    if (it.kcal_per_100 != null && g > 0) {
      kcal    += Math.round(g * it.kcal_per_100 / 100);
      protein += it.protein_per_100 != null ? g * it.protein_per_100 / 100 : 0;
      fat     += it.fat_per_100     != null ? g * it.fat_per_100     / 100 : 0;
      carbs   += it.carbs_per_100   != null ? g * it.carbs_per_100   / 100 : 0;
      count++;
    }
  }
  if (!count) return null;
  return {
    kcal,
    protein: Math.round(protein * 10) / 10,
    fat:     Math.round(fat     * 10) / 10,
    carbs:   Math.round(carbs   * 10) / 10,
    partial: count < items.length,
  };
}

function recalcMealKcal(mk) {
  const meal = MENU[person][curDay][mk];
  const calc = calcMealNutr(meal);
  if (!calc) return;
  meal.kcal = calc.kcal;
  const el = document.getElementById("mkc_" + mk);
  if (el) el.textContent = calc.kcal + " ккал";
  const ekc = document.getElementById("ekc_" + mk);
  if (ekc) { ekc.value = calc.kcal; ekc.style.borderColor = "var(--accent)"; ekc.style.color = "var(--accent)"; }
  renderTotals();
}

window.updG = function(mk, i, v) {
  MENU[person][curDay][mk].items[i].g = v;
  const iEl = document.getElementById("ikcal_" + mk + "_" + i);
  if (iEl) {
    const it = MENU[person][curDay][mk].items[i];
    const g = parseG(v);
    if (it.kcal_per_100 && g > 0) {
      iEl.textContent = Math.round(g * it.kcal_per_100 / 100) + "кк";
      iEl.style.display = "";
    } else {
      iEl.style.display = "none";
    }
  }
  recalcMealKcal(mk);
};

window.openMSearch = function(mk, i) {
  _msCtx = { mk, i };
  const cur = MENU[person][curDay][mk].items[i];
  document.getElementById("msInp").value = cur.n || "";
  document.getElementById("msRes").innerHTML = "";
  document.getElementById("msearch").classList.add("on");
  setTimeout(() => document.getElementById("msInp").focus(), 120);
};

window.closeMSearch = function() {
  document.getElementById("msearch").classList.remove("on");
  _msCtx = null;
  _remapKey = null;
};

window.doMSearch = async function() {
  const q = document.getElementById("msInp").value.trim();
  if (!q) return;
  const res = document.getElementById("msRes");
  const btn = document.querySelector(".msd-btn");
  btn.disabled = true;
  res.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px"><div class="spin" style="margin:0 auto 8px"></div><br>Шукаємо в Сільпо...</div>`;
  try {
    const r = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products?limit=20&search=${encodeURIComponent(q)}`, {
      headers: { accept: "application/json" }
    });
    const data = await r.json();
    // Smart sort: exact/word matches first, shorter titles preferred
    // No category filter — manual mode lets user pick anything
    const items = (data.items || []).slice().sort((a, b) =>
      silpoMatchScore(q, a, null) - silpoMatchScore(q, b, null)
    );
    if (!items.length) {
      res.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">😔 Нічого не знайдено в Сільпо</div>`;
    } else {
      _msFoods = items;
      res.innerHTML = items.map((p, idx) => {
        const price = p.displayPrice ? `${p.displayPrice} грн/${p.displayRatio || "шт"}` : "";
        const thumb = p.icon ? `<img src="https://images.silpo.ua/products/100x100/${p.icon}" style="width:38px;height:38px;object-fit:contain;border-radius:6px;background:var(--card2);flex-shrink:0;margin-right:9px" onerror="this.style.display='none'">` : '';
        return `<div class="msd-item" onclick="selectMsItem(${idx})" style="display:flex;align-items:center">
          ${thumb}
          <div style="flex:1;min-width:0">
            <div class="msd-iname">${p.title}${p.brandTitle ? ` <span style="color:var(--muted);font-weight:400">${p.brandTitle}</span>` : ""}</div>
            <div class="msd-imac"><span style="color:var(--muted)">${price}</span></div>
          </div>
        </div>`;
      }).join("");
    }
  } catch(e) {
    res.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">⚠️ Помилка мережі</div>`;
  }
  btn.disabled = false;
};

// Router — picks behavior based on whether we're in remap or edit-row mode
window.selectMsItem = function(idx) {
  if (_remapKey === '__newfood__') return applyNewFoodSilpo(idx);
  if (_remapKey) return applyRemap(idx);
  return selectFoodForEdit(idx);
};

// Parse Silpo nutrient attributeGroups → { kcal, protein, fat, carbs }
function parseSilpoNutr(attributeGroups) {
  const group = (attributeGroups || []).find(ag => ag.key === "nutrient");
  if (!group) return null;
  const get = (key) => {
    const a = group.attributes.find(a => a.attribute.key === key);
    if (!a) return null;
    const v = a.value;
    // title holds numeric value; key holds "kcal/kJ" string for calorie
    if (key === "calorie") {
      const raw = v.key || v.title || "";
      return parseFloat(String(raw).replace(",",".").split("/")[0]) || null;
    }
    return v.title != null ? parseFloat(v.title) : null;
  };
  const kcal = get("calorie");
  if (!kcal) return null;
  return { kcal, protein: get("proteins"), fat: get("fats"), carbs: get("carbohydrates") };
}

window.selectFoodForEdit = async function(idx) {
  if (!_msCtx) return;
  const p = _msFoods[idx];
  const res = document.getElementById("msRes");
  // Show loading state on clicked item
  const el = res.querySelectorAll(".msd-item")[idx];
  if (el) el.querySelector(".msd-imac").innerHTML = `<span style="color:var(--accent)">Завантажуємо КБЖУ...</span>`;

  let nutr = null;
  try {
    const r = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products/${p.slug}`, {
      headers: { accept: "application/json" }
    });
    const detail = await r.json();
    nutr = parseSilpoNutr(detail.attributeGroups);
  } catch(e) {}

  const { mk, i } = _msCtx;
  const item = MENU[person][curDay][mk].items[i];
  const alias = item.n || p.title; // keep existing alias, fall back to Silpo title
  item.n = alias;
  item.silpoId = p.id;
  item.silpoSlug = p.slug;
  item.silpoPrice = p.displayPrice;
  item.silpoPriceRatio = p.displayRatio;
  if (nutr) {
    item.kcal_per_100 = nutr.kcal;
    item.protein_per_100 = nutr.protein;
    item.fat_per_100 = nutr.fat;
    item.carbs_per_100 = nutr.carbs;
    // Save to directory with alias + Silpo origin
    const key = foodKey(alias);
    FOODS[key] = { name: alias, silpoTitle: p.title, silpoSlug: p.slug, silpoIcon: p.icon || null, source: 'silpo', ...nutr };
    if (db) set(ref(db, "racion/foods/" + key), FOODS[key]).catch(() => {});
  }
  closeMSearch();
  renderMeals();
};

// ═══════════════════════════════
// FOOD DIRECTORY
// ═══════════════════════════════
let _editingFoodKey = null;

window.showFdTab = function(tab) {
  document.getElementById('fd-tab-dir').classList.toggle('active', tab === 'dir');
  document.getElementById('fd-tab-silpo').classList.toggle('active', tab === 'silpo');
  document.getElementById('fd-dir').style.display   = tab === 'dir'   ? '' : 'none';
  document.getElementById('fd-silpo').style.display = tab === 'silpo' ? '' : 'none';
  if (tab === 'dir') renderFoodsDir();
};

window.renderFoodsDir = function() {
  const filter = (document.getElementById('dirFilter')?.value || '').toLowerCase();
  const list = document.getElementById('dirList');
  if (!list) return;
  const entries = Object.entries(FOODS)
    .map(([key, val]) => ({
      key,
      name: val.name || key.replace(/_/g,' '),
      kcal: val.kcal || 0,
      protein: val.protein || 0,
      fat: val.fat || 0,
      carbs: val.carbs || 0,
      silpoTitle: val.silpoTitle || null,
      silpoSlug: val.silpoSlug || null,
      source: val.source || null,
    }))
    .filter(e => !filter || e.name.toLowerCase().includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));

  if (!entries.length) {
    list.innerHTML = `<div class="dir-empty">Довідник порожній.<br>Натисни 🤖 Автоплан → Оновити КБЖУ,<br>або додай продукти через пошук Сільпо,<br>або вручну кнопкою "+ Додати".</div>`;
    return;
  }
  list.innerHTML = entries.map(e => {
    if (_editingFoodKey === e.key) return _dirEditRowHtml(e);
    const showSilpoTitle = e.silpoTitle && e.silpoTitle !== e.name;
    const linkHtml = e.silpoSlug
      ? (e.source === 'silpo'
          ? `<a class="dir-link-a" href="https://silpo.ua/product/${e.silpoSlug}" target="_blank" onclick="event.stopPropagation()">↗ Сільпо</a>`
          : `<span class="dir-link-off" title="Дані відредаговано вручну">✎ ред.</span>`)
      : '';
    const isSel = _dirSelected.has(e.key);
    const cbHtml = _dirSelectMode
      ? `<input type="checkbox" class="dir-row-cb" data-key="${e.key}" ${isSel ? 'checked' : ''} onchange="toggleDirItem('${e.key}')">`
      : '';
    const actionsHtml = _dirSelectMode ? '' : `<div class="dir-actions">
        <button class="dir-btn" onclick="event.stopPropagation();startEditFood('${e.key}')">✏️</button>
        <button class="dir-btn" onclick="event.stopPropagation();deleteFoodItem('${e.key}')">🗑️</button>
      </div>`;
    const rowClick = _dirSelectMode ? `toggleDirItem('${e.key}')` : `openPCard('${e.key}')`;
    return `<div class="dir-row${isSel ? ' sel' : ''}" style="${!_dirSelectMode ? 'cursor:pointer' : ''}" onclick="${rowClick}">
      ${cbHtml}
      <div class="dir-names">
        <div class="dir-alias">${e.name}</div>
        ${showSilpoTitle ? `<div class="dir-stitle">${e.silpoTitle}</div>` : ''}
      </div>
      <div class="dir-nutr">
        <span class="dn-k">${Math.round(e.kcal)}</span>
        <span>Б${+(e.protein).toFixed(1)}</span>
        <span>Ж${+(e.fat).toFixed(1)}</span>
        <span>В${+(e.carbs).toFixed(1)}</span>
      </div>
      ${_dirSelectMode ? '' : linkHtml}
      ${actionsHtml}
    </div>`;
  }).join('');
};

function _dirEditRowHtml(e) {
  const srcInfo = e.silpoSlug
    ? `<div class="dir-src-info">Джерело: <a href="https://silpo.ua/product/${e.silpoSlug}" target="_blank">${e.silpoTitle || e.name}</a>${e.source==='manual' ? ' (відредаговано)' : ''}<br><small style="color:var(--muted)">Після збереження посилання стане неактивним</small></div>`
    : '';
  return `<div class="dir-edit-row">
    <input class="dir-edit-name" id="de_name" value="${e.name||''}" placeholder="Назва (аліас)">
    <div class="dir-edit-grid">
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_kcal" type="number" value="${Math.round(e.kcal)||''}"><div class="dir-edit-lbl">Ккал</div></div>
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_prot" type="number" step="0.1" value="${+(e.protein).toFixed(1)||''}"><div class="dir-edit-lbl">Білок г</div></div>
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_fat"  type="number" step="0.1" value="${+(e.fat).toFixed(1)||''}"><div class="dir-edit-lbl">Жири г</div></div>
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_carb" type="number" step="0.1" value="${+(e.carbs).toFixed(1)||''}"><div class="dir-edit-lbl">Вуглев г</div></div>
    </div>
    ${srcInfo}
    <div class="dir-edit-btns">
      <button class="dir-save-btn" onclick="saveFoodItem('${e.key}')">Зберегти</button>
      <button class="dir-cancel-btn" onclick="cancelEditFood()">Скасувати</button>
    </div>
  </div>`;
}

window.startEditFood = function(key) {
  _editingFoodKey = key;
  renderFoodsDir();
  setTimeout(() => document.getElementById('de_name')?.focus(), 50);
};

window.cancelEditFood = function() {
  _editingFoodKey = null;
  _newFoodSilpoData = null;
  renderFoodsDir();
};

// ── BULK SELECT ─────────────────────────────────────────────────────────
let _dirSelectMode = false;
let _dirSelected = new Set();

window.toggleDirSelectMode = function() {
  _dirSelectMode = !_dirSelectMode;
  _dirSelected.clear();
  document.getElementById('dirSelBar').classList.toggle('on', _dirSelectMode);
  document.getElementById('btnDirSel').style.color = _dirSelectMode ? 'var(--accent2)' : '';
  document.getElementById('btnDirSel').style.borderColor = _dirSelectMode ? 'var(--accent2)' : '';
  renderFoodsDir();
};

window.toggleDirItem = function(key) {
  if (_dirSelected.has(key)) _dirSelected.delete(key);
  else _dirSelected.add(key);
  _updateSelCount();
  // Toggle .sel class without re-rendering
  const rows = document.querySelectorAll('.dir-row');
  rows.forEach(r => {
    const cb = r.querySelector('.dir-row-cb');
    if (cb?.dataset.key === key) {
      cb.checked = _dirSelected.has(key);
      r.classList.toggle('sel', _dirSelected.has(key));
    }
  });
};

function _updateSelCount() {
  document.getElementById('dirSelCount').textContent = `${_dirSelected.size} обрано`;
}

window.dirSelectAll = function() {
  const filter = (document.getElementById('dirFilter')?.value || '').toLowerCase();
  Object.entries(FOODS).forEach(([key, val]) => {
    const name = (val.name || key).toLowerCase();
    if (!filter || name.includes(filter)) _dirSelected.add(key);
  });
  _updateSelCount();
  renderFoodsDir();
};

window.dirDeselectAll = function() {
  _dirSelected.clear();
  _updateSelCount();
  renderFoodsDir();
};

window.deleteSelected = function() {
  if (!_dirSelected.size) { showToast('Нічого не обрано'); return; }
  if (!confirm(`Видалити ${_dirSelected.size} продуктів з довідника?`)) return;
  const batch = [];
  _dirSelected.forEach(key => {
    delete FOODS[key];
    if (db) batch.push(set(ref(db, 'racion/foods/' + key), null).catch(() => {}));
  });
  Promise.all(batch);
  _dirSelected.clear();
  _updateSelCount();
  renderFoodsDir();
  showToast(`Видалено ✓`);
};

window.openDirItem = function(key) {
  // Open product card directly
  openPCard(key);
};

// ─── PRODUCT CARD ────────────────────────────────────────────────────────
let _pcardKey = null;

window.openPCard = function(key) {
  const food = FOODS[key];
  if (!food) return;
  _pcardKey = key;

  // Image — silpoIcon is just the filename (UUID.png), need to build full URL
  const imgWrap = document.getElementById('pcardImgWrap');
  const imgUrl = food.silpoIcon ? `https://images.silpo.ua/products/350x350/${food.silpoIcon}` : null;
  if (imgUrl) {
    imgWrap.innerHTML = `<img class="pcard-img" src="${imgUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt=""><div class="pcard-img-none" style="display:none">🛒</div>`;
  } else {
    imgWrap.innerHTML = `<div class="pcard-img-none">🛒</div>`;
  }

  const alias = food.name || key.replace(/_/g,' ');
  document.getElementById('pcardAlias').textContent = alias;
  const stitle = (food.silpoTitle && food.silpoTitle !== food.name) ? food.silpoTitle : '';
  document.getElementById('pcardStitle').textContent = stitle;
  document.getElementById('pcardStitle').style.display = stitle ? '' : 'none';
  document.getElementById('pcardKcal').textContent = food.kcal != null ? Math.round(food.kcal) : '—';
  document.getElementById('pcardProt').textContent = food.protein != null ? +(food.protein).toFixed(1) : '—';
  document.getElementById('pcardFat').textContent  = food.fat     != null ? +(food.fat).toFixed(1)     : '—';
  document.getElementById('pcardCarb').textContent = food.carbs   != null ? +(food.carbs).toFixed(1)   : '—';

  const priceEl = document.getElementById('pcardPrice');
  priceEl.textContent = food.silpoPrice ? `${food.silpoPrice} грн/${food.silpoPriceRatio || 'шт'}` : '';

  const srcEl = document.getElementById('pcardSrc');
  if (food.silpoSlug) {
    const srcLabel = food.source === 'silpo' ? 'Дані з Сільпо' : 'Відредаговано вручну (Сільпо)';
    srcEl.innerHTML = `${srcLabel} · <a href="https://silpo.ua/product/${food.silpoSlug}" target="_blank" onclick="event.stopPropagation()">Відкрити ↗</a>`;
  } else {
    srcEl.textContent = 'Додано вручну';
  }

  const actEl = document.getElementById('pcardActions');
  const openBtn = (food.silpoSlug && food.source === 'silpo')
    ? `<a class="pcard-open-a" href="https://silpo.ua/product/${food.silpoSlug}" target="_blank" onclick="event.stopPropagation()">Відкрити в Сільпо ↗</a>`
    : `<div style="flex:1"></div>`;
  actEl.innerHTML = `${openBtn}
    <button class="pcard-edit-btn" title="Заповнити КБЖУ через AI (вбудовані дані)" onclick="applyAIFillFood('${key}')">🤖</button>
    <button class="pcard-edit-btn" title="Привʼязати до продукту в Сільпо" onclick="openRemap('${key}')">🔗</button>
    <button class="pcard-edit-btn" title="Редагувати КБЖУ" onclick="closePCard();showScreen('search');showFdTab('dir');startEditFood('${key}')">✏️</button>
    <button class="pcard-del-btn" title="Видалити" onclick="if(confirm('Видалити?')){deleteFoodItem('${key}');closePCard();}">🗑</button>`;

  document.getElementById('pcardModal').classList.add('on');
};

window.closePCard = function() {
  document.getElementById('pcardModal').classList.remove('on');
  _pcardKey = null;
};

// ─── MANUAL REMAP: pick a different Silpo product for a directory entry ──
// Fill КБЖУ for a directory entry from the built-in INGREDIENT_POOL ("AI knowledge").
// Does not touch silpoSlug if already linked — only updates the nutrition fields.
window.applyAIFillFood = function(key) {
  const food = FOODS[key];
  if (!food) return;
  const known = findInPool(food.name);
  if (!known) {
    showToast('AI не має даних для "' + food.name + '"', 'err');
    return;
  }
  FOODS[key] = {
    ...food,
    kcal:    known.k,
    protein: known.p ?? 0,
    fat:     known.f ?? 0,
    carbs:   known.c ?? 0,
  };
  if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
  renderFoodsDir();
  showToast('КБЖУ заповнено з AI ✓');
  // Re-open card with fresh data
  setTimeout(() => openPCard(key), 150);
};

window.openRemap = function(key) {
  _remapKey = key;
  _msCtx = null;
  // Close the product card so the search modal isn't covered by it.
  // applyRemap re-opens the card after a successful pick.
  document.getElementById('pcardModal').classList.remove('on');
  const food = FOODS[key];
  document.getElementById('msInp').value = food?.name || '';
  document.getElementById('msRes').innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Введи назву і натисни Шукати,<br>щоб обрати інший продукт з Сільпо</div>`;
  document.getElementById('msearch').classList.add('on');
  setTimeout(() => { const i = document.getElementById('msInp'); i.focus(); i.select(); }, 120);
};

window.applyRemap = async function(idx) {
  const key = _remapKey;
  if (!key) return;
  const p = _msFoods[idx];
  const res = document.getElementById('msRes');
  const el = res.querySelectorAll('.msd-item')[idx];
  if (el) {
    const mac = el.querySelector('.msd-imac');
    if (mac) mac.innerHTML = '<span style="color:var(--accent)">Завантажуємо КБЖУ...</span>';
  }
  let nutr = null;
  try {
    const r = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products/${p.slug}`, { headers: { accept: 'application/json' } });
    const detail = await r.json();
    nutr = parseSilpoNutr(detail.attributeGroups);
  } catch(e) {}
  // If any nutrient is missing in the new Silpo product → reset all to 0.
  // Link stays bound regardless (user explicitly chose this product).
  const hasFullNutr = nutr && nutr.kcal != null && nutr.protein != null && nutr.fat != null && nutr.carbs != null;
  const old = FOODS[key] || {};
  FOODS[key] = {
    name: old.name || p.title,
    silpoTitle: p.title,
    silpoSlug: p.slug,
    silpoIcon: p.icon || null,
    silpoPrice: p.displayPrice ?? null,
    silpoPriceRatio: p.displayRatio ?? null,
    source: 'silpo',
    kcal:    hasFullNutr ? nutr.kcal    : 0,
    protein: hasFullNutr ? nutr.protein : 0,
    fat:     hasFullNutr ? nutr.fat     : 0,
    carbs:   hasFullNutr ? nutr.carbs   : 0,
  };
  if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
  _remapKey = null;
  closeMSearch();
  renderFoodsDir();
  showToast('Оновлено ✓');
  // Re-open the card with new data
  setTimeout(() => openPCard(key), 180);
};

// ─── FORCE RE-FETCH: refresh all directory entries from Silpo ────────────
// Re-fetches КБЖУ, price, icon, slug for every product in FOODS using
// the new category-aware matcher. Skips manually edited entries.
window.refetchAllFoods = async function() {
  const keys = Object.keys(FOODS).filter(k => FOODS[k].source !== 'manual');
  if (!keys.length) { showToast('Немає продуктів для оновлення'); return; }
  if (!confirm(`Заново завантажити ${keys.length} продуктів з Сільпо?\n\nОновляться: КБЖУ, ціни, фото, назви.\nЗаписи відредаговані вручну не зміняться.`)) return;
  const overlay = document.getElementById('progOverlay');
  const bar     = document.getElementById('progBar');
  const title   = document.getElementById('progTitle');
  const sub     = document.getElementById('progSub');
  overlay.classList.add('on');
  bar.style.width = '0%';
  let done = 0, ok = 0;
  for (const key of keys) {
    const food = FOODS[key];
    const name = food.name || key;
    title.textContent = 'Оновлюємо з Сільпо...';
    sub.textContent = name;
    bar.style.width = `${Math.round(done / keys.length * 100)}%`;
    try {
      let items = [];
      for (const query of [name, name.split(' ')[0]]) {
        const sr = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products?limit=20&search=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' } });
        const sd = await sr.json();
        items = sd.items || [];
        if (items.length) break;
      }
      const best = pickBestSilpo(items, name);
      if (best) {
        const dr = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products/${best.slug}`, { headers: { accept: 'application/json' } });
        const detail = await dr.json();
        const nutr = parseSilpoNutr(detail.attributeGroups);
        if (nutr) {
          FOODS[key] = {
            name,
            silpoTitle: best.title,
            silpoSlug: best.slug,
            silpoIcon: best.icon || null,
            silpoPrice: best.displayPrice ?? null,
            silpoPriceRatio: best.displayRatio ?? null,
            source: 'silpo',
            ...nutr,
          };
          if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
          ok++;
        }
      }
    } catch(e) {}
    done++;
  }
  bar.style.width = '100%';
  title.textContent = '✓ Готово!';
  sub.textContent = `Оновлено ${ok} з ${keys.length}`;
  renderFoodsDir();
  setTimeout(() => overlay.classList.remove('on'), 1800);
};

function getItemSourceLink(it) {
  // FOODS is the single source of truth. Always show 📚 if the product
  // exists in the directory; additionally show ↗ Сільпо if the directory
  // entry has a silpoSlug attached.
  const key = foodKey(it.n || '');
  const food = FOODS[key];
  if (!food) return '';
  let html = `<span class="item-src-dir" onclick="openDirItem('${key}')" title="Відкрити картку продукту">📚</span>`;
  if (food.silpoSlug) {
    html += `<a class="item-src-a" href="https://silpo.ua/product/${food.silpoSlug}" target="_blank" title="Відкрити в Сільпо" onclick="event.stopPropagation()">↗</a>`;
  }
  return html;
}

window.saveFoodItem = function(originalKey) {
  const name   = document.getElementById('de_name')?.value.trim();
  if (!name) { showToast('Введи назву продукту'); return; }
  const kcal   = parseFloat(document.getElementById('de_kcal')?.value) || 0;
  const protein= parseFloat(document.getElementById('de_prot')?.value) || 0;
  const fat    = parseFloat(document.getElementById('de_fat')?.value)  || 0;
  const carbs  = parseFloat(document.getElementById('de_carb')?.value) || 0;
  const newKey = foodKey(name);
  // Delete old key if name changed
  if (originalKey !== '__new__' && newKey !== originalKey) {
    delete FOODS[originalKey];
    if (db) set(ref(db, 'racion/foods/' + originalKey), null).catch(() => {});
  }
  // For NEW entries created via the add form: if user picked Silpo or AI
  // via the prefill buttons, persist the source accordingly. Otherwise,
  // editing an existing entry → fully detaches Silpo binding (manual override).
  if (originalKey === '__new__' && _newFoodSilpoData) {
    FOODS[newKey] = {
      name, kcal, protein, fat, carbs,
      source: 'silpo',
      ..._newFoodSilpoData,
    };
  } else if (originalKey === '__new__' && findInPool(name)) {
    // New entry where AI prefill was used (or matches POOL by name)
    FOODS[newKey] = { name, kcal, protein, fat, carbs, source: 'auto' };
  } else {
    // Existing entry edited manually → drops any Silpo link
    FOODS[newKey] = { name, kcal, protein, fat, carbs, source: 'manual' };
  }
  _newFoodSilpoData = null;
  if (db) set(ref(db, 'racion/foods/' + newKey), FOODS[newKey]).catch(() => {});
  _editingFoodKey = null;
  renderFoodsDir();
  showToast('Збережено ✓');
};

window.deleteFoodItem = function(key) {
  const name = FOODS[key]?.name || key.replace(/_/g,' ');
  if (!confirm(`Видалити "${name}" з довідника?`)) return;
  delete FOODS[key];
  if (db) set(ref(db, 'racion/foods/' + key), null).catch(() => {});
  renderFoodsDir();
  showToast('Видалено');
};

window.startAddFood = function() {
  _editingFoodKey = '__new__';
  _newFoodSilpoData = null;
  const list = document.getElementById('dirList');
  const div = document.createElement('div');
  div.id = 'dir-add-row';
  div.innerHTML = `<div class="dir-edit-row">
    <input class="dir-edit-name" id="de_name" placeholder="Назва продукту">
    <div style="display:flex;gap:6px;margin:6px 0 10px;">
      <button class="dir-cancel-btn" style="flex:1" onclick="prefillNewFoodFromAI()" title="Заповнити з вбудованих AI-даних">🤖 AI</button>
      <button class="dir-cancel-btn" style="flex:1" onclick="prefillNewFoodFromSilpo()" title="Знайти продукт в Сільпо і привʼязати">🔗 Сільпо</button>
    </div>
    <div id="de_silpo_info" style="font-size:10px;color:var(--blue);margin-bottom:6px;display:none"></div>
    <div class="dir-edit-grid">
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_kcal" type="number" placeholder="0"><div class="dir-edit-lbl">Ккал</div></div>
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_prot" type="number" step="0.1" placeholder="0"><div class="dir-edit-lbl">Білок г</div></div>
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_fat"  type="number" step="0.1" placeholder="0"><div class="dir-edit-lbl">Жири г</div></div>
      <div class="dir-edit-cell"><input class="dir-edit-inp" id="de_carb" type="number" step="0.1" placeholder="0"><div class="dir-edit-lbl">Вуглев г</div></div>
    </div>
    <div class="dir-edit-btns">
      <button class="dir-save-btn" onclick="saveFoodItem('__new__')">Зберегти</button>
      <button class="dir-cancel-btn" onclick="cancelEditFood()">Скасувати</button>
    </div>
  </div>`;
  list.insertBefore(div, list.firstChild);
  setTimeout(() => document.getElementById('de_name')?.focus(), 50);
};

// Holds Silpo product data picked via 🔗 in the add form, so saveFoodItem
// can attach silpoSlug/icon/title when persisting the new entry.
let _newFoodSilpoData = null;

window.prefillNewFoodFromAI = function() {
  const name = document.getElementById('de_name')?.value.trim();
  if (!name) { showToast('Спочатку введи назву продукту'); return; }
  const known = findInPool(name);
  if (!known) { showToast('AI не має даних для "' + name + '"', 'err'); return; }
  document.getElementById('de_kcal').value = known.k;
  document.getElementById('de_prot').value = known.p ?? 0;
  document.getElementById('de_fat').value  = known.f ?? 0;
  document.getElementById('de_carb').value = known.c ?? 0;
  _newFoodSilpoData = null;
  document.getElementById('de_silpo_info').style.display = 'none';
  showToast('Заповнено з AI ✓');
};

window.prefillNewFoodFromSilpo = function() {
  const name = document.getElementById('de_name')?.value.trim();
  if (!name) { showToast('Спочатку введи назву продукту'); return; }
  // Reuse the existing search modal but with a special "new food" context
  _remapKey = '__newfood__';
  _msCtx = null;
  document.getElementById('msInp').value = name;
  document.getElementById('msRes').innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px">Натисни Шукати щоб знайти продукт у Сільпо</div>`;
  document.getElementById('msearch').classList.add('on');
  setTimeout(() => { const i = document.getElementById('msInp'); i.focus(); i.select(); }, 120);
};

// Called from selectMsItem when _remapKey === '__newfood__' — pick a Silpo
// product, fetch its nutrition, fill the new-food form, store data for save.
window.applyNewFoodSilpo = async function(idx) {
  const p = _msFoods[idx];
  const res = document.getElementById('msRes');
  const el = res.querySelectorAll('.msd-item')[idx];
  if (el) {
    const mac = el.querySelector('.msd-imac');
    if (mac) mac.innerHTML = '<span style="color:var(--accent)">Завантажуємо КБЖУ...</span>';
  }
  let nutr = null;
  try {
    const r = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products/${p.slug}`, { headers: { accept: 'application/json' } });
    const detail = await r.json();
    nutr = parseSilpoNutr(detail.attributeGroups);
  } catch(e) {}
  // Stash Silpo metadata for saveFoodItem to read
  _newFoodSilpoData = {
    silpoTitle:      p.title,
    silpoSlug:       p.slug,
    silpoIcon:       p.icon || null,
    silpoPrice:      p.displayPrice ?? null,
    silpoPriceRatio: p.displayRatio ?? null,
  };
  if (nutr) {
    document.getElementById('de_kcal').value = nutr.kcal    ?? 0;
    document.getElementById('de_prot').value = nutr.protein ?? 0;
    document.getElementById('de_fat').value  = nutr.fat     ?? 0;
    document.getElementById('de_carb').value = nutr.carbs   ?? 0;
  }
  const info = document.getElementById('de_silpo_info');
  if (info) {
    info.textContent = '🔗 ' + p.title;
    info.style.display = 'block';
  }
  _remapKey = null;
  closeMSearch();
  showToast('Привʼязано до Сільпо ✓');
};

// ═══════════════════════════════
// AUTO-FILL FROM SILPO
// ═══════════════════════════════

window.confirmAutoFill = function() {
  const hasKey = !!getAIKey();
  const provLabel = AI_PROVIDERS[getAIProvider()].label;
  showConfirm({
    icon: '🤖',
    title: 'Автоплан раціону',
    text: hasKey
      ? `${provLabel} згенерує тиждень з твого профіля (ккал, заборонені продукти, прийоми їжі).`
      : `Ще не налаштовано AI. Зайди в Профіль і додай ключ для ${provLabel}, або синхронізуй довідник без генерації.`,
    actions: [
      hasKey && {
        label: '✨ Згенерувати тиждень через AI',
        style: 'primary',
        onClick: () => autoFillWeek(true),
      },
      {
        label: '🔄 Тільки синхронізувати довідник',
        style: 'secondary',
        onClick: () => autoFillWeek(false),
      },
      { label: 'Скасувати', style: 'cancel' },
    ].filter(Boolean),
  });
};

// Score how well a Silpo product matches a query (lower = better).
// Honors category whitelist if provided. Returns 99999 if rejected.
function silpoMatchScore(query, item, allowedCats) {
  const q = (query||'').toLowerCase().trim();
  const t = (item.title||'').toLowerCase().trim();
  const slug = (item.sectionSlug||'').toLowerCase();
  if (allowedCats && allowedCats.length) {
    const ok = allowedCats.some(c => slug.includes(c));
    if (!ok) return 99999;
  }
  if (!q || !t) return 9999;
  const lenPenalty = t.length * 0.01;
  if (t === q) return 0;
  const firstWord = t.split(/[\s,«(]/)[0];
  if (firstWord === q) return 1 + lenPenalty;
  // Title starts with query as substring (e.g. "Бананові" for "Банан") — worse
  if (t.startsWith(q)) return 5 + lenPenalty;
  // Query as a whole word somewhere
  const escQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|[\\s,«(\\-])${escQ}([\\s,»)\\-]|$)`).test(t)) return 10 + lenPenalty;
  const idx = t.indexOf(q);
  if (idx === -1) return 9999;
  return 50 + idx + lenPenalty;
}

function pickBestSilpo(items, name) {
  if (!items || !items.length) return null;
  const allowedCats = FOOD_CATEGORIES[name] || null;
  let best = null, bestScore = 99999;
  for (const it of items) {
    const s = silpoMatchScore(name, it, allowedCats);
    if (s < bestScore) { bestScore = s; best = it; }
  }
  if (bestScore >= 9999) return null;
  return best;
}

function applyPlanTemplate() {
  // Generate the entire week for every person from their profile
  // (targets, forbidden, meal slots). Day-level meals overrides are
  // preserved by generateMenuForPerson.
  for (const pid of getPeopleIds()) {
    generateMenuForPerson(pid);
  }
}

// Walk every meal item in the week and ensure FOODS has an entry for it.
// Items in the generated plan are POOL ingredients (so ensureFoodInDirectory
// finds them); manually-added items may not be in POOL — those stay un-seeded
// and remain visible to the user with their existing КБЖУ if any.
function seedFoodsFromMenu() {
  for (const p of getPeopleIds()) {
    for (let d = 0; d <= 6; d++) {
      const dayData = MENU[p]?.[d];
      if (!dayData) continue;
      for (const m of getDayMeals(p, d)) {
        const meal = dayData[m.key];
        if (!meal?.items) continue;
        for (const it of meal.items) {
          if (it.n) ensureFoodInDirectory(it.n);
        }
      }
    }
  }
}

// For every FOODS entry that isn't already linked to Silpo and isn't a manual
// override, search Silpo and replace the entry's КБЖУ + attach slug/icon/price.
// Auto-seeded entries (source='auto') get upgraded to source='silpo' on success.
// Push FOODS data into every menu item that has a matching name. Used after
// enrichment to propagate Silpo-accurate КБЖУ back to the plan.
function applyFoodsToMenuItems() {
  for (const p of getPeopleIds()) {
    for (let d = 0; d <= 6; d++) {
      const dayData = MENU[p]?.[d];
      if (!dayData) continue;
      for (const m of getDayMeals(p, d)) {
        const meal = dayData[m.key];
        if (!meal?.items) continue;
        for (const it of meal.items) {
          if (!it.n) continue;
          const food = FOODS[foodKey(it.n)];
          if (!food || !food.kcal) continue;
          it.kcal_per_100    = food.kcal;
          it.protein_per_100 = food.protein || 0;
          it.fat_per_100     = food.fat     || 0;
          it.carbs_per_100   = food.carbs   || 0;
          if (food.silpoSlug) {
            it.silpoSlug       = food.silpoSlug;
            it.silpoPrice      = food.silpoPrice      ?? null;
            it.silpoPriceRatio = food.silpoPriceRatio ?? null;
          }
        }
      }
    }
  }
}

async function autoFillWeek(applyTemplate = false) {
  const overlay = document.getElementById('progOverlay');
  const bar     = document.getElementById('progBar');
  const title   = document.getElementById('progTitle');
  const sub     = document.getElementById('progSub');
  overlay.classList.add('on');
  bar.style.width = '0%';

  try {
    // Phase 1 — AI generation (only on explicit "Згенерувати" choice).
    // Calls the active provider for each person, parses JSON response,
    // writes into MENU and seeds FOODS with AI-provided nutrition.
    if (applyTemplate) {
      const provLabel = AI_PROVIDERS[getAIProvider()].label;
      title.textContent = `${provLabel} генерує план...`;
      const ids = getPeopleIds();
      for (let i = 0; i < ids.length; i++) {
        const pid = ids[i];
        sub.textContent = getPersonName(pid) + ` (${i+1}/${ids.length})`;
        bar.style.width = `${Math.round((i / ids.length) * 60)}%`;
        await generateMenuViaAI(pid);
      }
    }

    // Phase 2 — make sure every menu item has a FOODS entry (covers manually
    // edited items between regenerations).
    bar.style.width = '70%';
    title.textContent = 'Оновлюємо довідник';
    sub.textContent = '';
    seedFoodsFromMenu();

    // Phase 3 — push current FOODS data back into menu items
    bar.style.width = '90%';
    applyFoodsToMenuItems();

    // Save
    bar.style.width = '100%';
    title.textContent = '✓ Готово!';
    sub.textContent = applyTemplate
      ? 'План згенеровано через AI. Привʼяжи продукти до Сільпо вручну (🔗 у картці продукту)'
      : 'Довідник синхронізовано з меню';
    if (db) set(ref(db, 'racion/menu'), MENU).then(() => setSyncStatus('ok', 'Збережено ✓')).catch(() => {});
    renderMeals();
    renderTotals();
    renderFoodsDir();
    setTimeout(() => overlay.classList.remove('on'), 2200);
  } catch (e) {
    overlay.classList.remove('on');
    showConfirm({
      icon: '⚠️',
      title: 'Помилка генерації',
      text: e.message || String(e),
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
  }
}

// ═══════════════════════════════
// SHOPPING LIST / CART
// ═══════════════════════════════

function buildShoppingList() {
  const map = {};
  for (const p of getPeopleIds()) {
    for (let d = 0; d <= 6; d++) {
      const dayData = MENU[p]?.[d];
      if (!dayData) continue;
      for (const m of getDayMeals(p, d)) {
        const meal = dayData[m.key];
        if (!meal?.items) continue;
        for (const it of meal.items) {
          if (!it.n) continue;
          const key = it.silpoSlug || it.n.toLowerCase().trim();
          const g = parseG(it.g);
          if (!map[key]) {
            map[key] = { name: it.n, silpoSlug: it.silpoSlug || null, silpoId: it.silpoId || null, price: it.silpoPrice || null, priceRatio: it.silpoPriceRatio || 'шт', totalG: 0, days: 0 };
          }
          map[key].totalG += g;
          map[key].days++;
        }
      }
    }
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

window.showShoppingList = function() {
  const list = buildShoppingList();
  const body = document.getElementById('cartBody');
  const sub  = document.getElementById('cartSub');
  const withSilpo = list.filter(i => i.silpoSlug).length;
  sub.textContent = `${list.length} продуктів • ${withSilpo} є в Сільпо`;

  if (!list.length) {
    body.innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px">Немає продуктів у раціоні.<br>Натисни 🤖 щоб заповнити з Сільпо.</div>`;
  } else {
    body.innerHTML = list.map(item => {
      const gText = item.totalG > 0 ? `${item.totalG}г на тиждень` : `${item.days} разів`;
      const priceText = item.price ? ` · ${item.price} грн/${item.priceRatio}` : '';
      const btn = item.silpoSlug
        ? `<a class="cart-ibtn" href="https://silpo.ua/product/${item.silpoSlug}" target="_blank">Відкрити ↗</a>`
        : `<span style="font-size:11px;color:var(--muted)">Немає в Сільпо</span>`;
      return `<div class="cart-item">
        <div class="cart-iinfo">
          <div class="cart-iname">${item.name}</div>
          <div class="cart-ig">${gText}${priceText}</div>
        </div>
        ${btn}
      </div>`;
    }).join('');
  }
  document.getElementById('cartModal').classList.add('on');
};

window.closeCartModal = function() {
  document.getElementById('cartModal').classList.remove('on');
};

window.openAllInSilpo = function() {
  const list = buildShoppingList().filter(i => i.silpoSlug);
  if (!list.length) { showToast('Немає продуктів з Сільпо в раціоні'); return; }
  // Open first 5 in new tabs (browsers block mass tab opening after 1)
  list.slice(0, 1).forEach(item => {
    window.open(`https://silpo.ua/product/${item.silpoSlug}`, '_blank');
  });
  showToast(`Відкрито Сільпо. Решту ${list.length - 1} — натискай "Відкрити ↗" по одному`);
};

// ═══════════════════════════════
// DIARY
// ═══════════════════════════════
window.calMove = function (d) {
  if (calView === "month") {
    calM += d;
    if (calM > 11) {
      calM = 0;
      calY++;
    }
    if (calM < 0) {
      calM = 11;
      calY--;
    }
  } else {
    const r = selDate || new Date();
    r.setDate(r.getDate() + d * 7);
    selDate = new Date(r);
    calY = selDate.getFullYear();
    calM = selDate.getMonth();
  }
  renderCal();
};
window.setCalView = function (v) {
  calView = v;
  document
    .getElementById("vt-month")
    .classList.toggle("active", v === "month");
  document
    .getElementById("vt-week")
    .classList.toggle("active", v === "week");
  renderCal();
};

function renderCal() {
  document.getElementById("calMonth").textContent =
    `${MONTHS[calM]} ${calY}`;
  calView === "month" ? renderMonth() : renderWeek();
}

function renderMonth() {
  const body = document.getElementById("calBody");
  const today = new Date(),
    first = new Date(calY, calM, 1),
    last = new Date(calY, calM + 1, 0);
  const off = (first.getDay() + 6) % 7;
  const prevLast = new Date(calY, calM, 0).getDate();
  let html = `<div class="cal-grid">`;
  ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].forEach(
    (d) => (html += `<div class="cal-dow">${d}</div>`),
  );
  for (let i = off - 1; i >= 0; i--)
    html += `<div class="cal-cell other"><span class="cn">${prevLast - i}</span><span class="cdot"></span></div>`;
  for (let d = 1; d <= last.getDate(); d++) {
    const dt = new Date(calY, calM, d),
      key = dateKey(dt);
    const isToday = dateKey(today) === key,
      hasl = !!DIARY[key],
      isSel = selDate && dateKey(selDate) === key;
    let cls = "cal-cell";
    if (isSel) cls += " sel";
    else if (isToday) cls += " tod";
    if (hasl && !isSel) cls += " has-log";
    html += `<div class="${cls}" onclick="selectDate('${key}')"><span class="cn">${d}</span><span class="cdot"></span></div>`;
  }
  html += `</div>`;
  if (selDate) {
    const key = dateKey(selDate),
      log = DIARY[key];
    const ds = selDate.toLocaleDateString("uk-UA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    html += `<div class="day-log"><div class="dl-date">${cap(ds)}</div>`;
    if (log) {
      html += `<div class="dl-sub">Зафіксований раціон</div>`;
      // Show every person who has data on this day (not just legacy you/her)
      const peopleInLog = new Set([...getPeopleIds(), ...Object.keys(log)]);
      peopleInLog.forEach((p) => {
        const pd = log[p];
        if (!pd) return;
        const pname = getPersonName(p);
        const pc = getPersonColor(p);
        let mh = "";
        // Logged day may have its own meals override saved in the snapshot
        const dayMeals = pd.meals || getPersonMeals(p);
        dayMeals.forEach((m) => {
          const ml = pd[m.key];
          if (ml && ml.items && ml.items.length)
            mh += `<div class="lpb-meal"><div class="lpb-mn">${m.ico} ${m.name}</div><div class="lpb-items">${ml.items.map((it) => it.n + (it.g ? " (" + it.g + ")" : "")).join(", ")}</div></div>`;
        });
        const totalKcal = pd.totals?.kcal ?? 0;
        html += `<div class="lpb"><div class="lpb-hdr"><div class="lpb-dot" style="background:${pc}"></div><div class="lpb-name" style="color:${pc}">${pname}</div><div class="lpb-kc" style="color:${pc}">${totalKcal} ккал</div></div><div class="lpb-meals">${mh}</div></div>`;
      });
    } else {
      html += `<div class="log-empty"><div class="lei">📭</div><p>Немає записів за цей день</p></div>`;
    }
    html += `</div>`;
  }
  body.innerHTML = html;
}

function renderWeek() {
  const ref2 = selDate || new Date(),
    dow = ref2.getDay(),
    mon = new Date(ref2);
  mon.setDate(ref2.getDate() - ((dow + 6) % 7));
  let html = `<div class="week-view">`;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    const key = dateKey(dt),
      log = DIARY[key],
      dname = DAYS[dt.getDay()];
    const ds = dt.toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short",
    });
    const isToday = dateKey(new Date()) === key;
    html += `<div class="wr" onclick="selectDate('${key}');setCalView('month')">
<div><div class="wr-day">${dname}${isToday ? " 🟢" : ""}</div><div class="wr-date">${ds}</div></div>
<div class="wr-r">`;
    if (log) {
      // Render a colored badge per person who has a logged day
      for (const pid of getPeopleIds()) {
        const pd = log[pid];
        if (!pd?.totals) continue;
        const c = getPersonColor(pid);
        html += `<div class="wrbadge" style="background:${hexToRgba(c,.12)};color:${c}">${pd.totals.kcal} ккал</div>`;
      }
    } else html += `<div class="wrbadge e">Немає даних</div>`;
    html += `</div></div>`;
  }
  html += `</div>`;
  document.getElementById("calBody").innerHTML = html;
}

window.selectDate = function (key) {
  selDate = keyToDate(key);
  calY = selDate.getFullYear();
  calM = selDate.getMonth();
  renderCal();
};
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ═══════════════════════════════
// FOOD SEARCH (Silpo)
// ═══════════════════════════════
window.doSearch = async function () {
  const q = document.getElementById("searchInp").value.trim();
  if (!q) return;
  await searchFood(q);
};
window.qs = function (q) {
  document.getElementById("searchInp").value = q;
  searchFood(q);
};

async function searchFood(q) {
  const btn = document.getElementById("searchBtn"),
    cont = document.getElementById("searchContent");
  btn.disabled = true;
  cont.innerHTML = `<div class="sl"><div class="spin" style="margin:0 auto 8px"></div><br>Шукаємо в Сільпо «${q}»...</div>`;
  try {
    const res = await fetch(
      `${SILPO_API}/${SILPO_BRANCH}/products?limit=15&search=${encodeURIComponent(q)}`,
      { headers: { accept: "application/json" } }
    );
    const data = await res.json();
    const ql = q.toLowerCase();
    const prods = (data.items || []).sort((a, b) => {
      const ai = a.title.toLowerCase().indexOf(ql);
      const bi = b.title.toLowerCase().indexOf(ql);
      return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    });
    if (!prods.length) {
      cont.innerHTML = `<div class="sl">😔 Нічого не знайдено в Сільпо.</div>`;
      btn.disabled = false;
      return;
    }
    let html = "";
    prods.forEach((p, i) => {
      const price = p.displayPrice ? `${p.displayPrice} грн/${p.displayRatio || "шт"}` : "";
      html += `<div class="fc" onclick="showFood(${i})">
  <div class="fc-name">${p.title}</div>
  ${p.brandTitle ? `<div class="fc-brand">${p.brandTitle} · ${price}</div>` : `<div class="fc-brand">${price}</div>`}
  <div class="fc-macros" id="fcm_${i}">
    <div class="fc-m" style="grid-column:1/-1;text-align:left"><span class="fc-mv" style="font-size:10px;color:var(--muted)">Натисни щоб побачити КБЖУ</span></div>
  </div></div>`;
    });
    cont.innerHTML = html;
    window._fr = prods;
  } catch (e) {
    cont.innerHTML = `<div class="sl">⚠️ Немає інтернету або помилка сервера</div>`;
  }
  btn.disabled = false;
}

window.showFood = async function (i) {
  const p = window._fr[i];
  // Show modal immediately with loading state
  document.getElementById("mTitle").textContent = p.title;
  document.getElementById("mBrand").textContent = p.brandTitle || "";
  document.getElementById("mKcal").textContent = "...";
  document.getElementById("mProt").textContent = "...";
  document.getElementById("mFat").textContent = "...";
  document.getElementById("mCarb").textContent = "...";
  document.getElementById("mo").classList.add("on");
  // Fetch details
  try {
    const r = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products/${p.slug}`, {
      headers: { accept: "application/json" }
    });
    const detail = await r.json();
    const nutr = parseSilpoNutr(detail.attributeGroups);
    document.getElementById("mKcal").textContent = nutr?.kcal != null ? nutr.kcal + " ккал" : "—";
    document.getElementById("mProt").textContent = nutr?.protein != null ? nutr.protein + "г" : "—";
    document.getElementById("mFat").textContent = nutr?.fat != null ? nutr.fat + "г" : "—";
    document.getElementById("mCarb").textContent = nutr?.carbs != null ? nutr.carbs + "г" : "—";
    // Also update the card in list
    const fcm = document.getElementById("fcm_" + i);
    if (fcm && nutr) {
      fcm.innerHTML = `
        <div class="fc-m"><span class="fc-mv">${nutr.kcal}</span><span class="fc-ml">ккал</span></div>
        <div class="fc-m"><span class="fc-mv">${nutr.protein ?? "—"}г</span><span class="fc-ml">білок</span></div>
        <div class="fc-m"><span class="fc-mv">${nutr.fat ?? "—"}г</span><span class="fc-ml">жири</span></div>
        <div class="fc-m"><span class="fc-mv">${nutr.carbs ?? "—"}г</span><span class="fc-ml">вуглев.</span></div>`;
    }
  } catch(e) {
    document.getElementById("mKcal").textContent = "—";
  }
};
window.closeMo = () =>
  document.getElementById("mo").classList.remove("on");

// ═══════════════════════════════
// DAY MEALS EDITOR (per-day override of meal slots)
// ═══════════════════════════════
let _dmDraft = null;     // working copy of meals array for the day being edited
let _dmReset = false;    // user pressed "reset to default" — drop override on save

window.openDayMealsEditor = function() {
  _dmDraft = JSON.parse(JSON.stringify(getDayMeals(person, curDay)));
  _dmReset = false;
  document.getElementById('dmDayLabel').textContent = `· ${DAYS[curDay]} · ${getPersonName(person)}`;
  const hasOverride = !!MENU[person]?.[curDay]?.meals;
  document.getElementById('dmSubTitle').textContent = hasOverride
    ? 'Цей день має власні налаштування'
    : 'Зараз використовуються налаштування з профіля';
  renderDmList();
  document.getElementById('dmModal').classList.add('on');
};

function renderDmList() {
  document.getElementById('dm_meals_list').innerHTML = _dmDraft.map((m, i) => `
    <div class="pe-meal-row">
      <input class="pe-meal-ico" value="${escapeHtml(m.ico || '')}" oninput="_dmDraft[${i}].ico=this.value" maxlength="2">
      <input class="pe-meal-name" value="${escapeHtml(m.name || '')}" oninput="_dmDraft[${i}].name=this.value" placeholder="Назва">
      <input class="pe-meal-time" value="${escapeHtml(m.time || '')}" oninput="_dmDraft[${i}].time=this.value" placeholder="час">
      <button class="pe-meal-del" onclick="dmRemoveMeal(${i})" ${_dmDraft.length <= 1 ? 'disabled style="opacity:.4"' : ''}>✕</button>
    </div>
  `).join('');
}

window.dmAddMeal = function() {
  let n = 1, key = `meal${n}`;
  const ex = new Set(_dmDraft.map(m => m.key));
  while (ex.has(key)) { n++; key = `meal${n}`; }
  _dmDraft.push({ key, name: 'Новий прийом', time: '12:00', ico: '🍴', cls: 'is' });
  renderDmList();
};

window.dmRemoveMeal = function(i) {
  if (_dmDraft.length <= 1) return;
  _dmDraft.splice(i, 1);
  renderDmList();
};

window.dmResetToDefault = function() {
  if (!confirm('Скинути прийоми їжі цього дня до налаштувань профіля?')) return;
  _dmReset = true;
  _dmDraft = JSON.parse(JSON.stringify(getPersonMeals(person)));
  renderDmList();
  document.getElementById('dmSubTitle').textContent = 'Скинуто. Натисни Зберегти щоб застосувати';
};

window.saveDayMeals = async function() {
  const day = MENU[person][curDay];
  if (_dmReset) {
    delete day.meals;
  } else {
    // Sanitize: every slot needs a unique non-empty key
    const seen = new Set();
    for (let i = 0; i < _dmDraft.length; i++) {
      let k = _dmDraft[i].key || `meal${i+1}`;
      while (seen.has(k)) k = k + '_';
      _dmDraft[i].key = k;
      seen.add(k);
    }
    day.meals = _dmDraft.map(m => ({ ...m }));
  }
  // Ensure each slot has a {kcal,items} entry on the day
  for (const m of (day.meals || getPersonMeals(person))) {
    if (!day[m.key]) day[m.key] = { kcal: 0, items: [] };
  }
  await pushMenu();
  closeDayMeals();
  renderMeals();
  renderTotals();
  showToast('Збережено ✓');
};

window.closeDayMeals = function() {
  document.getElementById('dmModal').classList.remove('on');
  _dmDraft = null;
  _dmReset = false;
};

// ═══════════════════════════════
// PROFILE / PEOPLE EDITOR
// ═══════════════════════════════
let _peEditingId = null;       // pid being edited (or null for new)
let _peDraft = null;           // working copy of person being edited

window.renderPeople = function() {
  const list = document.getElementById('peopleList');
  if (!list) return;
  const ids = getPeopleIds();
  if (!ids.length) {
    list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:12px">Жодної людини. Натисни <strong>+ Додати</strong>.</div>`;
    return;
  }
  list.innerHTML = ids.map(pid => {
    const p = getPerson(pid);
    const t = p?.targets || {};
    const meta = [
      `${t.kcal || '—'} ккал`,
      p?.age ? `${p.age} р.` : null,
      p?.weight ? `${p.weight} кг` : null,
      `${(p?.meals || []).length} прийомів`,
    ].filter(Boolean).join(' · ');
    return `<div class="person-card" onclick="openPersonEditor('${pid}')">
      <div class="person-dot" style="background:${p?.color || '#888'}"></div>
      <div class="person-info">
        <div class="person-name">${escapeHtml(p?.name || pid)}</div>
        <div class="person-meta">${meta}</div>
      </div>
      <div class="person-arr">›</div>
    </div>`;
  }).join('');
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

window.addPerson = function() {
  const id = 'p_' + Date.now().toString(36);
  const order = Math.max(0, ...Object.values(PEOPLE).map(p => p.order || 0)) + 1;
  PEOPLE[id] = {
    id,
    name: 'Нова людина',
    color: '#7dd3fc',
    age: null,
    weight: null,
    targets: { kcal: 2000, protein: 150, fat: 65, carbs: 200 },
    forbidden: [],
    meals: JSON.parse(JSON.stringify(DEFAULT_MEALS)),
    waterTarget: '2 л',
    order,
  };
  if (db) set(ref(db, 'racion/people/' + id), PEOPLE[id]).catch(() => {});
  // Seed empty MENU days for the new person
  applyPlanTemplate();
  if (db) set(ref(db, 'racion/menu'), MENU).catch(() => {});
  renderPeople();
  openPersonEditor(id);
};

window.openPersonEditor = function(pid) {
  const p = getPerson(pid);
  if (!p) return;
  _peEditingId = pid;
  // Deep copy so edits can be cancelled
  _peDraft = JSON.parse(JSON.stringify(p));
  // Ensure required nested structures exist
  _peDraft.targets   = _peDraft.targets   || { kcal: 2000, protein: 150, fat: 65, carbs: 200 };
  _peDraft.forbidden = _peDraft.forbidden || [];
  _peDraft.meals     = _peDraft.meals     || JSON.parse(JSON.stringify(DEFAULT_MEALS));
  document.getElementById('peTitle').textContent = `Профіль · ${p.name}`;
  // Disable delete if only 1 person
  document.getElementById('peDelBtn').disabled = getPeopleIds().length <= 1;
  renderPersonEditorBody();
  document.getElementById('peModal').classList.add('on');
};

function renderPersonEditorBody() {
  const d = _peDraft;
  const body = document.getElementById('peBody');
  body.innerHTML = `
    <div class="pe-section">
      <div class="pe-sect-title">Основне</div>
      <div class="pe-row">
        <input type="color" class="pe-color-box" id="pe_color" value="${d.color || '#c8f54a'}">
        <input class="pe-inp" id="pe_name" placeholder="Ім'я" value="${escapeHtml(d.name || '')}">
      </div>
      <div class="pe-row">
        <span class="pe-lbl">Вік</span>
        <input class="pe-inp sm" id="pe_age" type="number" value="${d.age ?? ''}" placeholder="—">
        <span class="pe-lbl">Вага кг</span>
        <input class="pe-inp sm" id="pe_weight" type="number" value="${d.weight ?? ''}" placeholder="—">
      </div>
      <div class="pe-row">
        <span class="pe-lbl">Вода</span>
        <input class="pe-inp" id="pe_water" value="${escapeHtml(d.waterTarget || '')}" placeholder="напр. 2.5 л">
      </div>
    </div>

    <div class="pe-section">
      <div class="pe-sect-title">Денна ціль КБЖУ</div>
      <div class="pe-grid4">
        <div class="pe-cell"><input class="pe-cell-inp" id="pe_t_k" type="number" value="${d.targets.kcal || ''}"><div class="pe-cell-lbl">ккал</div></div>
        <div class="pe-cell"><input class="pe-cell-inp" id="pe_t_p" type="number" value="${d.targets.protein || ''}"><div class="pe-cell-lbl">білок г</div></div>
        <div class="pe-cell"><input class="pe-cell-inp" id="pe_t_f" type="number" value="${d.targets.fat || ''}"><div class="pe-cell-lbl">жири г</div></div>
        <div class="pe-cell"><input class="pe-cell-inp" id="pe_t_c" type="number" value="${d.targets.carbs || ''}"><div class="pe-cell-lbl">вуглев г</div></div>
      </div>
    </div>

    <div class="pe-section">
      <div class="pe-sect-title">Заборонені продукти</div>
      <div class="pe-tags" id="pe_forbidden_tags">${renderForbiddenTags()}</div>
      <div class="pe-tag-add">
        <input id="pe_forbidden_inp" placeholder="Напр. лосось" onkeydown="if(event.key==='Enter')addForbiddenTag()">
        <button onclick="addForbiddenTag()">+ Додати</button>
      </div>
    </div>

    <div class="pe-section">
      <div class="pe-sect-title">Прийоми їжі</div>
      <div id="pe_meals_list">${renderMealsEditor()}</div>
      <button class="pe-add-meal" onclick="addMealSlot()">+ Додати прийом</button>
    </div>
  `;
}

function renderForbiddenTags() {
  if (!_peDraft.forbidden.length) return `<span style="font-size:11px;color:var(--muted)">Немає заборонених</span>`;
  return _peDraft.forbidden.map((f, i) =>
    `<span class="pe-tag">${escapeHtml(f)}<span class="pe-tag-x" onclick="removeForbiddenTag(${i})">×</span></span>`
  ).join('');
}

function renderMealsEditor() {
  return _peDraft.meals.map((m, i) => `
    <div class="pe-meal-row">
      <input class="pe-meal-ico" value="${escapeHtml(m.ico || '')}" oninput="_peDraft.meals[${i}].ico=this.value" maxlength="2">
      <input class="pe-meal-name" value="${escapeHtml(m.name || '')}" oninput="_peDraft.meals[${i}].name=this.value" placeholder="Назва">
      <input class="pe-meal-time" value="${escapeHtml(m.time || '')}" oninput="_peDraft.meals[${i}].time=this.value" placeholder="час">
      <button class="pe-meal-del" onclick="removeMealSlot(${i})" ${_peDraft.meals.length <= 1 ? 'disabled style="opacity:.4"' : ''}>✕</button>
    </div>
  `).join('');
}

window.addForbiddenTag = function() {
  const inp = document.getElementById('pe_forbidden_inp');
  const v = inp.value.trim();
  if (!v) return;
  if (!_peDraft.forbidden.some(f => f.toLowerCase() === v.toLowerCase())) {
    _peDraft.forbidden.push(v);
  }
  inp.value = '';
  document.getElementById('pe_forbidden_tags').innerHTML = renderForbiddenTags();
  inp.focus();
};

window.removeForbiddenTag = function(i) {
  _peDraft.forbidden.splice(i, 1);
  document.getElementById('pe_forbidden_tags').innerHTML = renderForbiddenTags();
};

window.addMealSlot = function() {
  // Generate unique key
  let n = 1;
  let key = `meal${n}`;
  const existing = new Set(_peDraft.meals.map(m => m.key));
  while (existing.has(key)) { n++; key = `meal${n}`; }
  _peDraft.meals.push({ key, name: 'Новий прийом', time: '12:00', ico: '🍴', cls: 'is' });
  document.getElementById('pe_meals_list').innerHTML = renderMealsEditor();
};

window.removeMealSlot = function(i) {
  if (_peDraft.meals.length <= 1) return;
  _peDraft.meals.splice(i, 1);
  document.getElementById('pe_meals_list').innerHTML = renderMealsEditor();
};

window.closePersonEditor = function() {
  document.getElementById('peModal').classList.remove('on');
  _peEditingId = null;
  _peDraft = null;
};

window.savePersonFromEditor = async function() {
  if (!_peDraft || !_peEditingId) return;
  // Read flat fields from DOM
  const get = id => document.getElementById(id);
  _peDraft.name        = get('pe_name').value.trim() || 'Без імені';
  _peDraft.color       = get('pe_color').value || '#c8f54a';
  _peDraft.age         = parseInt(get('pe_age').value)    || null;
  _peDraft.weight      = parseFloat(get('pe_weight').value) || null;
  _peDraft.waterTarget = get('pe_water').value.trim();
  _peDraft.targets = {
    kcal:    parseInt(get('pe_t_k').value)   || 0,
    protein: parseInt(get('pe_t_p').value)   || 0,
    fat:     parseInt(get('pe_t_f').value)   || 0,
    carbs:   parseInt(get('pe_t_c').value)   || 0,
  };
  // meals already updated via inline oninput handlers
  PEOPLE[_peEditingId] = _peDraft;
  if (db) {
    try { await set(ref(db, 'racion/people/' + _peEditingId), _peDraft); }
    catch(e) { showToast('Помилка збереження', 'err'); return; }
  }
  closePersonEditor();
  renderPeople();
  // Re-render menu page in case current person was edited
  renderMenuPage();
  showToast('Збережено ✓');
};

window.deletePersonFromEditor = async function() {
  if (!_peEditingId) return;
  if (getPeopleIds().length <= 1) { showToast('Має лишитись хоча б 1 людина'); return; }
  const name = _peDraft?.name || _peEditingId;
  if (!confirm(`Видалити "${name}"?\n\nВсе її меню та записи в щоденнику теж видаляться.`)) return;
  const pid = _peEditingId;
  delete PEOPLE[pid];
  delete MENU[pid];
  // Strip from DIARY entries
  for (const k of Object.keys(DIARY)) {
    if (DIARY[k]?.[pid]) delete DIARY[k][pid];
  }
  if (db) {
    try {
      await set(ref(db, 'racion/people/' + pid), null);
      await set(ref(db, 'racion/menu/'   + pid), null);
      await set(ref(db, 'racion/diary'), DIARY);
    } catch(e) {}
  }
  // If we just deleted the active person, switch to the first remaining one
  if (person === pid) {
    person = getPeopleIds()[0];
  }
  closePersonEditor();
  renderPeople();
  renderMenuPage();
  showToast('Видалено');
};

// ═══════════════════════════════
// CUSTOM CONFIRM MODAL
// ═══════════════════════════════
// showConfirm({icon, title, text, actions})
// actions = [{ label, style:'primary'|'secondary'|'danger'|'cancel', onClick }]
window.showConfirm = function({ icon, title, text, actions }) {
  document.getElementById('cfIcon').textContent = icon || '❓';
  document.getElementById('cfTitle').textContent = title || '';
  document.getElementById('cfText').textContent = text || '';
  const actEl = document.getElementById('cfActions');
  actEl.innerHTML = '';
  for (const a of (actions || [])) {
    const btn = document.createElement('button');
    btn.className = 'cf-btn cf-btn-' + (a.style || 'secondary');
    btn.textContent = a.label;
    btn.onclick = () => { cfClose(); a.onClick?.(); };
    actEl.appendChild(btn);
  }
  document.getElementById('cfModal').classList.add('on');
};

window.cfClose = function() {
  document.getElementById('cfModal').classList.remove('on');
};

// ═══════════════════════════════
// AI PROVIDERS
// ═══════════════════════════════
// Provider configs are stored in localStorage. Each user picks one and pastes
// their own key. Keys never leave the device.
const AI_PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    keyHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    needsProxy: false,
  },
  openai: {
    label: 'OpenAI (GPT)',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    needsProxy: true,  // CORS blocks direct browser calls
  },
  gemini: {
    label: 'Google Gemini',
    keyHint: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
    needsProxy: false,
  },
};

function getAIProvider() {
  return localStorage.getItem('ai_provider') || 'claude';
}

function getAIKey(provider) {
  return localStorage.getItem('ai_key_' + (provider || getAIProvider())) || '';
}

window.setAIProvider = function(p) {
  localStorage.setItem('ai_provider', p);
  refreshAISettingsUI();
};

window.saveAIKey = function() {
  const provider = getAIProvider();
  const key = document.getElementById('aiKeyInp').value.trim();
  if (!key) {
    localStorage.removeItem('ai_key_' + provider);
    showToast('Ключ видалено');
  } else {
    localStorage.setItem('ai_key_' + provider, key);
    showToast('Ключ збережено ✓');
  }
  refreshAISettingsUI();
};

function refreshAISettingsUI() {
  const provider = getAIProvider();
  ['claude','openai','gemini'].forEach(p =>
    document.getElementById('aip_' + p)?.classList.toggle('active', p === provider)
  );
  const cfg = AI_PROVIDERS[provider];
  const inp = document.getElementById('aiKeyInp');
  if (inp) {
    inp.placeholder = cfg.keyHint;
    inp.value = getAIKey(provider);
  }
  const status = document.getElementById('aiKeyStatus');
  if (status) {
    const has = !!getAIKey(provider);
    status.textContent = has
      ? `${cfg.label} — ключ збережено ✓`
      : `${cfg.label} — потрібен ключ. Отримай тут: ${cfg.docsUrl}`;
    status.classList.toggle('ok', has);
  }
}

// Build the prompt for plan generation. Returns a string ready to send.
function buildPlanPrompt(person) {
  const meals = (person.meals || DEFAULT_MEALS).map(m =>
    `  - ${m.key}: ${m.name} (${m.time})`
  ).join('\n');
  const t = person.targets || {};
  const fb = (person.forbidden || []).join(', ') || 'немає';
  return `Згенеруй тижневий план харчування для людини. Поверни ВИКЛЮЧНО валідний JSON, без жодного тексту до або після.

Профіль:
- Імʼя: ${person.name || 'Користувач'}
- Вік: ${person.age || 'не вказано'}
- Вага: ${person.weight ? person.weight + ' кг' : 'не вказано'}
- Денна ціль: ${t.kcal || 2000} ккал, ${t.protein || 150}г білка, ${t.fat || 65}г жирів, ${t.carbs || 200}г вуглеводів
- Заборонені продукти (НЕ використовувати): ${fb}
- Прийоми їжі (точно ці слоти, не змінюй ключі):
${meals}

Вимоги:
1. Згенеруй РІВНО 7 днів (weekday 0=Неділя, 1=Понеділок, ..., 6=Субота).
2. Кожен день має містити кожен прийом їжі зі списку вище (за key).
3. Кожен прийом має 2-5 інгредієнтів. Назви українською, реальні продукти що можна купити в Україні.
4. Порції — реалістичні (наприклад 150г куряче філе, 100г гречки, 100г огірка).
5. Денна сума ккал має бути близькою до цілі ±100 ккал.
6. Різноманітність — не повторюй однакові прийоми кожного дня. Використовуй різні білки, крупи, овочі, фрукти.
7. ВРАХУЙ заборонені продукти — не використовуй їх взагалі і не використовуй варіації (наприклад "лосось" забороняє і "стейк лосося", і "філе лосося").
8. Кожен item має містити ТОЧНІ значення per-100g — не вигадуй, використовуй реальні харчові дані.

Формат відповіді (точно такий, без коментарів):
{
  "days": [
    {
      "weekday": 1,
      "meals": {
        "breakfast": {
          "items": [
            { "n": "Куряче філе", "g": "150г", "kcal_per_100": 110, "protein_per_100": 23, "fat_per_100": 1.2, "carbs_per_100": 0 }
          ]
        }
      }
    }
  ]
}`;
}

// Call the active provider with the given prompt. Returns the raw text response.
async function callAIProvider(prompt) {
  const provider = getAIProvider();
  const key = getAIKey(provider);
  if (!key) throw new Error(`Не налаштовано API ключ для ${AI_PROVIDERS[provider].label}. Зайди в Профіль.`);

  if (provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`Claude API: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return data.content?.[0]?.text || '';
  }

  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
      }),
    });
    if (!r.ok) throw new Error(`Gemini API: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'openai') {
    // OpenAI blocks direct browser calls via CORS. Requires a proxy
    // (e.g. a Cloudflare Worker that forwards to api.openai.com). Until
    // that's set up we just throw — keep the option visible in UI for later.
    throw new Error('OpenAI потребує проксі-сервера через CORS. Поки використовуй Claude або Gemini.');
  }

  throw new Error('Невідомий AI провайдер: ' + provider);
}

// Strip ```json ... ``` fences and any preamble, parse JSON
function parseAIPlanResponse(text) {
  let t = String(text || '').trim();
  // Drop fenced code blocks
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // Find first { and last }
  const first = t.indexOf('{');
  const last  = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

// Call AI for one person, parse, write into MENU[pid]
async function generateMenuViaAI(pid) {
  const person = getPerson(pid);
  if (!person) return;
  const prompt = buildPlanPrompt(person);
  const raw = await callAIProvider(prompt);
  const data = parseAIPlanResponse(raw);
  if (!data?.days || !Array.isArray(data.days)) {
    throw new Error('AI повернув некоректну структуру (немає масиву days)');
  }

  if (!MENU[pid]) MENU[pid] = {};
  const targets = getPersonTargets(pid);

  for (const day of data.days) {
    const wd = Number(day.weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) continue;
    const newDay = { totals: { ...targets } };
    // Preserve existing meal-slot override on the day
    if (MENU[pid][wd]?.meals) newDay.meals = MENU[pid][wd].meals;

    for (const [mealKey, meal] of Object.entries(day.meals || {})) {
      if (!Array.isArray(meal.items)) continue;
      const items = meal.items
        .filter(it => it && it.n)
        .map(it => {
          // Seed FOODS so the directory always has the AI's nutrition data
          const name = String(it.n).trim();
          const cleaned = {
            kcal:    Number(it.kcal_per_100)    || 0,
            protein: Number(it.protein_per_100) || 0,
            fat:     Number(it.fat_per_100)     || 0,
            carbs:   Number(it.carbs_per_100)   || 0,
          };
          const key = foodKey(name);
          if (!FOODS[key] || FOODS[key].source === 'auto') {
            FOODS[key] = { name, ...cleaned, source: 'auto' };
            if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
          }
          // Build menu item with embedded nutrition + Silpo link if any
          const item = {
            n: name,
            g: String(it.g || '100г'),
            kcal_per_100:    cleaned.kcal,
            protein_per_100: cleaned.protein,
            fat_per_100:     cleaned.fat,
            carbs_per_100:   cleaned.carbs,
          };
          const food = FOODS[key];
          if (food?.silpoSlug) {
            item.silpoSlug       = food.silpoSlug;
            item.silpoPrice      = food.silpoPrice      ?? null;
            item.silpoPriceRatio = food.silpoPriceRatio ?? null;
          }
          return item;
        });
      newDay[mealKey] = { kcal: 0, items };
    }

    MENU[pid][wd] = newDay;
  }
}

// ═══════════════════════════════
// TOAST
// ═══════════════════════════════
window.showToast = function (msg, type) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (type === "err" ? " err" : "") + " on";
  setTimeout(() => t.classList.remove("on"), 2600);
};
