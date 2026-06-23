# Инструкция тестировщику: что проверять в MVP — 21 июня, версия 6.2

## Цель проверки

Проверить функции, добавленные **после версии 5.2**:

```text
5.3 — DC cascade simulation (инженерка + малая схема)
6.2 — engineering attributes + risk score + cascade (инженерка + малая география)
```

Базовые режимы 1–6 из инструкции 5.2 должны по-прежнему работать. Этот документ дополняет `TESTING_GUIDE_5_2.md`, а не заменяет его.

## Общие проверки перед тестом

1. Запустить `python app.py`.
2. Открыть http://127.0.0.1:5001 (или актуальный порт).
3. Сделать жёсткое обновление страницы (Ctrl+F5), чтобы подтянуть `graph_core.js`.
4. Убедиться, что в инженерных режимах виден дисклеймер про synthetic / screening model.

## Режим 5.3: каскад на малой схеме

Страница: режим 5 · инженерка · малая схема (`eng-small.html`).

### Что должно быть видно

- секция **«Каскад»** в левой панели (вкладка «Генерация»);
- параметры `Trip threshold, %` и `Max steps`;
- подсказка стартового отказа;
- кнопки `Запустить каскад` и `Сбросить каскад`;
- справа: **«Каскад · timeline»** и блок метрик;
- в легенде: Initial outage, Overload before trip, Cascade-tripped;
- дисклеймер про cascade model в баннере.

### Карточки объектов (режим 5.2 + каскад)

По клику на узел:

```text
type
voltage_level_kv
generation / load
theta
repair_time_days
risk_score
```

По клику на линию:

```text
type: line / transformer
voltage
capacity_mw
reactance
dc_flow_mw
loading_percent
repair_time_days
risk_score
```

### Как проверить каскад

1. Сгенерировать малую инженерную схему (20–26 узлов).
2. Кликнуть узел или линию — в подсказке должен появиться стартовый отказ.
3. Задать `Trip threshold` (например 100–120%) и `Max steps` (например 10).
4. Нажать **«Запустить каскад»**.
5. Убедиться, что timeline заполнился, например:

```text
Step 0: initial outage …
Step 1: DC solved, overloads: …
Step 2: tripped …
Step 3: stable, no overloads
```

или остановка по `max_steps` / `DC solve failed`.

6. Проверить метрики:

```text
cascade_steps
initial_outage
failed_assets
failed_edges / failed_nodes
max_loading
unserved_load
critical_unserved
dc_solved_final: yes/no
stable: yes/no
```

7. На схеме проверить раскраску:
   - стартовый отказ — чёрный, толстый;
   - перегруженные до отключения — оранжевые;
   - отключённые каскадом — серые пунктирные;
   - critical unserved — явная подсветка (если есть).
8. Нажать **«Сбросить каскад»** — схема и состояние возвращаются к исходным.
9. Повторно сгенерировать граф — каскад сбрасывается.

### Регрессия режима 5

После проверки каскада убедиться, что работают:

- DC power flow;
- DC N-1;
- таблица **Top-10 risky objects**;
- фильтры voltage / type / top risk;
- отключение узлов и рёбер кликом;
- поиск слабой вершины / ребра;
- планы «Бюджет» и «Critical».

## Режим 6.2: risk и каскад на малой карте

Страница: режим 6 · инженерка · малая география (`eng-map.html`).

### Что должно быть видно

- карта с DC power flow (как в 5.2);
- фильтры: напряжение, тип, «Только top risk (топ-10)»;
- секция **«Каскад»** с теми же параметрами, что в режиме 5;
- справа: **Top-10 risky objects**;
- справа: **«Каскад · timeline»** и метрики;
- легенда: Initial outage, Overload before trip, Cascade-tripped;
- дисклеймер:

```text
Engineering geo mode uses synthetic electrical parameters.
Risk and cascade are simplified screening models, not operational assessments.
```

### Карточка узла на карте

```text
type
voltage_level_kv
generation / load
theta
repair_time_days
risk_score
slack
```

### Карточка линии на карте

```text
type: line / transformer
voltage (или from → to kV для трансформатора)
capacity_mw
reactance
dc_flow_mw
loading_percent
repair_time_days
risk_score
violation
```

### Top-10 risky objects

Таблица содержит колонки:

```text
object
type
kV
impact
repair d
risk
```

Как проверить:

1. Построить сеть на карте (20–50 узлов).
2. Убедиться, что таблица заполнена (до 10 строк).
3. Кликнуть строку — карта должна приблизиться к объекту и подсветить его.

### Фильтры на карте

1. Выбрать напряжение (750 / 330 / 110) — несоответствующие объекты приглушаются.
2. Выбрать тип (generator, load, substation, line, transformer).
3. Включить «Только top risk» — остаются яркими только объекты из топ-10.
4. Сбросить фильтры — все объекты снова нормальной яркости.

### Как проверить каскад на карте

1. Построить сеть на карте.
2. Кликнуть узел или линию — задать стартовый отказ.
3. При необходимости снизить `Trip threshold` (например до 80–100%), чтобы каскад сработал.
4. Нажать **«Запустить каскад»**.
5. Проверить timeline и метрики (как в режиме 5.3).
6. На карте проверить стили линий и узлов (чёрный / оранжевый / серый).
7. Нажать **«Сбросить каскад»** — исходное состояние восстановлено.
8. Повторно нажать **«Построить на карте»** — каскад сброшен.

### Регрессия режима 6

После проверки risk и каскада убедиться, что работают:

- окраска линий по `dc_loading_percent`;
- DC N-1 на карте;
- показ худшего сценария N-1;
- перетаскивание узлов и перебалансировка;
- кластеры при совпадающих координатах.

## Регрессия режимов 1–4

Кратко убедиться, что не сломались:

```text
mode 1: малая схема, математика
mode 2: малая карта, математика
mode 3: большая схема
mode 4: большая карта
```

Достаточно: сгенерировать граф / карту, открыть детали объекта, запустить поиск слабого места.

## Дисклеймеры

В режиме 5 проверить наличие:

```text
Cascade model is a simplified DC screening model.
Not an operational protection model.
```

В режиме 6 — см. баннер про synthetic parameters, risk и cascade.

## Итоговый чеклист

```text
mode 5.3 cascade UI: OK / FAIL
mode 5.3 cascade run + timeline: OK / FAIL
mode 5.3 cascade visualization: OK / FAIL
mode 5.3 cascade reset: OK / FAIL
mode 5 regression (DC, N-1, risk): OK / FAIL

mode 6.2 node/edge cards (risk, repair): OK / FAIL
mode 6.2 Top-10 table + click focus: OK / FAIL
mode 6.2 filters (voltage/type/top risk): OK / FAIL
mode 6.2 cascade run + timeline: OK / FAIL
mode 6.2 cascade visualization on map: OK / FAIL
mode 6.2 cascade reset: OK / FAIL
mode 6 regression (DC N-1, map): OK / FAIL

modes 1–4 regression: OK / FAIL
disclaimers: OK / FAIL
```
