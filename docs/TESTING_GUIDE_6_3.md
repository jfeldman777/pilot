# Инструкция тестировщику: что проверять в MVP — 21 июня, версия 6.3

## Цель проверки

Проверить функции, добавленные **после версии 6.2**:

```text
6.3 — Monte Carlo + Top worst + Top risky + Pareto на инженерной карте
      (инженерка + мало + гео, DC power flow + cascade)
```

Базовые режимы 1–6 и функции из `TESTING_GUIDE_5_2.md`, `TESTING_GUIDE_6_2.md`, `TESTING_GUIDE_5_4.md` должны по-прежнему работать. Этот документ дополняет их, а не заменяет.

## Общие проверки перед тестом

1. Запустить `python app.py`.
2. Открыть http://127.0.0.1:5001 (или актуальный порт).
3. Открыть режим 6 · инженерка · малая география (`eng-map.html`).
4. Сделать жёсткое обновление страницы (Ctrl+F5), чтобы подтянуть `graph_core.js`.
5. Убедиться, что в баннере есть дисклеймер про Monte Carlo и Pareto.

## Режим 6.3: Monte Carlo на карте

### Что должно быть видно

В левой панели, под секцией «Каскад»:

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
- progress bar и счётчик `N / total runs`.

В правой панели:

- **Monte Carlo · Top-10 worst**;
- **Top risky by Monte Carlo**;
- блок **Pareto summary**.

В легенде карты:

```text
MC risky — фиолетовая обводка
Pareto protect — золотая обводка
Initial outage / Cascade-tripped — как в 6.2
```

### Формула damage_score

Та же, что в режиме 5.4:

```text
damage_score =
  unserved_load_mw
  + critical_unserved_count × 100
  + failed_assets_count × 5
  + cascade_steps × 2
```

### Как проверить Monte Carlo (100 runs)

1. Нажать **«Построить на карте»** (20–50 узлов).
2. В секции Monte Carlo: `Runs = 100`, `Max outages = 3`, `Seed = 42`, `Use cascade = yes`.
3. Нажать **«Запустить Monte Carlo»**.
4. Убедиться, что progress доходит до `100 / 100`.
5. Проверить таблицу **Top-10 worst** — колонки run, outages, damage, unserved, crit, steps, stable.
6. Проверить **Top risky by Monte Carlo** — object, type, freq worst, crit hits, avg damage.
7. Проверить **Pareto summary** — `Protect top 1/3/5` с процентами снижения.

### 1000 runs — карта не блокируется

1. Выбрать `Runs = 1000`.
2. Запустить Monte Carlo.
3. Убедиться, что:
   - progress обновляется пачками;
   - карту можно двигать/масштабировать во время прогона;
   - прогон завершается без зависания.
4. При необходимости нажать **«Остановить»** — частичные результаты сохраняются.

### Preview worst scenario на карте

1. После прогона кликнуть строку в **Top-10 worst**.
2. На карте:
   - стартовые отказы — чёрные / толстые линии или узлы;
   - cascade-tripped — серый пунктир;
   - перегруженные до trip — оранжевые (если cascade включён).
3. В **«Каскад · timeline»** — шаги сценария.
4. Строка worst выделена в таблице.

### Клик по Top risky object

1. Кликнуть строку в **Top risky by Monte Carlo**.
2. Карта приближается к объекту.
3. Открывается карточка узла или линии справа.
4. Объект подсвечен **фиолетовой обводкой** (MC risky).

### Pareto на карте

1. После завершения Monte Carlo кликнуть строку **Protect top 1**, **Protect top 3** или **Protect top 5** в Pareto summary.
2. Соответствующие объекты подсвечиваются **золотой обводкой** на карте.
3. При повторном клике на другой уровень (top 1 → top 3) подсветка обновляется.

### Seed воспроизводимость

1. **«Сбросить результаты»**.
2. Повторить прогон с тем же seed и параметрами.
3. Worst-сценарий и `damage` совпадают с первым прогоном.

### Сброс результатов

1. Нажать **«Сбросить результаты»**.
2. Таблицы Monte Carlo очищаются.
3. Карта возвращается к исходному состоянию (после preview, если был).
4. Подсветки MC risky / Pareto снимаются.
5. Новая генерация карты также сбрасывает Monte Carlo.

### Use cascade = no

1. `Use cascade = no`, 100 runs.
2. В worst-сценариях `cascade_steps` обычно = 0.
3. Preview показывает только начальные отказы.

## Регрессия режима 6 (6.2)

После проверки Monte Carlo убедиться, что работают:

- DC power flow на карте, окраска линий по загрузке;
- engineering attributes и risk score в карточках;
- таблица **Top-10 risky objects** (статический risk);
- фильтры voltage / type / top risk;
- секция **«Каскад»** на карте;
- DC N-1 и худший сценарий N-1;
- перетаскивание узлов, кластеры при совпадении координат.

## Регрессия режима 5.4

Monte Carlo на малой схеме (`eng-small.html`) должен работать как в `TESTING_GUIDE_5_4.md`. Логика общая — изменения в режиме 6 не должны её сломать.

## Регрессия режимов 1–4

Кратко: генерация, детали, слабые места — OK.

## Дисклеймер

Проверить баннер режима 6:

```text
Monte Carlo and Pareto are demo screening tools, not operational recommendations.
```

## Итоговый чеклист

```text
Monte Carlo UI на карте: OK / FAIL
100 runs завершаются: OK / FAIL
1000 runs не блокируют карту: OK / FAIL
progress bar / run counter: OK / FAIL
Top-10 worst table: OK / FAIL
клик worst → preview на карте + timeline: OK / FAIL
Top risky by Monte Carlo: OK / FAIL
клик risky → подсветка + карточка: OK / FAIL
Pareto summary: OK / FAIL
клик Pareto top 1/3/5 → подсветка на карте: OK / FAIL
seed воспроизводим: OK / FAIL
сброс результатов: OK / FAIL
режим 6 regression (6.2): OK / FAIL
режим 5.4 regression: OK / FAIL
режимы 1–4 regression: OK / FAIL
дисклеймер: OK / FAIL
```
