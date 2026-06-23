/** Клиентское ядро графа потоков (для GitHub Pages и локального запуска). */
(function (global) {
  "use strict";

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const COLOR = { generator: "#4CAF50", consumer: "#F44336", transit: "#2196F3" };
  const PRIORITY_RANK = { critical: 0, important: 1, normal: 2, flexible: 3 };
  const CAPACITY_BLOCK_MW = 10;
  const DEFAULT_EDGE_CAPACITY = 1e9;

  class Random {
    constructor(seed) {
      this.state = (seed >>> 0) || 1;
    }
    next() {
      this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
      return this.state / 0x100000000;
    }
    random() {
      return this.next();
    }
    randint(a, b) {
      return a + Math.floor(this.next() * (b - a + 1));
    }
    choice(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    sample(population, k) {
      const copy = [...population];
      this.shuffle(copy);
      return copy.slice(0, k);
    }
  }

  function parseParams(raw) {
    return {
      n_vertices: +raw.n_vertices,
      n_generators: +raw.n_generators,
      n_consumers: +raw.n_consumers,
      n_transit: +raw.n_transit,
      total_production: +raw.total_production,
      total_consumption: +raw.total_consumption,
      min_degree: +raw.min_degree,
      max_degree: +raw.max_degree,
      seed: +raw.seed,
      get total_surplus() {
        return this.total_production - this.total_consumption;
      },
    };
  }

  function validateParams(p) {
    if (p.n_vertices < 3) throw new Error("Минимум 3 вершины");
    if (p.n_vertices > LETTERS.length) throw new Error(`Максимум ${LETTERS.length} вершин (буквы A–Z)`);
    if (p.n_generators + p.n_consumers + p.n_transit !== p.n_vertices) {
      throw new Error("Генераторы + потребители + транзит должны равняться числу вершин");
    }
    if (p.n_generators < 1 || p.n_consumers < 1 || p.n_transit < 1) {
      throw new Error("Нужен хотя бы 1 генератор, 1 потребитель и 1 транзит");
    }
    if (p.total_production < p.total_consumption) {
      throw new Error("Производство должно быть не меньше потребления");
    }
    if (p.total_production < p.n_generators) {
      throw new Error("Производство слишком мало для числа генераторов");
    }
    if (p.total_consumption < p.n_consumers) {
      throw new Error("Потребление слишком мало для числа потребителей");
    }
    if (p.min_degree > p.max_degree) throw new Error("min_degree не может быть больше max_degree");
  }

  class Graph {
    constructor(n, edges = []) {
      this.n = n;
      this.edges = edges.map(([u, v]) => [u, v]);
      this.adj = Array.from({ length: n }, () => []);
      for (const [u, v] of this.edges) {
        if (!this.adj[u].includes(v)) this.adj[u].push(v);
        if (!this.adj[v].includes(u)) this.adj[v].push(u);
      }
    }
    nodes() {
      return [...Array(this.n).keys()];
    }
    neighbors(v) {
      return this.adj[v];
    }
    degree(v) {
      return this.adj[v].length;
    }
    hasEdge(u, v) {
      return this.adj[u].includes(v);
    }
    addEdge(u, v) {
      if (this.hasEdge(u, v)) return;
      this.edges.push([u, v]);
      this.adj[u].push(v);
      this.adj[v].push(u);
    }
    edgeCount() {
      return this.edges.length;
    }
    isConnected() {
      if (this.n === 0) return true;
      const seen = new Set([0]);
      const q = [0];
      while (q.length) {
        const v = q.pop();
        for (const u of this.adj[v]) {
          if (!seen.has(u)) {
            seen.add(u);
            q.push(u);
          }
        }
      }
      return seen.size === this.n;
    }
    subgraph(active) {
      const set = new Set(active);
      const edges = this.edges.filter(([u, v]) => set.has(u) && set.has(v));
      return new Graph(this.n, edges);
    }
    subgraphBlocked(active, blockedEdgeKeys) {
      const nodes = new Set(active);
      const blocked = blockedEdgeKeys || new Set();
      const edges = this.edges.filter(([u, v]) => {
        if (!nodes.has(u) || !nodes.has(v)) return false;
        const key = `${Math.min(u, v)},${Math.max(u, v)}`;
        return !blocked.has(key);
      });
      return new Graph(this.n, edges);
    }
    shortestPath(src, dst) {
      if (src === dst) return [src];
      const prev = new Map();
      const q = [src];
      prev.set(src, null);
      while (q.length) {
        const v = q.shift();
        for (const u of this.adj[v]) {
          if (!prev.has(u)) {
            prev.set(u, v);
            if (u === dst) {
              const path = [dst];
              let cur = v;
              while (cur !== null) {
                path.unshift(cur);
                cur = prev.get(cur);
              }
              return path;
            }
            q.push(u);
          }
        }
      }
      return null;
    }
  }

  function stateToJson(state) {
    const p = state.params;
    const out = {
      params: {
        n_vertices: p.n_vertices,
        n_generators: p.n_generators,
        n_consumers: p.n_consumers,
        n_transit: p.n_transit,
        total_production: p.total_production,
        total_consumption: p.total_consumption,
        min_degree: p.min_degree,
        max_degree: p.max_degree,
        seed: p.seed,
        mode: p.mode || "graph",
      },
      roles: Object.fromEntries(Object.entries(state.roles).map(([k, v]) => [String(k), v])),
      edges: state.edges,
      production: Object.fromEntries(Object.entries(state.production).map(([k, v]) => [String(k), v])),
      consumption: Object.fromEntries(Object.entries(state.consumption).map(([k, v]) => [String(k), v])),
    };
    if (state.geo) out.geo = state.geo;
    if (state.passport) out.passport = state.passport;
    if (state.edge_capacity) out.edge_capacity = { ...state.edge_capacity };
    if (state.priority) out.priority = Object.fromEntries(Object.entries(state.priority).map(([k, v]) => [String(k), v]));
    if (state.reinforced_edges?.length) out.reinforced_edges = [...state.reinforced_edges];
    if (state.new_edges?.length) out.new_edges = [...state.new_edges];
    if (state.disabled_edges?.length) out.disabled_edges = state.disabled_edges.map(e => [...e]);
    if (state.edge_reactance) out.edge_reactance = { ...state.edge_reactance };
    if (state.slack_node != null) out.slack_node = state.slack_node;
    if (state.voltage_level_kv) out.voltage_level_kv = { ...state.voltage_level_kv };
    if (state.node_types) out.node_types = { ...state.node_types };
    if (state.edge_types) out.edge_types = { ...state.edge_types };
    if (state.edge_voltage_kv) out.edge_voltage_kv = { ...state.edge_voltage_kv };
    if (state.edge_from_kv) out.edge_from_kv = { ...state.edge_from_kv };
    if (state.edge_to_kv) out.edge_to_kv = { ...state.edge_to_kv };
    if (state.node_repair_time_days) out.node_repair_time_days = { ...state.node_repair_time_days };
    if (state.edge_repair_time_days) out.edge_repair_time_days = { ...state.edge_repair_time_days };
    if (state.edge_replacement_cost) out.edge_replacement_cost = { ...state.edge_replacement_cost };
    if (state.engineering_attrs_ready) out.engineering_attrs_ready = true;
    if (state.theta) out.theta = { ...state.theta };
    return out;
  }

  function edgeKey(u, v) {
    const a = Math.min(u, v);
    const b = Math.max(u, v);
    return `${a},${b}`;
  }

  function edgeKeySet(list) {
    const s = new Set();
    for (const e of list || []) {
      if (typeof e === "string") s.add(e);
      else if (Array.isArray(e)) s.add(edgeKey(e[0], e[1]));
    }
    return s;
  }

  function edgeKeyList(set) {
    return [...set]
      .map(k => k.split(",").map(Number))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  function stateFromJson(data) {
    const p = parseParams(data.params);
    if (data.params?.mode) p.mode = data.params.mode;
    const roles = {};
    for (const [k, v] of Object.entries(data.roles)) roles[+k] = v;
    const production = {};
    for (const [k, v] of Object.entries(data.production)) production[+k] = +v;
    const consumption = {};
    for (const [k, v] of Object.entries(data.consumption)) consumption[+k] = +v;
    return {
      params: p,
      roles,
      edges: data.edges.map(e => [...e]),
      production,
      consumption,
      geo: data.geo || null,
      passport: data.passport || null,
      edge_capacity: data.edge_capacity || null,
      priority: data.priority ? Object.fromEntries(Object.entries(data.priority).map(([k, v]) => [+k, v])) : null,
      reinforced_edges: data.reinforced_edges || [],
      new_edges: data.new_edges || [],
      disabled_edges: (data.disabled_edges || []).map(e => [...e]),
      edge_reactance: data.edge_reactance || null,
      slack_node: data.slack_node != null ? +data.slack_node : null,
      voltage_level_kv: data.voltage_level_kv || null,
      node_types: data.node_types ? Object.fromEntries(Object.entries(data.node_types).map(([k, v]) => [+k, v])) : null,
      edge_types: data.edge_types || null,
      edge_voltage_kv: data.edge_voltage_kv || null,
      edge_from_kv: data.edge_from_kv || null,
      edge_to_kv: data.edge_to_kv || null,
      node_repair_time_days: data.node_repair_time_days
        ? Object.fromEntries(Object.entries(data.node_repair_time_days).map(([k, v]) => [+k, +v]))
        : null,
      edge_repair_time_days: data.edge_repair_time_days || null,
      edge_replacement_cost: data.edge_replacement_cost || null,
      engineering_attrs_ready: !!data.engineering_attrs_ready,
      theta: data.theta || null,
    };
  }

  function stateToGraph(state) {
    return new Graph(state.params.n_vertices, state.edges);
  }

  function edgeAllowed(u, v, roles) {
    const ru = roles[u];
    const rv = roles[v];
    if (ru === "generator" && rv === "generator") return false;
    if (ru === "consumer" && rv === "consumer") return false;
    return true;
  }

  function generateConnectedGraph(n, minDeg, maxDeg, roles, seed) {
    const rng = new Random(seed);
    const G = new Graph(n);

    const transit = [...Array(n).keys()].filter(v => roles[v] === "transit");
    const generators = [...Array(n).keys()].filter(v => roles[v] === "generator");
    const consumers = [...Array(n).keys()].filter(v => roles[v] === "consumer");

    for (let i = 0; i < transit.length; i++) {
      G.addEdge(transit[i], transit[(i + 1) % transit.length]);
    }

    function attach(node, preferred) {
      if (G.degree(node) >= maxDeg) return;
      const pool = preferred.filter(
        t =>
          edgeAllowed(node, t, roles) &&
          !G.hasEdge(node, t) &&
          G.degree(t) < maxDeg
      );
      if (pool.length) {
        pool.sort((a, b) => G.degree(a) - G.degree(b));
        G.addEdge(node, pool[0]);
      }
    }

    for (const g of generators) {
      attach(g, transit);
      if (G.degree(g) < minDeg) attach(g, [...transit, ...consumers]);
    }
    for (const c of consumers) {
      attach(c, transit);
      if (G.degree(c) < minDeg) attach(c, [...transit, ...generators]);
    }

    const candidates = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        if (!G.hasEdge(u, v) && edgeAllowed(u, v, roles)) candidates.push([u, v]);
      }
    }
    rng.shuffle(candidates);
    const targetEdges = rng.randint(n, Math.floor((n * maxDeg) / 2));

    for (const [u, v] of candidates) {
      if (G.edgeCount() >= targetEdges) break;
      if (G.degree(u) < maxDeg && G.degree(v) < maxDeg) G.addEdge(u, v);
    }

    for (let iter = 0; iter < n * n; iter++) {
      const low = G.nodes().filter(v => G.degree(v) < minDeg);
      if (!low.length) break;
      const v = low[0];
      const others = G.nodes().filter(
        u => u !== v && !G.hasEdge(u, v) && G.degree(u) < maxDeg && edgeAllowed(u, v, roles)
      );
      if (others.length) G.addEdge(v, rng.choice(others));
      else break;
    }

    if (!G.isConnected()) {
      throw new Error("Не удалось построить связный граф с заданными параметрами");
    }
    for (const v of G.nodes()) {
      const deg = G.degree(v);
      if (deg < minDeg || deg > maxDeg) {
        throw new Error(`Степень вершины ${LETTERS[v]} = ${deg}, нужно [${minDeg}, ${maxDeg}]`);
      }
    }
    return G;
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function weightedChoice(items, weights, rng) {
    if (!items.length) return null;
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 1e-12) return rng.choice(items);
    let r = rng.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function geoEdgeWeight(distKm, scaleKm) {
    return Math.exp(-distKm / scaleKm);
  }

  function medianGeoScale(n, roles, geo) {
    const dists = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        if (!edgeAllowed(u, v, roles)) continue;
        const gu = geo[String(u)] ?? geo[u];
        const gv = geo[String(v)] ?? geo[v];
        if (!gu || !gv) continue;
        dists.push(haversineKm(gu, gv));
      }
    }
    if (!dists.length) return 120;
    dists.sort((a, b) => a - b);
    return dists[Math.floor(dists.length / 2)] || 120;
  }

  function generateGeoGraph(n, roles, geo, seed) {
    const rng = new Random(seed);
    const G = new Graph(n);
    const dist = (u, v) => {
      const gu = geo[String(u)] ?? geo[u];
      const gv = geo[String(v)] ?? geo[v];
      return haversineKm(gu, gv);
    };
    const scale = medianGeoScale(n, roles, geo);

    const order = [...Array(n).keys()];
    rng.shuffle(order);
    const inTree = new Set([order[0]]);

    for (let i = 1; i < order.length; i++) {
      const u = order[i];
      let candidates = [...inTree].filter(v => edgeAllowed(u, v, roles));
      if (!candidates.length) {
        candidates = G.nodes().filter(v => v !== u && edgeAllowed(u, v, roles));
      }
      if (!candidates.length) continue;
      const weights = candidates.map(v => geoEdgeWeight(dist(u, v), scale));
      G.addEdge(u, weightedChoice(candidates, weights, rng));
      inTree.add(u);
    }

    const extras = [];
    const extraWeights = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        if (edgeAllowed(u, v, roles) && !G.hasEdge(u, v)) {
          extras.push([u, v]);
          extraWeights.push(geoEdgeWeight(dist(u, v), scale));
        }
      }
    }

    const target = rng.randint(n, Math.max(n, Math.floor(n * 1.8)));
    const ranked = extras
      .map((edge, i) => ({
        edge,
        w: extraWeights[i],
        tie: rng.random(),
      }))
      .sort((a, b) => b.w + b.tie * 0.15 - (a.w + a.tie * 0.15));

    for (const { edge: [u, v], w } of ranked) {
      if (G.edgeCount() >= target) break;
      const p = Math.min(0.95, 0.25 + w * 1.4);
      if (rng.random() < p) G.addEdge(u, v);
    }

    if (!G.isConnected()) {
      const bridge = extras
        .map(([u, v], i) => ({ u, v, d: dist(u, v) }))
        .filter(({ u, v }) => !G.hasEdge(u, v))
        .sort((a, b) => a.d - b.d);
      for (const { u, v } of bridge) {
        if (G.isConnected()) break;
        G.addEdge(u, v);
      }
    }
    return G;
  }

  function generateLooseGraph(n, roles, seed) {
    const rng = new Random(seed);
    const G = new Graph(n);
    const order = [...Array(n).keys()];
    rng.shuffle(order);

    for (let i = 1; i < order.length; i++) {
      const u = order[i];
      const prev = order.slice(0, i).filter(v => edgeAllowed(u, v, roles));
      if (!prev.length) {
        for (let j = 0; j < i; j++) {
          if (edgeAllowed(u, order[j], roles)) {
            G.addEdge(u, order[j]);
            break;
          }
        }
      } else {
        G.addEdge(u, rng.choice(prev));
      }
    }

    const candidates = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        if (edgeAllowed(u, v, roles)) candidates.push([u, v]);
      }
    }
    rng.shuffle(candidates);
    const target = rng.randint(n, Math.max(n, Math.floor(n * 1.8)));
    for (const [u, v] of candidates) {
      if (G.edgeCount() >= target) break;
      if (!G.hasEdge(u, v)) G.addEdge(u, v);
    }

    if (!G.isConnected()) {
      for (let u = 0; u < n; u++) {
        for (let v = u + 1; v < n; v++) {
          if (!G.isConnected()) {
            if (edgeAllowed(u, v, roles) && !G.hasEdge(u, v)) G.addEdge(u, v);
          }
        }
      }
    }
    return G;
  }

  function splitTotal(total, count, rng) {
    if (count === 0) return [];
    if (count === 1) return [total];
    const population = [];
    for (let i = 1; i < total; i++) population.push(i);
    const cuts = rng.sample(population, count - 1).sort((a, b) => a - b);
    const parts = [cuts[0]];
    for (let i = 1; i < cuts.length; i++) parts.push(cuts[i] - cuts[i - 1]);
    parts.push(total - cuts[cuts.length - 1]);
    rng.shuffle(parts);
    return parts;
  }

  function assignRoles(n, nGen, nCons, seed) {
    const rng = new Random(seed + 1);
    const nodes = [...Array(n).keys()];
    rng.shuffle(nodes);
    const roles = {};
    nodes.slice(0, nGen).forEach(v => (roles[v] = "generator"));
    nodes.slice(nGen, nGen + nCons).forEach(v => (roles[v] = "consumer"));
    nodes.slice(nGen + nCons).forEach(v => (roles[v] = "transit"));
    return roles;
  }

  function getEdgeCapacityMw(edgeCapacity, u, v) {
    if (!edgeCapacity) return DEFAULT_EDGE_CAPACITY;
    const k = edgeKey(u, v);
    const c = edgeCapacity[k];
    return c != null && c > 0 ? c : DEFAULT_EDGE_CAPACITY;
  }

  function assignSyntheticEdgeCapacities(G, state, seed) {
    const rng = new Random((seed >>> 0) + 99);
    const cap = {};
    for (const [u, v] of G.edges) {
      const tight = rng.random() < 0.38;
      cap[edgeKey(u, v)] = tight ? rng.randint(5, 14) : rng.randint(16, 42);
    }
    return cap;
  }

  function assignConsumerPriorities(state, seed) {
    const rng = new Random((seed >>> 0) + 101);
    const pri = {};
    const consumers = Object.keys(state.roles).map(Number).filter(v => state.roles[v] === "consumer");
    for (const v of consumers) {
      const r = rng.random();
      if (r < 0.22) pri[v] = "critical";
      else if (r < 0.48) pri[v] = "important";
      else if (r < 0.78) pri[v] = "normal";
      else pri[v] = "flexible";
    }
    if (consumers.length && !Object.values(pri).includes("critical")) pri[consumers[0]] = "critical";
    return pri;
  }

  function initCapacityState(state, seed) {
    const G = stateToGraph(state);
    if (!state.edge_capacity) state.edge_capacity = assignSyntheticEdgeCapacities(G, state, seed);
    if (!state.priority) state.priority = assignConsumerPriorities(state, seed);
    state.passport = {
      coords: state.passport?.coords || (state.geo ? "OPEN_DATA" : "SYNTHETIC"),
      links: "SYNTHETIC",
      capacity: "SYNTHETIC",
      model: "MATHEMATICAL_SCREENING",
      ...state.passport,
    };
    if (!state.reinforced_edges) state.reinforced_edges = [];
    if (!state.new_edges) state.new_edges = [];
    return state;
  }

  function maxPushAmount(u, v, edgeFlow, edgeCapacity) {
    const key = edgeKey(u, v);
    const cap = getEdgeCapacityMw(edgeCapacity, u, v);
    const f = edgeFlow[key] || 0;
    const sign = u < v ? 1 : -1;
    const hi = cap - sign * f;
    const lo = -cap - sign * f;
    const loPos = Math.max(0, lo);
    const hiPos = Math.max(0, hi);
    if (loPos > hiPos + 1e-9) return 0;
    return hiPos;
  }

  function maxPushOnPath(path, edgeFlow, edgeCapacity) {
    let m = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      m = Math.min(m, maxPushAmount(path[i], path[i + 1], edgeFlow, edgeCapacity));
    }
    return m === Infinity ? 0 : m;
  }

  function analyzeFeasibility(G, state, edgeFlow, failed, served, edgeCapacity, priorities) {
    let capacityViolations = 0;
    let maxLoading = 0;
    for (const [u, v] of G.edges) {
      const key = edgeKey(u, v);
      const f = edgeFlow[key] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const loading = cap > 0 ? (Math.abs(f) / cap) * 100 : 0;
      if (Math.abs(f) > cap + 1e-6) capacityViolations++;
      maxLoading = Math.max(maxLoading, loading);
    }
    let criticalTotal = 0;
    let criticalServed = 0;
    let criticalUnserved = 0;
    let servedTotal = 0;
    let unservedTotal = 0;
    for (const v of G.nodes()) {
      if (state.roles[v] !== "consumer") continue;
      const demand = state.consumption[v] || 0;
      const sv = served[v] || 0;
      servedTotal += sv;
      unservedTotal += Math.max(0, demand - sv);
      const p = priorities[v] || "normal";
      if (p === "critical") {
        criticalTotal++;
        if (sv >= demand - 1e-6) criticalServed++;
        else criticalUnserved++;
      }
    }
    const feasible = capacityViolations === 0 && criticalUnserved === 0;
    return {
      feasible,
      critical_served_count: criticalServed,
      critical_total_count: criticalTotal,
      critical_unserved_count: criticalUnserved,
      capacity_violations_count: capacityViolations,
      max_loading_percent: Math.round(maxLoading * 10) / 10,
      served_total_mw: Math.round(servedTotal),
      unserved_total_mw: Math.round(unservedTotal),
      demand_total_mw: state.params.total_consumption,
    };
  }

  function computeFlowsFromState(G, state, disabled, disabledEdges) {
    return computeFlows(
      G, state.roles, state.production, state.consumption, state.params.seed,
      disabled, disabledEdges, state.edge_capacity || {}, state.priority || {}
    );
  }

  function evaluateFeasibilityState(state, disabled = new Set(), disabledEdges = null) {
    const G = stateToGraph(state);
    const de = disabledEdges || edgeKeySet(state.disabled_edges);
    initCapacityState(state, state.params.seed);
    const { edgeFlow, failed, served } = computeFlowsFromState(G, state, disabled, de);
    return analyzeFeasibility(G, state, edgeFlow, failed, served, state.edge_capacity, state.priority);
  }

  function blockCost(mw, costPerBlock) {
    return Math.ceil(Math.max(1, mw) / CAPACITY_BLOCK_MW) * costPerBlock;
  }

  function improvementScore(before, after) {
    return (
      (before.critical_unserved_count - after.critical_unserved_count) * 1000 +
      (before.capacity_violations_count - after.capacity_violations_count) * 100 +
      (after.served_total_mw - before.served_total_mw)
    );
  }

  function computeFlows(G, roles, production, consumption, seed, disabled = new Set(), disabledEdges = new Set(), edgeCapacity = {}, priorities = {}) {
    const active = new Set(G.nodes().filter(v => !disabled.has(v)));
    const H = G.subgraphBlocked(active, disabledEdges);
    const rng = new Random(seed + 2);

    const supply = {};
    const demand = {};
    for (const v of active) {
      if (roles[v] === "generator") supply[v] = production[v] || 0;
      if (roles[v] === "consumer") demand[v] = consumption[v] || 0;
    }

    const edgeFlow = {};
    const failed = new Set();
    const flowKey = (u, v) => {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      return `${a},${b}`;
    };
    const addFlow = (u, v, amount) => {
      const key = flowKey(u, v);
      if (!edgeFlow[key]) edgeFlow[key] = 0;
      if (u < v) edgeFlow[key] += amount;
      else edgeFlow[key] -= amount;
    };
    const getFlow = (u, v) => edgeFlow[flowKey(u, v)] || 0;

    let generators = [...active].filter(v => roles[v] === "generator" && supply[v] > 1e-9);
    let consumers = [...active].filter(v => roles[v] === "consumer" && demand[v] > 1e-9);
    consumers.sort((a, b) => {
      const pa = PRIORITY_RANK[priorities[a] || "normal"] ?? 2;
      const pb = PRIORITY_RANK[priorities[b] || "normal"] ?? 2;
      return pa - pb;
    });
    rng.shuffle(generators);

    const served = {};

    for (const consumer of consumers) {
      let need = demand[consumer];
      const initialNeed = need;
      while (need > 1e-9) {
        const src = generators
          .filter(g => supply[g] > 1e-9)
          .sort((a, b) => supply[b] - supply[a])[0];
        if (src === undefined) break;
        const path = H.shortestPath(src, consumer);
        if (!path) break;
        const pathCap = maxPushOnPath(path, edgeFlow, edgeCapacity);
        const amount = Math.min(supply[src], need, pathCap);
        if (amount < 1e-9) break;
        for (let i = 0; i < path.length - 1; i++) {
          addFlow(path[i], path[i + 1], amount);
        }
        supply[src] -= amount;
        need -= amount;
      }
      served[consumer] = initialNeed - need;
      if (need > 1e-9) failed.add(consumer);
    }

    for (const v of G.nodes()) {
      if (roles[v] === "consumer" && !served.hasOwnProperty(v)) {
        served[v] = 0;
      }
    }

    const surplus = {};
    for (const v of generators) {
      if (supply[v] > 1e-9) surplus[v] = supply[v];
    }

    const flowTuples = {};
    for (const [key, val] of Object.entries(edgeFlow)) {
      const [a, b] = key.split(",").map(Number);
      flowTuples[[a, b].join(",")] = val;
    }
    return { edgeFlow: flowTuples, surplus, failed, served };
  }

  function nodeBalance(G, production, consumption, edgeFlow, surplus) {
    const balance = {};
    const getF = (u, v) => {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      return edgeFlow[`${a},${b}`] || 0;
    };
    for (const v of G.nodes()) {
      let netIn = 0;
      for (const u of G.neighbors(v)) {
        const f = getF(u, v);
        const a = Math.min(u, v);
        const b = Math.max(u, v);
        netIn += v === b ? f : -f;
      }
      balance[v] =
        (production[v] || 0) + netIn - (consumption[v] || 0) - (surplus[v] || 0);
    }
    return balance;
  }

  function labelForVertex(v, roles, production, consumption, surplus) {
    const letter = LETTERS[v];
    const role = roles[v];
    if (role === "generator") return `${letter}\n${production[v]}-${Math.round(surplus[v] || 0)}`;
    if (role === "consumer") return `${letter}\n${consumption[v]}`;
    return letter;
  }

  function edgeLabel(u, v, f) {
    if (Math.abs(f) < 1e-9) return `${LETTERS[u]}${LETTERS[v]} 0`;
    if (f > 0) return `${LETTERS[u]}->${LETTERS[v]} ${Math.round(f)}`;
    return `${LETTERS[v]}->${LETTERS[u]} ${Math.round(Math.abs(f))}`;
  }

  function edgeDirection(u, v, f) {
    if (Math.abs(f) < 1e-9) return [u, v, false];
    const a = Math.min(u, v);
    const b = Math.max(u, v);
    if (f > 0) return [a, b, true];
    return [b, a, true];
  }

  function makeNodeColor(hex) {
    return {
      background: hex,
      border: hex,
      highlight: { background: hex, border: hex },
      hover: { background: hex, border: hex },
    };
  }

  function makeBlackNodeColor() {
    return makeNodeColor("#000000");
  }

  function springLayout(n, edges, seed, iterations, k) {
    const rng = new Random(seed);
    const pos = {};
    for (let v = 0; v < n; v++) {
      pos[v] = { x: (rng.random() - 0.5) * 2, y: (rng.random() - 0.5) * 2 };
    }
    for (let iter = 0; iter < iterations; iter++) {
      const disp = {};
      for (let v = 0; v < n; v++) disp[v] = { x: 0, y: 0 };
      for (let v = 0; v < n; v++) {
        for (let u = 0; u < n; u++) {
          if (u === v) continue;
          let dx = pos[v].x - pos[u].x;
          let dy = pos[v].y - pos[u].y;
          let dist = Math.hypot(dx, dy) || 0.01;
          let force = (k * k) / dist;
          disp[v].x += (dx / dist) * force;
          disp[v].y += (dy / dist) * force;
        }
      }
      for (const [u, v] of edges) {
        let dx = pos[v].x - pos[u].x;
        let dy = pos[v].y - pos[u].y;
        let dist = Math.hypot(dx, dy) || 0.01;
        let force = (dist * dist) / k;
        disp[v].x -= (dx / dist) * force;
        disp[v].y -= (dy / dist) * force;
        disp[u].x += (dx / dist) * force;
        disp[u].y += (dy / dist) * force;
      }
      const temp = 1 - iter / iterations;
      for (let v = 0; v < n; v++) {
        let d = Math.hypot(disp[v].x, disp[v].y) || 0.01;
        let lim = 0.1 * temp;
        pos[v].x += (disp[v].x / d) * Math.min(d, lim);
        pos[v].y += (disp[v].y / d) * Math.min(d, lim);
      }
    }
    return pos;
  }

  function spreadVisNodes(nodes, opts = {}) {
    const scale = opts.scale ?? 1.28;
    const minGap = opts.minGap ?? 14;
    const passes = opts.passes ?? 40;
    if (!nodes.length) return;
    let cx = 0;
    let cy = 0;
    for (const n of nodes) {
      cx += n.x;
      cy += n.y;
    }
    cx /= nodes.length;
    cy /= nodes.length;
    for (const n of nodes) {
      n.x = cx + (n.x - cx) * scale;
      n.y = cy + (n.y - cy) * scale;
    }
    const list = nodes.map(n => ({ n, x: n.x, y: n.y, r: (n.size || 38) / 2 }));
    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const need = a.r + b.r + minGap;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist < need) {
            const push = (need - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
          }
        }
      }
    }
    for (const item of list) {
      item.n.x = item.x;
      item.n.y = item.y;
    }
  }

  function spreadGeoNodeDisplays(nodes, seed, minSepDeg) {
    if (!nodes.length) return;
    const n = nodes.length;
    minSepDeg = minSepDeg ?? Math.max(0.06, 0.14 - n * 0.002);
    const parent = nodes.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => { parent[find(a)] = find(b); };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[i].lat - nodes[j].lat;
        const dy = nodes[i].lng - nodes[j].lng;
        if (Math.hypot(dx, dy) < minSepDeg) union(i, j);
      }
    }
    const groups = new Map();
    nodes.forEach((node, i) => {
      const g = find(i);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(node);
    });
    for (const group of groups.values()) {
      if (group.length === 1) {
        group[0].geo_lat = group[0].lat;
        group[0].geo_lng = group[0].lng;
        continue;
      }
      let clat = 0;
      let clng = 0;
      for (const node of group) {
        clat += node.lat;
        clng += node.lng;
      }
      clat /= group.length;
      clng /= group.length;
      const ringR = Math.min(0.2, 0.028 + group.length * 0.016);
      const sorted = [...group].sort((a, b) => a.id - b.id);
      sorted.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / sorted.length - Math.PI / 2;
        node.geo_lat = node.lat;
        node.geo_lng = node.lng;
        node.lat = clat + ringR * Math.cos(angle);
        node.lng = clng + ringR * Math.sin(angle);
      });
    }
  }

  function edgeLabelWithCapacity(u, v, f, cap) {
    const base = edgeLabel(u, v, f);
    const flow = Math.round(Math.abs(f));
    const c = Math.round(cap);
    const load = c > 0 ? Math.round((flow / c) * 100) : 0;
    return `${base}\n${flow}/${c} MW (${load}%)`;
  }

  function buildVisData(G, roles, production, consumption, edgeFlow, surplus, seed, disabled, failed, positions, disabledEdges, edgeCapacity, priorities, reinforcedEdges, newEdges, served) {
    disabled = disabled || new Set();
    failed = failed || new Set();
    disabledEdges = disabledEdges || new Set();
    edgeCapacity = edgeCapacity || {};
    priorities = priorities || {};
    reinforcedEdges = new Set(reinforcedEdges || []);
    newEdges = new Set(newEdges || []);
    served = served || {};
    const n = G.n;
    const k = Math.max(1.8, 3.0 / Math.max(n, 1));
    const defaultPos = springLayout(n, G.edges, seed, 80, k);
    const scale = n <= 6 ? 280 : 260;
    const sizeMap = n <= 6
      ? { generator: 44, consumer: 44, transit: 38 }
      : { generator: 44, consumer: 44, transit: 38 };
    const edgeFont = n <= 6 ? 12 : 13;

    const getPos = v => {
      if (positions) {
        if (positions[String(v)]) return positions[String(v)];
        if (positions[v]) return positions[v];
      }
      const p = defaultPos[v];
      return { x: p.x * scale, y: p.y * scale };
    };

    const nodes = [];
    for (const v of G.nodes()) {
      const { x, y } = getPos(v);
      const isOff = disabled.has(v);
      const isFailed = failed.has(v) && !isOff;
      let color, fontColor, borderWidth, nodeSize;

      if (isOff) {
        color = makeBlackNodeColor();
        fontColor = "#ffffff";
        borderWidth = 2;
        nodeSize = sizeMap[roles[v]];
      } else if (isFailed) {
        color = makeNodeColor("#bdbdbd");
        fontColor = "#ffffff";
        borderWidth = 2;
        nodeSize = sizeMap[roles[v]];
      } else {
        color = makeNodeColor(COLOR[roles[v]]);
        fontColor = "#ffffff";
        borderWidth = 2;
        nodeSize = sizeMap[roles[v]];
        if (roles[v] === "consumer" && priorities[v] === "critical") {
          color = {
            background: COLOR.consumer,
            border: "#FF9800",
            highlight: { background: COLOR.consumer, border: "#F57C00" },
            hover: { background: COLOR.consumer, border: "#F57C00" },
          };
          borderWidth = 4;
        }
      }

      const letter = LETTERS[v];
      let tooltip = labelForVertex(v, roles, production, consumption, surplus);
      if (roles[v] === "consumer" && priorities[v]) {
        const d = consumption[v] || 0;
        const sv = served[v] || 0;
        tooltip += `\n[${priorities[v]}] ${sv}/${d}`;
      }

      const node = {
        id: v,
        label: "",
        title: tooltip,
        letter,
        tooltip,
        shape: "dot",
        x,
        y,
        color,
        size: nodeSize,
        font: { size: 0, color: "rgba(0,0,0,0)" },
        borderWidth,
        disabled_manual: isOff,
        disabled_failed: isFailed,
        role: roles[v],
        role_color: COLOR[roles[v]],
        priority: priorities[v] || null,
        is_critical: priorities[v] === "critical",
      };
      if (isOff || isFailed) node.chosen = { node: false, label: false };
      nodes.push(node);
    }

    const inactive = new Set([...disabled, ...failed]);
    const edges = [];
    for (const [u, v] of G.edges) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      const ek = `${a},${b}`;
      const edgeOff = disabledEdges.has(ek);
      const offEdge = inactive.has(u) || inactive.has(v) || edgeOff;
      const f = offEdge ? 0 : edgeFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const violation = !offEdge && Math.abs(f) > cap + 1e-6;
      const [frm, to, arrow] = edgeDirection(u, v, f);
      const zeroFlow = Math.abs(f) < 1e-9;
      const isNew = newEdges.has(ek);
      const isReinforced = reinforcedEdges.has(ek);
      const dashed = offEdge || zeroFlow || isNew;
      const edge = {
        id: `${u}-${v}`,
        from: frm,
        to,
        label: edgeOff ? `${LETTERS[u]}—${LETTERS[v]} ✕` : edgeLabelWithCapacity(u, v, f, cap),
        font: { size: edgeFont, align: "middle", background: "rgba(255,255,255,0.85)" },
        color: {
          color: violation ? "#c62828" : edgeOff ? "#e65100" : offEdge ? "#bbbbbb" : zeroFlow ? "#aaaaaa" : isReinforced ? "#1565C0" : "#666666",
          highlight: violation ? "#b71c1c" : "#333333",
        },
        width: violation ? 4 : edgeOff ? 3 : isReinforced ? 3 : offEdge ? 1.5 : 2,
        smooth: { type: "continuous" },
        dashes: dashed ? [6, 8] : false,
        disabled_manual_edge: edgeOff,
        capacity_violation: violation,
        capacity_mw: cap,
        flow_mw: f,
        loading_percent: cap > 0 ? Math.round((Math.abs(f) / cap) * 1000) / 10 : 0,
        reinforced_edge: isReinforced,
        new_edge: isNew,
      };
      if (arrow && !offEdge) edge.arrows = "to";
      edges.push(edge);
    }
    return { nodes, edges };
  }

  function resolveGeoPos(v, geo, positions) {
    if (positions) {
      const p = positions[String(v)] ?? positions[v];
      if (p) {
        const lat = p.lat ?? p.y;
        const lng = p.lng ?? p.lon ?? p.x;
        return { lat, lng, x: lng, y: lat };
      }
    }
    const g = geo[String(v)] ?? geo[v];
    if (!g) return { lat: 0, lng: 0, x: 0, y: 0 };
    return { lat: g.lat, lng: g.lon, x: g.lon, y: g.lat };
  }

  function buildMapVisData(G, roles, production, consumption, edgeFlow, surplus, seed, disabled, failed, geo, positions, disabledEdges, edgeCapacity, priorities, reinforcedEdges, newEdges, served) {
    disabled = disabled || new Set();
    failed = failed || new Set();
    disabledEdges = disabledEdges || new Set();
    edgeCapacity = edgeCapacity || {};
    priorities = priorities || {};
    reinforcedEdges = new Set(reinforcedEdges || []);
    newEdges = new Set(newEdges || []);
    served = served || {};
    const sizeMap = { generator: 44, consumer: 44, transit: 38 };
    const edgeFont = 12;

    const nodes = [];
    for (const v of G.nodes()) {
      const { lat, lng, x, y } = resolveGeoPos(v, geo, positions);
      const isOff = disabled.has(v);
      const isFailed = failed.has(v) && !isOff;
      let color, fontColor, borderWidth, nodeSize;

      if (isOff) {
        color = makeBlackNodeColor();
        fontColor = "#ffffff";
        borderWidth = 2;
        nodeSize = sizeMap[roles[v]];
      } else if (isFailed) {
        color = makeNodeColor("#bdbdbd");
        fontColor = "#ffffff";
        borderWidth = 2;
        nodeSize = sizeMap[roles[v]];
      } else {
        color = makeNodeColor(COLOR[roles[v]]);
        fontColor = "#ffffff";
        borderWidth = 2;
        nodeSize = sizeMap[roles[v]];
        if (roles[v] === "consumer" && priorities[v] === "critical") {
          color = {
            background: COLOR.consumer,
            border: "#FF9800",
            highlight: { background: COLOR.consumer, border: "#F57C00" },
            hover: { background: COLOR.consumer, border: "#F57C00" },
          };
          borderWidth = 4;
        }
      }

      const g = geo[String(v)] ?? geo[v];
      const letter = LETTERS[v];
      let tooltip = labelForVertex(v, roles, production, consumption, surplus);
      if (roles[v] === "consumer" && priorities[v]) {
        const d = consumption[v] || 0;
        const sv = served[v] || 0;
        tooltip += `\n[${priorities[v]}] ${sv}/${d}`;
      }
      const node = {
        id: v,
        label: "",
        title: tooltip,
        letter,
        tooltip,
        shape: "dot",
        x,
        y,
        lat,
        lng,
        color,
        size: nodeSize,
        font: { size: 0, color: "rgba(0,0,0,0)" },
        borderWidth,
        disabled_manual: isOff,
        disabled_failed: isFailed,
        role: roles[v],
        role_color: COLOR[roles[v]],
        station_name: g?.name || "",
        oblast: g?.oblast || "",
        station_id: g?.station_id || "",
        priority: priorities[v] || null,
        is_critical: priorities[v] === "critical",
      };
      if (isOff || isFailed) node.chosen = { node: false, label: false };
      nodes.push(node);
    }

    const inactive = new Set([...disabled, ...failed]);
    const edges = [];
    for (const [u, v] of G.edges) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      const ek = `${a},${b}`;
      const edgeOff = disabledEdges.has(ek);
      const offEdge = inactive.has(u) || inactive.has(v) || edgeOff;
      const f = offEdge ? 0 : edgeFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const violation = !offEdge && Math.abs(f) > cap + 1e-6;
      const [frm, to, arrow] = edgeDirection(u, v, f);
      const zeroFlow = Math.abs(f) < 1e-9;
      const isNew = newEdges.has(ek);
      const isReinforced = reinforcedEdges.has(ek);
      const edge = {
        id: `${u}-${v}`,
        from: frm,
        to,
        label: edgeOff ? `${LETTERS[u]}—${LETTERS[v]} ✕` : edgeLabelWithCapacity(u, v, f, cap),
        font: { size: edgeFont, align: "middle", background: "rgba(255,255,255,0.85)" },
        color: {
          color: violation ? "#c62828" : edgeOff ? "#e65100" : offEdge ? "#bbbbbb" : zeroFlow ? "#aaaaaa" : isReinforced ? "#1565C0" : "#555555",
          highlight: "#333333",
        },
        width: violation ? 5 : edgeOff ? 4 : isReinforced ? 4 : offEdge ? 2 : 3,
        dashes: offEdge || zeroFlow || isNew ? [8, 10] : false,
        disabled_manual_edge: edgeOff,
        capacity_violation: violation,
        capacity_mw: cap,
        flow_mw: f,
        loading_percent: cap > 0 ? Math.round((Math.abs(f) / cap) * 1000) / 10 : 0,
        reinforced_edge: isReinforced,
        new_edge: isNew,
      };
      if (arrow && !offEdge) edge.arrows = "to";
      edges.push(edge);
    }
    return { nodes, edges };
  }

  function runMapChecks(G, roles, production, consumption, surplus, balances, params, disabled, failed) {
    disabled = disabled || new Set();
    failed = failed || new Set();
    const active = new Set(G.nodes().filter(v => !disabled.has(v) && !failed.has(v)));

    let genGen = false;
    let consCons = false;
    for (const [u, v] of G.edges) {
      if (roles[u] === "generator" && roles[v] === "generator") genGen = true;
      if (roles[u] === "consumer" && roles[v] === "consumer") consCons = true;
    }
    const activeBalances = [...active].filter(v => balances[v] !== undefined).map(v => balances[v]);
    const balOk = activeBalances.length ? activeBalances.every(b => Math.abs(b) < 1e-6) : true;

    const checks = [
      ["Граф связный", G.isConnected()],
      [`Сумма генерации = ${params.total_production}`, Object.values(production).reduce((a, b) => a + b, 0) === params.total_production],
      [`Сумма потребления = ${params.total_consumption}`, Object.values(consumption).reduce((a, b) => a + b, 0) === params.total_consumption],
      ["Балансы активных вершин сходятся", balOk],
      ["Источники не связаны между собой", !genGen],
      ["Потребители не связаны между собой", !consCons],
    ];
    if (disabled.size) checks.push([`Отключено вручную: ${disabled.size}`, true]);
    if (failed.size) checks.push([`Не обеспечены: ${failed.size}`, false]);
    else if (!disabled.size) {
      const s = Object.values(surplus).reduce((a, b) => a + b, 0);
      checks.push([`Сумма surplus = ${params.total_surplus}`, Math.abs(s - params.total_surplus) < 1e-6]);
    }
    return checks.map(([name, ok]) => ({ name, ok }));
  }

  function runChecks(G, roles, production, consumption, surplus, balances, params, disabled, failed) {
    disabled = disabled || new Set();
    failed = failed || new Set();
    const active = new Set(G.nodes().filter(v => !disabled.has(v) && !failed.has(v)));

    let genGen = false;
    let consCons = false;
    for (const [u, v] of G.edges) {
      if (roles[u] === "generator" && roles[v] === "generator") genGen = true;
      if (roles[u] === "consumer" && roles[v] === "consumer") consCons = true;
    }
    const degOk = G.nodes().every(v => G.degree(v) >= params.min_degree && G.degree(v) <= params.max_degree);
    const activeBalances = [...active].filter(v => balances[v] !== undefined).map(v => balances[v]);
    const balOk = activeBalances.length ? activeBalances.every(b => Math.abs(b) < 1e-6) : true;

    const checks = [
      ["Граф связный", G.isConnected()],
      [`Степени в [${params.min_degree}, ${params.max_degree}]`, degOk],
      [`Сумма генерации = ${params.total_production}`, Object.values(production).reduce((a, b) => a + b, 0) === params.total_production],
      [`Сумма потребления = ${params.total_consumption}`, Object.values(consumption).reduce((a, b) => a + b, 0) === params.total_consumption],
      ["Балансы активных вершин сходятся", balOk],
      ["Источники не связаны между собой", !genGen],
      ["Потребители не связаны между собой", !consCons],
    ];
    if (disabled.size) checks.push([`Отключено вручную: ${disabled.size}`, true]);
    if (failed.size) checks.push([`Не обеспечены: ${failed.size}`, false]);
    else if (!disabled.size) {
      const s = Object.values(surplus).reduce((a, b) => a + b, 0);
      checks.push([`Сумма surplus = ${params.total_surplus}`, Math.abs(s - params.total_surplus) < 1e-6]);
    }
    return checks.map(([name, ok]) => ({ name, ok }));
  }

  function nodeTooltipText(n) {
    return n.title || n.tooltip || n.label || "";
  }

  function nodeLetter(n) {
    return n.letter || nodeTooltipText(n).split("\n")[0] || String(n.id);
  }

  function buildPanel(nodes, edges) {
    const manual = [];
    const autoFailed = [];
    for (const n of nodes) {
      const letter = nodeLetter(n);
      const entry = { letter, label: nodeTooltipText(n).replace(/\n/g, " ") };
      if (n.disabled_manual) manual.push(entry);
      else if (n.disabled_failed) autoFailed.push(entry);
    }
    const flows = edges.map(e => e.label).filter(l => l && !l.endsWith(" 0")).sort();
    manual.sort((a, b) => a.letter.localeCompare(b.letter));
    autoFailed.sort((a, b) => a.letter.localeCompare(b.letter));
    return { manual_disabled: manual, failed: autoFailed, flows };
  }

  function evaluateState(state, disabled = new Set(), positions = null) {
    const G = stateToGraph(state);
    const params = state.params;
    initCapacityState(state, params.seed);
    const disabledEdges = edgeKeySet(state.disabled_edges);
    const { edgeFlow, surplus, failed, served } = computeFlowsFromState(G, state, disabled, disabledEdges);
    const balances = nodeBalance(G, state.production, state.consumption, edgeFlow, surplus);
    const feasibility = analyzeFeasibility(G, state, edgeFlow, failed, served, state.edge_capacity, state.priority);
    const reinforcedSet = new Set((state.reinforced_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const newSet = new Set((state.new_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const visExtra = [state.edge_capacity, state.priority, reinforcedSet, newSet, served];
    const isMap = !!(state.geo && Object.keys(state.geo).length);
    const { nodes, edges } = isMap
      ? buildMapVisData(
          G, state.roles, state.production, state.consumption,
          edgeFlow, surplus, params.seed, disabled, failed, state.geo, positions, disabledEdges, ...visExtra
        )
      : buildVisData(
          G, state.roles, state.production, state.consumption,
          edgeFlow, surplus, params.seed, disabled, failed, positions, disabledEdges, ...visExtra
        );
    const checks = isMap
      ? runMapChecks(G, state.roles, state.production, state.consumption, surplus, balances, params, disabled, failed)
      : runChecks(
          G, state.roles, state.production, state.consumption,
          surplus, balances, params, disabled, failed
        );
    if (disabledEdges.size) {
      checks.push({ name: `Отключено рёбер: ${disabledEdges.size}`, ok: true });
    }
    checks.push({
      name: `Допустимость (capacity + critical): ${feasibility.feasible ? "OK" : "INFEASIBLE"}`,
      ok: feasibility.feasible,
    });
    if (feasibility.critical_unserved_count > 0) {
      checks.push({ name: `Critical не покрыты: ${feasibility.critical_unserved_count}`, ok: false });
    }
    if (feasibility.capacity_violations_count > 0) {
      checks.push({ name: `Нарушения capacity: ${feasibility.capacity_violations_count}`, ok: false });
    }
    let activeConsumption = 0;
    for (const v of G.nodes()) {
      if (state.roles[v] === "consumer" && !disabled.has(v) && !failed.has(v)) {
        activeConsumption += state.consumption[v] || 0;
      }
    }
    const nextState = { ...state, disabled_edges: edgeKeyList(disabledEdges) };
    return {
      ok: true,
      nodes,
      edges,
      checks,
      state: stateToJson(nextState),
      disabled: [...disabled].sort((a, b) => a - b),
      disabled_edges: edgeKeyList(disabledEdges),
      failed: [...failed].sort((a, b) => a - b),
      summary: {
        vertices: params.n_vertices,
        production: params.total_production,
        consumption: params.total_consumption,
        surplus: params.total_surplus,
        edges_count: G.edgeCount(),
        disabled_count: disabled.size,
        disabled_edges_count: disabledEdges.size,
        failed_count: failed.size,
        served_consumption: activeConsumption,
        feasibility,
      },
      feasibility,
      panel: buildPanel(nodes, edges),
    };
  }

  function findWeakestVertex(state, baseDisabled = new Set()) {
    const G = stateToGraph(state);
    const params = state.params;
    const disabledEdges = edgeKeySet(state.disabled_edges);
    let bestV = 0;
    let bestFailed = new Set();
    let bestCount = -1;

    for (const v of G.nodes()) {
      if (baseDisabled.has(v)) continue;
      const trial = new Set(baseDisabled);
      trial.add(v);
      const { failed } = computeFlowsFromState(G, state, trial, disabledEdges);
      const failedConsumers = new Set([...failed].filter(f => state.roles[f] === "consumer"));
      const count = failedConsumers.size;
      if (count > bestCount || (count === bestCount && LETTERS[v] < LETTERS[bestV])) {
        bestV = v;
        bestFailed = failedConsumers;
        bestCount = count;
      }
    }

    return {
      vertex: bestV,
      letter: LETTERS[bestV],
      station_name: state.geo?.[String(bestV)]?.name || state.geo?.[bestV]?.name || "",
      role: state.roles[bestV],
      failed_count: bestCount,
      failed: [...bestFailed].sort((a, b) => a - b),
      failed_letters: [...bestFailed].sort((a, b) => a - b).map(f => LETTERS[f]),
    };
  }

  function findWeakestEdge(state, baseDisabled = new Set(), baseDisabledEdges = null) {
    const G = stateToGraph(state);
    const params = state.params;
    const disabledEdges = baseDisabledEdges || edgeKeySet(state.disabled_edges);
    let best = null;
    let bestFailed = new Set();
    let bestCount = -1;

    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (disabledEdges.has(ek)) continue;
      const trial = new Set(disabledEdges);
      trial.add(ek);
      const { failed } = computeFlowsFromState(G, state, baseDisabled, trial);
      const failedConsumers = new Set([...failed].filter(f => state.roles[f] === "consumer"));
      const count = failedConsumers.size;
      if (
        count > bestCount ||
        (count === bestCount && best && ek < best.edgeKey) ||
        (count === bestCount && !best)
      ) {
        best = { u, v, a: Math.min(u, v), b: Math.max(u, v), edgeKey: ek };
        bestFailed = failedConsumers;
        bestCount = count;
      }
    }

    if (!best) {
      return { u: 0, v: 0, edge: [0, 0], edgeKey: "0,0", label: "—", failed_count: 0, failed: [], failed_letters: [] };
    }

    return {
      u: best.u,
      v: best.v,
      edge: [best.a, best.b],
      edgeKey: best.edgeKey,
      label: `${LETTERS[best.u]}—${LETTERS[best.v]}`,
      letter_u: LETTERS[best.u],
      letter_v: LETTERS[best.v],
      failed_count: bestCount,
      failed: [...bestFailed].sort((a, b) => a - b),
      failed_letters: [...bestFailed].sort((a, b) => a - b).map(f => LETTERS[f]),
    };
  }

  function pickSolarStations(pool, count, seed) {
    const rng = new Random(seed);
    const eligible = pool.filter(s => s.lat != null && s.lon != null);
    if (eligible.length < count) {
      throw new Error(`Недостаточно СЕС с координатами: ${eligible.length} из ${count}`);
    }
    return rng.sample(eligible, count);
  }

  function generateFromSolarStations(pool, opts = {}) {
    const count = +opts.count || 21;
    const seed = +opts.seed || 42;
    if (count < 6) throw new Error("Минимум 6 станций");
    if (count > LETTERS.length) throw new Error(`Максимум ${LETTERS.length} станций на демо`);
    if (count % 3 !== 0) throw new Error("Число станций должно делиться на 3 (⅓ источники, ⅓ стоки, ⅓ транзит)");

    const stations = pickSolarStations(pool, count, seed);
    const n = stations.length;
    const third = n / 3;
    const roles = assignRoles(n, third, third, seed);

    const geo = {};
    stations.forEach((s, i) => {
      geo[String(i)] = {
        lat: s.lat,
        lon: s.lon,
        name: s.name || `СЕС ${i + 1}`,
        oblast: s.oblast || "",
        station_id: s.station_id || `ses-${i}`,
        capacity_mw: s.capacity_mw ?? null,
      };
    });

    const G = generateGeoGraph(n, roles, geo, seed);
    const rng = new Random(seed);

    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const totalProd = rng.randint(generators.length * 8, generators.length * 45);
    const totalCons = rng.randint(
      Math.max(consumers.length, Math.floor(totalProd * 0.5)),
      Math.max(consumers.length, Math.floor(totalProd * 0.82))
    );

    const productionList = splitTotal(totalProd, generators.length, rng);
    const consumptionList = splitTotal(totalCons, consumers.length, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));

    const params = {
      n_vertices: n,
      n_generators: third,
      n_consumers: third,
      n_transit: third,
      total_production: totalProd,
      total_consumption: totalCons,
      min_degree: 1,
      max_degree: 12,
      seed,
      mode: "map",
      get total_surplus() {
        return this.total_production - this.total_consumption;
      },
    };

    const state = {
      params,
      roles,
      edges: G.edges.map(e => [...e]),
      production,
      consumption,
      geo,
    };
    initCapacityState(state, seed);
    return evaluateState(state, new Set());
  }

  function generate(rawParams) {
    const params = parseParams(rawParams);
    validateParams(params);
    const rng = new Random(params.seed);
    const roles = assignRoles(params.n_vertices, params.n_generators, params.n_consumers, params.seed);
    const G = generateConnectedGraph(params.n_vertices, params.min_degree, params.max_degree, roles, params.seed);
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const productionList = splitTotal(params.total_production, params.n_generators, rng);
    const consumptionList = splitTotal(params.total_consumption, params.n_consumers, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));
    const state = {
      params,
      roles,
      edges: G.edges.map(e => [...e]),
      production,
      consumption,
    };
    initCapacityState(state, params.seed);
    return evaluateState(state, new Set());
  }

  function rebalance(stateJson, disabledList, positions) {
    const state = stateFromJson(stateJson);
    const disabled = new Set(disabledList.map(Number));
    return evaluateState(state, disabled, positions);
  }

  function showWeakest(stateJson, disabledList, positions) {
    const state = stateFromJson(stateJson);
    const disabled = new Set((disabledList || []).map(Number));
    const weakest = findWeakestVertex(state, disabled);
    const trial = new Set(disabled);
    trial.add(weakest.vertex);
    const result = evaluateState(state, trial, positions);
    result.weakest = weakest;
    return result;
  }

  function showWeakestEdge(stateJson, disabledList, positions) {
    const state = stateFromJson(stateJson);
    const disabled = new Set((disabledList || []).map(Number));
    const disabledEdges = edgeKeySet(state.disabled_edges);
    const weakest = findWeakestEdge(state, disabled, disabledEdges);
    if (!weakest || weakest.edgeKey === "0,0") {
      throw new Error("Нет рёбер для отключения");
    }
    const nextEdges = new Set(disabledEdges);
    nextEdges.add(weakest.edgeKey);
    const nextState = { ...state, disabled_edges: edgeKeyList(nextEdges) };
    const result = evaluateState(nextState, disabled, positions);
    result.weakest_edge = weakest;
    return result;
  }

  function cloneState(state) {
    return stateFromJson(stateToJson(state));
  }

  function worstFailureDamage(state) {
    const G = stateToGraph(state);
    const params = state.params;
    const roles = state.roles;
    const disabledEdges = edgeKeySet(state.disabled_edges);
    let maxDamage = 0;

    for (const v of G.nodes()) {
      const { failed } = computeFlowsFromState(G, state, new Set([v]), disabledEdges);
      const count = [...failed].filter(f => roles[f] === "consumer").length;
      if (count > maxDamage) maxDamage = count;
    }

    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (disabledEdges.has(ek)) continue;
      const trialEdges = new Set(disabledEdges);
      trialEdges.add(ek);
      const { failed } = computeFlowsFromState(G, state, new Set(), trialEdges);
      const count = [...failed].filter(f => roles[f] === "consumer").length;
      if (count > maxDamage) maxDamage = count;
    }
    return maxDamage;
  }

  function avgGeneratorProduction(state) {
    const gens = Object.keys(state.roles).filter(k => state.roles[k] === "generator");
    if (!gens.length) return 5;
    const total = gens.reduce((s, g) => s + (state.production[g] || 0), 0);
    return Math.max(1, Math.round(total / gens.length));
  }

  function scoreMissingEdge(G, roles, u, v) {
    const ru = roles[u];
    const rv = roles[v];
    let typeBonus = 1;
    if ((ru === "generator" && rv === "transit") || (ru === "transit" && rv === "generator")) typeBonus = 4;
    if ((ru === "transit" && rv === "consumer") || (ru === "consumer" && rv === "transit")) typeBonus = 4;
    if (ru === "transit" && rv === "transit") typeBonus = 2.5;
    return typeBonus + 2 / (1 + G.degree(u) + G.degree(v));
  }

  function missingEdgeCandidates(state, costs) {
    const G = stateToGraph(state);
    const roles = state.roles;
    const n = state.params.n_vertices;
    const cands = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        if (G.hasEdge(u, v) || !edgeAllowed(u, v, roles)) continue;
        cands.push({
          type: "edge",
          cost: costs.edge,
          u,
          v,
          id: `edge:${edgeKey(u, v)}`,
          score: scoreMissingEdge(G, roles, u, v),
        });
      }
    }
    cands.sort((a, b) => b.score - a.score || a.u - b.u || a.v - b.v);
    return cands.slice(0, 10);
  }

  function transitNodeCandidates(state, costs, limit = 4) {
    const G = stateToGraph(state);
    const roles = state.roles;
    const n = state.params.n_vertices;
    if (n >= LETTERS.length) return [];
    const raw = [];
    const transits = [...Array(n).keys()].filter(v => roles[v] === "transit");
    for (let i = 0; i < transits.length; i++) {
      for (let j = i + 1; j < transits.length; j++) {
        const u = transits[i];
        const v = transits[j];
        raw.push({ u, v, score: (G.hasEdge(u, v) ? 1 : 3) + 1 / (1 + G.degree(u) + G.degree(v)) });
      }
    }
    for (const t of transits) {
      for (let v = 0; v < n; v++) {
        if (v === t || G.hasEdge(t, v) || !edgeAllowed(t, v, roles) || roles[v] === "transit") continue;
        raw.push({ u: t, v, score: 2 + (roles[v] === "consumer" ? 2 : 1) });
      }
    }
    raw.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const out = [];
    for (const c of raw) {
      const id = `transit:${edgeKey(c.u, c.v)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: "transit", cost: costs.transit, u: c.u, v: c.v, id, score: c.score });
      if (out.length >= limit) break;
    }
    return out;
  }

  function generatorNodeCandidates(state, costs, limit = 2) {
    const G = stateToGraph(state);
    const roles = state.roles;
    const n = state.params.n_vertices;
    if (n >= LETTERS.length) return [];
    const transits = [...Array(n).keys()].filter(v => roles[v] === "transit");
    transits.sort((a, b) => G.degree(a) - G.degree(b));
    const prod = avgGeneratorProduction(state);
    const out = transits.slice(0, limit).map(t => ({
      type: "generator",
      cost: costs.generator,
      connect: t,
      production: prod,
      id: `gen:${t}`,
      score: 1 / (1 + G.degree(t)),
    }));
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function applyReinforcementAction(state, action) {
    if (action.type === "edge") {
      const G = stateToGraph(state);
      if (!G.hasEdge(action.u, action.v)) state.edges.push([action.u, action.v]);
      return;
    }
    const id = state.params.n_vertices;
    if (id >= LETTERS.length) return;
    state.params.n_vertices += 1;
    if (action.type === "transit") {
      state.params.n_transit += 1;
      state.roles[id] = "transit";
      state.edges.push([id, action.u], [id, action.v]);
      if (state.geo) {
        const gu = state.geo[String(action.u)] ?? state.geo[action.u];
        const gv = state.geo[String(action.v)] ?? state.geo[action.v];
        if (gu && gv) {
          state.geo[String(id)] = {
            lat: (gu.lat + gv.lat) / 2,
            lon: (gu.lon + gv.lon) / 2,
            name: `Транзит ${LETTERS[id]}`,
          };
        }
      }
    } else if (action.type === "generator") {
      state.params.n_generators += 1;
      state.params.total_production += action.production;
      state.roles[id] = "generator";
      state.production[id] = action.production;
      state.edges.push([id, action.connect]);
      if (state.geo) {
        const gt = state.geo[String(action.connect)] ?? state.geo[action.connect];
        if (gt) {
          state.geo[String(id)] = {
            lat: gt.lat + 0.08,
            lon: gt.lon + 0.08,
            name: `Источник ${LETTERS[id]}`,
          };
        }
      }
    }
  }

  function buildPlanDisplay(state, actions) {
    const applied = cloneState(state);
    const plan = [];
    for (const a of actions) {
      const idBefore = applied.params.n_vertices;
      if (a.type === "edge") {
        plan.push({
          type: "edge",
          cost: a.cost,
          text: `добавить ребро ${LETTERS[a.u]}—${LETTERS[a.v]}: ${a.cost}`,
          u: a.u,
          v: a.v,
        });
      } else if (a.type === "transit") {
        plan.push({
          type: "transit",
          cost: a.cost,
          text: `добавить транзит ${LETTERS[idBefore]}: ${a.cost}`,
          vertex: idBefore,
          u: a.u,
          v: a.v,
        });
      } else if (a.type === "generator") {
        plan.push({
          type: "generator",
          cost: a.cost,
          text: `добавить источник ${LETTERS[idBefore]}: ${a.cost}`,
          vertex: idBefore,
          connect: a.connect,
          production: a.production,
        });
      }
      applyReinforcementAction(applied, a);
    }
    return plan;
  }

  function greedyReinforcement(state, actions, budget) {
    const chosen = [];
    let cost = 0;
    let bestState = cloneState(state);
    let bestDamage = worstFailureDamage(state);
    const pool = actions.map(a => ({ ...a }));

    while (cost < budget && pool.length) {
      let pick = null;
      let pickState = null;
      let pickDamage = bestDamage;
      for (let i = 0; i < pool.length; i++) {
        const a = pool[i];
        if (cost + a.cost > budget) continue;
        const s = cloneState(bestState);
        applyReinforcementAction(s, a);
        const dmg = worstFailureDamage(s);
        if (dmg < pickDamage || (dmg === pickDamage && a.cost < (pick?.cost || Infinity))) {
          pick = a;
          pickState = s;
          pickDamage = dmg;
        }
      }
      if (!pick || pickDamage >= bestDamage) break;
      chosen.push({ ...pick });
      bestState = pickState;
      bestDamage = pickDamage;
      cost += pick.cost;
      const idx = pool.findIndex(x => x.id === pick.id);
      if (idx >= 0) pool.splice(idx, 1);
    }
    return { actions: chosen, damage: bestDamage, cost, state: bestState };
  }

  function searchReinforcementPlans(state, actions, budget, maxEval) {
    const damageCache = new Map();
    const stateSig = s =>
      `${s.params.n_vertices}|${s.edges.map(e => edgeKey(e[0], e[1])).sort().join(";")}|${s.params.total_production}`;

    function damageOf(s) {
      const key = stateSig(s);
      if (damageCache.has(key)) return damageCache.get(key);
      const d = worstFailureDamage(s);
      damageCache.set(key, d);
      return d;
    }

    let best = { actions: [], damage: damageOf(state), cost: 0, state: cloneState(state) };
    let evals = 0;

    function consider(chosen, s, cost) {
      if (++evals > maxEval) return;
      const dmg = damageOf(s);
      if (
        dmg < best.damage ||
        (dmg === best.damage && cost < best.cost) ||
        (dmg === best.damage && cost === best.cost && chosen.length < best.actions.length)
      ) {
        best = { actions: chosen.map(a => ({ ...a })), damage: dmg, cost, state: cloneState(s) };
      }
    }

    function dfs(i, cost, chosen, s) {
      if (evals > maxEval) return;
      consider(chosen, s, cost);
      if (i >= actions.length || cost >= budget) return;
      for (let j = i; j < actions.length; j++) {
        const a = actions[j];
        if (cost + a.cost > budget) continue;
        const next = cloneState(s);
        applyReinforcementAction(next, a);
        chosen.push(a);
        dfs(j + 1, cost + a.cost, chosen, next);
        chosen.pop();
      }
    }
    dfs(0, 0, [], cloneState(state));
    return { ...best, evaluated: evals };
  }

  function pickBestPlan(state, actions, budget) {
    const greedy = greedyReinforcement(state, actions, budget);
    const searched = searchReinforcementPlans(state, actions, budget, 1200);
    if (
      searched.damage < greedy.damage ||
      (searched.damage === greedy.damage && searched.cost < greedy.cost)
    ) {
      return { ...searched, evaluated: searched.evaluated, method: "search" };
    }
    return { ...greedy, evaluated: searched.evaluated, method: "greedy" };
  }

  function planReinforcement(stateJson, opts = {}) {
    const state = stateFromJson(stateJson);
    const budget = +opts.budget || 10;
    const costs = {
      edge: opts.cost_edge != null ? +opts.cost_edge : 1,
      transit: opts.cost_transit != null ? +opts.cost_transit : 3,
      generator: opts.cost_generator != null ? +opts.cost_generator : 5,
    };
    const damageBefore = worstFailureDamage(state);
    const actions = [
      ...missingEdgeCandidates(state, costs),
      ...transitNodeCandidates(state, costs),
      ...generatorNodeCandidates(state, costs),
    ];

    const best = pickBestPlan(state, actions, budget);
    const plan = buildPlanDisplay(state, best.actions);
    return {
      ok: true,
      budget,
      costs,
      damage_before: damageBefore,
      damage_after: best.damage,
      total_cost: best.cost,
      plan,
      plan_actions: best.actions.map(a => ({ ...a })),
      evaluated: best.evaluated,
      method: best.method,
      candidates: actions.length,
      state_after: stateToJson(best.state),
    };
  }

  function applyReinforcement(stateJson, planActions, positions) {
    const state = cloneState(stateFromJson(stateJson));
    for (const a of planActions || []) applyReinforcementAction(state, a);
    const result = evaluateState(state, new Set(), positions);
    result.reinforcement_applied = true;
    return result;
  }

  function optimizeReinforcement(stateJson, opts, positions) {
    const plan = planReinforcement(stateJson, opts);
    let result;
    if (plan.plan_actions.length) {
      result = applyReinforcement(stateJson, plan.plan_actions, positions);
    } else {
      result = evaluateState(stateFromJson(stateJson), new Set(), positions);
    }
    result.reinforcement = plan;
    return result;
  }

  const MAX_LARGE_VERTICES = 2000;

  function nodeName(v, n) {
    return n <= LETTERS.length && v < LETTERS.length ? LETTERS[v] : String(v);
  }

  function countRoles(roles) {
    let g = 0, c = 0, t = 0;
    for (const v of Object.keys(roles)) {
      if (roles[v] === "generator") g++;
      else if (roles[v] === "consumer") c++;
      else if (roles[v] === "transit") t++;
    }
    return { generators: g, consumers: c, transit: t };
  }

  function enrichSummary(summary, roles) {
    const rc = countRoles(roles);
    return { ...summary, ...rc };
  }

  function parseLargeParams(raw) {
    const n = +raw.n_vertices;
    const seed = +raw.seed || 42;
    const min_degree = +raw.min_degree || 2;
    const max_degree = +raw.max_degree || 6;
    const genPct = raw.gen_pct != null ? +raw.gen_pct : 20;
    const consPct = raw.cons_pct != null ? +raw.cons_pct : 50;
    let n_generators = raw.n_generators != null ? +raw.n_generators : Math.max(1, Math.round((n * genPct) / 100));
    let n_consumers = raw.n_consumers != null ? +raw.n_consumers : Math.max(1, Math.round((n * consPct) / 100));
    let n_transit = n - n_generators - n_consumers;
    if (n_transit < 1) {
      n_transit = 1;
      n_consumers = Math.max(1, n - n_generators - n_transit);
    }
    const prodPerGen = raw.prod_per_gen != null ? +raw.prod_per_gen : Math.max(5, Math.round(40 + n / 50));
    const consPerCon = raw.cons_per_con != null ? +raw.cons_per_con : Math.max(2, Math.round(8 + n / 100));
    const total_production = n_generators * prodPerGen;
    const total_consumption = Math.min(n_consumers * consPerCon, Math.floor(total_production * 0.85));
    return {
      n_vertices: n,
      n_generators,
      n_consumers,
      n_transit,
      total_production,
      total_consumption: Math.max(n_consumers, total_consumption),
      min_degree,
      max_degree,
      seed,
      mode: "large",
      scale: "large",
      get total_surplus() {
        return this.total_production - this.total_consumption;
      },
    };
  }

  function validateLargeParams(p) {
    if (p.n_vertices < 10) throw new Error("Large mode: минимум 10 вершин");
    if (p.n_vertices > MAX_LARGE_VERTICES) throw new Error(`Large mode: максимум ${MAX_LARGE_VERTICES} вершин`);
    if (p.n_generators < 1 || p.n_consumers < 1 || p.n_transit < 1) {
      throw new Error("Нужен хотя бы 1 генератор, 1 потребитель и 1 транзит");
    }
    if (p.total_production < p.total_consumption) {
      throw new Error("Производство должно быть не меньше потребления");
    }
    if (p.min_degree > p.max_degree) throw new Error("min_degree не может быть больше max_degree");
  }

  function connectGraphComponents(G, roles, rng) {
    const comps = [];
    const seen = new Set();
    for (const start of G.nodes()) {
      if (seen.has(start)) continue;
      const comp = [];
      const q = [start];
      seen.add(start);
      while (q.length) {
        const v = q.pop();
        comp.push(v);
        for (const u of G.neighbors(v)) {
          if (!seen.has(u)) {
            seen.add(u);
            q.push(u);
          }
        }
      }
      comps.push(comp);
    }
    for (let i = 1; i < comps.length; i++) {
      let linked = false;
      for (let t = 0; t < 40 && !linked; t++) {
        const u = rng.choice(comps[i - 1]);
        const v = rng.choice(comps[i]);
        if (!G.hasEdge(u, v) && edgeAllowed(u, v, roles)) {
          G.addEdge(u, v);
          linked = true;
        }
      }
      if (!linked) G.addEdge(comps[i - 1][0], comps[i][0]);
    }
  }

  function generateLargeConnectedGraph(n, minDeg, maxDeg, roles, seed) {
    const rng = new Random(seed);
    const G = new Graph(n);
    const transit = G.nodes().filter(v => roles[v] === "transit");
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");

    const backbone = transit.length ? transit : G.nodes();
    for (let i = 0; i < backbone.length; i++) {
      G.addEdge(backbone[i], backbone[(i + 1) % backbone.length]);
    }

    function tryAdd(u, v) {
      if (u === v || G.hasEdge(u, v) || !edgeAllowed(u, v, roles)) return false;
      if (G.degree(u) >= maxDeg || G.degree(v) >= maxDeg) return false;
      G.addEdge(u, v);
      return true;
    }

    for (const g of generators) {
      if (G.degree(g) < minDeg) {
        const pool = transit.length ? transit : G.nodes().filter(v => v !== g);
        tryAdd(g, rng.choice(pool));
      }
    }
    for (const c of consumers) {
      if (G.degree(c) < minDeg) {
        const pool = transit.length ? transit : G.nodes().filter(v => v !== c);
        tryAdd(c, rng.choice(pool));
      }
    }

    const target = Math.min(Math.floor(n * maxDeg / 2), n * 4);
    let attempts = 0;
    const maxAttempts = Math.max(n * 30, 5000);
    while (G.edgeCount() < target && attempts < maxAttempts) {
      attempts++;
      const u = rng.randint(0, n - 1);
      const v = rng.randint(0, n - 1);
      tryAdd(u, v);
    }

    for (let iter = 0; iter < n * 8; iter++) {
      const low = G.nodes().filter(v => G.degree(v) < minDeg);
      if (!low.length) break;
      const v = low[0];
      const u = rng.randint(0, n - 1);
      tryAdd(v, u);
    }

    if (!G.isConnected()) {
      connectGraphComponents(G, roles, rng);
    }
    return G;
  }

  function circleLayout(n, seed) {
    const rng = new Random(seed + 17);
    const pos = {};
    const layers = Math.max(1, Math.ceil(Math.sqrt(n / 12)));
    let idx = 0;
    for (let ring = 0; ring < layers && idx < n; ring++) {
      const inRing = ring === layers - 1 ? n - idx : Math.min(n - idx, Math.max(8, Math.round((2 * Math.PI * (ring + 1) * 6))));
      const r = (ring + 1) * (120 + Math.sqrt(n) * 8);
      for (let k = 0; k < inRing && idx < n; k++, idx++) {
        const angle = (2 * Math.PI * k) / inRing + rng.random() * 0.04;
        pos[idx] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      }
    }
    while (idx < n) {
      const angle = rng.random() * 2 * Math.PI;
      const r = layers * 140;
      pos[idx] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      idx++;
    }
    return pos;
  }

  function defaultRenderOpts(n) {
    return {
      labelMode: n > 100 ? "none" : "selected",
      flowThreshold: n > 300 ? 1 : 0,
      showZeroEdges: n <= 300,
      typeFilter: { generator: true, consumer: true, transit: true },
      statusFilter: { active: true, disabled: true, failed: true },
      highlightNodes: [],
      edgeMode: n > 300 ? "active" : "all",
    };
  }

  function passesNodeFilters(v, roles, disabled, failed, opts) {
    const role = roles[v];
    if (!opts.typeFilter[role]) return false;
    const isOff = disabled.has(v);
    const isFailed = failed.has(v) && !isOff;
    if (isOff && !opts.statusFilter.disabled) return false;
    if (isFailed && !opts.statusFilter.failed) return false;
    if (!isOff && !isFailed && !opts.statusFilter.active) return false;
    return true;
  }

  function buildLargeVisData(G, roles, production, consumption, edgeFlow, surplus, seed, disabled, failed, positions, disabledEdges, opts, edgeCapacity, priorities, reinforcedEdges, newEdges, served) {
    disabled = disabled || new Set();
    failed = failed || new Set();
    disabledEdges = disabledEdges || new Set();
    edgeCapacity = edgeCapacity || {};
    priorities = priorities || {};
    reinforcedEdges = new Set(reinforcedEdges || []);
    newEdges = new Set(newEdges || []);
    served = served || {};
    opts = opts || defaultRenderOpts(G.n);
    const n = G.n;
    const defaultPos = circleLayout(n, seed);
    const highlights = new Set(opts.highlightNodes || []);
    const nodeSize = n > 500 ? 5 : n > 200 ? 7 : n > 100 ? 10 : 14;
    const labelMode = opts.labelMode || "none";

    const getPos = v => {
      if (positions) {
        const p = positions[String(v)] ?? positions[v];
        if (p) return { x: p.x, y: p.y };
      }
      return defaultPos[v];
    };

    const nodes = [];
    for (const v of G.nodes()) {
      if (!passesNodeFilters(v, roles, disabled, failed, opts)) continue;
      const { x, y } = getPos(v);
      const isOff = disabled.has(v);
      const isFailed = failed.has(v) && !isOff;
      const showLabel = false;
      let color;
      if (isOff) color = makeBlackNodeColor();
      else if (isFailed) color = makeNodeColor("#bdbdbd");
      else color = makeNodeColor(COLOR[roles[v]]);
      if (roles[v] === "consumer" && priorities[v] === "critical") {
        color = {
          background: COLOR.consumer,
          border: "#FF9800",
          highlight: { background: COLOR.consumer, border: "#F57C00" },
          hover: { background: COLOR.consumer, border: "#F57C00" },
        };
      }

      let title = `${nodeName(v, n)} · ${roles[v]}`;
      if (roles[v] === "generator") title += `\n${production[v] || 0} MW`;
      if (roles[v] === "consumer") {
        const d = consumption[v] || 0;
        const sv = served[v] || 0;
        title += `\n${sv}/${d} MW`;
        if (priorities[v]) title += `\n[${priorities[v]}]`;
      }

      nodes.push({
        id: v,
        label: "",
        title,
        display_name: nodeName(v, n),
        show_label: showLabel,
        shape: "dot",
        x,
        y,
        color,
        size: nodeSize,
        font: { size: 0, color: "rgba(0,0,0,0)" },
        borderWidth: roles[v] === "consumer" && priorities[v] === "critical" ? 3 : isOff || isFailed ? 1 : 0.5,
        disabled_manual: isOff,
        disabled_failed: isFailed,
        role: roles[v],
        role_color: COLOR[roles[v]],
        priority: priorities[v] || null,
        is_critical: priorities[v] === "critical",
      });
    }

    const visibleIds = new Set(nodes.map(nd => nd.id));
    const inactive = new Set([...disabled, ...failed]);
    const edges = [];
    const edgeMode = opts.edgeMode || "all";
    for (const [u, v] of G.edges) {
      if (!visibleIds.has(u) || !visibleIds.has(v)) continue;
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      const ek = `${a},${b}`;
      const edgeOff = disabledEdges.has(ek);
      const offEdge = inactive.has(u) || inactive.has(v) || edgeOff;
      const f = offEdge ? 0 : edgeFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const violation = !offEdge && Math.abs(f) > cap + 1e-6;
      const zeroFlow = Math.abs(f) < 1e-9;
      const isNew = newEdges.has(ek);
      const isReinforced = reinforcedEdges.has(ek);
      if (edgeMode === "hidden") continue;
      if (edgeMode === "active" && zeroFlow && !edgeOff) continue;
      if (!opts.showZeroEdges && zeroFlow && !edgeOff) continue;
      if (Math.abs(f) < (opts.flowThreshold || 0) && !edgeOff) continue;
      const [frm, to, arrow] = edgeDirection(u, v, f);
      const edge = {
        id: `${u}-${v}`,
        from: frm,
        to,
        color: {
          color: violation ? "#c62828" : edgeOff ? "#e65100" : offEdge ? "#cccccc" : zeroFlow ? "#dddddd" : isReinforced ? "#1565C0" : "#888888",
          opacity: n > 500 ? 0.25 : 0.5,
        },
        width: violation ? 2.5 : edgeOff ? 2 : isReinforced ? 2 : n > 500 ? 0.5 : 1,
        dashes: isNew ? [4, 6] : false,
        disabled_manual_edge: edgeOff,
        capacity_violation: violation,
        capacity_mw: cap,
        flow_mw: f,
        loading_percent: cap > 0 ? Math.round((Math.abs(f) / cap) * 1000) / 10 : 0,
        reinforced_edge: isReinforced,
        new_edge: isNew,
      };
      if (arrow && !offEdge && n <= 200) edge.arrows = "to";
      edges.push(edge);
    }
    return { nodes, edges };
  }

  function buildLargeMapVisData(G, roles, production, consumption, edgeFlow, surplus, seed, disabled, failed, geo, positions, disabledEdges, opts, edgeCapacity, priorities, reinforcedEdges, newEdges, served) {
    disabled = disabled || new Set();
    failed = failed || new Set();
    disabledEdges = disabledEdges || new Set();
    edgeCapacity = edgeCapacity || {};
    priorities = priorities || {};
    reinforcedEdges = new Set(reinforcedEdges || []);
    newEdges = new Set(newEdges || []);
    served = served || {};
    opts = opts || defaultRenderOpts(G.n);
    const n = G.n;
    const highlights = new Set(opts.highlightNodes || []);

    const nodes = [];
    for (const v of G.nodes()) {
      if (!passesNodeFilters(v, roles, disabled, failed, opts)) continue;
      const { lat, lng } = resolveGeoPos(v, geo, positions);
      const isOff = disabled.has(v);
      const isFailed = failed.has(v) && !isOff;
      const g = geo[String(v)] ?? geo[v] ?? {};
      let title = g.name ? `${g.name} (#${v})` : `#${v} · ${roles[v]}`;
      if (roles[v] === "consumer" && priorities[v]) {
        const d = consumption[v] || 0;
        const sv = served[v] || 0;
        title += `\n[${priorities[v]}] ${sv}/${d} MW`;
      } else if (roles[v] === "generator") {
        title += `\n${production[v] || 0} MW`;
      }
      nodes.push({
        id: v,
        lat,
        lng,
        label: "",
        title,
        tooltip: title,
        disabled_manual: isOff,
        disabled_failed: isFailed,
        role: roles[v],
        role_color: COLOR[roles[v]],
        station_name: g.name || "",
        coord_source: g.coord_source || "OPEN_DATA",
        synthetic: !!g.synthetic,
        priority: priorities[v] || null,
        is_critical: priorities[v] === "critical",
      });
    }

    const visibleIds = new Set(nodes.map(nd => nodeId(nd.id)));
    const inactive = new Set([...disabled, ...failed]);
    const edges = [];
    const edgeMode = opts.edgeMode || "active";
    for (const [u, v] of G.edges) {
      if (!visibleIds.has(u) || !visibleIds.has(v)) continue;
      const ek = edgeKey(u, v);
      const edgeOff = disabledEdges.has(ek);
      const offEdge = inactive.has(u) || inactive.has(v) || edgeOff;
      const f = offEdge ? 0 : edgeFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const violation = !offEdge && Math.abs(f) > cap + 1e-6;
      const zeroFlow = Math.abs(f) < 1e-9;
      const isNew = newEdges.has(ek);
      const isReinforced = reinforcedEdges.has(ek);
      if (edgeMode === "hidden") continue;
      if (edgeMode === "active" && zeroFlow && !edgeOff) continue;
      if (Math.abs(f) < (opts.flowThreshold || 0) && !edgeOff) continue;
      const [frm, to] = edgeDirection(u, v, f);
      edges.push({
        id: `${u}-${v}`,
        from: frm,
        to,
        label: edgeOff ? "✕" : zeroFlow ? "" : `${Math.round(Math.abs(f))}/${Math.round(cap)}`,
        disabled_manual_edge: edgeOff,
        _flow: Math.abs(f),
        capacity_violation: violation,
        capacity_mw: cap,
        flow_mw: f,
        loading_percent: cap > 0 ? Math.round((Math.abs(f) / cap) * 1000) / 10 : 0,
        reinforced_edge: isReinforced,
        new_edge: isNew,
      });
    }
    return { nodes, edges };
  }

  function nodeId(raw) {
    return typeof raw === "string" ? parseInt(raw, 10) : raw;
  }

  function evaluateStateLarge(state, disabled = new Set(), positions = null, renderOpts = null) {
    const G = stateToGraph(state);
    const params = state.params;
    const n = params.n_vertices;
    initCapacityState(state, params.seed);
    const opts = renderOpts || defaultRenderOpts(n);
    const disabledEdges = edgeKeySet(state.disabled_edges);
    const { edgeFlow, surplus, failed, served } = computeFlowsFromState(G, state, disabled, disabledEdges);
    const feasibility = analyzeFeasibility(G, state, edgeFlow, failed, served, state.edge_capacity, state.priority);
    const reinforcedSet = new Set((state.reinforced_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const newSet = new Set((state.new_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const isMap = !!(state.geo && Object.keys(state.geo).length);
    const { nodes, edges } = isMap
      ? buildLargeMapVisData(G, state.roles, state.production, state.consumption, edgeFlow, surplus, params.seed, disabled, failed, state.geo, positions, disabledEdges, opts, state.edge_capacity, state.priority, reinforcedSet, newSet, served)
      : buildLargeVisData(G, state.roles, state.production, state.consumption, edgeFlow, surplus, params.seed, disabled, failed, positions, disabledEdges, opts, state.edge_capacity, state.priority, reinforcedSet, newSet, served);
    const nextState = { ...state, disabled_edges: edgeKeyList(disabledEdges) };
    let activeConsumption = 0;
    for (const v of G.nodes()) {
      if (state.roles[v] === "consumer" && !disabled.has(v) && !failed.has(v)) {
        activeConsumption += state.consumption[v] || 0;
      }
    }
    const rc = countRoles(state.roles);
    return {
      ok: true,
      nodes,
      edges,
      checks: [
        { name: `Large screening: ${n} узлов`, ok: true },
        { name: `Допустимость: ${feasibility.feasible ? "OK" : "INFEASIBLE"}`, ok: feasibility.feasible },
      ],
      state: stateToJson(nextState),
      disabled: [...disabled].sort((a, b) => a - b),
      disabled_edges: edgeKeyList(disabledEdges),
      failed: [...failed].sort((a, b) => a - b),
      render_opts: opts,
      summary: enrichSummary({
        vertices: n,
        production: params.total_production,
        consumption: params.total_consumption,
        surplus: params.total_surplus,
        edges_count: G.edgeCount(),
        disabled_count: disabled.size,
        disabled_edges_count: disabledEdges.size,
        failed_count: failed.size,
        served_consumption: activeConsumption,
        feasibility,
      }, state.roles),
      feasibility,
      panel: buildPanel(nodes, edges),
    };
  }

  function generateLarge(rawParams) {
    const params = parseLargeParams(rawParams);
    validateLargeParams(params);
    const rng = new Random(params.seed);
    const roles = assignRoles(params.n_vertices, params.n_generators, params.n_consumers, params.seed);
    const G = generateLargeConnectedGraph(params.n_vertices, params.min_degree, params.max_degree, roles, params.seed);
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const productionList = splitTotal(params.total_production, params.n_generators, rng);
    const consumptionList = splitTotal(params.total_consumption, params.n_consumers, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));
    const state = {
      params,
      roles,
      edges: G.edges.map(e => [...e]),
      production,
      consumption,
    };
    initCapacityState(state, params.seed);
    return evaluateStateLarge(state, new Set());
  }

  function rebalanceLarge(stateJson, disabledList, positions, renderOpts) {
    const state = stateFromJson(stateJson);
    return evaluateStateLarge(state, new Set(disabledList.map(Number)), positions, renderOpts);
  }

  function subsampleStep(n) {
    if (n > 800) return 3;
    if (n > 400) return 2;
    return 1;
  }

  function findWeakestVertexLarge(state, baseDisabled = new Set()) {
    const G = stateToGraph(state);
    const params = state.params;
    const n = G.n;
    const disabledEdges = edgeKeySet(state.disabled_edges);
    const step = subsampleStep(n);
    let bestV = 0;
    let bestFailed = new Set();
    let bestCount = -1;
    const vertices = G.nodes().filter(v => !baseDisabled.has(v));

    for (let i = 0; i < vertices.length; i += step) {
      const v = vertices[i];
      const trial = new Set(baseDisabled);
      trial.add(v);
      const { failed } = computeFlowsFromState(G, state, trial, disabledEdges);
      const failedConsumers = new Set([...failed].filter(f => state.roles[f] === "consumer"));
      const count = failedConsumers.size;
      if (count > bestCount || (count === bestCount && v < bestV)) {
        bestV = v;
        bestFailed = failedConsumers;
        bestCount = count;
      }
    }

    return {
      vertex: bestV,
      letter: nodeName(bestV, n),
      station_name: state.geo?.[String(bestV)]?.name || "",
      role: state.roles[bestV],
      failed_count: bestCount,
      failed: [...bestFailed].sort((a, b) => a - b),
      failed_letters: [...bestFailed].sort((a, b) => a - b).map(f => nodeName(f, n)),
      partial: step > 1,
      sample_step: step,
    };
  }

  function findWeakestEdgeLarge(state, baseDisabled = new Set(), baseDisabledEdges = null) {
    const G = stateToGraph(state);
    const params = state.params;
    const n = G.n;
    const disabledEdges = baseDisabledEdges || edgeKeySet(state.disabled_edges);
    const step = subsampleStep(n);
    let best = null;
    let bestFailed = new Set();
    let bestCount = -1;
    const edgeList = G.edges.filter(([u, v]) => !disabledEdges.has(edgeKey(u, v)));

    for (let i = 0; i < edgeList.length; i += step) {
      const [u, v] = edgeList[i];
      const ek = edgeKey(u, v);
      const trial = new Set(disabledEdges);
      trial.add(ek);
      const { failed } = computeFlowsFromState(G, state, baseDisabled, trial);
      const failedConsumers = new Set([...failed].filter(f => state.roles[f] === "consumer"));
      const count = failedConsumers.size;
      if (count > bestCount || (count === bestCount && best && ek < best.edgeKey)) {
        best = { u, v, a: Math.min(u, v), b: Math.max(u, v), edgeKey: ek };
        bestFailed = failedConsumers;
        bestCount = count;
      }
    }

    if (!best) {
      return { u: 0, v: 0, edge: [0, 0], edgeKey: "0,0", label: "—", failed_count: 0, failed: [], failed_letters: [], partial: false };
    }

    return {
      u: best.u,
      v: best.v,
      edge: [best.a, best.b],
      edgeKey: best.edgeKey,
      label: `${nodeName(best.u, n)}—${nodeName(best.v, n)}`,
      failed_count: bestCount,
      failed: [...bestFailed].sort((a, b) => a - b),
      failed_letters: [...bestFailed].sort((a, b) => a - b).map(f => nodeName(f, n)),
      partial: step > 1,
      sample_step: step,
    };
  }

  function showWeakestLarge(stateJson, disabledList, positions, renderOpts) {
    const state = stateFromJson(stateJson);
    const disabled = new Set((disabledList || []).map(Number));
    const weakest = findWeakestVertexLarge(state, disabled);
    const trial = new Set(disabled);
    trial.add(weakest.vertex);
    const opts = { ...(renderOpts || defaultRenderOpts(state.params.n_vertices)), highlightNodes: [weakest.vertex] };
    const result = evaluateStateLarge(state, trial, positions, opts);
    result.weakest = weakest;
    return result;
  }

  function showWeakestEdgeLarge(stateJson, disabledList, positions, renderOpts) {
    const state = stateFromJson(stateJson);
    const disabled = new Set((disabledList || []).map(Number));
    const disabledEdges = edgeKeySet(state.disabled_edges);
    const weakest = findWeakestEdgeLarge(state, disabled, disabledEdges);
    if (!weakest || weakest.edgeKey === "0,0") throw new Error("Нет рёбер для отключения");
    const nextEdges = new Set(disabledEdges);
    nextEdges.add(weakest.edgeKey);
    const nextState = { ...state, disabled_edges: edgeKeyList(nextEdges) };
    const opts = { ...(renderOpts || defaultRenderOpts(state.params.n_vertices)), highlightNodes: [weakest.u, weakest.v] };
    const result = evaluateStateLarge(nextState, disabled, positions, opts);
    result.weakest_edge = weakest;
    return result;
  }

  const UKRAINE_BBOX = { latMin: 44.18, latMax: 52.38, lonMin: 22.10, lonMax: 40.23 };
  const GEO_JITTER_DEG = 0.04;

  function normalizeGeoStation(s) {
    if (!s || typeof s !== "object") return null;
    const lat = s.lat ?? s.latitude;
    const lon = s.lon ?? s.lng ?? s.longitude;
    if (lat == null || lon == null || !Number.isFinite(+lat) || !Number.isFinite(+lon)) return null;
    return { ...s, lat: +lat, lon: +lon, type: s.type || "solar" };
  }

  function normalizeSolarPool(pool) {
    return (pool || []).map(normalizeGeoStation).filter(Boolean).filter(s => s.type === "solar");
  }

  function geoPassportFromStations(stations) {
    const sources = new Set(
      stations.map(s => s.coord_source || (s.synthetic ? "SYNTHETIC_DERIVED" : "OPEN_DATA"))
    );
    let coords = "OPEN_DATA";
    if (sources.has("SYNTHETIC_FALLBACK")) {
      coords = sources.size > 1 ? "OPEN_DATA / SYNTHETIC_FALLBACK" : "SYNTHETIC_FALLBACK";
    } else if (sources.has("SYNTHETIC_DERIVED")) {
      coords = sources.has("OPEN_DATA") ? "OPEN_DATA / SYNTHETIC_DERIVED" : "SYNTHETIC_DERIVED";
    }
    return { coords, links: "SYNTHETIC", capacity: "SYNTHETIC", model: "MATHEMATICAL SCREENING" };
  }

  function generateUkraineFallbackPoints(targetCount, rng) {
    const out = [];
    for (let i = 0; i < targetCount; i++) {
      out.push({
        station_id: `fallback-${i}`,
        name: `FALLBACK ${i}`,
        lat: UKRAINE_BBOX.latMin + rng.random() * (UKRAINE_BBOX.latMax - UKRAINE_BBOX.latMin),
        lon: UKRAINE_BBOX.lonMin + rng.random() * (UKRAINE_BBOX.lonMax - UKRAINE_BBOX.lonMin),
        oblast: "",
        type: "solar",
        coord_source: "SYNTHETIC_FALLBACK",
        synthetic: true,
      });
    }
    return out;
  }

  function deriveGeoPool(pool, targetCount, seed) {
    const rng = new Random(seed);
    const eligible = normalizeSolarPool(pool);
    if (!eligible.length) {
      const stations = generateUkraineFallbackPoints(targetCount, rng);
      return { stations, passport: geoPassportFromStations(stations) };
    }
    if (eligible.length >= targetCount) {
      const picked = rng.sample(eligible, targetCount);
      const stations = picked.map(s => ({ ...s, coord_source: "OPEN_DATA", synthetic: false }));
      return { stations, passport: geoPassportFromStations(stations) };
    }
    const out = [];
    for (const s of rng.shuffle([...eligible])) {
      out.push({ ...s, coord_source: "OPEN_DATA", synthetic: false });
    }
    while (out.length < targetCount) {
      const src = rng.choice(eligible);
      const jitter = () => (rng.random() - 0.5) * GEO_JITTER_DEG;
      out.push({
        ...src,
        station_id: `synth-${out.length}`,
        name: `SYNTH ${String(src.name || out.length).slice(0, 24)}`,
        lat: src.lat + jitter(),
        lon: src.lon + jitter(),
        type: "solar",
        coord_source: "SYNTHETIC_DERIVED",
        synthetic: true,
      });
    }
    return { stations: out, passport: geoPassportFromStations(out) };
  }

  function generateLargeGeo(pool, opts = {}) {
    const count = +opts.count || 300;
    const seed = +opts.seed || 42;
    if (count < 30) throw new Error("Минимум 30 станций для large geo");
    if (count > MAX_LARGE_VERTICES) throw new Error(`Максимум ${MAX_LARGE_VERTICES} станций`);
    const { stations, passport } = deriveGeoPool(pool, count, seed);
    const third = Math.floor(count / 3);
    const rem = count - third * 3;
    const nGen = third + (rem > 0 ? 1 : 0);
    const nCons = third + (rem > 1 ? 1 : 0);
    const nTransit = count - nGen - nCons;
    const roles = assignRoles(count, nGen, nCons, seed);
    const geo = {};
    stations.forEach((s, i) => {
      geo[String(i)] = {
        lat: s.lat,
        lon: s.lon,
        name: s.name || `СЕС ${i}`,
        oblast: s.oblast || "",
        station_id: s.station_id || `ses-${i}`,
        coord_source: s.coord_source,
        synthetic: s.synthetic,
      };
    });
    const G = generateGeoGraph(count, roles, geo, seed);
    const rng = new Random(seed);
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const totalProd = generators.length * Math.max(8, Math.round(20 + count / 80));
    const totalCons = Math.min(consumers.length * Math.max(4, Math.round(10 + count / 120)), Math.floor(totalProd * 0.82));
    const productionList = splitTotal(totalProd, generators.length, rng);
    const consumptionList = splitTotal(Math.max(consumers.length, totalCons), consumers.length, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));
    const params = {
      n_vertices: count,
      n_generators: nGen,
      n_consumers: nCons,
      n_transit: nTransit,
      total_production: totalProd,
      total_consumption: Math.max(consumers.length, totalCons),
      min_degree: 1,
      max_degree: 10,
      seed,
      mode: "large_map",
      scale: "large",
      get total_surplus() {
        return this.total_production - this.total_consumption;
      },
    };
    const state = { params, roles, edges: G.edges.map(e => [...e]), production, consumption, geo, passport };
    initCapacityState(state, seed);
    return evaluateStateLarge(state, new Set());
  }

  function formatCapacityActionText(state, action) {
    const n = state.params.n_vertices;
    if (action.type === "strengthen_edge") {
      return `усилить ребро ${nodeName(action.u, n)}-${nodeName(action.v, n)} на +${action.mw} MW, cost=${action.cost}`;
    }
    if (action.type === "add_edge") {
      return `добавить ребро ${nodeName(action.u, n)}-${nodeName(action.v, n)} ${action.mw} MW, cost=${action.cost}`;
    }
    if (action.type === "transit") {
      return `добавить транзит ${action.mw} MW (связь ${nodeName(action.u, n)}-${nodeName(action.v, n)}), cost=${action.cost}`;
    }
    if (action.type === "generator") {
      return `добавить генератор ${action.mw} MW, cost=${action.cost}`;
    }
    return action.type;
  }

  function applyCapacityReinforcementAction(state, action) {
    initCapacityState(state, state.params.seed);
    if (action.type === "strengthen_edge") {
      const k = edgeKey(action.u, action.v);
      state.edge_capacity[k] = (state.edge_capacity[k] || 10) + action.mw;
      if (!state.reinforced_edges.includes(k)) state.reinforced_edges.push(k);
      return;
    }
    if (action.type === "add_edge") {
      const G = stateToGraph(state);
      if (!G.hasEdge(action.u, action.v)) state.edges.push([action.u, action.v]);
      const k = edgeKey(action.u, action.v);
      state.edge_capacity[k] = action.mw;
      if (!state.new_edges.includes(k)) state.new_edges.push(k);
      return;
    }
    if (action.type === "transit") {
      if (state.params.n_vertices >= LETTERS.length) return;
      applyReinforcementAction(state, { type: "transit", u: action.u, v: action.v });
      const id = state.params.n_vertices - 1;
      const k1 = edgeKey(id, action.u);
      const k2 = edgeKey(id, action.v);
      const mw = action.mw || 10;
      state.edge_capacity[k1] = mw;
      state.edge_capacity[k2] = mw;
      if (!state.new_edges.includes(k1)) state.new_edges.push(k1);
      if (!state.new_edges.includes(k2)) state.new_edges.push(k2);
      return;
    }
    if (action.type === "generator") {
      if (state.params.n_vertices >= LETTERS.length) return;
      const mw = action.mw || action.production || 10;
      applyReinforcementAction(state, { type: "generator", connect: action.connect, production: mw });
      const id = state.params.n_vertices - 1;
      const k = edgeKey(id, action.connect);
      state.edge_capacity[k] = mw;
      if (!state.new_edges.includes(k)) state.new_edges.push(k);
    }
  }

  function buildCapacityPlanCandidates(state) {
    const G = stateToGraph(state);
    const costs = { edge: 1, transit: 3, generator: 5 };
    const cands = [];
    for (const [u, v] of G.edges) {
      for (const mw of [10, 20, 30]) {
        cands.push({ type: "strengthen_edge", u, v, mw, cost: blockCost(mw, 1), id: `se:${edgeKey(u, v)}:${mw}` });
      }
    }
    for (const c of missingEdgeCandidates(state, costs)) {
      for (const mw of [10, 20, 30]) {
        cands.push({ type: "add_edge", u: c.u, v: c.v, mw, cost: blockCost(mw, 1), id: `ae:${c.u},${c.v}:${mw}` });
      }
    }
    for (const c of transitNodeCandidates(state, costs, 6)) {
      for (const mw of [10, 20]) {
        cands.push({ type: "transit", u: c.u, v: c.v, mw, cost: blockCost(mw, 3), id: `tr:${c.id}:${mw}` });
      }
    }
    for (const c of generatorNodeCandidates(state, costs, 4)) {
      for (const mw of [10, 20, 30]) {
        cands.push({ type: "generator", connect: c.connect, mw, production: mw, cost: blockCost(mw, 5), id: `ge:${c.id}:${mw}` });
      }
    }
    return cands;
  }

  function countNewTopologyObjects(state, baseN) {
    return Math.max(0, state.params.n_vertices - baseN);
  }

  function planMinimalCapacityReinforcement(stateJson) {
    const state0 = cloneState(stateFromJson(stateJson));
    const before = evaluateFeasibilityState(state0);
    if (before.feasible) {
      return {
        feasible_already: true,
        before,
        after: before,
        plan: [],
        plan_actions: [],
        total_cost: 0,
        plan_display: [],
        state_after: stateToJson(state0),
      };
    }
    const candidates = buildCapacityPlanCandidates(state0);
    let state = cloneState(state0);
    const actions = [];
    let totalCost = 0;
    const used = new Set();
    const baseN = state0.params.n_vertices;
    for (let step = 0; step < 25; step++) {
      const cur = evaluateFeasibilityState(state);
      if (cur.feasible) break;
      let best = null;
      for (const cand of candidates) {
        if (used.has(cand.id)) continue;
        const trial = cloneState(state);
        applyCapacityReinforcementAction(trial, cand);
        const afterT = evaluateFeasibilityState(trial);
        const score = improvementScore(cur, afterT);
        if (score <= 0) continue;
        const newObjs = countNewTopologyObjects(trial, baseN);
        const eff = score / cand.cost;
        if (
          !best ||
          eff > best.eff + 1e-9 ||
          (Math.abs(eff - best.eff) < 1e-9 && afterT.served_total_mw > best.afterT.served_total_mw) ||
          (Math.abs(eff - best.eff) < 1e-9 && afterT.served_total_mw === best.afterT.served_total_mw && newObjs < best.newObjs) ||
          (Math.abs(eff - best.eff) < 1e-9 && afterT.served_total_mw === best.afterT.served_total_mw && newObjs === best.newObjs && cand.cost < best.cand.cost)
        ) {
          best = { cand, afterT, eff, newObjs };
        }
      }
      if (!best) break;
      applyCapacityReinforcementAction(state, best.cand);
      actions.push(best.cand);
      used.add(best.cand.id);
      totalCost += best.cand.cost;
    }
    const after = evaluateFeasibilityState(state);
    const plan = actions.map(a => ({ text: formatCapacityActionText(state0, a), cost: a.cost, type: a.type }));
    return {
      before,
      after,
      plan,
      plan_actions: actions,
      total_cost: totalCost,
      plan_display: plan,
      state_after: stateToJson(state),
      feasible_after: after.feasible,
    };
  }

  function optimizeCapacityReinforcement(stateJson, positions, renderOpts) {
    const plan = planMinimalCapacityReinforcement(stateJson);
    let result;
    const stateAfter = plan.state_after ? stateFromJson(plan.state_after) : stateFromJson(stateJson);
    const isLarge = stateAfter.params.scale === "large" || stateAfter.params.n_vertices > LETTERS.length;
    if (plan.plan_actions.length) {
      result = isLarge
        ? evaluateStateLarge(stateAfter, new Set(), positions, renderOpts)
        : evaluateState(stateAfter, new Set(), positions);
      result.reinforcement_applied = true;
    } else {
      const state = stateFromJson(stateJson);
      result = isLarge
        ? evaluateStateLarge(state, new Set(), positions, renderOpts)
        : evaluateState(state, new Set(), positions);
    }
    result.capacity_reinforcement = plan;
    return result;
  }

  // --- DC power flow (engineering screening, mode 5) ---

  const ENGINEERING_KV = [750, 330, 110];

  function engineeringNodeType(role, degree, rng) {
    if (role === "generator") return "generator";
    if (role === "consumer") return "load";
    if (degree >= 3 || rng.random() < 0.4) return "substation";
    return "bus";
  }

  function assignEngineeringVoltageAndTypes(state, seed) {
    const G = stateToGraph(state);
    const rng = new Random((seed >>> 0) + 404);
    const kv = {};
    const nodeTypes = {};
    for (const v of G.nodes()) {
      const role = state.roles[v];
      const deg = G.degree(v);
      const ntype = engineeringNodeType(role, deg, rng);
      nodeTypes[v] = ntype;
      if (role === "generator") {
        kv[v] = rng.random() < 0.35 ? 750 : 330;
      } else if (role === "consumer") {
        kv[v] = rng.random() < 0.65 ? 110 : 330;
      } else if (ntype === "substation") {
        kv[v] = rng.random() < 0.45 ? 750 : 330;
      } else {
        kv[v] = 110;
      }
    }
    state.voltage_level_kv = kv;
    state.node_types = nodeTypes;
    return { kv, nodeTypes };
  }

  function mergeEdgeCapacities(state, G, seed) {
    const rng = new Random((seed >>> 0) + 305);
    if (!state.edge_capacity) state.edge_capacity = {};
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (state.edge_capacity[ek] != null) continue;
      const et = state.edge_types?.[ek];
      if (et === "transformer") {
        const fromKv = state.edge_from_kv?.[ek] || 330;
        state.edge_capacity[ek] = fromKv >= 750 ? rng.randint(200, 600) : rng.randint(80, 320);
      } else {
        const lineKv = state.edge_voltage_kv?.[ek] || state.voltage_level_kv[u] || 110;
        state.edge_capacity[ek] = lineKv >= 750 ? rng.randint(400, 1200) : lineKv >= 330 ? rng.randint(120, 500) : rng.randint(30, 120);
      }
    }
  }

  function mergeEdgeReactance(state, G, seed) {
    const rng = new Random((seed >>> 0) + 306);
    if (!state.edge_reactance) state.edge_reactance = {};
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (state.edge_reactance[ek] != null) continue;
      const cap = state.edge_capacity?.[ek] || 100;
      const et = state.edge_types?.[ek];
      const base = et === "transformer"
        ? 0.12 + 18 / Math.max(cap, 40)
        : 0.04 + 12 / Math.max(cap, 8);
      state.edge_reactance[ek] = Math.round((base + rng.random() * 0.06) * 1000) / 1000;
    }
  }

  function injectTransformerEdges(state, seed) {
    const G = stateToGraph(state);
    const rng = new Random((seed >>> 0) + 707);
    const kv = state.voltage_level_kv;
    if (!state.edge_types) state.edge_types = {};
    if (!state.edge_from_kv) state.edge_from_kv = {};
    if (!state.edge_to_kv) state.edge_to_kv = {};
    if (!state.new_edges) state.new_edges = [];

    function tryAdd(u, v, fromKv, toKv) {
      if (u === v || G.hasEdge(u, v)) return false;
      const ek = edgeKey(u, v);
      state.edges.push([u, v]);
      G.addEdge(u, v);
      state.new_edges.push(ek);
      state.edge_types[ek] = "transformer";
      state.edge_from_kv[ek] = fromKv;
      state.edge_to_kv[ek] = toKv;
      return true;
    }

    const high = G.nodes().filter(v => kv[v] === 750);
    const med = G.nodes().filter(v => kv[v] === 330);
    const low = G.nodes().filter(v => kv[v] === 110);

    for (const h of high) {
      const targets = med.filter(m => !G.hasEdge(h, m));
      if (targets.length) tryAdd(h, rng.choice(targets), 750, 330);
    }
    for (const m of med) {
      if (state.node_types[m] !== "substation" && G.degree(m) < 3) continue;
      const targets = low.filter(l => !G.hasEdge(m, l));
      if (targets.length) tryAdd(m, rng.choice(targets), 330, 110);
    }
    for (const l of low) {
      if (state.node_types[l] !== "load") continue;
      const linked330 = med.some(m => G.hasEdge(m, l));
      if (!linked330 && med.length) tryAdd(rng.choice(med), l, 330, 110);
    }
  }

  function assignEngineeringEdgeTypes(state, G) {
    const kv = state.voltage_level_kv || {};
    if (!state.edge_types) state.edge_types = {};
    if (!state.edge_voltage_kv) state.edge_voltage_kv = {};
    if (!state.edge_from_kv) state.edge_from_kv = {};
    if (!state.edge_to_kv) state.edge_to_kv = {};
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (state.edge_types[ek] === "transformer" && state.edge_from_kv[ek]) continue;
      const ku = kv[u] ?? 110;
      const kvV = kv[v] ?? 110;
      if (ku === kvV) {
        state.edge_types[ek] = "line";
        state.edge_voltage_kv[ek] = ku;
      } else {
        const hi = Math.max(ku, kvV);
        const lo = Math.min(ku, kvV);
        state.edge_types[ek] = "transformer";
        state.edge_from_kv[ek] = hi;
        state.edge_to_kv[ek] = lo;
      }
    }
  }

  function repairTimeDaysLine(kv, rng) {
    if (kv >= 750) return rng.randint(14, 90);
    if (kv >= 330) return rng.randint(7, 30);
    return rng.randint(1, 7);
  }

  function repairTimeDaysTransformer(fromKv, rng) {
    if (fromKv >= 750) return rng.randint(180, 720);
    if (fromKv >= 330) return rng.randint(30, 180);
    return rng.randint(30, 180);
  }

  function assignEngineeringRepairTimes(state, G, seed) {
    const rng = new Random((seed >>> 0) + 808);
    const kv = state.voltage_level_kv || {};
    const nodeTypes = state.node_types || {};
    state.node_repair_time_days = state.node_repair_time_days || {};
    state.edge_repair_time_days = state.edge_repair_time_days || {};
    state.edge_replacement_cost = state.edge_replacement_cost || {};
    for (const v of G.nodes()) {
      const ntype = nodeTypes[v] || "bus";
      if (ntype === "generator") {
        state.node_repair_time_days[v] = rng.randint(7, 120);
      } else if (ntype === "load") {
        state.node_repair_time_days[v] = rng.randint(1, 14);
      } else if (ntype === "substation") {
        state.node_repair_time_days[v] = repairTimeDaysTransformer(kv[v] >= 750 ? 750 : 330, rng);
      } else {
        state.node_repair_time_days[v] = rng.randint(1, 7);
      }
    }
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (state.edge_types[ek] === "transformer") {
        const fromKv = state.edge_from_kv[ek] || 330;
        state.edge_repair_time_days[ek] = repairTimeDaysTransformer(fromKv, rng);
        state.edge_replacement_cost[ek] = fromKv >= 750
          ? rng.randint(8, 25) * 1_000_000
          : rng.randint(2, 12) * 1_000_000;
      } else {
        const lineKv = state.edge_voltage_kv[ek] || kv[u] || 110;
        state.edge_repair_time_days[ek] = repairTimeDaysLine(lineKv, rng);
      }
    }
  }

  function lostLoadMw(state, G, servedAfter, servedBefore, disabled = new Set()) {
    let lost = 0;
    for (const v of G.nodes()) {
      if (state.roles[v] !== "consumer" || disabled.has(v)) continue;
      const before = servedBefore[v] || 0;
      const after = servedAfter[v] || 0;
      lost += Math.max(0, before - after);
    }
    return Math.round(lost * 10) / 10;
  }

  function computeEngineeringRisk(state, G, disabled, disabledEdges, servedBefore) {
    const kv = state.voltage_level_kv || {};
    const nodeTypes = state.node_types || {};
    const nodeRepair = state.node_repair_time_days || {};
    const edgeRepair = state.edge_repair_time_days || {};
    const edgeTypes = state.edge_types || {};
    const objects = [];

    for (const v of G.nodes()) {
      if (disabled.has(v)) continue;
      const trialDisabled = new Set(disabled);
      trialDisabled.add(v);
      const { served } = computeFlowsFromState(G, state, trialDisabled, disabledEdges);
      const impact = lostLoadMw(state, G, served, servedBefore, trialDisabled);
      const repair = nodeRepair[v] || 1;
      const redundancy = 1 / Math.max(1, G.degree(v));
      const risk = Math.round(impact * repair * redundancy);
      objects.push({
        kind: "node",
        id: v,
        object: `${nodeName(v, G.n)} (#${v})`,
        type: nodeTypes[v] || "bus",
        voltage_kv: kv[v] ?? null,
        impact_mw: impact,
        repair_time_days: repair,
        redundancy_factor: Math.round(redundancy * 1000) / 1000,
        risk_score: risk,
        repair_time_source: "SYNTHETIC",
        risk_method: "simplified (1/degree)",
      });
    }

    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (disabled.has(u) || disabled.has(v) || disabledEdges.has(ek)) continue;
      const trialEdges = edgeKeySet(state.disabled_edges);
      trialEdges.add(ek);
      const { served } = computeFlowsFromState(G, state, disabled, trialEdges);
      const impact = lostLoadMw(state, G, served, servedBefore, disabled);
      const repair = edgeRepair[ek] || 1;
      const redundancy = 1 / Math.max(1, Math.min(G.degree(u), G.degree(v)));
      const risk = Math.round(impact * repair * redundancy);
      const et = edgeTypes[ek] || "line";
      const voltage = et === "transformer"
        ? `${state.edge_from_kv[ek] || "?"}→${state.edge_to_kv[ek] || "?"}`
        : String(state.edge_voltage_kv[ek] || kv[u] || "—");
      objects.push({
        kind: "edge",
        id: `${u}-${v}`,
        edgeKey: ek,
        u,
        v,
        object: `${nodeName(u, G.n)}—${nodeName(v, G.n)}`,
        type: et,
        voltage_kv: voltage,
        impact_mw: impact,
        repair_time_days: repair,
        redundancy_factor: Math.round(redundancy * 1000) / 1000,
        risk_score: risk,
        repair_time_source: "SYNTHETIC",
        risk_method: "simplified (1/degree)",
      });
    }

    objects.sort((a, b) => b.risk_score - a.risk_score || b.impact_mw - a.impact_mw);
    return objects;
  }

  function computeEngineeringRiskFast(state, G, disabled, disabledEdges, servedBefore, dcFlow = {}) {
    const kv = state.voltage_level_kv || {};
    const nodeTypes = state.node_types || {};
    const nodeRepair = state.node_repair_time_days || {};
    const edgeRepair = state.edge_repair_time_days || {};
    const edgeTypes = state.edge_types || {};
    const edgeCapacity = state.edge_capacity || {};
    const objects = [];

    for (const v of G.nodes()) {
      if (disabled.has(v)) continue;
      const role = state.roles[v];
      const baseImpact = role === "consumer"
        ? (state.consumption[v] || 0)
        : role === "generator"
          ? (state.production[v] || 0) * 0.5
          : Math.min(40, G.degree(v) * 2);
      const repair = nodeRepair[v] || 1;
      const redundancy = 1 / Math.max(1, G.degree(v));
      const risk = Math.round(baseImpact * repair * redundancy);
      objects.push({
        kind: "node",
        id: v,
        object: `${nodeName(v, G.n)} (#${v})`,
        type: nodeTypes[v] || assetTypeFromRole(role),
        voltage_kv: kv[v] ?? null,
        impact_mw: Math.round(baseImpact * 10) / 10,
        repair_time_days: repair,
        redundancy_factor: Math.round(redundancy * 1000) / 1000,
        risk_score: risk,
        repair_time_source: "SYNTHETIC",
        risk_method: "fast screening (degree/load)",
      });
    }

    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (disabled.has(u) || disabled.has(v) || disabledEdges.has(ek)) continue;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const f = Math.abs(dcFlow[ek] || 0);
      const loading = cap > 0 ? f / cap : 0;
      const impact = Math.round((loading * cap * 0.15 + loading * 25) * 10) / 10;
      const repair = edgeRepair[ek] || 1;
      const redundancy = 1 / Math.max(1, Math.min(G.degree(u), G.degree(v)));
      const risk = Math.round(impact * repair * redundancy);
      const et = edgeTypes[ek] || "line";
      const voltage = et === "transformer"
        ? `${state.edge_from_kv[ek] || "?"}→${state.edge_to_kv[ek] || "?"}`
        : String(state.edge_voltage_kv[ek] || kv[u] || "—");
      objects.push({
        kind: "edge",
        id: `${u}-${v}`,
        edgeKey: ek,
        u,
        v,
        object: `${nodeName(u, G.n)}—${nodeName(v, G.n)}`,
        type: et,
        voltage_kv: voltage,
        impact_mw: impact,
        repair_time_days: repair,
        redundancy_factor: Math.round(redundancy * 1000) / 1000,
        risk_score: risk,
        repair_time_source: "SYNTHETIC",
        risk_method: "fast screening (DC loading)",
      });
    }

    objects.sort((a, b) => b.risk_score - a.risk_score || b.impact_mw - a.impact_mw);
    return objects;
  }

  function assetTypeFromRole(role) {
    if (role === "generator") return "generator";
    if (role === "consumer") return "load";
    return "transit";
  }

  function assignSyntheticReactance(G, state, seed) {
    const rng = new Random((seed >>> 0) + 303);
    const x = {};
    for (const [u, v] of G.edges) {
      const cap = state.edge_capacity?.[edgeKey(u, v)];
      const base = cap ? 0.04 + 12 / Math.max(cap, 8) : 0.08 + rng.random() * 0.14;
      x[edgeKey(u, v)] = Math.round(base * 1000) / 1000;
    }
    return x;
  }

  function assignVoltageLevels(state, seed) {
    return assignEngineeringVoltageAndTypes(state, seed).kv;
  }

  function pickSlackNode(G, state, disabled) {
    disabled = disabled || new Set();
    const gens = G.nodes()
      .filter(v => state.roles[v] === "generator" && !disabled.has(v))
      .sort((a, b) => a - b);
    if (state.slack_node != null && gens.includes(state.slack_node)) return state.slack_node;
    return gens.length ? gens[0] : G.nodes().filter(v => !disabled.has(v)).sort((a, b) => a - b)[0] ?? 0;
  }

  function initEngineeringState(state, seed) {
    if (!state.engineering_attrs_ready) {
      assignEngineeringVoltageAndTypes(state, seed);
      injectTransformerEdges(state, seed);
      state.engineering_attrs_ready = true;
    }
    const G = stateToGraph(state);
    if (!state.edge_capacity) state.edge_capacity = assignSyntheticEdgeCapacities(G, state, seed);
    else mergeEdgeCapacities(state, G, seed);
    if (!state.edge_reactance) state.edge_reactance = assignSyntheticReactance(G, state, seed);
    else mergeEdgeReactance(state, G, seed);
    if (!state.priority) state.priority = assignConsumerPriorities(state, seed);
    assignEngineeringEdgeTypes(state, G);
    assignEngineeringRepairTimes(state, G, seed);
    state.slack_node = pickSlackNode(G, state, new Set());
    state.passport = {
      coords: state.passport?.coords || "SYNTHETIC",
      links: "SYNTHETIC",
      capacity: "SYNTHETIC",
      reactance: "SYNTHETIC",
      repair_time: "SYNTHETIC",
      risk_score: "SIMPLIFIED_SCREENING",
      model: "DC_POWER_FLOW_SCREENING",
    };
    if (!state.reinforced_edges) state.reinforced_edges = [];
    if (!state.new_edges) state.new_edges = [];
    return state;
  }

  function nodeInjectionMw(v, roles, production, consumption) {
    if (roles[v] === "generator") return production[v] || 0;
    if (roles[v] === "consumer") return -(consumption[v] || 0);
    return 0;
  }

  function solveLinearSystem(A, b) {
    const n = b.length;
    if (!n) return [];
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      if (Math.abs(M[pivot][col]) < 1e-11) return null;
      if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
      const div = M[col][col];
      for (let j = col; j <= n; j++) M[col][j] /= div;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = M[row][col];
        if (Math.abs(factor) < 1e-15) continue;
        for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
      }
    }
    return M.map(row => row[n]);
  }

  function solveDCPowerFlow(G, state, disabled = new Set(), disabledEdges = new Set()) {
    const roles = state.roles;
    const reactance = state.edge_reactance || {};
    const activeNodes = G.nodes().filter(v => !disabled.has(v)).sort((a, b) => a - b);
    if (activeNodes.length < 2) {
      return { solved: false, error: "Недостаточно активных узлов", slack: null, theta: {}, dcFlow: {}, injections: {} };
    }
    const slack = pickSlackNode(G, state, disabled);
    if (!activeNodes.includes(slack)) {
      return { solved: false, error: "Slack-узел отключён", slack, theta: {}, dcFlow: {}, injections: {} };
    }
    const activeEdges = G.edges.filter(([u, v]) => {
      const ek = edgeKey(u, v);
      return !disabled.has(u) && !disabled.has(v) && !disabledEdges.has(ek);
    });
    const idx = new Map(activeNodes.map((v, i) => [v, i]));
    const n = activeNodes.length;
    const B = Array.from({ length: n }, () => Array(n).fill(0));
    const injections = {};
    for (const v of activeNodes) injections[v] = nodeInjectionMw(v, roles, state.production, state.consumption);
    for (const [u, v] of activeEdges) {
      const x = reactance[edgeKey(u, v)] || 0.1;
      if (x < 1e-9) continue;
      const bij = 1 / x;
      const iu = idx.get(u);
      const iv = idx.get(v);
      B[iu][iu] += bij;
      B[iv][iv] += bij;
      B[iu][iv] -= bij;
      B[iv][iu] -= bij;
    }
    const unknown = activeNodes.filter(v => v !== slack);
    const m = unknown.length;
    const Br = Array.from({ length: m }, () => Array(m).fill(0));
    const Pr = Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      const vi = unknown[i];
      Pr[i] = injections[vi];
      for (let j = 0; j < m; j++) {
        Br[i][j] = B[idx.get(unknown[i])][idx.get(unknown[j])];
      }
    }
    const thetaPart = m ? solveLinearSystem(Br, Pr) : [];
    if (m && !thetaPart) {
      return { solved: false, error: "Сингулярная матрица B (сеть не связна?)", slack, theta: {}, dcFlow: {}, injections };
    }
    const theta = {};
    theta[slack] = 0;
    unknown.forEach((v, i) => { theta[v] = thetaPart[i]; });
    const dcFlow = {};
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      const off = disabled.has(u) || disabled.has(v) || disabledEdges.has(ek);
      if (off || theta[u] == null || theta[v] == null) {
        dcFlow[ek] = 0;
        continue;
      }
      const x = reactance[ek] || 0.1;
      dcFlow[ek] = (theta[u] - theta[v]) / x;
    }
    return { solved: true, error: null, slack, theta, dcFlow, injections };
  }

  function analyzeDCFeasibility(G, dcFlow, edgeCapacity, disabled = new Set(), disabledEdges = new Set()) {
    let capacityViolations = 0;
    let maxLoading = 0;
    const overCapacity = [];
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      if (disabled.has(u) || disabled.has(v) || disabledEdges.has(ek)) continue;
      const f = dcFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const loading = cap > 0 ? (Math.abs(f) / cap) * 100 : 0;
      if (Math.abs(f) > cap + 1e-6) {
        capacityViolations++;
        overCapacity.push({ edgeKey: ek, u, v, flow_mw: f, capacity_mw: cap, loading_percent: loading });
      }
      maxLoading = Math.max(maxLoading, loading);
    }
    return {
      capacity_violations_count: capacityViolations,
      max_loading_percent: Math.round(maxLoading * 10) / 10,
      over_capacity_edges: overCapacity,
      feasible: capacityViolations === 0,
    };
  }

  function engineeringEdgeLabel(u, v, mathF, dcF, cap, flowMode) {
    const m = Math.round(Math.abs(mathF));
    const d = Math.round(Math.abs(dcF) * 10) / 10;
    if (flowMode === "compare") return `${LETTERS[u]}—${LETTERS[v]} M${m}|D${d}`;
    if (flowMode === "dc") return `${LETTERS[u]}—${LETTERS[v]} ${d}/${Math.round(cap)}`;
    return edgeLabelWithCapacity(u, v, mathF, cap);
  }

  function engineeringGeoEdgeLabel(u, v, mathF, dcF, cap, flowMode, nVerts, edgeOff) {
    const nu = nodeName(u, nVerts);
    const nv = nodeName(v, nVerts);
    if (edgeOff) return `${nu}—${nv} ✕`;
    const m = Math.round(Math.abs(mathF));
    const d = Math.round(Math.abs(dcF) * 10) / 10;
    if (flowMode === "compare") return `${nu}—${nv} M${m}|D${d}`;
    if (flowMode === "dc") return `${nu}—${nv} ${d}/${Math.round(cap)}`;
    return `${nu}—${nv} ${m}/${Math.round(cap)}`;
  }

  function isEngineeringGeoState(state) {
    return !!(state.geo && typeof state.geo === "object" && Object.keys(state.geo).length);
  }

  function buildEngineeringMapVisData(G, state, mathFlow, surplus, failed, served, dcResult, flowMode, disabled, disabledEdges, geo, positions, seed, engOpts = {}) {
    const roles = state.roles;
    const production = state.production;
    const consumption = state.consumption;
    const edgeCapacity = state.edge_capacity || {};
    const reactance = state.edge_reactance || {};
    const priorities = state.priority || {};
    const reinforcedSet = new Set((state.reinforced_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const newSet = new Set((state.new_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const dcFlow = dcResult.dcFlow || {};
    const theta = dcResult.theta || {};
    const displayFlow = flowMode === "dc" ? dcFlow : mathFlow;
    const nVerts = G.n;
    const n1Outage = engOpts.n1OutageEdge || null;

    const base = buildMapVisData(
      G, roles, production, consumption, displayFlow, surplus, seed,
      disabled, failed, geo, positions, disabledEdges, edgeCapacity, priorities, reinforcedSet, newSet, served
    );
    if (!positions) spreadGeoNodeDisplays(base.nodes, seed);
    for (const node of base.nodes) {
      node.letter = node.letter || nodeName(node.id, nVerts);
    }
    enrichEngineeringVisObjects(
      base, G, state, roles, production, consumption, mathFlow, dcFlow, dcResult, flowMode,
      edgeCapacity, reactance, engOpts
    );
    for (const edge of base.edges) {
      const [u, v] = String(edge.id).split("-").map(Number);
      const ek = edgeKey(u, v);
      edge.n1_outage = n1Outage === ek;
      const df = dcFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      edge.dc_violation = !edge.disabled_manual_edge && Math.abs(df) > cap + 1e-6;
      if (edge.disabled_manual_edge && !edge.n1_outage) {
        edge.label = engineeringGeoEdgeLabel(u, v, mathFlow[ek] || 0, df, cap, flowMode, nVerts, true);
      }
    }
    return base;
  }

  function applyCascadeVisStyles(base, engOpts) {
    const c = engOpts?.cascade;
    if (!c) return;
    const initialEdge = c.initialOutageEdge;
    const initialNode = c.initialOutageNode;
    const initialEdges = new Set(c.initialOutageEdges || (initialEdge ? [initialEdge] : []));
    const initialNodes = new Set(c.initialOutageNodes || (initialNode != null ? [initialNode] : []));
    const tripped = new Set(c.cascadeTrippedEdges || []);

    for (const node of base.nodes) {
      const v = node.id;
      if (initialNodes.has(v)) {
        node.cascade_initial_outage = true;
        node.borderWidth = 5;
        node.color = {
          background: "#000000",
          border: "#000000",
          highlight: { background: "#333333", border: "#333333" },
        };
      }
      if (node.is_critical && node.disabled_failed) {
        node.cascade_critical_unserved = true;
        node.borderWidth = 5;
        node.color = {
          background: COLOR.consumer,
          border: "#FF5722",
          highlight: { background: COLOR.consumer, border: "#E64A19" },
        };
      }
    }

    for (const edge of base.edges) {
      const [u, v] = String(edge.id).split("-").map(Number);
      const ek = edgeKey(u, v);
      if (initialEdges.has(ek)) {
        edge.cascade_initial_outage = true;
        edge.color = { color: "#000000", highlight: "#333333" };
        edge.width = 5;
        edge.dashes = false;
        continue;
      }
      if (tripped.has(ek)) {
        edge.cascade_tripped = true;
        edge.color = { color: "#9e9e9e", highlight: "#757575" };
        edge.width = 2;
        edge.dashes = [6, 8];
        continue;
      }
      if (!edge.disabled_manual_edge && (edge.dc_loading_percent > (c.tripThreshold || 100) || edge.capacity_violation)) {
        edge.cascade_overload = true;
        edge.color = { color: "#FF9800", highlight: "#F57C00" };
        edge.width = 4;
      }
    }
  }

  function enrichEngineeringVisObjects(base, G, state, roles, production, consumption, mathFlow, dcFlow, dcResult, flowMode, edgeCapacity, reactance, engOpts = {}) {
    const riskByNode = engOpts.riskByNode;
    const riskByEdge = engOpts.riskByEdge;
    const kv = state.voltage_level_kv || {};
    const theta = dcResult.theta || {};
    for (const node of base.nodes) {
      const v = node.id;
      const role = roles[v];
      const ntype = state.node_types?.[v] ?? assetTypeFromRole(role);
      const ro = riskByNode?.get(v);
      node.asset_type = ntype;
      node.generation_mw = role === "generator" ? (production[v] || 0) : 0;
      node.load_mw = role === "consumer" ? (consumption[v] || 0) : 0;
      node.voltage_level_kv = kv[v] ?? kv[String(v)] ?? null;
      node.theta = theta[v] != null ? Math.round(theta[v] * 10000) / 10000 : null;
      node.is_slack = v === dcResult.slack;
      node.repair_time_days = state.node_repair_time_days?.[v] ?? null;
      node.repair_time_source = "SYNTHETIC";
      node.impact_mw = ro?.impact_mw ?? 0;
      node.risk_score = ro?.risk_score ?? 0;
      node.redundancy_factor = ro?.redundancy_factor ?? null;
      node.risk_method = ro?.risk_method || "simplified (1/degree)";
      if (node.is_slack) node.title += `\nSLACK · θ=0`;
      if (node.theta != null) node.title += `\nθ=${node.theta}`;
      if (node.voltage_level_kv) node.title += `\n${node.voltage_level_kv} kV · ${ntype}`;
      if (node.repair_time_days != null) node.title += `\nrepair ${node.repair_time_days}d (SYNTHETIC)`;
      if (node.risk_score) node.title += `\nrisk ${node.risk_score}`;
    }
    for (const edge of base.edges) {
      const [u, v] = String(edge.id).split("-").map(Number);
      const ek = edgeKey(u, v);
      const mf = mathFlow[ek] || 0;
      const df = dcFlow[ek] || 0;
      const cap = getEdgeCapacityMw(edgeCapacity, u, v);
      const x = reactance[ek] || 0.1;
      const ro = riskByEdge?.get(ek);
      const et = state.edge_types?.[ek] || "line";
      edge.edge_type = et;
      edge.reactance = x;
      edge.math_flow_mw = mf;
      edge.dc_flow_mw = df;
      edge.flow_difference = Math.round((df - mf) * 100) / 100;
      const showF = flowMode === "dc" ? df : mf;
      const dcLoading = cap > 0 ? Math.round((Math.abs(df) / cap) * 1000) / 10 : 0;
      edge.dc_loading_percent = dcLoading;
      const violation = !edge.disabled_manual_edge && Math.abs(flowMode === "dc" ? df : mf) > cap + 1e-6;
      edge.capacity_violation = violation;
      edge.flow_mw = showF;
      edge.loading_percent = cap > 0 ? Math.round((Math.abs(showF) / cap) * 1000) / 10 : 0;
      edge.capacity_mw = cap;
      edge.repair_time_days = state.edge_repair_time_days?.[ek] ?? null;
      edge.repair_time_source = "SYNTHETIC";
      edge.impact_mw = ro?.impact_mw ?? 0;
      edge.risk_score = ro?.risk_score ?? 0;
      edge.redundancy_factor = ro?.redundancy_factor ?? null;
      edge.risk_method = ro?.risk_method || "simplified (1/degree)";
      if (et === "transformer") {
        edge.from_voltage_kv = state.edge_from_kv?.[ek];
        edge.to_voltage_kv = state.edge_to_kv?.[ek];
        edge.voltage_label = `${edge.from_voltage_kv}→${edge.to_voltage_kv}`;
        edge.replacement_cost = state.edge_replacement_cost?.[ek];
        if (!edge.disabled_manual_edge && !violation) {
          edge.color = { color: "#7B1FA2", highlight: "#4A148C" };
          edge.dashes = [6, 10];
          edge.width = 3;
        }
      } else {
        edge.voltage_level_kv = state.edge_voltage_kv?.[ek] ?? kv[u] ?? null;
      }
      if (!edge.disabled_manual_edge) {
        const nVerts = G.n;
        const labelFn = nVerts > LETTERS.length
          ? (a, b, m, d, c, fm) => engineeringGeoEdgeLabel(a, b, m, d, c, fm, nVerts, false)
          : (a, b, m, d, c, fm) => engineeringEdgeLabel(a, b, m, d, c, fm);
        edge.label = engOpts.largeSchematic ? "" : labelFn(u, v, mf, df, cap, flowMode);
        if (flowMode === "compare") {
          edge.title = `math ${Math.round(mf)} MW · dc ${Math.round(df * 10) / 10} MW · Δ ${edge.flow_difference}`;
        } else if (flowMode === "dc") {
          const vtag = et === "transformer" ? edge.voltage_label : `${edge.voltage_level_kv} kV`;
          edge.title = `${nodeName(u, nVerts)}—${nodeName(v, nVerts)} · ${et} · ${vtag} · x=${x} · ${Math.round(df * 10) / 10}/${Math.round(cap)} MW · ${dcLoading}%`;
        }
      }
    }
    applyCascadeVisStyles(base, engOpts);
    return base;
  }

  function buildEngineeringLargeVisData(G, state, mathFlow, surplus, failed, served, dcResult, flowMode, disabled, disabledEdges, positions, seed, engOpts = {}) {
    const dcFlow = dcResult.dcFlow || {};
    const displayFlow = flowMode === "dc" ? dcFlow : mathFlow;
    const renderOpts = engOpts.renderOpts || defaultRenderOpts(G.n);
    const reinforcedSet = new Set((state.reinforced_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const newSet = new Set((state.new_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const built = buildLargeVisData(
      G, state.roles, state.production, state.consumption, displayFlow, surplus, seed,
      disabled, failed, positions, disabledEdges, renderOpts,
      state.edge_capacity, state.priority, reinforcedSet, newSet, served
    );
    return enrichEngineeringVisObjects(
      built, G, state, state.roles, state.production, state.consumption,
      mathFlow, dcFlow, dcResult, flowMode,
      state.edge_capacity, state.edge_reactance, { ...engOpts, largeSchematic: true }
    );
  }

  function buildEngineeringVisData(G, state, mathFlow, surplus, failed, served, dcResult, flowMode, disabled, disabledEdges, positions, seed, engOpts = {}) {
    const roles = state.roles;
    const production = state.production;
    const consumption = state.consumption;
    const edgeCapacity = state.edge_capacity || {};
    const reactance = state.edge_reactance || {};
    const priorities = state.priority || {};
    const reinforcedSet = new Set((state.reinforced_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const newSet = new Set((state.new_edges || []).map(k => (typeof k === "string" ? k : edgeKey(k[0], k[1]))));
    const dcFlow = dcResult.dcFlow || {};
    const displayFlow = flowMode === "dc" ? dcFlow : mathFlow;
    const base = buildVisData(
      G, roles, production, consumption, displayFlow, surplus, seed,
      disabled, failed, positions, disabledEdges, edgeCapacity, priorities, reinforcedSet, newSet, served
    );
    if (!positions) spreadVisNodes(base.nodes);
    return enrichEngineeringVisObjects(
      base, G, state, roles, production, consumption, mathFlow, dcFlow, dcResult, flowMode,
      edgeCapacity, reactance, engOpts
    );
  }

  function evaluateStateEngineering(state, disabled = new Set(), positions = null, engOpts = {}) {
    const G = stateToGraph(state);
    const params = state.params;
    const seed = params.seed;
    initEngineeringState(state, seed);
    const flowMode = engOpts.flowMode || "dc";
    const disabledEdges = edgeKeySet(state.disabled_edges);
    if (engOpts.cascadeDisabledEdgeSet) {
      for (const ek of engOpts.cascadeDisabledEdgeSet) disabledEdges.add(ek);
    }
    const { edgeFlow: mathFlow, surplus, failed, served } = computeFlowsFromState(G, state, disabled, disabledEdges);
    const mathFeas = analyzeFeasibility(G, state, mathFlow, failed, served, state.edge_capacity, state.priority);
    const dcResult = solveDCPowerFlow(G, state, disabled, disabledEdges);
    state.theta = dcResult.theta;
    state.slack_node = dcResult.slack;
    const dcFeas = analyzeDCFeasibility(G, dcResult.dcFlow || {}, state.edge_capacity, disabled, disabledEdges);
    const useFastRisk = params.n_vertices > 250;
    const riskObjects = engOpts.skipRisk && engOpts.cachedRisk
      ? engOpts.cachedRisk
      : useFastRisk
        ? computeEngineeringRiskFast(state, G, disabled, disabledEdges, served, dcResult.dcFlow || {})
        : computeEngineeringRisk(state, G, disabled, disabledEdges, served);
    const riskByNode = new Map();
    const riskByEdge = new Map();
    for (const o of riskObjects) {
      if (o.kind === "node") riskByNode.set(o.id, o);
      else riskByEdge.set(o.edgeKey, o);
    }
    const visEngOpts = { ...engOpts, riskByNode, riskByEdge };
    const isGeo = isEngineeringGeoState(state);
    const isLargeSchematic = !isGeo && (params.n_vertices > LETTERS.length || params.mode === "engineering_large");
    const largeRenderOpts = engOpts.renderOpts || defaultRenderOpts(params.n_vertices);
    const { nodes, edges } = isGeo
      ? buildEngineeringMapVisData(
        G, state, mathFlow, surplus, failed, served, dcResult, flowMode,
        disabled, disabledEdges, state.geo, positions, seed, visEngOpts
      )
      : isLargeSchematic
        ? buildEngineeringLargeVisData(
          G, state, mathFlow, surplus, failed, served, dcResult, flowMode,
          disabled, disabledEdges, positions, seed, { ...visEngOpts, renderOpts: largeRenderOpts }
        )
        : buildEngineeringVisData(
          G, state, mathFlow, surplus, failed, served, dcResult, flowMode,
          disabled, disabledEdges, positions, seed, visEngOpts
        );
    const balances = nodeBalance(G, state.production, state.consumption, mathFlow, surplus);
    const checks = isGeo
      ? runMapChecks(G, state.roles, state.production, state.consumption, surplus, balances, params, disabled, failed)
      : runChecks(G, state.roles, state.production, state.consumption, surplus, balances, params, disabled, failed);
    checks.push({
      name: `DC solved: ${dcResult.solved ? "yes" : "no"}${dcResult.error ? ` (${dcResult.error})` : ""}`,
      ok: dcResult.solved,
    });
    if (dcResult.slack != null) {
      checks.push({ name: `Slack: ${nodeName(dcResult.slack, params.n_vertices)} (#${dcResult.slack})`, ok: true });
    }
    checks.push({
      name: `DC max loading: ${dcFeas.max_loading_percent}%`,
      ok: dcFeas.capacity_violations_count === 0,
    });
    if (dcFeas.capacity_violations_count > 0) {
      checks.push({ name: `DC over capacity: ${dcFeas.capacity_violations_count} рёбер`, ok: false });
    }
    const nextState = { ...state, disabled_edges: edgeKeyList(disabledEdges) };
    return {
      ok: true,
      nodes,
      edges,
      checks,
      state: stateToJson(nextState),
      disabled: [...disabled].sort((a, b) => a - b),
      disabled_edges: edgeKeyList(disabledEdges),
      failed: [...failed].sort((a, b) => a - b),
      summary: enrichSummary({
        vertices: params.n_vertices,
        production: params.total_production,
        consumption: params.total_consumption,
        surplus: params.total_surplus,
        edges_count: G.edgeCount(),
        disabled_count: disabled.size,
        disabled_edges_count: disabledEdges.size,
        failed_count: failed.size,
        feasibility: mathFeas,
        dc_solved: dcResult.solved,
        dc_max_loading_percent: dcFeas.max_loading_percent,
        dc_capacity_violations: dcFeas.capacity_violations_count,
        slack_node: dcResult.slack,
      }, state.roles),
      feasibility: mathFeas,
      dc: {
        solved: dcResult.solved,
        error: dcResult.error,
        slack: dcResult.slack,
        feasibility: dcFeas,
        theta: dcResult.theta,
      },
      panel: buildPanel(nodes, edges),
      flow_mode: flowMode,
      engineering_metrics: {
        dc_solved: dcResult.solved,
        slack_node: dcResult.slack,
        slack_label: dcResult.slack != null ? nodeName(dcResult.slack, params.n_vertices) : null,
        max_loading_percent: dcFeas.max_loading_percent,
        capacity_violations: dcFeas.capacity_violations_count,
        total_generation: params.total_production,
        total_load: params.total_consumption,
      },
      engineering_risk: riskObjects,
      top_risk_objects: riskObjects.slice(0, 10),
      risk_disclaimer: "Engineering attributes are synthetic. Risk score is a simplified screening metric (redundancy ≈ 1/degree), not an operational assessment.",
    };
  }

  function mcObjectKey(obj) {
    if (obj.kind === "node") return `node:${obj.id}`;
    return `edge:${obj.edgeKey || obj.key}`;
  }

  function computeDamageScore(metrics) {
    return (
      (metrics.unserved_load_mw || 0)
      + (metrics.critical_unserved_count || 0) * 100
      + (metrics.failed_assets_count || 0) * 5
      + (metrics.cascade_steps || 0) * 2
    );
  }

  function buildMonteCarloAssetPool(state, G, protectedKeys = new Set()) {
    const n = G.n;
    const pool = [];
    for (const v of G.nodes()) {
      const key = `node:${v}`;
      if (protectedKeys.has(key)) continue;
      const role = state.roles[v];
      const atype = state.node_types?.[v] ?? assetTypeFromRole(role);
      pool.push({
        kind: "node",
        id: v,
        key,
        label: `${nodeName(v, n)} (#${v})`,
        type: atype,
      });
    }
    const edgeTypes = state.edge_types || {};
    for (const [u, v] of G.edges) {
      const ek = edgeKey(u, v);
      const key = `edge:${ek}`;
      if (protectedKeys.has(key)) continue;
      const et = edgeTypes[ek] || "line";
      pool.push({
        kind: "edge",
        edgeKey: ek,
        key,
        label: `${nodeName(u, n)}-${nodeName(v, n)}`,
        type: et,
      });
    }
    return pool;
  }

  function simulateScenarioCore(state, G, baseDisabled, userDisabledEdges, initialOutages, opts = {}) {
    const tripThreshold = +opts.tripThreshold || 120;
    const maxSteps = +opts.maxSteps || 10;
    const useCascade = opts.useCascade !== false;
    const workingDisabled = new Set(baseDisabled);
    const cascadeEdgeOff = new Set();
    const cascadeTrippedOnly = new Set();
    const initialOutageNodes = [];
    const initialOutageEdges = [];
    const n = G.n;
    const outageLabels = [];

    for (const o of initialOutages || []) {
      if (o.kind === "node") {
        workingDisabled.add(+o.id);
        initialOutageNodes.push(+o.id);
        outageLabels.push(o.label || `${nodeName(+o.id, n)} (#${+o.id})`);
      } else {
        const ek = o.edgeKey || o.key;
        cascadeEdgeOff.add(ek);
        initialOutageEdges.push(ek);
        const [u, v] = ek.split(",").map(Number);
        outageLabels.push(o.label || `${nodeName(u, n)}-${nodeName(v, n)}`);
      }
    }

    const timeline = outageLabels.length
      ? [{ step: 0, message: `initial outage ${outageLabels.join(", ")}` }]
      : [];

    let iteration = 0;
    let stable = false;
    let dcSolvedFinal = false;
    let stopReason = initialOutages?.length ? "unknown" : "no_outage";
    let lastDcFeas = { max_loading_percent: 0, capacity_violations_count: 0 };

    while (true) {
      const allOffEdges = new Set(userDisabledEdges);
      for (const ek of cascadeEdgeOff) allOffEdges.add(ek);

      const dcResult = solveDCPowerFlow(G, state, workingDisabled, allOffEdges);
      if (!dcResult.solved) {
        if (initialOutages?.length) {
          timeline.push({ step: iteration + 1, message: "DC solve failed — cascade stopped", dc_solved: false });
        }
        stopReason = "dc_failed";
        break;
      }
      dcSolvedFinal = true;
      lastDcFeas = analyzeDCFeasibility(G, dcResult.dcFlow || {}, state.edge_capacity, workingDisabled, allOffEdges);

      if (!useCascade || !initialOutages?.length) {
        stable = true;
        stopReason = useCascade ? "stable" : "dc_only";
        if (useCascade && initialOutages?.length) {
          const ovText = "none";
          timeline.push({ step: iteration + 1, message: `DC solved, overloads: ${ovText}`, overloads: [], dc_solved: true });
          timeline.push({ step: iteration + 1, message: "stable, no overloads" });
        }
        break;
      }

      const overloads = [];
      const dcFlow = dcResult.dcFlow || {};
      for (const [u, v] of G.edges) {
        const ek = edgeKey(u, v);
        if (workingDisabled.has(u) || workingDisabled.has(v) || allOffEdges.has(ek)) continue;
        const cap = getEdgeCapacityMw(state.edge_capacity, u, v);
        const f = dcFlow[ek] || 0;
        const loading = cap > 0 ? (Math.abs(f) / cap) * 100 : 0;
        if (loading > tripThreshold + 1e-6) {
          overloads.push({
            edgeKey: ek,
            u,
            v,
            loading_percent: Math.round(loading * 10) / 10,
            label: `${nodeName(u, n)}-${nodeName(v, n)}`,
          });
        }
      }

      const ovText = overloads.length
        ? overloads.map(o => `${o.label} ${o.loading_percent}%`).join(", ")
        : "none";
      timeline.push({
        step: iteration + 1,
        message: `DC solved, overloads: ${ovText}`,
        overloads: overloads.map(o => ({ ...o })),
        dc_solved: true,
      });

      if (!overloads.length) {
        stable = true;
        timeline.push({ step: iteration + 1, message: "stable, no overloads" });
        stopReason = "stable";
        break;
      }

      if (iteration >= maxSteps) {
        timeline.push({ step: iteration + 1, message: `max_steps (${maxSteps}) reached` });
        stopReason = "max_steps";
        break;
      }

      overloads.forEach(o => {
        cascadeEdgeOff.add(o.edgeKey);
        cascadeTrippedOnly.add(o.edgeKey);
      });
      timeline.push({
        step: iteration + 1,
        message: `tripped ${overloads.map(o => o.label).join(", ")}`,
        tripped: overloads.map(o => o.label),
      });
      iteration++;
    }

    const finalOffEdges = new Set(userDisabledEdges);
    for (const ek of cascadeEdgeOff) finalOffEdges.add(ek);
    const { failed, served } = computeFlowsFromState(G, state, workingDisabled, finalOffEdges);
    const { served: baseServed } = computeFlowsFromState(G, state, baseDisabled, userDisabledEdges);
    const unservedMw = Math.round(lostLoadMw(state, G, served, baseServed, workingDisabled) * 100) / 100;

    let criticalUnserved = 0;
    for (const v of G.nodes()) {
      if (state.roles[v] !== "consumer" || workingDisabled.has(v) || failed.has(v)) continue;
      if ((state.priority[v] || "") === "critical" && (served[v] || 0) < (state.consumption[v] || 0) - 1e-6) {
        criticalUnserved++;
      }
    }

    const failedAssets = workingDisabled.size + cascadeEdgeOff.size;
    const metrics = {
      cascade_steps: iteration,
      failed_assets_count: failedAssets,
      failed_edges: [...cascadeEdgeOff],
      failed_nodes: [...workingDisabled].sort((a, b) => a - b),
      max_loading_percent: lastDcFeas.max_loading_percent,
      capacity_violations_count: lastDcFeas.capacity_violations_count,
      unserved_load_mw: unservedMw,
      critical_unserved_count: criticalUnserved,
      dc_solved_final: dcSolvedFinal,
      stable,
      stop_reason: stopReason,
      trip_threshold: tripThreshold,
    };
    metrics.damage_score = Math.round(computeDamageScore(metrics) * 100) / 100;

    return {
      timeline,
      metrics,
      cascadeVis: {
        initialOutageNodes,
        initialOutageEdges,
        cascadeTrippedEdges: [...cascadeTrippedOnly],
        tripThreshold,
      },
      workingDisabled,
      cascadeEdgeOff,
      cascadeTrippedOnly,
      initialOutages: (initialOutages || []).map(o => ({ ...o })),
    };
  }

  function simulateMonteCarloRun(state, G, baseDisabled, userDisabledEdges, assetPool, mcOpts, runId) {
    const maxK = +mcOpts.maxOutagesPerScenario || 1;
    const rng = new Random((+mcOpts.seed || 42) + runId * 10007);
    const k = rng.randint(1, Math.max(1, maxK));
    const picks = assetPool.length ? rng.sample(assetPool, Math.min(k, assetPool.length)) : [];
    const initialOutages = picks.map(p => (
      p.kind === "node"
        ? { kind: "node", id: p.id, label: p.label, type: p.type }
        : { kind: "edge", edgeKey: p.edgeKey, label: p.label, type: p.type }
    ));

    const sim = simulateScenarioCore(state, G, baseDisabled, userDisabledEdges, initialOutages, {
      tripThreshold: mcOpts.tripThreshold,
      maxSteps: mcOpts.maxCascadeSteps || mcOpts.maxSteps || 10,
      useCascade: mcOpts.useCascade !== false,
    });

    return {
      run_id: runId,
      outaged_objects: initialOutages.map(o => ({
        kind: o.kind,
        id: o.id,
        edgeKey: o.edgeKey,
        label: o.label,
        type: o.type,
        key: mcObjectKey(o),
      })),
      outaged_objects_label: initialOutages.map(o => o.label).join(", ") || "—",
      ...sim.metrics,
      stable: !!sim.metrics.stable,
      timeline: sim.timeline,
      cascadeVis: sim.cascadeVis,
      initialOutages,
    };
  }

  function aggregateMonteCarloRuns(runs, topWorstN = 10) {
    if (!runs.length) {
      return {
        worst_scenarios: [],
        object_frequency: [],
        avg_damage_score: 0,
        top_worst_keys: new Set(),
      };
    }
    const sorted = [...runs].sort((a, b) => b.damage_score - a.damage_score);
    const worst = sorted.slice(0, topWorstN);
    const topWorstKeys = new Set();
    const freqMap = new Map();

    for (const run of worst) {
      for (const o of run.outaged_objects || []) {
        topWorstKeys.add(o.key || mcObjectKey(o));
      }
    }

    for (const run of runs) {
      for (const o of run.outaged_objects || []) {
        const key = o.key || mcObjectKey(o);
        if (!freqMap.has(key)) {
          freqMap.set(key, {
            key,
            object: o.label,
            type: o.type,
            frequency_in_worst: 0,
            critical_hits: 0,
            damage_sum: 0,
            damage_count: 0,
          });
        }
        const rec = freqMap.get(key);
        rec.damage_sum += run.damage_score;
        rec.damage_count++;
        if (topWorstKeys.has(key)) rec.frequency_in_worst++;
        if (run.critical_unserved_count > 0) rec.critical_hits++;
      }
    }

    const object_frequency = [...freqMap.values()]
      .map(r => ({
        key: r.key,
        object: r.object,
        type: r.type,
        frequency_in_worst: r.frequency_in_worst,
        critical_hits: r.critical_hits,
        avg_damage_score: Math.round((r.damage_sum / r.damage_count) * 100) / 100,
      }))
      .sort((a, b) => b.frequency_in_worst - a.frequency_in_worst || b.avg_damage_score - a.avg_damage_score);

    const avg_damage_score = Math.round(
      (runs.reduce((s, r) => s + r.damage_score, 0) / runs.length) * 100
    ) / 100;

    return { worst_scenarios: worst, object_frequency, avg_damage_score, top_worst_keys: topWorstKeys };
  }

  function runMonteCarloBatch(stateJson, baseDisabledList = [], engOpts = {}, mcOpts = {}, batchOpts = {}) {
    const startRun = +batchOpts.startRun || 0;
    const count = +batchOpts.count || 1;
    const totalRuns = +mcOpts.runs || 100;
    const endRun = Math.min(startRun + count, totalRuns);

    const state = stateFromJson(stateJson);
    initEngineeringState(state, state.params.seed);
    const G = stateToGraph(state);
    const baseDisabled = new Set(baseDisabledList.map(Number));
    const userDisabledEdges = edgeKeySet(state.disabled_edges);
    const protectedKeys = new Set(mcOpts.protectedKeys || []);
    const assetPool = buildMonteCarloAssetPool(state, G, protectedKeys);

    const newRuns = [];
    for (let runId = startRun; runId < endRun; runId++) {
      newRuns.push(simulateMonteCarloRun(state, G, baseDisabled, userDisabledEdges, assetPool, mcOpts, runId + 1));
    }

    return {
      runs: newRuns,
      progress: { completed: endRun, total: totalRuns },
      asset_pool_size: assetPool.length,
    };
  }

  function computeParetoRecommendations(stateJson, baseDisabledList = [], engOpts = {}, mcOpts = {}, baselineAggregate) {
    const topObjects = (baselineAggregate?.object_frequency || []).slice(0, 5);
    const baselineAvg = baselineAggregate?.avg_damage_score || 0;
    const paretoRuns = Math.min(+mcOpts.runs || 100, 200);
    const recommendations = [];

    for (const protectCount of [1, 3, 5]) {
      const protectedKeys = topObjects.slice(0, protectCount).map(o => o.key);
      if (!protectedKeys.length) {
        recommendations.push({
          protect_count: protectCount,
          protected_objects: [],
          damage_reduced_percent: 0,
          baseline_avg_damage: baselineAvg,
          protected_avg_damage: baselineAvg,
        });
        continue;
      }
      const allRuns = [];
      let start = 0;
      while (start < paretoRuns) {
        const batch = runMonteCarloBatch(stateJson, baseDisabledList, engOpts, {
          ...mcOpts,
          runs: paretoRuns,
          protectedKeys,
        }, { startRun: start, count: 50 });
        allRuns.push(...batch.runs);
        start = batch.progress.completed;
      }
      const agg = aggregateMonteCarloRuns(allRuns);
      const reduction = baselineAvg > 0
        ? Math.round(((baselineAvg - agg.avg_damage_score) / baselineAvg) * 1000) / 10
        : 0;
      recommendations.push({
        protect_count: protectCount,
        protected_objects: topObjects.slice(0, protectCount).map(o => o.object),
        damage_reduced_percent: Math.max(0, reduction),
        baseline_avg_damage: baselineAvg,
        protected_avg_damage: agg.avg_damage_score,
        pareto_runs: paretoRuns,
      });
    }
    return recommendations;
  }

  function previewMonteCarloScenario(stateJson, baseDisabledList = [], positions = null, engOpts = {}, scenarioRun = {}) {
    const state = stateFromJson(stateJson);
    initEngineeringState(state, state.params.seed);
    const G = stateToGraph(state);
    const baseDisabled = new Set(baseDisabledList.map(Number));
    const userDisabledEdges = edgeKeySet(state.disabled_edges);
    const initialOutages = scenarioRun.initialOutages
      || (scenarioRun.outaged_objects || []).map(o => (
        o.kind === "node"
          ? { kind: "node", id: o.id, label: o.label }
          : { kind: "edge", edgeKey: o.edgeKey, label: o.label }
      ));

    const sim = simulateScenarioCore(state, G, baseDisabled, userDisabledEdges, initialOutages, {
      tripThreshold: scenarioRun.trip_threshold || engOpts.tripThreshold || 120,
      maxSteps: scenarioRun.max_cascade_steps || 10,
      useCascade: scenarioRun.use_cascade !== false,
    });

    const result = evaluateStateEngineering(state, sim.workingDisabled, positions, {
      ...engOpts,
      flowMode: engOpts.flowMode || "dc",
      cascade: sim.cascadeVis,
      cascadeDisabledEdgeSet: sim.cascadeEdgeOff,
    });

    result.dc_cascade = {
      timeline: scenarioRun.timeline || sim.timeline,
      metrics: {
        ...sim.metrics,
        initial_outage: scenarioRun.outaged_objects_label || initialOutages.map(o => o.label).join(", "),
      },
      cascade_active: true,
      monte_carlo_preview: true,
      run_id: scenarioRun.run_id,
    };
    result.monte_carlo_scenario = scenarioRun;
    result.monte_carlo_disclaimer =
      "Monte Carlo demo on synthetic network. Damage score and Pareto recommendations are screening metrics, not operational decisions.";
    return result;
  }

  function runDCCascade(stateJson, baseDisabledList = [], positions = null, engOpts = {}, cascadeOpts = {}) {
    const tripThreshold = +cascadeOpts.tripThreshold || 120;
    const maxSteps = +cascadeOpts.maxSteps || 10;
    const initialOutage = cascadeOpts.initialOutage;
    if (!initialOutage || !initialOutage.kind) {
      throw new Error("Выберите стартовый отказ: кликните узел или линию на схеме");
    }

    const state = stateFromJson(stateJson);
    initEngineeringState(state, state.params.seed);
    const G = stateToGraph(state);
    const n = G.n;
    const baseDisabled = new Set(baseDisabledList.map(Number));
    const userDisabledEdges = edgeKeySet(state.disabled_edges);

    let initialLabel = "";
    if (initialOutage.kind === "node") {
      initialLabel = `${nodeName(initialOutage.id, n)} (#${initialOutage.id})`;
    } else {
      const ek = initialOutage.edgeKey || initialOutage.key;
      const [u, v] = ek.split(",").map(Number);
      initialLabel = `${nodeName(u, n)}-${nodeName(v, n)}`;
    }

    const sim = simulateScenarioCore(
      state, G, baseDisabled, userDisabledEdges,
      [{ ...initialOutage, label: initialLabel }],
      { tripThreshold, maxSteps, useCascade: true }
    );

    const result = evaluateStateEngineering(state, sim.workingDisabled, positions, {
      ...engOpts,
      flowMode: "dc",
      cascade: sim.cascadeVis,
      cascadeDisabledEdgeSet: sim.cascadeEdgeOff,
    });

    result.dc_cascade = {
      timeline: sim.timeline,
      metrics: {
        ...sim.metrics,
        initial_outage: initialLabel,
      },
      cascade_active: true,
    };
    result.cascade_disclaimer =
      "Cascade model is a simplified DC screening model. Synthetic parameters. Not an operational protection model.";
    return result;
  }

  function generateEngineeringGeo(pool, opts = {}) {
    const count = +opts.count || 30;
    const seed = +opts.seed || 42;
    if (count < 20) throw new Error("Минимум 20 станций для режима 6");
    if (count > 50) throw new Error("Максимум 50 станций для режима 6");
    const { stations, passport: geoPassport } = deriveGeoPool(pool, count, seed);
    const third = Math.floor(count / 3);
    const rem = count - third * 3;
    const nGen = third + (rem > 0 ? 1 : 0);
    const nCons = third + (rem > 1 ? 1 : 0);
    const nTransit = count - nGen - nCons;
    const roles = assignRoles(count, nGen, nCons, seed);
    const geo = {};
    stations.forEach((s, i) => {
      geo[String(i)] = {
        lat: s.lat,
        lon: s.lon,
        name: s.name || `СЕС ${i}`,
        oblast: s.oblast || "",
        station_id: s.station_id || `ses-${i}`,
        coord_source: s.coord_source,
        synthetic: s.synthetic,
      };
    });
    const G = generateGeoGraph(count, roles, geo, seed);
    const rng = new Random(seed);
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const totalProd = rng.randint(generators.length * 8, generators.length * 45);
    const totalCons = rng.randint(
      Math.max(consumers.length, Math.floor(totalProd * 0.5)),
      Math.max(consumers.length, Math.floor(totalProd * 0.82))
    );
    const productionList = splitTotal(totalProd, generators.length, rng);
    const consumptionList = splitTotal(totalCons, consumers.length, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));
    const params = {
      n_vertices: count,
      n_generators: nGen,
      n_consumers: nCons,
      n_transit: nTransit,
      total_production: totalProd,
      total_consumption: totalCons,
      min_degree: 1,
      max_degree: 12,
      seed,
      mode: "engineering_map",
      get total_surplus() {
        return this.total_production - this.total_consumption;
      },
    };
    const passport = {
      ...geoPassport,
      reactance: "SYNTHETIC",
      model: "DC_POWER_FLOW_SCREENING",
    };
    const state = {
      params,
      roles,
      edges: G.edges.map(e => [...e]),
      production,
      consumption,
      geo,
      passport,
    };
    initEngineeringState(state, seed);
    return evaluateStateEngineering(state, new Set(), null, opts);
  }

  function generateEngineering(rawParams, engOpts = {}) {
    const params = parseParams(rawParams);
    validateParams(params);
    params.mode = "engineering";
    const rng = new Random(params.seed);
    const roles = assignRoles(params.n_vertices, params.n_generators, params.n_consumers, params.seed);
    const G = generateConnectedGraph(params.n_vertices, params.min_degree, params.max_degree, roles, params.seed);
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const productionList = splitTotal(params.total_production, params.n_generators, rng);
    const consumptionList = splitTotal(params.total_consumption, params.n_consumers, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));
    const state = { params, roles, edges: G.edges.map(e => [...e]), production, consumption };
    initEngineeringState(state, params.seed);
    return evaluateStateEngineering(state, new Set(), null, engOpts);
  }

  function rebalanceEngineering(stateJson, disabledList, positions, engOpts) {
    const state = stateFromJson(stateJson);
    return evaluateStateEngineering(state, new Set(disabledList.map(Number)), positions, engOpts);
  }

  function rankN1Scenario(a, b) {
    if (b.dc_capacity_violations !== a.dc_capacity_violations) return b.dc_capacity_violations - a.dc_capacity_violations;
    if (b.dc_max_loading_percent !== a.dc_max_loading_percent) return b.dc_max_loading_percent - a.dc_max_loading_percent;
    return b.critical_unserved_count - a.critical_unserved_count;
  }

  function selectN1EdgeSample(G, state, baseDisabled) {
    const n = G.n;
    const all = G.edges;
    let maxEdges = all.length;
    if (n <= 100) return all;
    if (n <= 300) maxEdges = Math.min(80, all.length);
    else if (n <= 600) maxEdges = Math.min(50, all.length);
    else maxEdges = Math.min(30, all.length);
    if (all.length <= maxEdges) return all;

    let topEdgeKeys;
    if (n > 250) {
      const ranked = all
        .map(([u, v]) => ({ u, v, ek: edgeKey(u, v), score: G.degree(u) + G.degree(v) }))
        .sort((a, b) => b.score - a.score);
      topEdgeKeys = ranked.slice(0, Math.floor(maxEdges * 0.6)).map(e => e.ek);
    } else {
      const risk = computeEngineeringRisk(state, G, baseDisabled, edgeKeySet(state.disabled_edges), {});
      topEdgeKeys = risk.filter(o => o.kind === "edge").slice(0, Math.floor(maxEdges * 0.6)).map(o => o.edgeKey);
    }
    const picked = new Set(topEdgeKeys);
    const rng = new Random((state.params.seed || 0) + 7717);
    const rest = all.filter(([u, v]) => !picked.has(edgeKey(u, v)));
    rng.shuffle(rest);
    for (const [u, v] of rest) {
      if (picked.size >= maxEdges) break;
      picked.add(edgeKey(u, v));
    }
    return all.filter(([u, v]) => picked.has(edgeKey(u, v)));
  }

  function scanDcN1Scenarios(stateJson, disabledList = [], opts = {}) {
    const state = stateFromJson(stateJson);
    const baseDisabled = new Set(disabledList.map(Number));
    const G = stateToGraph(state);
    initEngineeringState(state, state.params.seed);
    const edgeList = opts.edgeList || (opts.fullScan ? G.edges : selectN1EdgeSample(G, state, baseDisabled));
    const sampled = edgeList.length < G.edges.length;
    const lite = G.n > 400;
    const scenarios = [];
    for (const [u, v] of edgeList) {
      const ek = edgeKey(u, v);
      const trialEdges = edgeKeySet(state.disabled_edges);
      trialEdges.add(ek);
      const dcResult = solveDCPowerFlow(G, state, baseDisabled, trialEdges);
      const dcFeas = analyzeDCFeasibility(G, dcResult.dcFlow || {}, state.edge_capacity, baseDisabled, trialEdges);
      let criticalUnserved = 0;
      if (!lite) {
        const { failed, served } = computeFlowsFromState(G, state, baseDisabled, trialEdges);
        for (const node of G.nodes()) {
          if (state.roles[node] !== "consumer" || baseDisabled.has(node) || failed.has(node)) continue;
          if ((state.priority[node] || "") === "critical" && (served[node] || 0) < (state.consumption[node] || 0) - 1e-6) {
            criticalUnserved++;
          }
        }
      }
      scenarios.push({
        edgeKey: ek,
        u,
        v,
        label: `${nodeName(u, G.n)}-${nodeName(v, G.n)}`,
        dc_solved: dcResult.solved,
        dc_capacity_violations: dcFeas.capacity_violations_count,
        dc_max_loading_percent: dcFeas.max_loading_percent,
        critical_unserved_count: criticalUnserved,
        over_capacity: dcFeas.over_capacity_edges.slice(0, 5),
      });
    }
    scenarios.sort(rankN1Scenario);
    return {
      scenarios,
      worst: scenarios[0] || null,
      sampled,
      edges_scanned: edgeList.length,
      edges_total: G.edges.length,
    };
  }

  function applyDcN1Scenario(stateJson, edgeKey, disabledList = [], positions = null, engOpts = {}) {
    const state = stateFromJson(stateJson);
    const trialEdges = edgeKeySet(state.disabled_edges);
    trialEdges.add(edgeKey);
    const stateTrial = { ...state, disabled_edges: edgeKeyList(trialEdges) };
    return evaluateStateEngineering(
      stateTrial,
      new Set(disabledList.map(Number)),
      positions,
      { ...engOpts, n1OutageEdge: edgeKey }
    );
  }

  function generateEngineeringLarge(rawParams, engOpts = {}) {
    const params = parseLargeParams(rawParams);
    validateLargeParams(params);
    params.mode = "engineering_large";
    const rng = new Random(params.seed);
    const roles = assignRoles(params.n_vertices, params.n_generators, params.n_consumers, params.seed);
    const G = generateLargeConnectedGraph(params.n_vertices, params.min_degree, params.max_degree, roles, params.seed);
    const generators = G.nodes().filter(v => roles[v] === "generator");
    const consumers = G.nodes().filter(v => roles[v] === "consumer");
    const productionList = splitTotal(params.total_production, params.n_generators, rng);
    const consumptionList = splitTotal(params.total_consumption, params.n_consumers, rng);
    const production = {};
    const consumption = {};
    generators.forEach((v, i) => (production[v] = productionList[i]));
    consumers.forEach((v, i) => (consumption[v] = consumptionList[i]));
    const state = {
      params,
      roles,
      edges: G.edges.map(e => [...e]),
      production,
      consumption,
    };
    initEngineeringState(state, params.seed);
    const renderOpts = engOpts.renderOpts || defaultRenderOpts(params.n_vertices);
    return evaluateStateEngineering(state, new Set(), null, { ...engOpts, renderOpts });
  }

  function rebalanceEngineeringLarge(stateJson, disabledList, positions, engOpts) {
    const state = stateFromJson(stateJson);
    const n = state.params.n_vertices;
    const renderOpts = engOpts.renderOpts || defaultRenderOpts(n);
    return evaluateStateEngineering(state, new Set(disabledList.map(Number)), positions, { ...engOpts, renderOpts });
  }

  function dcN1Analysis(stateJson, disabledList = [], positions = null, engOpts = {}) {
    const applyWorst = engOpts.applyWorst !== false;
    const scanResult = scanDcN1Scenarios(stateJson, disabledList, engOpts);
    const { scenarios, worst, sampled, edges_scanned, edges_total } = scanResult;
    const state = stateFromJson(stateJson);
    const baseDisabled = new Set(disabledList.map(Number));
    const result = evaluateStateEngineering(state, baseDisabled, positions, engOpts);
    const topN = engOpts.n1TopN || 10;
    result.dc_n1 = {
      scenarios: scenarios.slice(0, topN),
      worst,
      sampled,
      edges_scanned,
      edges_total,
    };
    if (worst) {
      const sampleNote = sampled ? ` (sampled ${edges_scanned}/${edges_total} edges)` : "";
      result.dc_n1_summary = `Худшее N-1: ${worst.label} · DC violations ${worst.dc_capacity_violations} · loading ${worst.dc_max_loading_percent}%${sampleNote}`;
      if (applyWorst) {
        const hi = new Set(engOpts.highlightNodes || []);
        hi.add(worst.u);
        hi.add(worst.v);
        const trialView = applyDcN1Scenario(
          stateJson,
          worst.edgeKey,
          disabledList,
          positions,
          { ...engOpts, highlightNodes: [...hi] }
        );
        trialView.dc_n1 = result.dc_n1;
        trialView.dc_n1_summary = result.dc_n1_summary;
        return trialView;
      }
    }
    return result;
  }

  global.GraphCore = {
    generate,
    rebalance,
    showWeakest,
    showWeakestEdge,
    generateFromSolarStations,
    pickSolarStations,
    planReinforcement,
    applyReinforcement,
    optimizeReinforcement,
    planMinimalCapacityReinforcement,
    optimizeCapacityReinforcement,
    evaluateFeasibilityState,
    generateLarge,
    rebalanceLarge,
    showWeakestLarge,
    showWeakestEdgeLarge,
    generateLargeGeo,
    deriveGeoPool,
    normalizeSolarPool,
    defaultRenderOpts,
    nodeName,
    MAX_LARGE_VERTICES,
    findWeakestVertexLarge,
    findWeakestEdgeLarge,
    generateEngineering,
    generateEngineeringLarge,
    generateEngineeringGeo,
    rebalanceEngineering,
    rebalanceEngineeringLarge,
    buildEngineeringLargeVisData,
    selectN1EdgeSample,
    evaluateStateEngineering,
    solveDCPowerFlow,
    dcN1Analysis,
    scanDcN1Scenarios,
    applyDcN1Scenario,
    runDCCascade,
    runMonteCarloBatch,
    aggregateMonteCarloRuns,
    computeParetoRecommendations,
    previewMonteCarloScenario,
    computeDamageScore,
    computeEngineeringRisk,
    computeEngineeringRiskFast,
  };
})(typeof window !== "undefined" ? window : globalThis);
