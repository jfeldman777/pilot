# Соответствие ТЗ заказчика и roadmap

Демонстрационный MVP (день 4 из 30). **Не боевой симулятор** — screening-прототип контура **A1 (физическая безпека)**.

Ориентир заказчика: [ukrenergo.radai-1984.dev](https://ukrenergo.radai-1984.dev) (прото-MVP, концепт).

## Главный вопрос продукта

> Какой **минимальный набор объектов** укрепить, чтобы сеть вынесла сценарии поражения?

**Ответ в demo:** режим 8 → War-Gaming → Pareto-кривая и Protect top 1/3/5.

---

## Таблица соответствия

| Требование заказчика | Статус в MVP | Где посмотреть | Этап 2 |
|----------------------|--------------|-----------------|--------|
| Цифровая модель сети на карте | 🟡 Synthetic + open coords | Режим 8, `eng-large-map.html` | Топология Укрэнерго 750/330, NDA |
| DC power flow (скрининг) | 🟢 Реализовано | Режимы 5–8 + **API v2** (`POST /dc-run`) | AC на полной сети |
| AC / Newton-Raphson | 🔴 Нет | README §7 | Критические узлы |
| N-1 contingency | 🟢 Full / sampled | DC N-1, режимы 5–8 | Полный N-k |
| N-k / множественные отказы | 🟡 Через War-Gaming (до 3 outage/run) | War-Gaming, режим 8 | Явный N-k scan |
| Каскадные отказы | 🟡 Упрощённый DC trip | Каскад + worst scenario | Модель защит |
| Сценарии ударов (не погода) | 🟡 War-Gaming = волны поражения | Кнопка «Демо: волна ударов» | Цели, время, погода |
| Monte Carlo миллионы прогонов | 🟡 100–50k (браузер + batch) | War-Gaming + `scripts/run_mc_batch.mjs` | Batch + workers + БД |
| Pareto: минимум укреплений | 🟢 Protect top 1/3/5 + кривая | Правая панель режима 8 | Полная кривая до 90% |
| TSO 750/330 demo backbone | 🟢 Пресет + автодемо | Режим 8 | Реальная топология Укрэнерго |
| Бейджи OPEN_DATA / SYNTHETIC / DEMO | 🟢 Tooltip + детали | Режим 8 | NDA_CALIBRATED слой |
| Risk: ущерб × резерв × repair | 🟡 Synthetic screening | Top-10 risky objects | Калибровка по истории |
| ML-корректор (GB, PINN) | 🔴 Нет | — | Grey-box слой |
| Автокалибровка к реальности | 🟡 Stub API | `GET /calibration/status` | MC → метрика → параметры |
| Агент 24/7 + NL запросы | 🔴 Нет | — | LLM + API |
| FastAPI + PostgreSQL + Docker | 🟢 Phase 3 scaffold | `api/`, `docker-compose.yml`, `architecture.html` | Workers + TimescaleDB |
| Продукт A2 (рынок) | 🔴 Вне scope MVP | — | Отдельный продукт |
| Продукт A3 (втраты) | 🔴 Вне scope MVP | — | Отдельный продукт |
| Open data / synthetic + бейджи | 🟢 Дисклеймеры, паспорт | home, режим 4/6/8 | ENTSO-E, Energy Map |
| Интерактивный фронт | 🟢 8 режимов, карта, кластеры | `home.html` | — |

**Легенда:** 🟢 есть в demo · 🟡 упрощённо · 🔴 не в scope месяца 1

---

## Сравнение с radai-1984.dev (честно)

| | radai (концепт) | Наш MVP |
|---|-----------------|---------|
| Формат | Лендинг + документация | **Кликабельный симулятор** |
| War-Gaming | Герой-экран A1 | Режим 8, War-Gaming + демо-кнопка |
| Pareto | Кривая 50/80/90% | Кривая + top 1/3/5 |
| Масштаб сети | Маркетинговые цифры | 100–1000 узлов, реально считает |
| A2, A3, шина | В концепте | Этап 2 |
| Агент 24/7 | В концепте | Этап 2 |

---

## Архитектура: сейчас → цель

```text
СЕЙЧАС (MVP + фаза 3)          ЭТАП 4 (полный продукт)
──────────────────────          ───────────────────────
Браузер + graph_core.js    →     Единый расчётный контур
Flask static + FastAPI API →     Docker on-premise prod
Synthetic сеть             →     Open data + NDA слой
Batch до 50k (Node worker) →     10⁶+ + TimescaleDB
Ручной demo + API demo     →     Агент 24/7 + калибровка
```

---

## Что не обещает этот MVP

- Операционный клон ОЭС Украины
- Инженерное заключение или инвестпрограмма
- Доказательство устойчивости «к любой комбинации ударов»
- Замена SCADA / EMS / PSS/E

---

## Следующие шаги (после приёмки MVP)

1. ~~Пресет TSO backbone 750/330 (synthetic)~~ — **сделано** (режим 8)
2. ~~Бейджи OPEN_DATA / SYNTHETIC / DEMO~~ — **сделано** (карта + детали)
3. ~~FastAPI + pandapower microservice~~ — **сделано** (`api/`, `api-demo.html`)
4. ~~Batch War-Gaming 10k+ в файл~~ — **сделано** (`scripts/run_mc_batch.mjs`, до 50k)
5. ~~Архитектура агентного контура (документ + заглушка)~~ — **сделано** (`ARCHITECTURE.md`, `/calibration/status`)
6. Интеграция batch → PostgreSQL + распределённые workers
7. Реальная топология Укрэнерго (NDA) + калибровка

## Фаза 2 (реализовано)

| # | Функция | Где |
|---|---------|-----|
| 7 | TSO 750/330 synthetic backbone | Режим 8 · пресет «TSO 750/330 · demo» |
| 8 | Бейджи происхождения данных | Tooltip, детали узла |
| 9 | Формулы risk / damage | Sidebar режима 8 |
| 10 | N-k в War-Gaming | Колонка N-k в worst-таблице |
| 12 | Копировать отчёт | Кнопка в режиме 8 |

## Фаза 3 (реализовано)

| # | Функция | Где |
|---|---------|-----|
| 13 | FastAPI + pandapower DC | `api/main.py` · `POST /dc-run` · OpenAPI `/docs` |
| 14 | Docker Compose (web + api + postgres) | `docker-compose.yml` |
| 15 | Batch War-Gaming worker | `node scripts/run_mc_batch.mjs 1000 42` |
| 16 | Архитектура агентного контура | `architecture.html` · `ARCHITECTURE.md` |
| 17 | API demo UI | `api-demo.html` |
| 18 | Batch results viewer | `batch-results.html` · `data/batch/latest_summary.json` |
| 19 | Calibration loop stub | `GET /calibration/status` |
