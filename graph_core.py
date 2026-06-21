"""Ядро генерации сбалансированного графа потоков."""

import random
from collections import defaultdict
from dataclasses import dataclass

import networkx as nx

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
COLOR = {"generator": "#4CAF50", "consumer": "#F44336", "transit": "#2196F3"}


def _node_color(hex_color: str) -> dict:
    return {
        "background": hex_color,
        "border": hex_color,
        "highlight": {"background": hex_color, "border": hex_color},
        "hover": {"background": hex_color, "border": hex_color},
    }


def _failed_node_color() -> dict:
    """Не обеспечена автоматически — светло-серый (одноцветный)."""
    return _node_color("#bdbdbd")


@dataclass
class GraphParams:
    n_vertices: int = 20
    n_generators: int = 5
    n_consumers: int = 10
    n_transit: int = 5
    total_production: int = 50
    total_consumption: int = 35
    min_degree: int = 2
    max_degree: int = 5
    seed: int = 42

    @property
    def total_surplus(self) -> int:
        return self.total_production - self.total_consumption

    def validate(self) -> None:
        if self.n_vertices < 3:
            raise ValueError("Минимум 3 вершины")
        if self.n_vertices > len(LETTERS):
            raise ValueError(f"Максимум {len(LETTERS)} вершин (буквы A–Z)")
        if self.n_generators + self.n_consumers + self.n_transit != self.n_vertices:
            raise ValueError("Генераторы + потребители + транзит должны равняться числу вершин")
        if self.n_generators < 1 or self.n_consumers < 1 or self.n_transit < 1:
            raise ValueError("Нужен хотя бы 1 генератор, 1 потребитель и 1 транзит")
        if self.total_production < self.total_consumption:
            raise ValueError("Производство должно быть не меньше потребления")
        if self.total_production < self.n_generators:
            raise ValueError("Производство слишком мало для числа генераторов")
        if self.total_consumption < self.n_consumers:
            raise ValueError("Потребление слишком мало для числа потребителей")
        if self.min_degree > self.max_degree:
            raise ValueError("min_degree не может быть больше max_degree")


@dataclass
class GraphState:
    params: GraphParams
    roles: dict[int, str]
    edges: list[list[int]]
    production: dict[int, int]
    consumption: dict[int, int]

    def to_json(self) -> dict:
        p = self.params
        return {
            "params": {
                "n_vertices": p.n_vertices,
                "n_generators": p.n_generators,
                "n_consumers": p.n_consumers,
                "n_transit": p.n_transit,
                "total_production": p.total_production,
                "total_consumption": p.total_consumption,
                "min_degree": p.min_degree,
                "max_degree": p.max_degree,
                "seed": p.seed,
            },
            "roles": {str(k): v for k, v in self.roles.items()},
            "edges": self.edges,
            "production": {str(k): v for k, v in self.production.items()},
            "consumption": {str(k): v for k, v in self.consumption.items()},
        }

    @classmethod
    def from_json(cls, data: dict) -> "GraphState":
        p = data["params"]
        params = GraphParams(
            n_vertices=int(p["n_vertices"]),
            n_generators=int(p["n_generators"]),
            n_consumers=int(p["n_consumers"]),
            n_transit=int(p["n_transit"]),
            total_production=int(p["total_production"]),
            total_consumption=int(p["total_consumption"]),
            min_degree=int(p["min_degree"]),
            max_degree=int(p["max_degree"]),
            seed=int(p["seed"]),
        )
        roles = {int(k): v for k, v in data["roles"].items()}
        production = {int(k): v for k, v in data["production"].items()}
        consumption = {int(k): v for k, v in data["consumption"].items()}
        edges = [list(e) for e in data["edges"]]
        return cls(params, roles, edges, production, consumption)

    def to_graph(self) -> nx.Graph:
        G = nx.Graph()
        G.add_nodes_from(range(self.params.n_vertices))
        G.add_edges_from((u, v) for u, v in self.edges)
        return G


def edge_allowed(u: int, v: int, roles: dict[int, str]) -> bool:
    ru, rv = roles[u], roles[v]
    if ru == "generator" and rv == "generator":
        return False
    if ru == "consumer" and rv == "consumer":
        return False
    return True


