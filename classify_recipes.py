# -*- coding: utf-8 -*-
"""One-shot recipe classifier — assigns mealTypes to each recipe in
recipes.json based on name keywords + klopotenko category + ingredients.
"""
import json, re, sys, random
sys.stdout.reconfigure(encoding='utf-8')

# ── KEYWORD RULES (case-insensitive substrings) ─────────────────────────
BREAKFAST_KW = re.compile(
    r"снідан|ранков|омлет|сирник|оладк|гранол|мюсл|панкейк|скрембл|"
    r"яєчн|тост(?!и-к)|млинц|млинч|вівсян|манн|кукурудзян.*каш|"
    r"каш[іеа]|молочн.*каш|сирн.*запіканк|запіканк.*сирн|шакшук|"
    r"порідж|боул|поридж",
    re.I,
)

# Strong dessert/sweet/snack signals — these almost never lunch/dinner
SNACK_STRONG = re.compile(
    r"торт|тірамісу|чізкейк|шарлотк|штрудель|еклер|кейк|капкейк|"
    r"маффін|мафін|кекс|печив|пряник|пастил|мармелад|желе|мусс|парфе|"
    r"морозив|сорбет|смузі|коктейл|цукерк|трюфел|пралін|нугат|брауні|"
    r"марципан|конфет|сухарик|крекер|глаз|карамел|бісквіт|тіста.*солод|"
    r"тарт.*солод|пирог.*з.*ягод|пирог.*з.*ябл|пирог.*з.*вишн|"
    r"шоколадн|з\s*медом|з\s*цукром",
    re.I,
)

# Soft snack — appetizers, finger food
SNACK_SOFT = re.compile(
    r"закуск|канапе|канапк|брускет|тапас|антипаст|сирн.*тарілк|"
    r"паштет|хумус|гуакамол|діп\b|соус.*діп|чіпс|"
    r"роли\b|роллі|тартар|карпачо|сальса|маринован|солон.*риб|"
    r"круасан|пиріжк|шарик(?:и|ів)|кульк",
    re.I,
)

# Soups → lunch only
LUNCH_KW = re.compile(
    r"борщ|суп(?!ер)|юшк|бульйон|окрошк|харчо|солянк|лагман|шурпа|"
    r"рассольник|щі\b|капусняк|чорба|том ям|мінестрон|пюре-суп",
    re.I,
)

# Main dishes — both lunch and dinner
MAIN_KW = re.compile(
    r"котлет|биточк|шніцел|відбивн|ескалоп|стейк|фрикадел|тефтел|"
    r"плов|ризот|паст(?:у|а|и)?\b|спагет|лазан|феттучин|тальятел|"
    r"равіол|каннелон|маніко|голубц|вареник(?!.*сир)|пельмен|манти|"
    r"хінкал|долма|перец.*фарширов|кабачк.*фарширов|курк|курч|курят|"
    r"курин|індич|качк|свинин|яловичин|телятин|баранин|кролик|"
    r"печінк|шашлик|кебаб|тушкован|запечен|смажен.*мяс|рагу|жарк|"
    r"рулет.*мяс|мясн.*рулет|по-київськ|строганов|гуляш|"
    r"по-французьк|капуста.*тушков|узбецьк|карі|чахохбілі",
    re.I,
)

FISH_KW = re.compile(
    r"риб|лосос|скумбр|тунец|форел|сьомг|сардин|тіляп|оселедец|"
    r"карп|щук|сом\b|треск|пелад|анчоус|кільк|шпрот|креветк|"
    r"кальмар|восьминог|мідії|устриц|морепродукт|суш(?:і|и)\b",
    re.I,
)

VEGGIE_DISH_KW = re.compile(
    r"овочев|рататуй|капуста.*з|буряк.*салат|кабачк|баклажан|"
    r"карпуч|вінегрет|шуба|цезар|грецьк.*салат",
    re.I,
)

