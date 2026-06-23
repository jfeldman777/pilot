# Delivery checklist — MVP demo

Отметьте перед отправкой ссылки заказчику.

## Документация

```text
[ ] README.md актуален (8 режимов, demo path на режим 8)
[ ] TESTING_GUIDE.md актуален
[ ] DELIVERY_CHECKLIST.md пройден
```

## Все 8 режимов открываются

```text
[ ] mode 1   small.html          — малый · схема · screening
[ ] mode 2   map.html             — малый · карта · screening
[ ] mode 3   large.html           — большой · схема · screening
[ ] mode 4   large-map.html       — большой · карта · screening
[ ] mode 5   eng-small.html       — малый · схема · инженерная
[ ] mode 6   eng-map.html         — малый · карта · инженерная
[ ] mode 7   eng-large.html       — большой · схема · инженерная
[ ] mode 8   eng-large-map.html   — большой · карта · инженерная ★ главный demo
```

## Инженерные функции (режимы 5–8)

```text
[ ] DC power flow + метрики
[ ] Top-10 risky objects
[ ] DC N-1
[ ] Каскад (timeline)
[ ] Monte Carlo (100 runs)
[ ] Pareto top 1/3/5
```

## Дисклеймеры и UX

```text
[ ] home.html — disclaimer + demo path на режим 8
[ ] synthetic / not operational видны на всех 8 экранах
[ ] режим 8 — подсказка demo path в sidebar
[ ] режим 8 — top risk линии по умолчанию (не паутина на 1000)
[ ] нет явных debug-элементов в UI для показа
```

## Быстрый smoke-test (5 мин)

1. `python app.py` → **start.html** → «Демо: волна ударов»
2. Дождаться Pareto-кривой и подсветки top 3
3. **roadmap.html** — таблица соответствия ТЗ
4. Home → режим **1** → Сгенерировать — sanity check

## Фаза 3 (backend scaffold)

Точка входа: **backend-demo.html** · подробный чеклист: **TESTING_GUIDE.md** § «Фаза 3».

```text
[ ] backend-demo.html открывается, ссылки на API / batch / architecture
[ ] uvicorn api.main:app --port 8000 → /health pandapower:true
[ ] api-demo.html → POST /dc-run converged
[ ] node scripts/run_mc_batch.mjs 100 42 → latest_summary.json
[ ] batch-results.html показывает summary
[ ] architecture.html рендерит ARCHITECTURE.md
[ ] docker compose up --build (опционально)
```

## Ссылка для заказчика

```text
Локально:  http://127.0.0.1:5001/start.html
Деплой:    <ваш URL>/start.html
Автодемо:  eng-large-map.html?demo=1
README:    readme.html · roadmap.html · backend-demo.html
```

## Если «песочные часы» на кнопках

- Обновите страницу (Ctrl+F5).
- Серые кнопки = сначала «Построить» / «Сгенерировать».
- Во время Monte Carlo активна только **Остановить**; после `100/100` подождите 2–3 с на Pareto.
- Наводите на **цветные** кнопки, не на серые.

## Примечание

Это checklist **демо-поставки**, не полный регрессионный набор. Подробные сценарии — `TESTING_GUIDE.md` и `docs/TESTING_GUIDE_*.md`.