def generate_connected_graph(
    n: int, min_deg: int, max_deg: int, roles: dict[int, str], seed: int
) -> nx.Graph:
    rng = random.Random(seed)

    G = nx.Graph()
    G.add_nodes_from(range(n))

    transit = [v for v in range(n) if roles[v] == "transit"]
    generators = [v for v in range(n) if roles[v] == "generator"]
    consumers = [v for v in range(n) if roles[v] == "consumer"]

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

    if not nx.is_connected(G):
        raise ValueError("Не удалось построить связный граф с заданными параметрами")
    for v in G.nodes:
        deg = G.degree(v)
        if deg < min_deg or deg > max_deg:
            raise ValueError(f"Степень вершины {LETTERS[v]} = {deg}, нужно [{min_deg}, {max_deg}]")

    return G


def split_total(total: int, count: int, rng: random.Random) -> list[int]:
    if count == 0:
        return []
    if count == 1:
        return [total]
    cuts = sorted(rng.sample(range(1, total), count - 1))
    parts = [cuts[0]] + [cuts[i] - cuts[i - 1] for i in range(1, len(cuts))] + [total - cuts[-1]]
    rng.shuffle(parts)
    return parts


def assign_roles(n: int, n_gen: int, n_cons: int, seed: int) -> dict[int, str]:
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
    disabled: set[int] | None = None,
) -> tuple[dict[tuple[int, int], float], dict[int, float], set[int]]:
    """Жадное распределение потоков. Возвращает потоки, surplus и неудовлетворённых потребителей."""
    disabled = disabled or set()
    active = set(G.nodes) - disabled
    H = G.subgraph(active)
    rng = random.Random(seed + 2)

    supply = {v: float(production.get(v, 0)) for v in active if roles[v] == "generator"}
    demand = {v: float(consumption.get(v, 0)) for v in active if roles[v] == "consumer"}
    edge_flow: dict[tuple[int, int], float] = defaultdict(float)
    failed: set[int] = set()

    generators = [v for v in active if roles[v] == "generator" and supply.get(v, 0) > 0]
    consumers = [v for v in active if roles[v] == "consumer" and demand.get(v, 0) > 0]
    rng.shuffle(generators)
    rng.shuffle(consumers)

    for consumer in consumers:
        need = demand[consumer]
        while need > 1e-9:
            src = max((g for g in generators if supply.get(g, 0) > 1e-9), key=lambda g: supply[g], default=None)
            if src is None:
                break
            try:
                path = nx.shortest_path(H, src, consumer)
            except nx.NetworkXNoPath:
                break

            amount = min(supply[src], need)
            for i in range(len(path) - 1):
                u, v = path[i], path[i + 1]
                key = (min(u, v), max(u, v))
                if u < v:
                    edge_flow[key] += amount
                else:
                    edge_flow[key] -= amount

            supply[src] -= amount
            need -= amount

        if need > 1e-9:
            failed.add(consumer)

    surplus = {v: supply[v] for v in generators if supply.get(v, 0) > 1e-9}
    return dict(edge_flow), surplus, failed


def node_balance(
    G: nx.Graph,
    production: dict[int, int],
    consumption: dict[int, int],
    edge_flow: dict[tuple[int, int], float],
    surplus: dict[int, float],
) -> dict[int, float]:
    balance = {}
    for v in G.nodes:
        net_in = 0.0
        for u in G.neighbors(v):
            a, b = min(u, v), max(u, v)
            f = edge_flow.get((a, b), 0.0)
            net_in += f if v == b else -f
        balance[v] = production.get(v, 0) + net_in - consumption.get(v, 0) - surplus.get(v, 0.0)
    return balance


def label_for_vertex(v: int, roles: dict, production: dict, consumption: dict, surplus: dict) -> str:
    letter = LETTERS[v]
    role = roles[v]
    if role == "generator":
        return f"{letter}\n{production[v]}-{int(surplus.get(v, 0))}"
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
    key = (min(u, v), max(u, v))
    f = edge_flow.get(key, 0.0)
    if abs(f) < 1e-9:
        return u, v, False
    if f > 0:
        return key[0], key[1], True
    return key[1], key[0], True


