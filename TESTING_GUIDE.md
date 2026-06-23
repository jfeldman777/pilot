# Инструкция тестировщику — MVP (все 8 режимов)

Версия: июнь 2026 · все режимы 1–8 реализованы.

## Перед началом

1. `pip install flask`
2. `python app.py` → http://127.0.0.1:5001/ (**index** → start или home с кубом)
3. На каждом экране: **Ctrl+F5** (жёсткое обновление `graph_core.js`)
4. Консоль браузера (F12) — без красных ошибок после smoke-test

## Дисклеймеры (обязательно)

На **каждом** режиме должны быть видны формулировки про:

- **synthetic** данные (сеть, параметры, repair time, risk);
- **not operational** / не операционная модель;
- screening, не инженерная рекомендация (инженерные режимы 5–8).

| Экран | Где искать |
|-------|------------|
| `home.html` | оранжевый блок + footer |
| 1–4 (screening) | banner в sidebar |
| 5–6 (инженерные) | disclaimer + MVP status (режим 6) |
| 7–8 (большие инженерные) | banner / demo-disclaimer в sidebar |

---

## Smoke-test: все 8 режимов

Минимальная проверка «страница открывается и сеть строится».

| # | URL | Действие | Ожидание |
|---|-----|----------|----------|
| 1 | `/small.html` | Сгенерировать (12 узлов) | Схема, потоки, панель метрик |
| 2 | `/map.html` | Построить на карте (20 узлов) | Маркеры на карте, линии |
| 3 | `/large.html` | Пресет 100 → Сгенерировать | Схема ~100 узлов за &lt;5 с |
| 4 | `/large-map.html` | Пресет 100 → Построить | Кластеры, паспорт данных |
| 5 | `/eng-small.html` | Сгенерировать (12 узлов) | DC metrics, risk table |
| 6 | `/eng-map.html` | Построить на карте | DC loading на линиях, risk table |
| 7 | `/eng-large.html` | Пресет 100 → Сгенерировать | Схема, DC N-1, risk table |
| 8 | `/eng-large-map.html` | Пресет 100 → Построить | Кластеры + ≤10 risk-линий |

---

## Главный demo path (режим 8)

**Цель:** заказчик за 1 минуту понимает, куда нажимать.

1. `home.html` → блок **★ Главный demo path** → режим 8.
2. Пресет **100** (или 300) → **Построить на карте**.
3. Карта: кластеры узлов, **не** паутина из сотен линий (режим рёбер = Top risk).
4. Справа: **Top-10 risky objects** (колонки obj, type, kV, repair d, risk).
5. **Monte Carlo** → 100 runs, cascade = yes → дождаться завершения.
6. Клик **worst scenario** в таблице Monte Carlo.
7. **Pareto summary** → Protect top 1 / 3 / 5 → подсветка на карте.

Повтор на пресете **1000**: карта остаётся читаемой (кластеры + ~10 линий).

---

## Режим 8 — детальные проверки

### Визуализация

- [ ] Рёбра по умолчанию: **Top risk (топ-10)**
- [ ] Кластеры при отдалении, раскрытие при zoom
- [ ] Фильтры voltage / asset type не ломают карту
- [ ] Режим «Все рёбра (детально)» — только при zoom ≥ 9 (не для показа заказчику)

### Инженерные функции

- [ ] DC metrics в sidebar после построения
- [ ] **DC N-1** — таблица топ-10 (sampled на 300/1000)
- [ ] **Каскад** — клик узел/линия → Запустить → timeline
- [ ] **Monte Carlo** — progress bar, worst table, Pareto
- [ ] Клик по risk object в таблице — фокус на карте

### Производительность (ориентиры)

| Узлов | Построить | N-1 | MC 100 runs |
|-------|-----------|-----|-------------|
| 100 | &lt;2 с | &lt;3 с | &lt;10 с |
| 300 | &lt;3 с | &lt;5 с | &lt;20 с |
| 1000 | &lt;5 с | sampled | &lt;60 с |

---

## Режимы 5–7 (инженерные)

Общий набор для режимов 5, 6, 7:

- [ ] DC power flow — loading %, capacity violations
- [ ] Top-10 risky objects
- [ ] DC N-1 (full на малых, sampled на large)
- [ ] Каскад (initial outage → trip → timeline)
- [ ] Monte Carlo + Pareto top 1/3/5
- [ ] Toggle узла/ребра — пересчёт без зависания (режим 7: instant toggle)

