# Инструкция тестировщику: что проверять в MVP — 21 июня, версия 5.4

## Цель проверки

Проверить функции, добавленные **после версии 5.3**:

```text
5.4 — Monte Carlo сценарии отказов + Top worst + Pareto-рекомендации
      (инженерка + малая схема, DC power flow + cascade)
```

Базовые режимы 1–6 и функции 5.2 / 5.3 из инструкций `TESTING_GUIDE_5_2.md` и `TESTING_GUIDE_6_2.md` должны по-прежнему работать. Этот документ дополняет их, а не заменяет.

## Общие проверки перед тестом

1. Запустить `python app.py`.
2. Открыть http://127.0.0.1:5001 (или актуальный порт).
3. Открыть режим 5 · инженерка · малая схема (`eng-small.html`).
4. Сделать жёсткое обновление страницы (Ctrl+F5), чтобы подтянуть `graph_core.js`.
5. Убедиться, что в баннере есть дисклеймер про Monte Carlo demo.

## Режим 5.4: Monte Carlo на малой схеме

### Что должно быть видно

В левой панели (вкладка «Генерация»), под секцией «Каскад»:

- секция **«Monte Carlo»**;
- подсказка формулы `damage_score` (synthetic);
- параметры:
  - `Runs`: 100 / 1000 / 5000
  - `Max outages / run`: 1 / 2 / 3
  - `Seed`
  - `Use cascade`: yes / no
  - `Trip threshold (cascade), %`
- кнопки:
  - `Запустить Monte Carlo`
  - `Остановить`
  - `Сбросить результаты`
- progress bar и счётчик `N / total runs` (для 1000+).

В правой панели:

- **Monte Carlo · Top-10 worst** — таблица худших сценариев;
- **Top risky by Monte Carlo** — частота объектов в worst + critical hits;
- блок **Pareto summary** (`Protect top 1/3/5: X% reduction`).

### Формула damage_score (synthetic)

```text
damage_score =
  unserved_load_mw
  + critical_unserved_count × 100
  + failed_assets_count × 5
  + cascade_steps × 2
```

Проверить, что формула указана в UI и не подаётся как операционная метрика.

### Метрики каждого run

После прогона в таблице worst должны быть доступны (явно или через preview):

```text
run_id
outaged_objects
damage_score
unserved_load_mw
critical_unserved_count
cascade_steps
stable (yes/no)
```

### Как проверить Monte Carlo (100 runs)

1. Сгенерировать малую инженерную схему (20–26 узлов).
2. В секции Monte Carlo оставить `Runs = 100`, `Max outages = 3`, `Seed = 42`, `Use cascade = yes`.
3. Нажать **«Запустить Monte Carlo»**.
4. Убедиться, что progress доходит до `100 / 100`.
5. Проверить таблицу **Top-10 worst** — до 10 строк, отсортировано по `damage`.
6. Проверить **Top risky by Monte Carlo** — объекты с `freq worst`, `crit hits`, `avg damage`.
7. Проверить **Pareto summary** — строки `Protect top 1/3/5` с процентом снижения.
8. Запомнить `damage` у worst #1.

### Воспроизводимость seed

1. Нажать **«Сбросить результаты»**.
2. Повторить прогон с тем же `Seed = 42` и теми же параметрами.
3. Убедиться, что worst-сценарий и `damage` совпадают с первым прогоном.

### Как проверить 1000 runs (UI не ломается)

1. Выбрать `Runs = 1000`.
2. Запустить Monte Carlo.
3. Убедиться, что:
   - progress bar обновляется пачками;
   - страница остаётся отзывчивой (можно прокручивать панели);
   - прогон завершается без зависания;
   - таблицы заполняются после завершения.
4. При необходимости нажать **«Остановить»** во время прогона — частичные результаты сохраняются, progress останавливается.

### Preview worst scenario на схеме

1. После завершения Monte Carlo кликнуть строку в **Top-10 worst**.
2. На схеме должны подсветиться:
   - стартовые отказы (чёрный / толстый стиль);
   - cascade-tripped линии (серый пунктир), если cascade был включён;
   - перегруженные до trip (оранжевый), если применимо;
   - critical unserved (если есть).
3. В блоке **«Каскад · timeline»** — шаги сценария.
4. Строка в таблице worst выделяется (selected).
5. Исходная сеть не должна быть испорчена навсегда — см. сброс ниже.

### Сброс результатов

1. Нажать **«Сбросить результаты»**.
2. Таблицы Monte Carlo очищаются.
3. Схема возвращается к состоянию до preview (если был выбран worst scenario).
4. Progress bar скрыт или сброшен.
5. Повторная генерация графа также сбрасывает Monte Carlo.

### Use cascade = no

1. Установить `Use cascade = no`.
2. Запустить 100 runs.
3. В worst-сценариях `cascade_steps` обычно = 0.
4. Preview на схеме показывает только начальные отказы, без каскадных trip.

### Max outages per scenario

1. Установить `Max outages / run = 1` → в колонке outages обычно один объект.
2. Установить `Max outages / run = 3` → в части runs до трёх объектов в outages.

Типы объектов в пуле отказов:

```text
узлы (generator, load, substation, transit/bus)
линии (line)
трансформаторы (transformer, как рёбра)
```

## Регрессия режима 5 (5.2 + 5.3)

После проверки Monte Carlo убедиться, что работают:

- DC power flow, DC N-1;
- таблица **Top-10 risky objects** (статический risk score);
- фильтры voltage / type / top risk;
- секция **«Каскад»** (ручной запуск, timeline, reset);
- отключение узлов/рёбер кликом;
- планы «Бюджет» и «Critical».

## Регрессия режимов 1–4 и 6

Кратко (по `TESTING_GUIDE_5_2.md` / `TESTING_GUIDE_6_2.md`):

```text
mode 1–4: генерация, детали, слабые места — OK
mode 6: risk + cascade на карте — OK (Monte Carlo в режиме 6 пока нет)
```

## Дисклеймер

Проверить наличие в баннере режима 5:

```text
Monte Carlo demo on synthetic network.
Damage score and Pareto recommendations are screening metrics, not operational decisions.
```

## Итоговый чеклист

```text
Monte Carlo UI (секция, параметры, кнопки): OK / FAIL
100 runs завершаются: OK / FAIL
1000 runs не ломают UI: OK / FAIL
progress bar / run counter: OK / FAIL
Top-10 worst table: OK / FAIL
клик worst → preview на схеме: OK / FAIL
Top risky by Monte Carlo: OK / FAIL
Pareto summary (top 1/3/5): OK / FAIL
seed воспроизводим: OK / FAIL
сброс результатов / сеть не испорчена: OK / FAIL
use cascade yes/no: OK / FAIL
режим 5 regression (5.2, 5.3): OK / FAIL
режимы 1–4, 6 regression: OK / FAIL
дисклеймер: OK / FAIL
```
