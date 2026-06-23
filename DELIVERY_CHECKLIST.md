# Delivery checklist — MVP demo

Отметьте перед демонстрацией заказчику.

```text
[ ] mode 1 works          (small.html — математика, схема)
[ ] mode 2 works          (map.html — математика, карта)
[ ] mode 3 works          (large.html — большая схема)
[ ] mode 4 works          (large-map.html — большая карта)
[ ] mode 5 works          (eng-small.html — инженерная схема)
[ ] mode 6 works          (eng-map.html — инженерная карта, главный demo)
[ ] DC N-1 works          (режимы 5 и 6)
[ ] cascade works         (режимы 5 и 6)
[ ] Monte Carlo works     (режимы 5 и 6)
[ ] Pareto works          (режимы 5 и 6)
[ ] README updated        (README.md)
[ ] synthetic disclaimers visible (home + режим 6)
[ ] demo path visible     (eng-map.html sidebar)
[ ] MVP status panel      (eng-map.html sidebar)
```

## Быстрый smoke-test (режим 6)

1. `python app.py` → home → режим 6
2. Построить на карте
3. Monte Carlo 100 runs → worst scenario → Pareto top 3
4. Ctrl+F5 — повтор без ошибок в консоли

## Примечание

Это checklist **демо-поставки**, не полный регрессионный набор. Подробные сценарии — в `docs/TESTING_GUIDE_*.md`.

## Если «песочные часы» на кнопках

- Обновите страницу (Ctrl+F5) после обновления MVP.
- Серые кнопки = ещё не готовы (сначала «Построить на карте»).
- Во время Monte Carlo активна только **Остановить**; после `100/100` подождите 2–3 с на `Pareto analysis…`.
- Наводите на **цветные** кнопки, не на серые (серые = курсор «нельзя», это нормально).
