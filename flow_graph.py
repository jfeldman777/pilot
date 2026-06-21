"""
Сбалансированный синтетический граф потоков.
Генерация, расчёт потоков и отображение на одном экране.
"""

import json
import random
import webbrowser
from collections import defaultdict
from pathlib import Path

import networkx as nx

# --- Параметры ---
N_VERTICES = 20
N_GENERATORS = 5
N_CONSUMERS = 10
N_TRANSIT = 5
TOTAL_PRODUCTION = 50
TOTAL_CONSUMPTION = 35
TOTAL_SURPLUS = TOTAL_PRODUCTION - TOTAL_CONSUMPTION  # 15
MIN_DEGREE = 2
MAX_DEGREE = 5
SEED = 42

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def edge_allowed(u: int, v: int, roles: dict[int, str]) -> bool:
    """Источники и потребители не связаны внутри своих групп."""
    ru, rv = roles[u], roles[v]
    if ru == "generator" and rv == "generator":
        return False
    if ru == "consumer" and rv == "consumer":
        return False
    return True


def generate_connected_graph(
    n: int, min_deg: int, max_deg: int, roles: dict[int, str], seed: int
) -> nx.Graph:
    """Случайный связный граф с ограничением степени и типов рёбер."""
    rng = random.Random(seed)

    G = nx.Graph()
    G.add_nodes_from(range(n))

    transit = [v for v in range(n) if roles[v] == "transit"]
    generators = [v for v in range(n) if roles[v] == "generator"]
    consumers = [v for v in range(n) if roles[v] == "consumer"]

    # Транзитное кольцо — связное ядро сети
    for i in range(len(transit)):
        G.add_edge(transit[i], transit[(i + 1) % len(transit)])

    def attach(node: int, preferred: list[int]) -> None:
        if G.degree(node) >= max_deg:
            return
        pool = [
            t
            for t in preferred
            if edge_allowed(node, t, roles)
            and not G.has_edge(node, t)
            and G.degree(t) < max_deg
        ]
        if pool:
            pool.sort(key=lambda t: G.degree(t))
            G.add_edge(node, pool[0])

    for g in generators:
        attach(g, transit)
        if G.degree(g) < min_deg:
            attach(g, transit + consumers)

    for c in consumers:
        attach(c, transit)
        if G.degree(c) < min_deg:
            attach(c, transit + generators)

    candidates = [
        (u, v)
        for u in range(n)
        for v in range(u + 1, n)
        if not G.has_edge(u, v) and edge_allowed(u, v, roles)
    ]
    rng.shuffle(candidates)
    target_edges = rng.randint(n, n * max_deg // 2)

    for u, v in candidates:
        if G.number_of_edges() >= target_edges:
            break
        if G.degree(u) < max_deg and G.degree(v) < max_deg:
            G.add_edge(u, v)

    for _ in range(n * n):
        low = [v for v in G.nodes if G.degree(v) < min_deg]
        if not low:
            break
        v = low[0]
        others = [
            u
            for u in G.nodes
            if u != v and not G.has_edge(u, v) and G.degree(u) < max_deg and edge_allowed(u, v, roles)
        ]
        if others:
            G.add_edge(v, rng.choice(others))
        else:
            break

    assert nx.is_connected(G), "Граф не связный"
    for v in G.nodes:
        assert min_deg <= G.degree(v) <= max_deg, f"Степень {v} = {G.degree(v)} вне [{min_deg}, {max_deg}]"
    for u, v in G.edges:
        assert edge_allowed(u, v, roles), f"Запрещённое ребро {u}-{v}"

    return G


def split_total(total: int, count: int, rng: random.Random) -> list[int]:
    """Разбить total на count положительных целых (сумма = total)."""
    if count == 0:
        return []
    cuts = sorted(rng.sample(range(1, total), count - 1))
    parts = [cuts[0]] + [cuts[i] - cuts[i - 1] for i in range(1, len(cuts))] + [total - cuts[-1]]
    rng.shuffle(parts)
    return parts


def assign_roles(n: int, n_gen: int, n_cons: int, seed: int) -> dict[int, str]:
    """Назначить типы вершин: generator, consumer, transit."""
    rng = random.Random(seed + 1)
    nodes = list(range(n))
    rng.shuffle(nodes)
    roles = {}
    for v in nodes[:n_gen]:
        roles[v] = "generator"
    for v in nodes[n_gen : n_gen + n_cons]:
        roles[v] = "consumer"
    for v in nodes[n_gen + n_cons :]:
        roles[v] = "transit"
    return roles


def compute_flows(
    G: nx.Graph,
    roles: dict[int, str],
    production: dict[int, int],
    consumption: dict[int, int],
    seed: int,
) -> tuple[dict[tuple[int, int], float], dict[int, float]]:
    """
    Жадное распределение потоков по кратчайшим путям.
    Возвращает потоки по рёбрам и surplus на генераторах.
    """
    rng = random.Random(seed + 2)

    supply = {v: float(production.get(v, 0)) for v in G.nodes}
    demand = {v: float(consumption.get(v, 0)) for v in G.nodes}

    # Направленные потоки по рёбрам (канонический ключ: min, max)
    edge_flow: dict[tuple[int, int], float] = defaultdict(float)

    generators = [v for v in G.nodes if roles[v] == "generator" and supply[v] > 0]
    consumers = [v for v in G.nodes if roles[v] == "consumer" and demand[v] > 0]
    rng.shuffle(generators)
    rng.shuffle(consumers)

    for consumer in consumers:
        need = demand[consumer]
        while need > 1e-9:
            # Генератор с максимальным остатком
            src = max((g for g in generators if supply[g] > 1e-9), key=lambda g: supply[g], default=None)
            if src is None:
                break
            try:
                path = nx.shortest_path(G, src, consumer)
            except nx.NetworkXNoPath:
                break

            amount = min(supply[src], need)
            for i in range(len(path) - 1):
                u, v = path[i], path[i + 1]
                key = (min(u, v), max(u, v))
                # Направление: u -> v
                if u < v:
                    edge_flow[key] += amount
                else:
                    edge_flow[key] -= amount

            supply[src] -= amount
            need -= amount

    surplus = {v: supply[v] for v in generators if supply[v] > 1e-9}
    return dict(edge_flow), surplus


def node_balance(
    G: nx.Graph,
    roles: dict[int, str],
    production: dict[int, int],
    consumption: dict[int, int],
    edge_flow: dict[tuple[int, int], float],
    surplus: dict[int, float],
) -> dict[int, float]:
    """Баланс вершины: production + net_inflow - consumption - surplus."""
    balance = {}
    for v in G.nodes:
        net_in = 0.0
        for u in G.neighbors(v):
            a, b = min(u, v), max(u, v)
            f = edge_flow.get((a, b), 0.0)
            net_in += f if v == b else -f

        prod = production.get(v, 0)
        cons = consumption.get(v, 0)
        sur = surplus.get(v, 0.0)
        # production + net_in = cons + sur (для генератора sur>0, для consumer cons>0)
        balance[v] = prod + net_in - cons - sur
    return balance


def label_for_vertex(v: int, roles: dict, production: dict, consumption: dict, surplus: dict) -> str:
    letter = LETTERS[v]
    role = roles[v]
    if role == "generator":
        val = production[v]
        sur = int(surplus.get(v, 0))
        return f"{letter}\n{val}-{sur}"
    if role == "consumer":
        return f"{letter}\n{consumption[v]}"
    return letter


def edge_label(u: int, v: int, edge_flow: dict) -> str:
    key = (min(u, v), max(u, v))
    f = edge_flow.get(key, 0.0)
    if abs(f) < 1e-9:
        return f"{LETTERS[u]}{LETTERS[v]} 0"
    if f > 0:
        return f"{LETTERS[u]}->{LETTERS[v]} {f:.0f}"
    return f"{LETTERS[v]}->{LETTERS[u]} {abs(f):.0f}"


def edge_direction(u: int, v: int, edge_flow: dict) -> tuple[int, int, bool]:
    """(from, to, show_arrow) с учётом знака потока."""
    key = (min(u, v), max(u, v))
    f = edge_flow.get(key, 0.0)
    if abs(f) < 1e-9:
        return u, v, False
    if f > 0:
        return key[0], key[1], True
    return key[1], key[0], True


def export_interactive_html(
    G: nx.Graph,
    roles: dict,
    production: dict,
    consumption: dict,
    edge_flow: dict,
    surplus: dict,
    output: str = "flow_graph.html",
) -> Path:
    """Интерактивный граф: вершины можно перетаскивать мышью."""
    pos = nx.spring_layout(G, seed=SEED, k=1.8, iterations=80)
    scale = 600

    color_map = {"generator": "#4CAF50", "consumer": "#F44336", "transit": "#2196F3"}
    size_map = {"generator": 28, "consumer": 28, "transit": 22}

    nodes = []
    for v in G.nodes:
        x, y = pos[v]
        nodes.append(
            {
                "id": v,
                "label": label_for_vertex(v, roles, production, consumption, surplus),
                "x": float(x) * scale,
                "y": float(y) * scale,
                "color": color_map[roles[v]],
                "size": size_map[roles[v]],
                "font": {"color": "#ffffff", "size": 14, "face": "Arial", "multi": True, "bold": True},
            }
        )

    edges = []
    for u, v in G.edges:
        frm, to, arrow = edge_direction(u, v, edge_flow)
        key = (min(u, v), max(u, v))
        zero_flow = abs(edge_flow.get(key, 0.0)) < 1e-9
        edge = {
            "from": frm,
            "to": to,
            "label": edge_label(u, v, edge_flow),
            "font": {"size": 11, "align": "middle", "background": "rgba(255,255,255,0.85)"},
            "color": {"color": "#aaaaaa" if zero_flow else "#666666", "highlight": "#333333"},
            "width": 2,
            "smooth": {"type": "continuous"},
        }
        if zero_flow:
            edge["dashes"] = [8, 6]
        if arrow:
            edge["arrows"] = "to"
        edges.append(edge)

    title = (
        f"Сбалансированный граф потоков | V={N_VERTICES} | "
        f"Prod={TOTAL_PRODUCTION} Cons={TOTAL_CONSUMPTION} Surplus={TOTAL_SURPLUS}"
    )

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: Arial, sans-serif; background: #f5f5f5; }}
    #header {{
      padding: 12px 20px;
      background: #fff;
      border-bottom: 1px solid #ddd;
      font-size: 15px;
      font-weight: bold;
    }}
    #legend {{
      padding: 8px 20px;
      background: #fff;
      border-bottom: 1px solid #eee;
      font-size: 13px;
      display: flex;
      gap: 24px;
    }}
    .legend-item {{ display: flex; align-items: center; gap: 6px; }}
    .dot {{ width: 14px; height: 14px; border-radius: 50%; border: 1px solid #333; }}
    #graph {{ width: 100vw; height: calc(100vh - 80px); background: #fff; }}
    #hint {{
      position: fixed;
      bottom: 12px;
      right: 16px;
      background: rgba(255,255,255,0.9);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: #555;
      border: 1px solid #ddd;
    }}
  </style>