def build_vis_data(
    G: nx.Graph,
    roles: dict,
    production: dict,
    consumption: dict,
    edge_flow: dict,
    surplus: dict,
    seed: int,
    disabled: set[int] | None = None,
    failed: set[int] | None = None,
    positions: dict[int, dict[str, float]] | None = None,
) -> tuple[list[dict], list[dict]]:
    disabled = disabled or set()
    failed = failed or set()
    default_pos = nx.spring_layout(G, seed=seed, k=max(1.8, 3.0 / max(len(G.nodes), 1)), iterations=80)
    n = len(G.nodes)
    scale = 350 if n <= 6 else 600
    if n <= 6:
        size_map = {"generator": 42, "consumer": 42, "transit": 36}
    else:
        size_map = {"generator": 28, "consumer": 28, "transit": 22}
    edge_font = 10 if n <= 6 else 11

    nodes = []
    for v in G.nodes:
        if positions and str(v) in positions:
            x, y = positions[str(v)]["x"], positions[str(v)]["y"]
        elif positions and v in positions:
            x, y = positions[v]["x"], positions[v]["y"]
        elif v in default_pos:
            x, y = default_pos[v]
            x, y = float(x) * scale, float(y) * scale
        else:
            x, y = 0.0, 0.0

        is_off = v in disabled
        is_failed = v in failed and not is_off

        if is_off:
            node_color = _node_color("#000000")
            font_color = "#ffffff"
            border_width = 2
            node_size = size_map[roles[v]]
        elif is_failed:
            node_color = _failed_node_color()
            font_color = "#ffffff"
            border_width = 2
            node_size = size_map[roles[v]]
        else:
            node_color = _node_color(COLOR[roles[v]])
            font_color = "#ffffff"
            border_width = 2
            node_size = size_map[roles[v]]

        node = {
            "id": v,
            "label": label_for_vertex(v, roles, production, consumption, surplus),
            "x": x,
            "y": y,
            "color": node_color,
            "size": node_size,
            "font": {"color": font_color, "size": 14, "face": "Arial", "multi": True, "bold": True},
            "borderWidth": border_width,
            "disabled_manual": is_off,
            "disabled_failed": is_failed,
        }
        if is_off or is_failed:
            node["chosen"] = {"node": False, "label": False}
        node["role"] = roles[v]
        node["role_color"] = COLOR[roles[v]]
        nodes.append(node)

    inactive_nodes = disabled | failed
    edges = []
    for u, v in G.edges:
        key = (min(u, v), max(u, v))
        off_edge = u in inactive_nodes or v in inactive_nodes
        f = 0.0 if off_edge else edge_flow.get(key, 0.0)
        frm, to, arrow = edge_direction(u, v, {key: f})
        zero_flow = abs(f) < 1e-9
        dashed = off_edge or zero_flow
        edge = {
            "id": f"{u}-{v}",
            "from": frm,
            "to": to,
            "label": edge_label(u, v, {key: f}),
            "font": {"size": edge_font, "align": "middle", "background": "rgba(255,255,255,0.85)"},
            "color": {"color": "#bbbbbb" if off_edge else ("#aaaaaa" if zero_flow else "#666666"), "highlight": "#333333"},
            "width": 1.5 if off_edge else 2,
            "smooth": {"type": "continuous"},
            "dashes": [6, 8] if dashed else False,
        }
        if arrow and not off_edge:
            edge["arrows"] = "to"
        edges.append(edge)

    return nodes, edges


def run_checks(
    G: nx.Graph,
    roles: dict,
    production: dict,
    consumption: dict,
    edge_flow: dict,
    surplus: dict,
    balances: dict,
    params: GraphParams,
    disabled: set[int] | None = None,
    failed: set[int] | None = None,
) -> list[dict]:
    disabled = disabled or set()
    failed = failed or set()
    active = set(G.nodes) - disabled - failed

    gen_gen = any(roles[u] == "generator" and roles[v] == "generator" for u, v in G.edges)
    cons_cons = any(roles[u] == "consumer" and roles[v] == "consumer" for u, v in G.edges)
    deg_ok = all(params.min_degree <= G.degree(v) <= params.max_degree for v in G.nodes)

    active_balances = [balances[v] for v in active if v in balances]
    bal_ok = all(abs(b) < 1e-6 for b in active_balances) if active_balances else True

    checks = [
        ("Граф связный", nx.is_connected(G)),
        (f"Степени в [{params.min_degree}, {params.max_degree}]", deg_ok),
        (f"Сумма генерации = {params.total_production}", sum(production.values()) == params.total_production),
        (f"Сумма потребления = {params.total_consumption}", sum(consumption.values()) == params.total_consumption),
        ("Балансы активных вершин сходятся", bal_ok),
        ("Источники не связаны между собой", not gen_gen),
        ("Потребители не связаны между собой", not cons_cons),
    ]
    if disabled:
        checks.append((f"Отключено вручную: {len(disabled)}", True))
    if failed:
        checks.append((f"Не обеспечены: {len(failed)}", False))
    elif not disabled:
        checks.append(
            (f"Сумма surplus = {params.total_surplus}", abs(sum(surplus.values()) - params.total_surplus) < 1e-6)
        )
    return [{"name": name, "ok": ok} for name, ok in checks]


