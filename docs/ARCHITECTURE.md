# Архитектура MVP → целевая платформа

Демонстрационная двухслойная архитектура (screening). **Не боевой симулятор.**

## Слои

```text
┌─────────────────────────────────────────────────────────────┐
│  FRONT (браузер)                                            │
│  start.html · режимы 1–8 · War-Gaming UI · Pareto           │
│  graph_core.js — DC screening в браузере (MVP v1)           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (demo)
┌──────────────────────────▼──────────────────────────────────┐
│  API v2 (FastAPI + pandapower)          :8000               │
│  POST /dc-run · GET /calibration/status (stub)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  BATCH WORKERS (phase 3)                                    │
│  scripts/run_mc_batch.mjs → CSV + latest_summary.json       │
│  (план: 10⁶+ runs · Celery/k8s · TimescaleDB)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  PostgreSQL / TimescaleDB (docker-compose · scenarios)      │
│  сценарии · метрики · калибровка (этап 4+)                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  AGENT LAYER (этап 4+ · design stub)                        │
│  24/7 scenario generation → filter → expert → calibrate     │
│  NL → SQL / charts / re-run simulation                      │
└─────────────────────────────────────────────────────────────┘
```

## Компоненты (сейчас)

| Компонент | Порт | Назначение |
|-----------|------|------------|
| `app.py` (Flask) | 5001 | Статика + demo UI |
| `api/main.py` (FastAPI) | 8000 | pandapower DC/AC screening |
| Postgres `scenarios` | 5432 | Заготовка под хранение прогонов |
| `scripts/run_mc_batch.mjs` | CLI | Batch War-Gaming → `data/batch/` |

## Запуск

### Локально (без Docker)

```bash
pip install flask
pip install -r api/requirements.txt

# Терминал 1 — UI
python app.py

# Терминал 2 — API
uvicorn api.main:app --reload --port 8000

# Batch (опционально)
node scripts/run_mc_batch.mjs 1000 42
```

### Docker Compose

```bash
docker compose up --build
```

- UI: http://127.0.0.1:5001/start.html  
- API docs: http://127.0.0.1:8000/docs  
- Postgres: `localhost:5432` user `mvp` / `mvp_demo` / db `scenarios`

## API v2

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Статус + pandapower |
| GET | `/dc-run/example` | Пример сети 3 узла |
| POST | `/dc-run` | DC (или AC) расчёт pandapower |
| GET | `/calibration/status` | **Stub** контура калибровки |

## Контур калибровки (design stub)

```text
War-Gaming batch (10⁶)
        ↓
Сравнение sim vs observed (validation set)
        ↓
Метрика MAE / likelihood на outage events
        ↓
Обновление grey-box параметров (+ ML corrector)
        ↓
Экспертная приёмка → deploy
```

Эндпоинт `GET /calibration/status` возвращает демо-метрики и описание цикла. **Живая калибровка не подключена.**

## Этап 4+ (вне scope MVP)

- AC критические узлы (Newton-Raphson production path)
- Интеграция ENTSO-E / NDA слой Укрэнерго
- Агент 24/7 + LLM
- Продукты A2 (рынок), A3 (втраты)

## Дисклеймер

Все расчёты — **SYNTHETIC screening**. Not an operational grid model. Not an engineering recommendation.