</head>
<body>
  <div id="header">{title}</div>
  <div id="legend">
    <div class="legend-item"><span class="dot" style="background:#4CAF50"></span> Генератор (производство-избыток)</div>
    <div class="legend-item"><span class="dot" style="background:#F44336"></span> Потребитель (потребление)</div>
    <div class="legend-item"><span class="dot" style="background:#2196F3"></span> Транзит (буква)</div>
    <div class="legend-item"><span style="border-bottom:2px dashed #aaa;width:24px;display:inline-block"></span> Нулевой поток</div>
  </div>
  <div id="graph"></div>
  <div id="hint">Перетащите вершину мышью · колёсико — масштаб · перетаскивание фона — панорама</div>
  <script>
    const nodes = new vis.DataSet({json.dumps(nodes, ensure_ascii=False)});
    const edges = new vis.DataSet({json.dumps(edges, ensure_ascii=False)});
    const container = document.getElementById("graph");
    const data = {{ nodes, edges }};
    const options = {{
      physics: {{ enabled: false }},
      interaction: {{
        dragNodes: true,
        dragView: true,
        zoomView: true,
        hover: true,
      }},
      nodes: {{
        borderWidth: 2,
        borderWidthSelected: 3,
        chosen: {{ label: false }},
      }},
      edges: {{
        chosen: false,
      }},
    }};
    new vis.Network(container, data, options);
  </script>