def build_panel(nodes: list[dict], edges: list[dict]) -> dict:
    manual, auto_failed = [], []
    for n in nodes:
        letter = n["label"].split("\n")[0]
        entry = {"letter": letter, "label": n["label"].replace("\n", " ")}
        if n.get("disabled_manual"):
            manual.append(entry)
        elif n.get("disabled_failed"):
            auto_failed.append(entry)
    flows = sorted(
        e["label"] for e in edges if e.get("label") and not e["label"].endswith(" 0")
    )
    manual.sort(key=lambda x: x["letter"])
    auto_failed.sort(key=lambda x: x["letter"])
    return {"manual_disabled": manual, "failed": auto_failed, "flows": flows}


def find_weakest_vertex(state: GraphState) -> dict:
    """Вершина, при отключении которой падает максимум потребителей."""
    G = state.to_graph()
    params = state.params
    best_v = 0
    best_failed: set[int] = set()
    best_count = -1

    for v in G.nodes:
        _, _, failed = compute_flows(
            G, state.roles, state.production, state.consumption, params.seed, {v}
        )
        failed_consumers = {f for f in failed if state.roles[f] == "consumer"}
        count = len(failed_consumers)
        if count > best_count or (count == best_count and LETTERS[v] < LETTERS[best_v]):
            best_v = v
            best_failed = failed_consumers
            best_count = count

    return {
        "vertex": best_v,
        "letter": LETTERS[best_v],
        "role": state.roles[best_v],
        "failed_count": best_count,
        "failed": sorted(best_failed),
        "failed_letters": [LETTERS[f] for f in sorted(best_failed)],
    }


def show_weakest_case(state: GraphState, positions: dict | None = None) -> dict:
    weakest = find_weakest_vertex(state)
    result = _evaluate_state(state, {weakest["vertex"]}, positions)
    result["weakest"] = weakest
    return result


def _evaluate_state(
    state: GraphState,
    disabled: set[int] | None = None,
    positions: dict | None = None,
) -> dict:
    disabled = disabled or set()
    G = state.to_graph()
    params = state.params

    edge_flow, surplus, failed = compute_flows(
        G, state.roles, state.production, state.consumption, params.seed, disabled
    )
    balances = node_balance(G, state.production, state.consumption, edge_flow, surplus)
    nodes, edges = build_vis_data(
        G,
        state.roles,
        state.production,
        state.consumption,
        edge_flow,
        surplus,
        params.seed,
        disabled,
        failed,
        positions,
    )
    checks = run_checks(
        G, state.roles, state.production, state.consumption,
        edge_flow, surplus, balances, params, disabled, failed,
    )

    active_consumption = sum(
        state.consumption.get(v, 0) for v in G.nodes
        if state.roles[v] == "consumer" and v not in disabled and v not in failed
    )

    return {
        "nodes": nodes,
        "edges": edges,
        "checks": checks,
        "state": state.to_json(),
        "disabled": sorted(disabled),
        "failed": sorted(failed),
        "summary": {
            "vertices": params.n_vertices,
            "production": params.total_production,
            "consumption": params.total_consumption,
            "surplus": params.total_surplus,
            "edges_count": G.number_of_edges(),
            "disabled_count": len(disabled),
            "failed_count": len(failed),
            "served_consumption": active_consumption,
        },
        "panel": build_panel(nodes, edges),
    }


def rebalance_graph(state: GraphState, disabled: set[int], positions: dict | None = None) -> dict:
    return _evaluate_state(state, disabled, positions)


def generate_graph(params: GraphParams) -> dict:
    params.validate()
    rng = random.Random(params.seed)

    roles = assign_roles(params.n_vertices, params.n_generators, params.n_consumers, params.seed)
    G = generate_connected_graph(params.n_vertices, params.min_degree, params.max_degree, roles, params.seed)

    generators = [v for v in G.nodes if roles[v] == "generator"]
    consumers = [v for v in G.nodes if roles[v] == "consumer"]

    production_list = split_total(params.total_production, params.n_generators, rng)
    consumption_list = split_total(params.total_consumption, params.n_consumers, rng)

    production = dict(zip(generators, production_list))
    consumption = dict(zip(consumers, consumption_list))

    state = GraphState(
        params=params,
        roles=roles,
        edges=[list(e) for e in G.edges],
        production=production,
        consumption=consumption,
    )
    result = _evaluate_state(state, disabled=set())
    return result
