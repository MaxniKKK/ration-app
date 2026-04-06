import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  child,
  update,
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
  ['dir', 'recipes', 'silpo'].forEach(t => {
    const tabEl = document.getElementById('fd-tab-' + t);
    const ctEl  = document.getElementById('fd-' + t);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
    if (ctEl)  ctEl.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'dir')     renderFoodsDir();
  if (tab === 'recipes') renderRecipesView();
};

window.renderFoodsDir = function() {
  const filter = (document.getElementById('dirFilter')?.value || '').toLowerCase();
  const list = document.getElementById('dirList');
  if (!list) return;
  const entries = Object.entries(FOODS)
    .filter(([k, v]) => v && v.type !== 'recipe')  // recipes live in the 🍳 Рецепти tab
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
  const count = _dirSelected.size;
  showConfirm({
    icon: '🗑',
    title: 'Видалити продукти?',
    text: `${count} ${count === 1 ? 'продукт буде видалено' : 'продуктів буде видалено'} з довідника. Це не можна відмінити.`,
    actions: [
      { label: 'Видалити', style: 'danger', onClick: () => {
        const batch = [];
        _dirSelected.forEach(key => {
          delete FOODS[key];
          if (db) batch.push(set(ref(db, 'racion/foods/' + key), null).catch(() => {}));
        });
        Promise.all(batch);
        _dirSelected.clear();
        _updateSelCount();
        renderFoodsDir();
        showToast('Видалено ✓');
      }},
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
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

  // Recipe ingredients section — only for type='recipe'. Shows each raw
  // ingredient string with its resolved status (linked / staple / missing).
  // Linked rows are clickable → opens that product's card. Computes a
  // fresh link list on demand if linkedIngredients was never persisted.
  const ingsEl = document.getElementById('pcardIngsSection');
  if (food.type === 'recipe' && Array.isArray(food.ingredients) && food.ingredients.length) {
    let linked = food.linkedIngredients;
    if (!Array.isArray(linked)) {
      // Lazy compute on first card open after a fresh load
      const products = Object.entries(FOODS)
        .filter(([k, f]) => f && f.type !== 'recipe' && f.name)
        .map(([k, f]) => ({ key: k, name: f.name }));
      linked = analyzeRecipeCoverage(food, products).linked;
    }
    const matchedCount = linked.filter(l => l.kind === 'linked').length;
    const missingCount = linked.filter(l => l.kind === 'missing').length;
    const stapleCount  = linked.filter(l => l.kind === 'staple').length;
    ingsEl.innerHTML = `
      <div class="pcard-ings-label">Інгредієнти${food.servings ? ` · на ${food.servings} порц.` : ''}</div>
      <ul class="pcard-ings-list">
        ${linked.map(l => {
          if (l.kind === 'linked') {
            return `<li>
              <span class="pcard-ing-icon linked" title="Привʼязано до продукту">●</span>
              <span class="pcard-ing-raw">${escapeHtml(l.raw)}</span>
              <a class="pcard-ing-link" onclick="event.stopPropagation();openPCard('${l.productKey}')">→ ${escapeHtml(l.productName || '')}</a>
            </li>`;
          }
          if (l.kind === 'staple') {
            return `<li>
              <span class="pcard-ing-icon staple" title="Базовий продукт (завжди є)">○</span>
              <span class="pcard-ing-raw" style="color:var(--muted)">${escapeHtml(l.raw)}</span>
            </li>`;
          }
          return `<li>
            <span class="pcard-ing-icon missing" title="Немає в довіднику продуктів">✕</span>
            <span class="pcard-ing-raw">${escapeHtml(l.raw)}</span>
          </li>`;
        }).join('')}
      </ul>
      <div class="pcard-ing-meta">${matchedCount} в довіднику · ${missingCount} відсутні · ${stapleCount} базові${food.sourceUrl ? ` · <a href="${food.sourceUrl}" target="_blank" onclick="event.stopPropagation()" style="color:var(--blue);text-decoration:none">↗ klopotenko</a>` : ''}</div>
    `;
    ingsEl.style.display = '';
  } else {
    ingsEl.style.display = 'none';
  }

  // Meal-type tags: which slot types this product can appear in
  const tagsEl = document.getElementById('pcardTagsSection');
  const curTags = food.tags || [];
  tagsEl.innerHTML = `
    <div class="pcard-tags-label">Категорії прийомів</div>
    <div class="pcard-tags-row">
      ${MEAL_TAGS.map(t => `
        <button class="pcard-tag${curTags.includes(t.key) ? ' active' : ''}" onclick="togglePCardTag('${key}','${t.key}')">${t.label}</button>
      `).join('')}
    </div>
    <div class="pcard-tags-hint">${curTags.length
      ? 'Продукт буде використовуватись лише в обраних типах прийомів'
      : 'Без обмежень — продукт може зʼявлятись у будь-якому прийомі'}</div>
  `;

  const actEl = document.getElementById('pcardActions');
  const openBtn = (food.silpoSlug && food.source === 'silpo')
    ? `<a class="pcard-open-a" href="https://silpo.ua/product/${food.silpoSlug}" target="_blank" onclick="event.stopPropagation()">Відкрити в Сільпо ↗</a>`
    : `<div style="flex:1"></div>`;
  actEl.innerHTML = `${openBtn}
    <button class="pcard-edit-btn" title="Заповнити КБЖУ через AI" onclick="applyAIFillFood('${key}')">🤖</button>
    <button class="pcard-edit-btn" title="Привʼязати до продукту в Сільпо" onclick="openRemap('${key}')">🔗</button>
    <button class="pcard-edit-btn" title="Редагувати КБЖУ" onclick="closePCard();showScreen('search');showFdTab('dir');startEditFood('${key}')">✏️</button>
    <button class="pcard-del-btn" title="Видалити" onclick="confirmDeletePCardFood('${key}')">🗑</button>`;

  document.getElementById('pcardModal').classList.add('on');
};

window.togglePCardTag = function(key, tag) {
  const food = FOODS[key];
  if (!food) return;
  const tagSet = new Set(food.tags || []);
  if (tagSet.has(tag)) tagSet.delete(tag);
  else tagSet.add(tag);
  FOODS[key] = { ...food, tags: [...tagSet] };
  if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
  // Re-render in place by re-opening (cheap, modal stays mounted)
  openPCard(key);
};

window.closePCard = function() {
  document.getElementById('pcardModal').classList.remove('on');
  _pcardKey = null;
};

window.confirmDeletePCardFood = function(key) {
  const food = FOODS[key];
  showConfirm({
    icon: '🗑',
    title: 'Видалити продукт?',
    text: `"${food?.name || key}" буде видалено з довідника. Це не можна відмінити.`,
    actions: [
      { label: 'Видалити', style: 'danger', onClick: () => { deleteFoodItem(key, true); closePCard(); }},
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

// ─── MANUAL REMAP: pick a different Silpo product for a directory entry ──
// Fill КБЖУ for a directory entry by asking the active AI provider for
// per-100g nutrition of this product. Does not touch silpoSlug if already
// linked — only updates the nutrition fields.
window.applyAIFillFood = async function(key) {
  const food = FOODS[key];
  if (!food) return;
  showAIBusy('🤖 AI шукає КБЖУ...', food.name);
  try {
    const nutr = await fetchNutritionFromAI(food.name);
    FOODS[key] = { ...food, ...nutr };
    if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
    hideAIBusy();
    renderFoodsDir();
    showToast('КБЖУ заповнено через AI ✓');
    setTimeout(() => openPCard(key), 150);
  } catch (e) {
    hideAIBusy();
    showConfirm({
      icon: '⚠️',
      title: 'Помилка AI',
      text: e.message || String(e),
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
  }
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
window.refetchAllFoods = function() {
  const keys = Object.keys(FOODS).filter(k => FOODS[k].source !== 'manual');
  if (!keys.length) { showToast('Немає продуктів для оновлення'); return; }
  showConfirm({
    icon: '🔄',
    title: 'Заново завантажити з Сільпо?',
    text: `${keys.length} продуктів буде оновлено: КБЖУ, ціни, фото, назви. Записи відредаговані вручну не зміняться.`,
    actions: [
      { label: 'Оновити', style: 'primary', onClick: () => _doRefetchAllFoods(keys) },
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

async function _doRefetchAllFoods(keys) {
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

window.deleteFoodItem = function(key, skipConfirm = false) {
  const name = FOODS[key]?.name || key.replace(/_/g,' ');
  const doDelete = () => {
    delete FOODS[key];
    if (db) set(ref(db, 'racion/foods/' + key), null).catch(() => {});
    renderFoodsDir();
    showToast('Видалено');
  };
  if (skipConfirm) return doDelete();
  showConfirm({
    icon: '🗑',
    title: 'Видалити продукт?',
    text: `"${name}" буде видалено з довідника.`,
    actions: [
      { label: 'Видалити', style: 'danger', onClick: doDelete },
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
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

window.prefillNewFoodFromAI = async function() {
  const name = document.getElementById('de_name')?.value.trim();
  if (!name) { showToast('Спочатку введи назву продукту'); return; }
  showAIBusy('🤖 AI шукає КБЖУ...', name);
  try {
    const nutr = await fetchNutritionFromAI(name);
    document.getElementById('de_kcal').value = nutr.kcal;
    document.getElementById('de_prot').value = nutr.protein;
    document.getElementById('de_fat').value  = nutr.fat;
    document.getElementById('de_carb').value = nutr.carbs;
    _newFoodSilpoData = null;
    const info = document.getElementById('de_silpo_info');
    if (info) info.style.display = 'none';
    hideAIBusy();
    showToast('Заповнено через AI ✓');
  } catch (e) {
    hideAIBusy();
    showConfirm({
      icon: '⚠️',
      title: 'Помилка AI',
      text: e.message || String(e),
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
  }
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
  const dirCount = Object.values(FOODS).filter(f => f && (f.kcal || 0) > 0).length;
  showConfirm({
    icon: '🤖',
    title: 'Автоплан раціону',
    text: hasKey
      ? `${provLabel} згенерує тиждень з твого профіля. У довіднику зараз ${dirCount} продуктів.`
      : `Ще не налаштовано AI. Зайди в Профіль і додай ключ для ${provLabel}, або синхронізуй довідник без генерації.`,
    actions: [
      hasKey && {
        label: '✨ Згенерувати (вільний режим)',
        style: 'primary',
        onClick: () => autoFillWeek('free'),
      },
      hasKey && dirCount > 0 && {
        label: '📚 Згенерувати лише з довідника',
        style: 'secondary',
        onClick: () => autoFillWeek('strict'),
      },
      {
        label: '🔄 Тільки синхронізувати довідник',
        style: 'secondary',
        onClick: () => autoFillWeek(null),
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
// For every FOODS entry that isn't already linked to Silpo and isn't a manual
// override, search Silpo and try to attach a slug. Doesn't overwrite КБЖУ
// when source is 'auto' from AI — only adds the silpoSlug + price + icon.
// Returns { upgraded, total } counts.
async function enrichFoodsFromSilpo(progress) {
  const candidates = Object.keys(FOODS).filter(k => {
    const v = FOODS[k];
    return v && v.source !== 'silpo' && v.source !== 'manual' && !v.silpoSlug;
  });
  let upgraded = 0;
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i];
    const food = FOODS[key];
    const name = food.name || key;
    progress?.(name, i, candidates.length);
    try {
      let items = [];
      for (const query of [name, name.split(' ')[0]]) {
        const sr = await fetch(`${SILPO_API}/${SILPO_BRANCH}/products?limit=20&search=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' } });
        const sd = await sr.json();
        items = sd.items || [];
        if (items.length) break;
      }
      const best = pickBestSilpo(items, name);
      if (!best) continue;
      // Attach Silpo metadata; KEEP existing AI/POOL КБЖУ unless food was an
      // empty stub (kcal === 0). Silpo's nutrition fields are unreliable per
      // earlier testing.
      FOODS[key] = {
        ...food,
        silpoTitle:      best.title,
        silpoSlug:       best.slug,
        silpoIcon:       best.icon || null,
        silpoPrice:      best.displayPrice ?? null,
        silpoPriceRatio: best.displayRatio ?? null,
      };
      if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
      upgraded++;
    } catch(e) {
      console.warn('[enrich] failed for', name, e);
    }
  }
  return { upgraded, total: candidates.length };
}

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

// mode = 'free'   → AI may invent new ingredients (prefers existing FOODS)
// mode = 'strict' → AI must use ONLY existing FOODS entries
// mode = null     → no generation, just sync directory + Silpo-link new items
async function autoFillWeek(mode = null) {
  const overlay = document.getElementById('progOverlay');
  const bar     = document.getElementById('progBar');
  const title   = document.getElementById('progTitle');
  const sub     = document.getElementById('progSub');
  overlay.classList.add('on');
  bar.style.width = '0%';

  try {
    // Phase 1 — generation
    // - 'free' → AI call per person (network, costs money)
    // - 'strict' → 100% local generator from FOODS, no AI call at all
    if (mode === 'free') {
      const provLabel = AI_PROVIDERS[getAIProvider()].label;
      const ids = getPeopleIds();
      for (let i = 0; i < ids.length; i++) {
        const pid = ids[i];
        title.textContent = `${provLabel} генерує план...`;
        sub.textContent = `${getPersonName(pid)} (${i+1}/${ids.length}) — до 1 хв`;
        bar.style.width = `${Math.round((i / ids.length) * 50)}%`;
        const slowAnim = setInterval(() => {
          const cur = parseFloat(bar.style.width) || 0;
          const max = ((i + 0.9) / ids.length) * 50;
          if (cur < max) bar.style.width = (cur + 0.4) + '%';
        }, 700);
        try {
          await generateMenuViaAI(pid, 'free');
        } finally {
          clearInterval(slowAnim);
        }
      }
    } else if (mode === 'strict') {
      title.textContent = 'Складаємо план з довідника...';
      const ids = getPeopleIds();
      for (let i = 0; i < ids.length; i++) {
        const pid = ids[i];
        sub.textContent = `${getPersonName(pid)} (${i+1}/${ids.length})`;
        bar.style.width = `${Math.round((i / ids.length) * 50)}%`;
        generateMenuLocally(pid);
      }
    }

    // Phase 2 — seed FOODS for any items not yet in directory
    bar.style.width = '55%';
    title.textContent = 'Оновлюємо довідник';
    sub.textContent = '';
    seedFoodsFromMenu();

    // Phase 3 — auto-link unmapped FOODS entries to Silpo (skip in strict
    // mode since strict implies user wants only directory state, no enrich)
    let upgraded = 0, total = 0;
    if (mode !== 'strict') {
      title.textContent = 'Привʼязуємо до Сільпо...';
      const result = await enrichFoodsFromSilpo((name, i, n) => {
        sub.textContent = name;
        bar.style.width = `${Math.round(60 + (i / Math.max(1, n)) * 30)}%`;
      });
      upgraded = result.upgraded;
      total    = result.total;
    }

    // Phase 4 — push (now possibly Silpo-linked) FOODS data into menu items
    bar.style.width = '95%';
    sub.textContent = '';
    applyFoodsToMenuItems();

    // Save
    bar.style.width = '100%';
    title.textContent = '✓ Готово!';
    if (mode === 'free' || mode === 'strict') {
      sub.textContent = total > 0
        ? `План створено через AI. Привʼязано до Сільпо: ${upgraded} з ${total}`
        : 'План створено через AI';
    } else {
      sub.textContent = total > 0
        ? `Довідник синхронізовано. Привʼязано до Сільпо: ${upgraded} з ${total}`
        : 'Довідник синхронізовано з меню';
    }
    if (db) set(ref(db, 'racion/menu'), MENU).then(() => setSyncStatus('ok', 'Збережено ✓')).catch(() => {});
    renderMeals();
    renderTotals();
    renderFoodsDir();
    setTimeout(() => overlay.classList.remove('on'), 2400);
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
  showConfirm({
    icon: '↺',
    title: 'Скинути прийоми дня?',
    text: 'Прийоми їжі цього дня повернуться до налаштувань з профіля. Зміни підтвердиш кнопкою Зберегти.',
    actions: [
      { label: 'Скинути', style: 'primary', onClick: () => {
        _dmReset = true;
        _dmDraft = JSON.parse(JSON.stringify(getPersonMeals(person)));
        renderDmList();
        document.getElementById('dmSubTitle').textContent = 'Скинуто. Натисни Зберегти щоб застосувати';
      }},
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
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

window.deletePersonFromEditor = function() {
  if (!_peEditingId) return;
  if (getPeopleIds().length <= 1) { showToast('Має лишитись хоча б 1 людина'); return; }
  const name = _peDraft?.name || _peEditingId;
  showConfirm({
    icon: '🗑',
    title: `Видалити "${name}"?`,
    text: 'Все її меню та записи в щоденнику теж видаляться. Це не можна відмінити.',
    actions: [
      { label: 'Видалити', style: 'danger', onClick: async () => {
        const pid = _peEditingId;
        delete PEOPLE[pid];
        delete MENU[pid];
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
        if (person === pid) person = getPeopleIds()[0];
        closePersonEditor();
        renderPeople();
        renderMenuPage();
        showToast('Видалено');
      }},
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

// ═══════════════════════════════
// CUSTOM CONFIRM MODAL
// ═══════════════════════════════
// showConfirm({icon, title, text, input, actions})
// input = { placeholder, value }  — when present, shows a text field;
//                                    its value is passed to action.onClick
// actions = [{ label, style:'primary'|'secondary'|'danger'|'cancel', onClick }]
window.showConfirm = function({ icon, title, text, input, actions }) {
  document.getElementById('cfIcon').textContent = icon || '❓';
  document.getElementById('cfTitle').textContent = title || '';
  document.getElementById('cfText').textContent = text || '';
  const inpEl = document.getElementById('cfInput');
  if (input) {
    inpEl.style.display = '';
    inpEl.placeholder = input.placeholder || '';
    inpEl.value = input.value || '';
    setTimeout(() => { inpEl.focus(); inpEl.select(); }, 120);
  } else {
    inpEl.style.display = 'none';
    inpEl.value = '';
  }
  const actEl = document.getElementById('cfActions');
  actEl.innerHTML = '';
  for (const a of (actions || [])) {
    const btn = document.createElement('button');
    btn.className = 'cf-btn cf-btn-' + (a.style || 'secondary');
    btn.textContent = a.label;
    btn.onclick = () => {
      const val = input ? inpEl.value : undefined;
      cfClose();
      a.onClick?.(val);
    };
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

// Build the prompt for plan generation.
// mode='free'  → AI may invent new ingredients but should prefer existing ones
// mode='strict' → AI must use ONLY ingredients from FOODS directory
function buildPlanPrompt(person, mode = 'free') {
  const meals = (person.meals || DEFAULT_MEALS).map(m =>
    `  - ${m.key}: ${m.name} (${m.time})`
  ).join('\n');
  const t = person.targets || {};
  const fbForbidden = (person.forbidden || []);
  const fb = fbForbidden.join(', ') || 'немає';

  // Build directory context — list every FOODS entry with its nutrition,
  // skipping forbidden items so AI doesn't even see them.
  const isForbidden = name => fbForbidden.some(f =>
    String(name||'').toLowerCase().includes(String(f).toLowerCase())
  );
  const tagLabel = key => MEAL_TAGS.find(t => t.key === key)?.label || key;
  const dirItems = Object.values(FOODS)
    .filter(f => f && f.name && (f.kcal || 0) > 0 && !isForbidden(f.name))
    .map(f => {
      const base = `  - ${f.name}: ${Math.round(f.kcal)} ккал, ${(f.protein||0)}г Б, ${(f.fat||0)}г Ж, ${(f.carbs||0)}г В`;
      const tags = (f.tags || []);
      if (tags.length) return base + ` [тільки для: ${tags.map(tagLabel).join(', ')}]`;
      return base;
    });

  let dirSection = '';
  if (dirItems.length) {
    if (mode === 'strict') {
      dirSection = `\n\n⚠️ СУВОРИЙ РЕЖИМ ⚠️
ВИКОРИСТОВУЙ ВИКЛЮЧНО продукти з цього довідника. Бери ТОЧНО ці значення нутриції на 100г.
НЕ ВИГАДУЙ нові продукти, навіть якщо здається що чогось бракує — комбінуй що є.

Доступні продукти (всі КБЖУ на 100г):
${dirItems.join('\n')}`;
    } else {
      dirSection = `\n\nВ довіднику вже є ці продукти. НАДАВАЙ ЇМ ПЕРЕВАГУ якщо вони підходять — використовуй ТОЧНО ці назви і значення нутриції щоб не дублювати:
${dirItems.join('\n')}

Можеш додавати нові продукти ТІЛЬКИ якщо без них не вийде збалансованого тижня.`;
    }
  }

  return `Згенеруй тижневий план харчування для людини. Поверни ВИКЛЮЧНО валідний JSON, без жодного тексту до або після.

Профіль:
- Імʼя: ${person.name || 'Користувач'}
- Вік: ${person.age || 'не вказано'}
- Вага: ${person.weight ? person.weight + ' кг' : 'не вказано'}
- Денна ціль: ${t.kcal || 2000} ккал, ${t.protein || 150}г білка, ${t.fat || 65}г жирів, ${t.carbs || 200}г вуглеводів
- Заборонені продукти (НЕ використовувати взагалі): ${fb}
- Прийоми їжі (точно ці слоти, не змінюй ключі):
${meals}${dirSection}

Вимоги:
1. Згенеруй РІВНО 7 днів (weekday 0=Неділя, 1=Понеділок, ..., 6=Субота).
2. Кожен день має містити кожен прийом їжі зі списку вище (за key).
3. Кожен прийом має 2-5 інгредієнтів. Назви українською, реальні продукти.
4. Порції — реалістичні (150г куряче філе, 100г гречки, 100г огірка).
5. Денна сума ккал має бути близькою до цілі ±100 ккал.
6. Різноманітність — не повторюй однакові прийоми кожного дня.
7. ВРАХУЙ заборонені продукти і їх варіації (наприклад "лосось" забороняє "стейк лосося").
8. Якщо в продукта вказано [тільки для: ...] — використовуй його ВИКЛЮЧНО в перелічених типах прийомів. Наприклад "[тільки для: Сніданок]" означає що продукт може бути лише в сніданку.
9. Кожен item має містити ТОЧНІ значення per-100g — реальні харчові дані.

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

  // Hard timeout — without this a stuck network call hangs forever
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);

  try {
    if (provider === 'claude') {
      console.log('[AI] Calling Claude API...');
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      console.log('[AI] Claude response status:', r.status);
      if (!r.ok) {
        const txt = await r.text();
        console.error('[AI] Claude error body:', txt);
        throw new Error(`Claude API ${r.status}: ${txt.slice(0, 300)}`);
      }
      const data = await r.json();
      console.log('[AI] Claude usage:', data.usage);
      return data.content?.[0]?.text || '';
    }

    if (provider === 'gemini') {
      console.log('[AI] Calling Gemini API...');
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
        }),
      });
      console.log('[AI] Gemini response status:', r.status);
      if (!r.ok) {
        const txt = await r.text();
        console.error('[AI] Gemini error body:', txt);
        throw new Error(`Gemini API ${r.status}: ${txt.slice(0, 300)}`);
      }
      const data = await r.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Запит до AI завис довше 2 хв. Спробуй ще раз або переключись на Gemini.');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (provider === 'openai') {
    // OpenAI blocks direct browser calls via CORS. Requires a proxy
    // (e.g. a Cloudflare Worker that forwards to api.openai.com). Until
    // that's set up we just throw — keep the option visible in UI for later.
    throw new Error('OpenAI потребує проксі-сервера через CORS. Поки використовуй Claude або Gemini.');
  }

  throw new Error('Невідомий AI провайдер: ' + provider);
}

// Ask the active AI provider for per-100g nutrition of a single product.
// Returns { kcal, protein, fat, carbs } or throws on failure.
async function fetchNutritionFromAI(name) {
  if (!getAIKey()) throw new Error('Не налаштовано AI ключ. Зайди в Профіль → AI генератор.');
  const prompt = `Поверни ВИКЛЮЧНО валідний JSON без жодного тексту до або після — харчова цінність продукту "${name}" на 100г.

Формат: {"kcal": число, "protein": число, "fat": число, "carbs": число}

Усі поля обовʼязкові, числа без одиниць виміру. Якщо це український продукт — використовуй стандартні значення для України. Якщо точно невідомо — дай найбільш ймовірну оцінку.`;
  const raw = await callAIProvider(prompt);
  // Reuse the JSON-extraction logic from the plan parser
  let t = String(raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  let data;
  try { data = JSON.parse(t); }
  catch (e) { throw new Error('AI повернув некоректний JSON: ' + t.slice(0, 120)); }
  const result = {
    kcal:    Number(data.kcal)    || 0,
    protein: Number(data.protein) || 0,
    fat:     Number(data.fat)     || 0,
    carbs:   Number(data.carbs)   || 0,
  };
  if (!result.kcal) throw new Error('AI не зміг визначити калорійність для "' + name + '"');
  return result;
}

// Categories that aren't shown as buckets in the recipes view. Recipes
// carrying any of these still exist in FOODS — they appear under their
// other (real) categories. Only orphans fall into 'Інше'.
const SKIP_BUCKET_NAMES = new Set([
  // Meta-tags (filters, not categories)
  'Відео',
  'Готуємо без світла',
  'Шкільні рецепти',
  'Мамині рецепти',
  'Страви в мультиварці',
  'Страви з пшениці',
  // User-decided exclusions
  'Дієтичні страви',
  'Вегетаріанські рецепти',
  'Блюда на Пасху',
  'Торти',
  'Рибне',
  'Сендвічі та бутерброди',
  'Випічка',
  'Солодкі страви',
  'Десерти',
  'Коктейлі та напої',
]);

// Top-level meal-type buckets that the recipes view groups into.
// Same key as MEAL_TAGS so the rest of the app stays consistent.
const MEAL_TYPE_BUCKETS = [
  { type: 'breakfast', label: 'Сніданок', icon: '🌅' },
  { type: 'lunch',     label: 'Обід',     icon: '🍽️' },
  { type: 'dinner',    label: 'Вечеря',   icon: '🌙' },
  { type: 'snack',     label: 'Перекус',  icon: '🥗' },
];

// Map klopotenko category name → list of meal types it serves.
// A category can map to multiple types (Другі страви → lunch + dinner) so
// recipes appear in both meal-type buckets.
const CATEGORY_TO_MEAL_TYPES = {
  'Перші страви':    ['lunch'],
  'Другі страви':    ['lunch', 'dinner'],
  'М\'ясні':         ['lunch', 'dinner'],
  'Овочеві':         ['lunch', 'dinner'],
  'Гарніри':         ['lunch', 'dinner'],
  'Салати':          ['lunch', 'dinner'],
  'Закуски':         ['snack'],
  'Холодні закуски': ['snack'],
  'Гарячі закуски':  ['snack', 'lunch'],
  // No own bucket but contribute to breakfast — sweet/baked dishes are
  // typical morning fare (сирники, оладки, панкейки, гранола, etc).
  'Солодкі страви':  ['breakfast'],
  'Випічка':         ['breakfast'],
};

// Optional display icon per category name. Unknown names get '🍳'.
const CATEGORY_ICONS = {
  'Сніданок':                '🌅',
  'Перші страви':            '🍲',
  'Другі страви':            '🍽️',
  'М\'ясні':                 '🥩',
  'Рибне':                   '🐟',
  'Овочеві':                 '🥦',
  'Гарніри':                 '🍚',
  'Салати':                  '🥗',
  'Закуски':                 '🥙',
  'Холодні закуски':         '🍢',
  'Гарячі закуски':          '🌶️',
  'Десерти':                 '🍰',
  'Солодкі страви':          '🍮',
  'Випічка':                 '🥐',
  'Дієтичні страви':         '🥬',
  'Вегетаріанські рецепти':  '🌱',
  'Сендвічі та бутерброди':  '🥪',
  'Коктейлі та напої':       '🥤',
  'Торти':                   '🎂',
  'Блюда на Пасху':          '🌻',
};

// ── KLOPOTENKO CATEGORY → MEAL-TYPE TAG MAPPING ──────────────────────────
// Maps klopotenko's recipeCategory strings (comma-separated) into our
// breakfast/lunch/dinner/snack tags. A recipe inherits all matching tags.
const CATEGORY_TO_MEAL_TAGS = [
  // [substring in category string, [meal types]]
  ['снідан',         ['breakfast']],
  ['каш',            ['breakfast']],            // morning porridges
  ['перші',          ['lunch']],                // soups
  ['другі',          ['lunch', 'dinner']],      // main courses
  ['м\'ясн',         ['lunch', 'dinner']],
  ['рибн',           ['lunch', 'dinner']],
  ['овочев',         ['lunch', 'dinner']],
  ['гарнір',         ['lunch', 'dinner']],
  ['салат',          ['lunch', 'dinner']],
  ['пиц',            ['lunch', 'dinner']],
  ['паст',           ['lunch', 'dinner']],
  ['десерт',         ['snack']],
  ['солодк',         ['snack']],
  ['випічк',         ['snack']],
  ['закуск',         ['snack']],
  ['коктейл',        ['snack']],
  ['напо',           ['snack']],
];

// Categories we DON'T want to import as recipes (not full meals)
const SKIP_CATEGORIES = ['Соуси', 'Заготовки', 'Варення', 'Маринади'];

function inferMealTagsFromCategory(category, name) {
  const c = (category || '').toLowerCase();
  const n = (name || '').toLowerCase();
  const tags = new Set();
  // Name-based hints win first
  if (/снідан|каша/.test(n)) tags.add('breakfast');
  for (const [sub, mealTags] of CATEGORY_TO_MEAL_TAGS) {
    if (c.includes(sub) || n.includes(sub)) {
      mealTags.forEach(t => tags.add(t));
    }
  }
  return [...tags];
}

// Bulk import recipes.json (shipped in repo) into FOODS as type='recipe'
// stubs with kcal=0. Per-category AI nutrition is computed afterwards.
window.promptBulkImportKlopotenko = function() {
  showConfirm({
    icon: '📥',
    title: 'Імпорт бази рецептів',
    text: 'Завантажу ~1600 рецептів з klopotenko.com у твій довідник. Це безкоштовно (без AI), КБЖУ можна буде додати потім по категоріях. Записи в Firebase займуть ~2 МБ.',
    actions: [
      { label: 'Імпортувати', style: 'primary', onClick: () => doBulkImportKlopotenko() },
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

async function doBulkImportKlopotenko() {
  const overlay = document.getElementById('progOverlay');
  const bar     = document.getElementById('progBar');
  const title   = document.getElementById('progTitle');
  const sub     = document.getElementById('progSub');
  overlay.classList.add('on');
  title.textContent = '📥 Завантажуємо базу рецептів...';
  sub.textContent = '';
  bar.style.width = '0%';

  try {
    const r = await fetch('./recipes.json');
    if (!r.ok) throw new Error('recipes.json не знайдено в репо (HTTP ' + r.status + ')');
    const recipes = await r.json();

    title.textContent = '📥 Імпорт у довідник...';
    sub.textContent = `${recipes.length} рецептів`;

    // Build batch update — much faster than per-item set()
    const batch = {};
    let added = 0, skipped = 0;
    for (const rec of recipes) {
      if (!rec.name || !rec.ingredients?.length) { skipped++; continue; }
      // Skip non-meal categories
      if (rec.category && SKIP_CATEGORIES.some(s => rec.category.includes(s))) { skipped++; continue; }
      const key = foodKey(rec.name);
      // Don't overwrite existing entries (manual edits, etc)
      if (FOODS[key]) { skipped++; continue; }
      const tags = inferMealTagsFromCategory(rec.category, rec.name);
      // Prefer the pre-computed mealTypes from recipes.json (classifier
      // ran during build time and stored breakfast/lunch/dinner/snack tags
      // per recipe). Fall back to legacy tag inference for entries without it.
      const mealTags = (rec.mealTypes && rec.mealTypes.length) ? rec.mealTypes : tags;
      const food = {
        name: rec.name,
        type: 'recipe',
        kcal:    rec.kcal    || 0,
        protein: rec.protein || 0,
        fat:     rec.fat     || 0,
        carbs:   rec.carbs   || 0,
        ingredients: rec.ingredients,
        category: rec.category || '',
        cuisine: rec.cuisine || '',
        servings: rec.servings || null,
        sourceUrl: rec.sourceUrl,
        sourceImage: rec.sourceImage || null,
        source: 'klopotenko',
        tags: mealTags,
      };
      // Skip recipes that didn't classify into any meal type — they're
      // typically jams/preserves that we don't want in the planner anyway
      if (!mealTags.length) { skipped++; continue; }
      FOODS[key] = food;
      batch['racion/foods/' + key] = food;
      added++;
    }

    // Write in chunks of 200 (Firebase update payload limits)
    if (db) {
      const keys = Object.keys(batch);
      for (let i = 0; i < keys.length; i += 200) {
        const chunk = {};
        keys.slice(i, i + 200).forEach(k => chunk[k] = batch[k]);
        await update(ref(db), chunk);
        bar.style.width = `${Math.round((i + 200) / keys.length * 100)}%`;
        sub.textContent = `Збережено ${Math.min(i+200, keys.length)} з ${keys.length}`;
      }
    }

    bar.style.width = '100%';
    title.textContent = '✓ Готово!';
    sub.textContent = `Імпортовано: ${added}. Пропущено: ${skipped}. Тепер можеш додати КБЖУ через AI по категоріях.`;
    renderFoodsDir();
    setTimeout(() => overlay.classList.remove('on'), 3500);
  } catch (e) {
    overlay.classList.remove('on');
    showConfirm({
      icon: '⚠️',
      title: 'Помилка імпорту',
      text: e.message || String(e),
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
  }
}

// Compute nutrition via AI for all recipes in a given category that don't yet
// have kcal. Cheap with Gemini Flash (free), modest with Claude (~$0.001/recipe).
window.promptComputeCategoryNutrition = function(catKey) {
  const cat = RECIPE_CATEGORIES.find(c => c.key === catKey);
  if (!cat) return;
  const todo = Object.entries(FOODS).filter(([k, f]) =>
    f?.type === 'recipe' && (f.category || '').includes(cat.label) && !f.kcal
  );
  if (!todo.length) {
    showToast('У цій категорії немає рецептів без КБЖУ');
    return;
  }
  showConfirm({
    icon: '🤖',
    title: `Розрахувати КБЖУ для "${cat.label}"`,
    text: `${todo.length} рецептів буде відправлено на обраний AI провайдер. Це може зайняти ${Math.ceil(todo.length / 60)} хв (Gemini ~60/хв, Claude швидше). Натисни лише якщо ключ вже налаштовано.`,
    actions: [
      { label: 'Запустити', style: 'primary', onClick: () => computeCategoryNutrition(todo) },
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

async function computeCategoryNutrition(entries) {
  if (!getAIKey()) {
    showConfirm({
      icon: '⚠️',
      title: 'Немає AI ключа',
      text: 'Зайди в Профіль → AI генератор і додай ключ.',
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
    return;
  }
  const overlay = document.getElementById('progOverlay');
  const bar     = document.getElementById('progBar');
  const title   = document.getElementById('progTitle');
  const sub     = document.getElementById('progSub');
  overlay.classList.add('on');
  title.textContent = '🤖 AI рахує КБЖУ рецептів';
  bar.style.width = '0%';

  let done = 0, ok = 0;
  for (const [key, food] of entries) {
    sub.textContent = `${done + 1}/${entries.length} · ${food.name.slice(0, 50)}`;
    bar.style.width = `${Math.round(done / entries.length * 100)}%`;
    try {
      const ingList = food.ingredients.join('\n');
      const prompt = `Розрахуй середню харчову цінність на 100г готової страви "${food.name}".

Інгредієнти:
${ingList}

Поверни ВИКЛЮЧНО валідний JSON без жодного тексту: {"kcal": число, "protein": число, "fat": число, "carbs": число}
Усі поля обовʼязкові, числа без одиниць виміру.`;
      const raw = await callAIProvider(prompt);
      let t = String(raw).trim();
      const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) t = fence[1].trim();
      const first = t.indexOf('{'), last = t.lastIndexOf('}');
      if (first >= 0 && last > first) t = t.slice(first, last + 1);
      const data = JSON.parse(t);
      if (data.kcal) {
        FOODS[key] = {
          ...food,
          kcal:    Number(data.kcal)    || 0,
          protein: Number(data.protein) || 0,
          fat:     Number(data.fat)     || 0,
          carbs:   Number(data.carbs)   || 0,
        };
        if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
        ok++;
      }
    } catch (e) {
      console.warn('[ai-nutr]', food.name, e.message);
    }
    done++;
  }

  bar.style.width = '100%';
  title.textContent = '✓ Готово!';
  sub.textContent = `Розраховано ${ok} з ${entries.length}`;
  renderFoodsDir();
  setTimeout(() => overlay.classList.remove('on'), 2500);
}

// ── RECIPE INGREDIENT COVERAGE ──────────────────────────────────────────
// Pantry staples — stem-form set. Includes ALL common stem variants
// (Ukrainian has stem-changing inflections so 'сіль' → 'сіл' but 'солі' → 'сол';
// both must be listed). These never count as missing or reduce the ratio.
const PANTRY_STAPLE_STEMS = new Set([
  // SALT — сіль/солі/сіллю/посолити
  'сол', 'сіл', 'сол', 'посол',
  // PEPPER — перець/перцю/перчений/перчик
  'перц', 'перец', 'перч', 'перчик',
  // WATER — вода/води/водою
  'вод', 'льод',
  // SUGAR — цукор/цукру/цукровий
  'цук', 'цукор', 'цукр',
  // VANILLA
  'ванілі', 'ваніль', 'ваніл', 'ванільн',
  // OIL — олія/олій/оливкова
  'олі', 'олій', 'олиї', 'оливк',
  // VINEGAR — оцет/оцту
  'оце', 'оцт', 'оцет',
  // Common dried spices / herbs
  'лавр', 'кмин', 'паприк', 'кориц', 'мускат', 'гвоздик', 'кардамон',
  'імбир', 'куркум', 'базилік', 'орегано', 'чебрец', 'тимʼ', 'тим', 'розмарин',
  'мят', 'мʼят', 'кінз', 'фенхель', 'чилі', 'кайєн', 'каррі', 'хмел',
  // Fresh herbs everyone has
  'петрушк', 'кріп', 'кроп', 'зелен',
  // Baking basics
  'сод', 'розпуш', 'дріжж',
  // Garlic
  'часник', 'часн', 'часнк', 'зубчик', 'зубч', 'зубк',
]);

function isPantryStaple(parsedName) {
  if (!parsedName) return false;
  const allStems = stemsOf(parsedName);
  if (!allStems.size) return true;
  // Drop modifier-adjective stems via prefix match (so 'червони' filters
  // even though MODS only has 'червон')
  const isModifier = s => {
    for (const mod of STAPLE_MODIFIER_STEMS) {
      if (s === mod) return true;
      if (mod.length >= 4 && (s.startsWith(mod) || mod.startsWith(s))) return true;
    }
    return false;
  };
  const significant = [...allStems].filter(s => !isModifier(s));
  if (!significant.length) return true;
  for (const s of significant) {
    let isStaple = false;
    if (PANTRY_STAPLE_STEMS.has(s)) isStaple = true;
    else {
      for (const staple of PANTRY_STAPLE_STEMS) {
        if (staple.length >= 3 && (s.startsWith(staple) || staple.startsWith(s))) {
          isStaple = true;
          break;
        }
      }
    }
    if (!isStaple) return false;
  }
  return true;
}

// Parse a raw klopotenko ingredient string ("500 г свинини", "2 ст. л. олії",
// "4-5 шт. картоплі") into a normalized base name suitable for matching.
//
// All regexes use Unicode-aware word matching (Cyrillic letters explicitly).
// Units are only stripped IF they follow a number — otherwise we'd eat the
// initial 'л' from words like 'лавровий'.
function parseIngredientName(raw) {
  let s = String(raw || '').toLowerCase();
  // Decode HTML entities
  s = s.replace(/&#8217;|&rsquo;|&apos;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ');
  // Replace fractions with space (we'll strip the leading number block next)
  s = s.replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, ' ');
  // Strip a leading number-and-unit block: optional digits/fractions/dashes,
  // optional unit (must follow whitespace or appear after digits), trailing
  // separator. Only happens if string starts with a digit OR known unit
  // immediately followed by whitespace.
  // Strip a leading number block + optional unit + separator.
  // Cyrillic suffix class [а-яіїєґ]* covers all inflection forms.
  s = s.replace(
    /^[\d\s,.\/\u2013\-]+(?:г|кг|мл|л|шт[а-яіїєґ]*|ч\.?\s*л\.?|ст\.?\s*л\.?|столов[а-яіїєґ]*\s*ложк[а-яіїєґ]*|чайн[а-яіїєґ]*\s*ложк[а-яіїєґ]*|стакан[а-яіїєґ]*|склянк[а-яіїєґ]*|жмен[а-яіїєґ]*|пучок|пучк[а-яіїєґ]*|щіпк[а-яіїєґ]*|зубчик[а-яіїєґ]*|зубч[а-яіїєґ]*|зубк[а-яіїєґ]*|пакет[а-яіїєґ]*|банк[а-яіїєґ]*|пляшк[а-яіїєґ]*|за\s*смак[а-яіїєґ]*|до\s*смак[а-яіїєґ]*)?[\s\.,]*/i,
    ''
  );
  // Strip leading quantifier nouns that may appear without numbers
  s = s.replace(
    /^(?:дрібк[аиу]|пучок|пучк[аиу]|пучка|жмен[яіюа]|щіпк[аи]|шматок|шматочок|шматочки|невелик[аиу]?|пара|кілька|трохи|по\s*смак[оу])[\s\.,]*/i,
    ''
  );
  // Strip parentheticals
  s = s.replace(/\([^)]*\)/g, ' ');
  // Strip leading common adjective stems (свіжий, варений, etc)
  s = s.replace(
    /^(?:свіж|варен|тушков|смажен|запечен|сухий|сушен|молод|стиглий|маринован|солон|нарізан|подрібн)[а-яіїєґʼ']*\s+/i,
    ''
  );
  return s.replace(/\s+/g, ' ').trim();
}

// Adjective stems that DON'T change staple-status of a multi-word phrase
// (used in isPantryStaple). 'лавровий лист' is a staple because 'лавр' is.
const STAPLE_MODIFIER_STEMS = new Set([
  // Spice modifiers / phrases
  'лавр', 'лавров', 'лист',
  'червон', 'чорн', 'біл', 'жовт', 'зелен', 'темн', 'світл',
  'молот', 'мелен', 'мел',
  'дрібн', 'велик', 'малий',
  'морськ', 'камʼя', 'камя', 'кам',
  'запашн', 'духм',
  'солодк', 'гострий', 'гірк', 'кисл',
  'сушен', 'свіж',
  // Oil-type adjectives — 'соняшникова олія' = staple because 'олі' is
  'соняшни', 'соняшн', 'оливков', 'оливк', 'кунжут', 'льнян', 'кокос', 'кокосов',
  'арахіс', 'арахісо', 'кукуруд', 'рослин', 'тваринн', 'верш',
  // 'до смаку' / 'за смаком' tail — gets parsed as 'смак', means 'to taste'
  'смак', 'смаку', 'смаком',
  // Sugar forms — 'цукрова пудра' = staple because 'цукр' is
  'пудр',
]);

// Map post-stem irregular forms onto a canonical stem so different
// stem-changing inflections collapse together (Ukrainian has stem-changing
// nouns: яйце/яйця → 'яйц' but the genitive plural 'яєць' → 'яєц').
const STEM_ALIASES = {
  'яєц': 'яйц', 'яєчк': 'яйц', 'яєчн': 'яйц',
  'мяс': 'мяс', 'мʼяс': 'мяс',
  'моркв': 'морк', 'морков': 'морк',
};

// Cyrillic word stem — strip common inflection suffixes and normalize.
// No early-return for short words: 'яйце'/'сіль' must also be stemmed so
// they collapse with 'яйця'/'солі'/'сіллю'.
function stemUk(word) {
  let w = String(word || '').toLowerCase().replace(/[ʼ'']/g, '');
  if (!w) return '';
  // Drop common Ukrainian inflection suffixes (cases/numbers)
  w = w.replace(/(?:ами|ями|ому|ого|ям|ах|ою|ій|ої|ом|их|ат|ят|ів|ам|ах|ях|ем|им|ять|ять)$/, '');
  // Drop trailing single vowel or soft sign
  w = w.replace(/[аеєиіїоуюяь]$/, '');
  w = w.slice(0, 7);
  return STEM_ALIASES[w] || w;
}

// Compute the set of significant stems for a piece of text. Filter very
// short noise words (≤2 chars) but keep 3-char ones so 'сіль'→'сіл'/'рис'
// stay in the set.
function stemsOf(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^а-яіїєґʼ'\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .map(stemUk)
      .filter(s => s && s.length >= 2)
  );
}

// Match an ingredient string against a product name.
// Strict enough to NOT confuse "куряче філе" with "Яйця курячі" (both share
// 'куряч' stem but only one stem of 2 — 50% overlap, below threshold).
function ingredientMatchesProduct(ingredientText, productName) {
  const ing = parseIngredientName(ingredientText).toLowerCase();
  const prod = String(productName || '').toLowerCase();
  if (!ing || !prod) return false;

  // 1. Direct full-string substring either way (very strong signal).
  //    'яйця' includes-test against 'яйця курячі' = MATCH.
  if (prod.includes(ing) || ing.includes(prod)) return true;

  // 2. Stem-based matching with REQUIRED-OVERLAP ratio.
  //    For multi-word ingredients/products we need at least ⌈min(|i|,|p|)*0.6⌉
  //    shared stems. This prevents 'куряче філе' (stems куряч,філ) from
  //    matching 'яйця курячі' (stems яйц,куряч) on a single shared stem.
  const ingStems = [...stemsOf(ing)];
  const prodStems = [...stemsOf(prod)];
  if (!ingStems.length || !prodStems.length) return false;

  let shared = 0;
  for (const s of ingStems) {
    if (prodStems.includes(s)) { shared++; continue; }
    for (const p of prodStems) {
      if (s.length >= 4 && p.length >= 4 &&
          (s.startsWith(p.slice(0, 4)) || p.startsWith(s.slice(0, 4)))) {
        shared++;
        break;
      }
    }
  }

  const minSize = Math.min(ingStems.length, prodStems.length);
  // Single-word on one side: 1 shared is enough (we already passed substring
  // check, this catches inflected forms like 'картоплі' → 'Картопля').
  // Multi-word both sides: need ≥60% of the smaller side's stems to overlap.
  const required = minSize <= 1 ? 1 : Math.ceil(minSize * 0.6);
  return shared >= required;
}

// For one recipe: how many of its non-staple ingredients map to a product
// in FOODS? Pantry staples (сіль, перець, спеції, etc) are excluded from
// both matched and total — they're assumed always available.
//
// Also returns `linked` — a parallel array describing each raw ingredient
// with its resolved status: { raw, kind: 'staple'|'linked'|'missing',
// productKey?, productName? }. The recipe card uses this to render
// clickable product links inline.
function analyzeRecipeCoverage(recipe, productEntries) {
  const ings = recipe.ingredients || [];
  if (!ings.length) return { matched: 0, total: 0, ratio: 0, missing: [], skipped: 0, linked: [] };
  let matched = 0, skipped = 0;
  const missing = [];
  const linked = [];
  for (const ing of ings) {
    const parsed = parseIngredientName(ing);
    if (isPantryStaple(parsed)) {
      skipped++;
      linked.push({ raw: ing, kind: 'staple' });
      continue;
    }
    let foundProd = null;
    for (const prod of productEntries) {
      if (ingredientMatchesProduct(ing, prod.name)) { foundProd = prod; break; }
    }
    if (foundProd) {
      matched++;
      linked.push({ raw: ing, kind: 'linked', productKey: foundProd.key, productName: foundProd.name });
    } else {
      missing.push(ing);
      linked.push({ raw: ing, kind: 'missing' });
    }
  }
  const total = ings.length - skipped;
  return { matched, total, ratio: total > 0 ? matched / total : 1, missing, skipped, linked };
}

// Whitelist threshold — recipes with coverage ≥ this become available for the
// strict-mode generator. 0.7 = 70% of ingredients must map to known products.
const RECIPE_WHITELIST_THRESHOLD = 0.7;

let _recipeWhitelistFilterOn = false;

window.runRecipeCoverageAnalysis = function() {
  const products = Object.entries(FOODS)
    .filter(([k, f]) => f && f.type !== 'recipe' && f.name)
    .map(([k, f]) => ({ key: k, name: f.name }));
  if (!products.length) {
    showConfirm({
      icon: '⚠️',
      title: 'Немає продуктів',
      text: 'Спочатку додай продукти в довідник через вкладку Продукти. Інакше нічого з чим зіставляти.',
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
    return;
  }

  const recipes = Object.entries(FOODS).filter(([k, f]) => f?.type === 'recipe');
  let whitelisted = 0;
  const missingFreq = new Map();
  const fbBatch = {};
  for (const [key, recipe] of recipes) {
    const cov = analyzeRecipeCoverage(recipe, products);
    recipe._coverage = cov;
    const isWhite = cov.ratio >= RECIPE_WHITELIST_THRESHOLD;
    recipe._whitelisted = isWhite;
    // Persist linked ingredients + whitelist flag onto the recipe so the
    // card can render product links and the strict generator can pre-filter
    // without re-running the analysis on every page load.
    recipe.linkedIngredients = cov.linked;
    recipe.whitelisted = isWhite;
    fbBatch['racion/foods/' + key + '/linkedIngredients'] = cov.linked;
    fbBatch['racion/foods/' + key + '/whitelisted']       = isWhite;
    if (isWhite) whitelisted++;
    for (const m of cov.missing) {
      const base = parseIngredientName(m);
      if (!base || isPantryStaple(base)) continue;
      missingFreq.set(base, (missingFreq.get(base) || 0) + 1);
    }
  }

  // Batched persist (chunks of 200 keys → ~50 recipes per call)
  if (db) {
    const keys = Object.keys(fbBatch);
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = {};
      keys.slice(i, i + 200).forEach(k => chunk[k] = fbBatch[k]);
      update(ref(db), chunk).catch(e => console.warn('[cov-persist]', e));
    }
  }

  // Top 12 missing ingredients
  const top = [...missingFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topText = top.map(([n, c]) => `• ${n} (${c})`).join('\n');

  showConfirm({
    icon: '🔬',
    title: 'Аналіз покриття',
    text: `${whitelisted} з ${recipes.length} рецептів мають ≥70% інгредієнтів у довіднику (${products.length} продуктів).\n\nНайчастіше відсутні:\n${topText || '—'}`,
    actions: [{ label: 'Зрозуміло', style: 'primary' }],
  });
  renderRecipesView();
};

window.toggleRecipeWhitelistFilter = function() {
  _recipeWhitelistFilterOn = !_recipeWhitelistFilterOn;
  document.getElementById('recCovFilter').classList.toggle('on', _recipeWhitelistFilterOn);
  renderRecipesView();
};

// ── RECIPES TAB: grouping, rendering, deletion ──────────────────────────
let _expandedRecipeCats = new Set();
let _recipeBuckets = [];  // populated by renderRecipesView; handlers index into this

// Group recipes into meal-type buckets (Сніданок/Обід/Вечеря/Перекус)
// directly via food.tags — those tags were assigned per-recipe by the
// pre-build classifier (classify_recipes.py) and stored in recipes.json,
// then written to FOODS.tags during bulk import. No category mapping
// needed at runtime — every recipe carries its own meal-type assignment.
function groupRecipesByCategory() {
  const buckets = MEAL_TYPE_BUCKETS.map(b => ({
    name: b.label,
    type: b.type,
    icon: b.icon,
    recipes: [],
  }));
  const byType = Object.fromEntries(buckets.map(b => [b.type, b]));

  for (const [key, food] of Object.entries(FOODS)) {
    if (!food || food.type !== 'recipe') continue;
    if (_recipeWhitelistFilterOn && !food._whitelisted) continue;
    const tags = food.tags || [];
    if (!tags.length) continue;
    for (const t of tags) {
      const bucket = byType[t];
      if (bucket) bucket.recipes.push({ key, food });
    }
  }

  return buckets.filter(b => b.recipes.length);
}

// Build the small coverage badge HTML for a recipe item.
function recipeCovBadge(food) {
  const cov = food._coverage;
  if (!cov || !cov.total) return '';
  const pct = Math.round(cov.ratio * 100);
  const cls = pct >= 70 ? 'full' : pct >= 40 ? 'partial' : 'low';
  return `<span class="recipe-cov-badge ${cls}" title="${cov.matched} з ${cov.total} інгредієнтів у довіднику">${pct}%</span>`;
}

window.renderRecipesView = function() {
  const list = document.getElementById('recipesList');
  if (!list) return;
  _recipeBuckets = groupRecipesByCategory();
  if (!_recipeBuckets.length) {
    list.innerHTML = `<div class="dir-empty">Немає рецептів у довіднику.<br>Натисни <strong>📥 Імпорт бази klopotenko</strong> вище.</div>`;
    return;
  }
  list.innerHTML = _recipeBuckets.map((grp, idx) => {
    const noNutr = grp.recipes.filter(r => !r.food.kcal).length;
    const isExpanded = _expandedRecipeCats.has(grp.name);
    const expandedList = isExpanded
      ? `<div class="recipe-cat-list">
          ${grp.recipes.slice(0, 100).map(r => `
            <div class="recipe-item" onclick="openPCard('${r.key}')">
              <span class="recipe-item-kcal${r.food.kcal ? '' : ' empty'}">${r.food.kcal ? Math.round(r.food.kcal) : '—'}</span>
              <span class="recipe-item-name">${escapeHtml(r.food.name)}</span>
              ${recipeCovBadge(r.food)}
            </div>
          `).join('')}
          ${grp.recipes.length > 100 ? `<div class="recipe-item-more">... і ще ${grp.recipes.length - 100} рецептів</div>` : ''}
        </div>`
      : '';
    return `<div class="recipe-cat">
      <div class="recipe-cat-hdr" onclick="toggleRecipeCat(${idx})">
        <span class="recipe-cat-icon">${grp.icon}</span>
        <div class="recipe-cat-info">
          <div class="recipe-cat-name">${escapeHtml(grp.name)}</div>
          <div class="recipe-cat-meta">${grp.recipes.length} рецептів${noNutr ? ` · <span class="nonutr">${noNutr} без КБЖУ</span>` : ''}</div>
        </div>
        <span class="recipe-cat-arr">${isExpanded ? '▼' : '▶'}</span>
      </div>
      <div class="recipe-cat-actions">
        ${noNutr ? `<button class="compute-btn" onclick="event.stopPropagation();promptComputeCategoryRecipes(${idx})">🤖 КБЖУ (${noNutr})</button>` : ''}
        <button class="delete-btn" onclick="event.stopPropagation();confirmDeleteRecipeCategory(${idx})">🗑 Видалити всі</button>
      </div>
      ${expandedList}
    </div>`;
  }).join('');
};

window.toggleRecipeCat = function(idx) {
  const grp = _recipeBuckets[idx];
  if (!grp) return;
  if (_expandedRecipeCats.has(grp.name)) _expandedRecipeCats.delete(grp.name);
  else _expandedRecipeCats.add(grp.name);
  renderRecipesView();
};

window.promptComputeCategoryRecipes = function(idx) {
  const grp = _recipeBuckets[idx];
  if (!grp) return;
  const todo = grp.recipes.filter(r => !r.food.kcal).map(r => [r.key, r.food]);
  if (!todo.length) { showToast('У цій категорії всі рецепти вже мають КБЖУ'); return; }
  showConfirm({
    icon: '🤖',
    title: `КБЖУ для "${grp.name}"`,
    text: `${todo.length} рецептів буде відправлено на ${AI_PROVIDERS[getAIProvider()].label}. Час: ~${Math.max(1, Math.ceil(todo.length / 30))} хв. Gemini Flash безкоштовний, Claude ~$0.001/рецепт.`,
    actions: [
      { label: 'Запустити', style: 'primary', onClick: () => computeCategoryNutrition(todo).then(() => renderRecipesView()) },
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

window.confirmDeleteRecipeCategory = function(idx) {
  const grp = _recipeBuckets[idx];
  if (!grp) return;
  showConfirm({
    icon: '🗑',
    title: `Видалити "${grp.name}"?`,
    text: `${grp.recipes.length} рецептів буде видалено з довідника. Це не можна відмінити.`,
    actions: [
      { label: `Видалити ${grp.recipes.length}`, style: 'danger', onClick: () => deleteRecipeCategory(grp.name) },
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

async function deleteRecipeCategory(bucketName) {
  // Re-group from current FOODS so we delete the actual current set
  const groups = groupRecipesByCategory();
  const grp = groups.find(g => g.name === bucketName);
  if (!grp || !grp.recipes.length) return;
  const overlay = document.getElementById('progOverlay');
  const bar     = document.getElementById('progBar');
  const title   = document.getElementById('progTitle');
  const sub     = document.getElementById('progSub');
  overlay.classList.add('on');
  title.textContent = '🗑 Видаляємо рецепти...';
  sub.textContent = `${grp.recipes.length} записів`;
  bar.style.width = '20%';

  // Dedupe keys (a recipe might be in multiple categories — but we delete from
  // FOODS by key so each unique key is removed once)
  const keys = [...new Set(grp.recipes.map(r => r.key))];
  const batch = {};
  for (const k of keys) {
    delete FOODS[k];
    batch['racion/foods/' + k] = null;
  }
  if (db) {
    const allKeys = Object.keys(batch);
    for (let i = 0; i < allKeys.length; i += 200) {
      const chunk = {};
      allKeys.slice(i, i + 200).forEach(k => chunk[k] = batch[k]);
      try { await update(ref(db), chunk); } catch (e) { console.warn('[delete-cat]', e); }
      bar.style.width = `${20 + (i + 200) / allKeys.length * 75}%`;
      sub.textContent = `Видалено ${Math.min(i + 200, allKeys.length)} з ${allKeys.length}`;
    }
  }
  bar.style.width = '100%';
  title.textContent = '✓ Видалено';
  sub.textContent = `${keys.length} рецептів видалено`;
  renderRecipesView();
  setTimeout(() => overlay.classList.remove('on'), 1500);
}

// ── KLOPOTENKO RECIPE IMPORT ─────────────────────────────────────────────
// klopotenko.com publishes schema.org Recipe JSON-LD on every recipe page.
// We fetch through a public CORS proxy (the site itself doesn't expose
// Access-Control-Allow-Origin), parse the JSON-LD, and save as a FOODS
// entry with type='recipe'.
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

window.promptKlopotenkoImport = function() {
  showConfirm({
    icon: '🍳',
    title: 'Імпортувати рецепт',
    text: 'Встав посилання на рецепт з klopotenko.com — інгредієнти та КБЖУ підтягнуться автоматично.',
    input: { placeholder: 'https://klopotenko.com/...' },
    actions: [
      { label: 'Імпортувати', style: 'primary', onClick: (url) => {
        const u = (url || '').trim();
        if (!u || !u.includes('klopotenko.com')) {
          showToast('Потрібен URL з klopotenko.com', 'err');
          return;
        }
        importKlopotenkoRecipe(u);
      }},
      { label: 'Скасувати', style: 'cancel' },
    ],
  });
};

async function importKlopotenkoRecipe(url) {
  showAIBusy('🍳 Імпортуємо рецепт', 'Завантажуємо сторінку...');
  try {
    const proxied = CORS_PROXY + encodeURIComponent(url);
    const r = await fetch(proxied);
    if (!r.ok) throw new Error(`Не вдалось завантажити сторінку (HTTP ${r.status})`);
    const html = await r.text();

    // Find all <script type="application/ld+json"> blocks and pick the Recipe one
    const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    let recipe = null;
    for (const m of blocks) {
      try {
        const data = JSON.parse(m[1].trim());
        if (Array.isArray(data)) {
          const found = data.find(x => x['@type'] === 'Recipe' || (Array.isArray(x['@type']) && x['@type'].includes('Recipe')));
          if (found) { recipe = found; break; }
        } else if (data['@type'] === 'Recipe' || (Array.isArray(data['@type']) && data['@type'].includes('Recipe'))) {
          recipe = data; break;
        } else if (data['@graph']) {
          const found = data['@graph'].find(x => x['@type'] === 'Recipe' || (Array.isArray(x['@type']) && x['@type'].includes('Recipe')));
          if (found) { recipe = found; break; }
        }
      } catch (e) {}
    }
    if (!recipe) throw new Error('На сторінці немає Recipe schema. Перевір що це посилання саме на рецепт.');

    const name = String(recipe.name || 'Без назви').trim();
    const nutr = recipe.nutrition || {};
    const parseNum = s => {
      if (s == null) return 0;
      const m = String(s).match(/[\d.,]+/);
      return m ? parseFloat(m[0].replace(',', '.')) : 0;
    };
    const yieldRaw = recipe.recipeYield;
    const servings = yieldRaw ? (parseInt(String(yieldRaw).match(/\d+/)?.[0]) || null) : null;
    const image = Array.isArray(recipe.image) ? recipe.image[0] : recipe.image;

    const food = {
      name,
      type: 'recipe',
      kcal:    parseNum(nutr.calories),
      protein: parseNum(nutr.proteinContent),
      fat:     parseNum(nutr.fatContent),
      carbs:   parseNum(nutr.carbohydrateContent),
      ingredients: (recipe.recipeIngredient || []).map(s => String(s).trim()),
      servings,
      sourceUrl: url,
      sourceImage: typeof image === 'string' ? image : (image?.url || null),
      source: 'klopotenko',
      tags: [],
    };

    if (!food.kcal) throw new Error('Рецепт не містить даних про калорійність — імпорт неможливий.');

    const key = foodKey(name);
    FOODS[key] = food;
    if (db) await set(ref(db, 'racion/foods/' + key), food);

    hideAIBusy();
    showToast('Рецепт імпортовано ✓');
    renderFoodsDir();
    setTimeout(() => openPCard(key), 200);
  } catch (e) {
    hideAIBusy();
    console.error('[klopotenko] import failed:', e);
    showConfirm({
      icon: '⚠️',
      title: 'Помилка імпорту',
      text: e.message || String(e),
      actions: [{ label: 'Зрозуміло', style: 'primary' }],
    });
  }
}

// Tiny progress overlay helpers used by single-shot AI calls
// (per-product nutrition fetch). The big plan generator still uses
// the same overlay element directly with its own progress tracking.
function showAIBusy(title, sub) {
  const o = document.getElementById('progOverlay');
  document.getElementById('progTitle').textContent = title || '🤖 AI...';
  document.getElementById('progSub').textContent   = sub || '';
  document.getElementById('progBar').style.width   = '50%';
  o.classList.add('on');
}
function hideAIBusy() {
  document.getElementById('progOverlay').classList.remove('on');
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

// ── MEAL TYPE TAGS ──────────────────────────────────────────────────────
// Each FOODS entry may have an optional `tags` array. If non-empty, the
// generator (both local and AI) will only place that product in meal slots
// classified into one of the listed types. Empty/missing → no constraint.
const MEAL_TAGS = [
  { key: 'breakfast', label: 'Сніданок' },
  { key: 'lunch',     label: 'Обід'     },
  { key: 'dinner',    label: 'Вечеря'   },
  { key: 'snack',     label: 'Перекус'  },
];

function isFoodAllowedForMealType(food, mealType) {
  const tags = food?.tags;
  if (!tags || !tags.length) return true;  // no tags = unrestricted
  return tags.includes(mealType);
}

// ── LOCAL CLASSIFIER for FOODS entries ─────────────────────────────────
// Used by strict-mode generator that runs without any AI calls.
// Returns 'protein'|'dairy'|'carb'|'fruit'|'veggie' or null if unrecognised.
function classifyFood(name) {
  const n = (name || '').toLowerCase();
  if (/куряч|філе|м.?яс|свинин|телятин|яловичин|індич|тунець|лосось|форел|тіляп|риб|креветк|кальмар|восьмин|мідії|яйц|індич|кролик/.test(n)) return 'protein';
  if (/йогурт|кефір|молоко|молочн|сметан|ряжанк|снежок|айран|твор|маскарпон|рікот/.test(n)) return 'dairy';
  if (/сир(\b|у|ів|и|ом)/.test(n) && !/сирок|сирн/.test(n)) return 'protein';   // hard cheese ≈ protein
  if (/гречк|^рис| рис|макарон|спагет|лапш|хліб|тост|хлопь|вівсян|овес|кіноа|кускус|булгур|перлов|пшеничн|пшоно|картопл|батат|лаваш|тортіл|піт/.test(n)) return 'carb';
  if (/банан|яблук|апельсин|груш|малин|полуниц|виногр|ківі|манго|персик|нектарин|чорниц|лохин|мандарин|грейпфрут|диня|кавун|ягод|вишн|сливи|абрикос|ананас|папай|гранат/.test(n)) return 'fruit';
  if (/огірок|помідор|томат|перец|цибул|морк|капуст|буряк|брокол|салат|шпинат|кабачк|баклажан|редис|зеленин|петрушк|кріп|часник|гарбуз|спаржа|ріпа|редьк|кольраб/.test(n)) return 'veggie';
  return null;
}

// Build per-category pools from FOODS, skipping forbidden and unrecognised.
function buildFoodsPoolsForPerson(person) {
  const fb = (person.forbidden || []);
  const isFb = name => fb.some(f => name.toLowerCase().includes(String(f).toLowerCase()));
  const pools = { protein: [], dairy: [], carb: [], fruit: [], veggie: [] };
  for (const [key, food] of Object.entries(FOODS)) {
    if (!food || !food.name || !(food.kcal > 0)) continue;
    if (isFb(food.name)) continue;
    const cat = classifyFood(food.name);
    if (!cat) continue;
    pools[cat].push({
      key, n: food.name,
      k: food.kcal, p: food.protein || 0, f: food.fat || 0, c: food.carbs || 0,
      tags: food.tags || [],
      silpoSlug:       food.silpoSlug,
      silpoPrice:      food.silpoPrice      ?? null,
      silpoPriceRatio: food.silpoPriceRatio ?? null,
    });
  }
  return pools;
}

// Sensible portion bounds per category for FOODS-based generation.
// Protein max is intentionally low (200g, ~3-4 eggs or 1 chicken portion).
// For specific named ingredients we have tighter per-product bounds in POOL.
const CAT_PORTION = {
  protein: { def: 150, min: 80,  max: 200 },
  dairy:   { def: 200, min: 100, max: 300 },
  carb:    { def: 100, min: 50,  max: 180 },
  fruit:   { def: 130, min: 80,  max: 220 },
  veggie:  { def: 100, min: 50,  max: 200 },
};

// Resolve portion bounds for a food. Tries POOL by name match first
// (per-product limits like "eggs max 220g"), falls back to CAT_PORTION.
function findPortionBounds(name, cat) {
  const pool = findInPool(name);
  if (pool && pool.def != null) {
    return { def: pool.def, min: pool.min || 30, max: pool.max || 300 };
  }
  return CAT_PORTION[cat] || { def: 100, min: 30, max: 300 };
}

// Local strict-mode generator: builds the week from FOODS only, no AI.
// Same shape of output as generateMenuViaAI so the rest of the pipeline
// (seed/enrich/apply) keeps working.
function generateMenuLocally(pid) {
  const person = getPerson(pid);
  if (!person) return;
  const targets   = getPersonTargets(pid);
  const dailyKcal = targets.kcal || 2000;
  const personMeals = getPersonMeals(pid);
  const pools = buildFoodsPoolsForPerson(person);

  // Sanity: need at least one protein and one carb to make a meal
  if (!pools.protein.length && !pools.carb.length) {
    throw new Error('У довіднику немає достатньо продуктів для генерації. Додай хоча б білки та крупи.');
  }

  if (!MENU[pid]) MENU[pid] = {};

  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const slots = MENU[pid][day]?.meals || personMeals;
    if (!slots || !slots.length) {
      MENU[pid][day] = { totals: { ...targets } };
      continue;
    }

    const types = slots.map(s => classifyMealSlot(s.name));
    const rawShares = types.map(t => MEAL_KCAL_SHARE[t] || 0.1);
    const totalShare = rawShares.reduce((s, x) => s + x, 0) || 1;
    const slotKcals = rawShares.map(s => Math.round(dailyKcal * s / totalShare));

    const newDay = { totals: { ...targets } };
    if (MENU[pid][day]?.meals) newDay.meals = MENU[pid][day].meals;

    slots.forEach((slot, idx) => {
      const type = types[idx];
      const recipe = MEAL_RECIPE[type] || MEAL_RECIPE.snack;
      const mealKcal = slotKcals[idx];

      // Pick ingredients with rotation across days/slots so variety happens.
      // Filter by meal-type tags: a tagged item only appears in matching slots.
      const picks = [];
      recipe.forEach((cat, ci) => {
        const list = (pools[cat] || []).filter(it => isFoodAllowedForMealType(it, type));
        if (!list.length) return;
        const rot = ((day * 7 + idx * 3 + ci) % list.length + list.length) % list.length;
        picks.push({ cat, food: list[rot] });
      });

      // Default portions per ingredient — prefer per-product bounds from POOL
      // (so eggs default to 110g, max 220g) over generic category defaults.
      const allBounds = picks.map(pk => findPortionBounds(pk.food.n, pk.cat));
      const portions = allBounds.map(b => b.def);
      const mainIdx = picks.map((p, i) => SCALABLE_CATEGORIES.has(p.cat) ? i : -1).filter(i => i >= 0);
      if (mainIdx.length) {
        let sideKcal = 0, mainKcal = 0;
        picks.forEach((p, i) => {
          const k = portions[i] * p.food.k / 100;
          if (mainIdx.includes(i)) mainKcal += k; else sideKcal += k;
        });
        const targetMainKcal = Math.max(0, mealKcal - sideKcal);
        if (mainKcal > 0) {
          const scale = targetMainKcal / mainKcal;
          for (const i of mainIdx) {
            let g = portions[i] * scale;
            g = Math.max(allBounds[i].min, Math.min(allBounds[i].max, g));
            portions[i] = Math.max(20, Math.round(g / 10) * 10);
          }
        }
      }

      const items = picks.map((pk, i) => {
        const item = {
          n: pk.food.n,
          g: `${portions[i]}г`,
          kcal_per_100:    pk.food.k,
          protein_per_100: pk.food.p,
          fat_per_100:     pk.food.f,
          carbs_per_100:   pk.food.c,
        };
        if (pk.food.silpoSlug) {
          item.silpoSlug       = pk.food.silpoSlug;
          item.silpoPrice      = pk.food.silpoPrice      ?? null;
          item.silpoPriceRatio = pk.food.silpoPriceRatio ?? null;
        }
        return item;
      });

      newDay[slot.key] = { kcal: mealKcal, items };
    });

    MENU[pid][day] = newDay;
  }
}

// Call AI for one person, parse, write into MENU[pid]
async function generateMenuViaAI(pid, mode = 'free') {
  const person = getPerson(pid);
  if (!person) return;
  const prompt = buildPlanPrompt(person, mode);
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
          if (!FOODS[key]) {
            FOODS[key] = { name, ...cleaned, source: 'auto' };
            if (db) set(ref(db, 'racion/foods/' + key), FOODS[key]).catch(() => {});
          } else if (FOODS[key].source === 'auto') {
            // Refresh nutrition for auto entries but PRESERVE user-set tags
            // and any silpo link that may have been attached later
            FOODS[key] = { ...FOODS[key], ...cleaned };
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