</body>
</html>"""

    path = Path(output)
    path.write_text(html, encoding="utf-8")
    return path


def draw_graph_static_png(
    G: nx.Graph,
    roles: dict,
    production: dict,
    consumption: dict,
    edge_flow: dict,
    surplus: dict,
):
    """Статический PNG (опционально, требует matplotlib)."""
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    pos = nx.spring_layout(G, seed=SEED, k=1.8, iterations=80)

    fig, ax = plt.subplots(figsize=(16, 10))
    ax.set_title(
        f"Сбалансированный граф потоков | V={N_VERTICES} | "
        f"Prod={TOTAL_PRODUCTION} Cons={TOTAL_CONSUMPTION} Surplus={TOTAL_SURPLUS}",
        fontsize=14,
        fontweight="bold",
    )

    color_map = {"generator": "#4CAF50", "consumer": "#F44336", "transit": "#2196F3"}
    node_colors = [color_map[roles[v]] for v in G.nodes]
    node_sizes = [900 if roles[v] != "transit" else 700 for v in G.nodes]

    zero_edges = [(u, v) for u, v in G.edges if abs(edge_flow.get((min(u, v), max(u, v)), 0.0)) < 1e-9]
    flow_edges = [(u, v) for u, v in G.edges if abs(edge_flow.get((min(u, v), max(u, v)), 0.0)) >= 1e-9]
    if flow_edges:
        nx.draw_networkx_edges(G, pos, edgelist=flow_edges, ax=ax, width=2, alpha=0.6, edge_color="#555555")
    if zero_edges:
        nx.draw_networkx_edges(
            G, pos, edgelist=zero_edges, ax=ax, width=1.5, alpha=0.5, edge_color="#aaaaaa", style="dashed"
        )

    nx.draw_networkx_nodes(G, pos, ax=ax, node_color=node_colors, node_size=node_sizes, edgecolors="black", linewidths=1.5)

    labels = {v: label_for_vertex(v, roles, production, consumption, surplus) for v in G.nodes}
    nx.draw_networkx_labels(G, pos, labels, ax=ax, font_size=8, font_weight="bold")

    # Подписи рёбер
    for u, v in G.edges:
        x = (pos[u][0] + pos[v][0]) / 2
        y = (pos[u][1] + pos[v][1]) / 2
        ax.text(
            x,
            y,
            edge_label(u, v, edge_flow),
            fontsize=7,
            ha="center",
            va="center",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="white", edgecolor="#aaaaaa", alpha=0.85),
        )

    legend_patches = [
        mpatches.Patch(color="#4CAF50", label="Generator (G)"),
        mpatches.Patch(color="#F44336", label="Consumer (C)"),
        mpatches.Patch(color="#2196F3", label="Transit (T)"),
    ]
    ax.legend(handles=legend_patches, loc="upper left", fontsize=10)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig("flow_graph.png", dpi=150, bbox_inches="tight")
    plt.close()
    print("Статический PNG сохранён в flow_graph.png")


def verify(
    G: nx.Graph,
    roles: dict,
    production: dict,
    consumption: dict,
    edge_flow: dict,
    surplus: dict,
    balances: dict,
):
    """Проверка критериев приёмки."""
    checks = []

    checks.append(("Граф связный", nx.is_connected(G)))
    deg_ok = all(MIN_DEGREE <= G.degree(v) <= MAX_DEGREE for v in G.nodes)
    checks.append((f"Степени в [{MIN_DEGREE}, {MAX_DEGREE}]", deg_ok))
    checks.append(("Сумма генерации = 50", sum(production.values()) == TOTAL_PRODUCTION))
    checks.append(("Сумма потребления = 35", sum(consumption.values()) == TOTAL_CONSUMPTION))
    checks.append(("Сумма surplus = 15", abs(sum(surplus.values()) - TOTAL_SURPLUS) < 1e-6))
    bal_ok = all(abs(b) < 1e-6 for b in balances.values())
    checks.append(("Балансы всех вершин сходятся", bal_ok))
    gen_gen = any(roles[u] == "generator" and roles[v] == "generator" for u, v in G.edges)
    cons_cons = any(roles[u] == "consumer" and roles[v] == "consumer" for u, v in G.edges)
    checks.append(("Источники не связаны между собой", not gen_gen))
    checks.append(("Потребители не связаны между собой", not cons_cons))

    print("\n=== Проверка критериев приёмки ===")
    all_ok = True
    for name, ok in checks:
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {name}")
        all_ok = all_ok and ok

    print("\n=== Детали вершин ===")
    for v in sorted(G.nodes):
        letter = LETTERS[v]
        role = roles[v]
        bal = balances[v]
        sur = surplus.get(v, 0)
        prod = production.get(v, 0)
        cons = consumption.get(v, 0)
        print(
            f"  {letter} ({role:9s}) deg={G.degree(v)} prod={prod:2d} cons={cons:2d} "
            f"surplus={sur:5.1f} balance={bal:+.2f}"
        )

    print("\n=== Потоки по рёбрам ===")
    for (u, v), f in sorted(edge_flow.items()):
        if abs(f) > 1e-9:
            direction = f"{LETTERS[u]}->{LETTERS[v]}" if f > 0 else f"{LETTERS[v]}->{LETTERS[u]}"
            print(f"  {direction}: {abs(f):.0f}")

    return all_ok


def main():
    rng = random.Random(SEED)

    roles = assign_roles(N_VERTICES, N_GENERATORS, N_CONSUMERS, SEED)
    G = generate_connected_graph(N_VERTICES, MIN_DEGREE, MAX_DEGREE, roles, SEED)

    generators = [v for v in G.nodes if roles[v] == "generator"]
    consumers = [v for v in G.nodes if roles[v] == "consumer"]

    production_list = split_total(TOTAL_PRODUCTION, N_GENERATORS, rng)
    consumption_list = split_total(TOTAL_CONSUMPTION, N_CONSUMERS, rng)

    production = dict(zip(generators, production_list))
    consumption = dict(zip(consumers, consumption_list))

    edge_flow, surplus = compute_flows(G, roles, production, consumption, SEED)
    balances = node_balance(G, roles, production, consumption, edge_flow, surplus)

    ok = verify(G, roles, production, consumption, edge_flow, surplus, balances)
    if not ok:
        raise SystemExit("Проверка не пройдена")

    html_path = export_interactive_html(G, roles, production, consumption, edge_flow, surplus)
    print(f"\nИнтерактивный граф сохранён в {html_path}")
    webbrowser.open(html_path.resolve().as_uri())
    print("Граф открыт в браузере — перетаскивайте вершины мышью.")


if __name__ == "__main__":
    main()