Режим 6 дополнительно:

- [ ] Demo path box в sidebar
- [ ] MVP status panel (реализовано / данные / ограничения)
- [ ] Легенда MC risky / Pareto protect на карте

---

## Режимы 1–4 (screening)

- [ ] Генерация сети по seed воспроизводима
- [ ] Отключение узлов пересчитывает flow
- [ ] План укрепления (бюджет) — режимы 1–4
- [ ] Режим 4: паспорт данных (OPEN_DATA / SYNTHETIC)
- [ ] Режим 3/4: пресеты 100 / 300 / 1000

---

## Что НЕ является багом

- Серые кнопки до «Построить» / «Сгенерировать» — ожидаемо.
- Курсор «нельзя» на disabled-кнопках — ожидаемо.
- `Pareto analysis…` 2–3 с после MC — ожидаемо.
- N-1 sampled на 300/1000 — задумано для скорости.
- SYNTHETIC / SYNTHETIC_FALLBACK в подсказках пула координат.

---

## Фаза 3 — Backend scaffold (~10 мин)

**Не заменяет** главный demo path (режим 8). Проверяет отдельный контур: API + batch + документация.

**Точка входа в UI:** http://127.0.0.1:5001/backend-demo.html

### Подготовка

```bash
# Терминал A — UI
pip install flask
python app.py

# Терминал B — API
pip install -r api/requirements.txt
python -m uvicorn api.main:app --port 8000
```

Node.js нужен только для batch (терминал C).

### Чеклист

| # | Шаг | Действие | Ожидание |
|---|-----|----------|----------|
| B1 | Hub | Открыть `/backend-demo.html` | Карточки API / Batch / Architecture, команды |
| B2 | Health | `api-demo.html` → **Health** | JSON: `"ok": true`, `"pandapower": true` |
| B3 | DC run | **Load example** → **POST /dc-run** | `"converged": true`, `line_results` не пустой |
| B4 | OpenAPI | http://127.0.0.1:8000/docs | Swagger UI, эндпоинты `/health`, `/dc-run`, `/calibration/status` |
| B5 | Calibration stub | В `/docs` → GET `/calibration/status` | `"status": "design_stub"`, описание цикла |
| B6 | Batch | `node scripts/run_mc_batch.mjs 100 42` | Exit 0, путь к CSV и `latest_summary.json` |
| B7 | Batch UI | `/batch-results.html` | JSON: `runs: 100`, `worst_damage`, `pareto[]` |
| B8 | Architecture | `/architecture.html` | Рендер `ARCHITECTURE.md`, схема слоёв |
| B9 | Roadmap | `/roadmap.html` | Секция «Фаза 3 (реализовано)» |

### Опционально

- [ ] `docker compose up --build` — web :5001, api :8000, postgres :5432 стартуют без ошибок
- [ ] `node scripts/run_mc_batch.mjs 1000 42` — завершается за разумное время (&lt;2 мин на типичном ПК)

### Что НЕ проверяем в фазе 3

- Режим 8 **не** вызывает pandapower API (два параллельных контура — задумано).
- PostgreSQL **не** получает данные от batch/API.
- Batch не обязан быть прогнан перед показом — достаточно B6–B7 один раз.

### Типичные сбои

| Симптом | Причина | Решение |
|---------|---------|---------|
| `Failed to fetch` в api-demo | API не запущен | Терминал B: uvicorn |
| `pandapower: false` | Не установлен пакет | `pip install -r api/requirements.txt` |
| batch-results «Нет batch» | Не запускали скрипт | `node scripts/run_mc_batch.mjs 100 42` |
| `node` не найден | Нет Node.js | Установить Node 18+ или пропустить B6–B7 |

---

## Регрессия после изменений

1. Пройти smoke-test (таблица выше).
2. Главный demo path (режим 8).
3. **Фаза 3** (опционально): `backend-demo.html` + чеклист B1–B8.
4. Режим 6: MC 100 → worst → Pareto 3 (как в `docs/TESTING_GUIDE_6_3.md`).
5. Режим 1: базовая генерация (как в `docs/TESTING_GUIDE_5_2.md`).

Детальные пошаговые сценарии по версиям — в `docs/TESTING_GUIDE_*.md`.