SALAD_KW = re.compile(
    r"салат|вінегрет|карпуч|шуба|цезар|табуле|боул(?:\s|$)",
    re.I,
)

GARNIR_KW = re.compile(
    r"гарнір|пюре|картопл.*пюре|картопл.*запеч|картопл.*смаж|"
    r"картопл.*по-|картопл.*з.*ма|картопл.*тушков|рис(?!\s*пап)|"
    r"гречка|булгур|кускус|кіноа|перлов|чечевиц|сочевиц|нут\b|"
    r"квасол.*тушков|квасол.*по-",
    re.I,
)


def classify(recipe):
    name = recipe.get("name") or ""
    cats = (recipe.get("category") or "").lower()
    tags = set()
    n = name

    # 1. Hard category signals from klopotenko (authoritative)
    if "перші страви" in cats:
        tags.add("lunch")
    if "десерт" in cats or "торти" in cats:
        tags.add("snack")
    if "коктейл" in cats or "напої" in cats:
        tags.add("snack")
    if "холодні закуски" in cats or "гарячі закуски" in cats:
        tags.add("snack")

    # 2. Strong sweet/snack name signals
    if SNACK_STRONG.search(n):
        tags.add("snack")

    # 3. Breakfast detection
    if BREAKFAST_KW.search(n):
        tags.add("breakfast")

    # 4. Soups → lunch
    if LUNCH_KW.search(n):
        tags.add("lunch")

    # 5. Main dishes → lunch + dinner
    if MAIN_KW.search(n) or FISH_KW.search(n):
        tags.add("lunch")
        tags.add("dinner")

    # 6. Salads → lunch + dinner
    if SALAD_KW.search(n):
        tags.add("lunch")
        tags.add("dinner")

    # 7. Veggie dishes
    if VEGGIE_DISH_KW.search(n):
        tags.add("lunch")
        tags.add("dinner")

    # 8. Sides
    if GARNIR_KW.search(n):
        tags.add("lunch")
        tags.add("dinner")

    # 9. Soft appetizer
    if SNACK_SOFT.search(n):
        tags.add("snack")

    # 10. Category fallback for unmatched
    if not tags:
        myasni = "м" in cats and "ясні" in cats
        if (
            "другі страви" in cats
            or myasni
            or "овочеві" in cats
            or "гарніри" in cats
            or "салати" in cats
        ):
            tags.add("lunch")
            tags.add("dinner")
        elif "солодкі страви" in cats or "випічка" in cats:
            tags.add("snack")

    return sorted(tags)


# ── RUN ─────────────────────────────────────────────────────────────────
data = json.load(open("recipes.json", encoding="utf-8"))
stats = {"breakfast": 0, "lunch": 0, "dinner": 0, "snack": 0, "unclassified": 0}
for r in data:
    tags = classify(r)
    r["mealTypes"] = tags
    if not tags:
        stats["unclassified"] += 1
    else:
        for t in tags:
            stats[t] += 1

print("Classification results:")
for k, v in stats.items():
    print(f"  {k}: {v}")
print(f"Total: {len(data)}")

unc = [r for r in data if not r["mealTypes"]]
print(f"\nUnclassified ({len(unc)}):")
for r in unc[:15]:
    print(f"  - {r['name'][:65]} | cat: {(r.get('category') or '')[:40]}")

print("\nSample breakfast:")
for r in random.sample([r for r in data if "breakfast" in r["mealTypes"]], min(8, sum(1 for r in data if "breakfast" in r["mealTypes"]))):
    print(f"  - {r['name'][:65]}")

print("\nSample snack:")
for r in random.sample([r for r in data if "snack" in r["mealTypes"]], 8):
    print(f"  - {r['name'][:65]}")

print("\nSample lunch:")
for r in random.sample([r for r in data if "lunch" in r["mealTypes"]], 8):
    print(f"  - {r['name'][:65]}")

with open("recipes.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print("\nrecipes.json updated with mealTypes field")
