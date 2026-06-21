/** Клиентское ядро графа потоков (для GitHub Pages и локального запуска). */
(function (global) {
  "use strict";

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const COLOR = { generator: "#4CAF50", consumer: "#F44336", transit: "#2196F3" };

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
    return out;
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

  function computeFlows(G, roles, production, consumption, seed, disabled = new Set()) {
    const active = new Set(G.nodes().filter(v => !disabled.has(v)));
    const H = G.subgraph(active);
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
    rng.shuffle(generators);
    rng.shuffle(consumers);

    for (const consumer of consumers) {
      let need = demand[consumer];
      while (need > 1e-9) {
        const src = generators
          .filter(g => supply[g] > 1e-9)
          .sort((a, b) => supply[b] - supply[a])[0];
        if (src === undefined) break;
        const path = H.shortestPath(src, consumer);
        if (!path) break;
        const amount = Math.min(supply[src], need);
        for (let i = 0; i < path.length - 1; i++) {
          addFlow(path[i], path[i + 1], amount);
        }
        supply[src] -= amount;
        need -= amount;
      }
      if (need > 1e-9) failed.add(consumer);
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
    return { edgeFlow: flowTuples, surplus, failed };
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

  function buildVisData(G, roles, production, consumption, edgeFlow, surplus, seed, disabled, failed, positions) {
    disabled = disabled || new Set();
    failed = failed || new Set();
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
      }

      const node = {
        id: v,
        label: labelForVertex(v, roles, production, consumption, surplus),
        x,
        y,
        color,
        size: nodeSize,
        font: { color: fontColor, size: 16, face: "Arial", multi: true, bold: true },
        borderWidth,
        disabled_manual: isOff,
        disabled_failed: isFailed,
        role: roles[v],
        role_color: COLOR[roles[v]],
      };
      if (isOff || isFailed) node.chosen = { node: false, label: false };
      nodes.push(node);
    }

    const inactive = new Set([...disabled, ...failed]);
    const edges = [];
    for (const [u, v] of G.edges) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      const offEdge = inactive.has(u) || inactive.has(v);
      const f = offEdge ? 0 : edgeFlow[`${a},${b}`] || 0;
      const [frm, to, arrow] = edgeDirection(u, v, f);
      const zeroFlow = Math.abs(f) < 1e-9;
      const dashed = offEdge || zeroFlow;
      const edge = {
        id: `${u}-${v}`,
        from: frm,
        to,
        label: edgeLabel(u, v, f),
        font: { size: edgeFont, align: "middle", background: "rgba(255,255,255,0.85)" },
        color: { color: offEdge ? "#bbbbbb" : zeroFlow ? "#aaaaaa" : "#666666", highlight: "#333333" },
        width: offEdge ? 1.5 : 2,
        smooth: { type: "continuous" },
        dashes: dashed ? [6, 8] : false,
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

  function buildMapVisData(G, roles, production, consumption, edgeFlow, surplus, seed, disabled, failed, geo, positions) {
    disabled = disabled || new Set();
    failed = failed || new Set();
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
      }

      const g = geo[String(v)] ?? geo[v];
      const node = {
        id: v,
        label: labelForVertex(v, roles, production, consumption, surplus),
        x,
        y,
        lat,
        lng,
        color,
        size: nodeSize,
        font: { color: fontColor, size: 16, face: "Arial", multi: true, bold: true },
        borderWidth,
        disabled_manual: isOff,
        disabled_failed: isFailed,
        role: roles[v],
        role_color: COLOR[roles[v]],
        station_name: g?.name || "",
        oblast: g?.oblast || "",
        station_id: g?.station_id || "",
      };
      if (isOff || isFailed) node.chosen = { node: false, label: false };
      nodes.push(node);
    }

    const inactive = new Set([...disabled, ...failed]);
    const edges = [];
    for (const [u, v] of G.edges) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      const offEdge = inactive.has(u) || inactive.has(v);
      const f = offEdge ? 0 : edgeFlow[`${a},${b}`] || 0;
      const [frm, to, arrow] = edgeDirection(u, v, f);
      const zeroFlow = Math.abs(f) < 1e-9;
      const dashed = offEdge || zeroFlow;
      const edge = {
        id: `${u}-${v}`,
        from: frm,
        to,
        label: edgeLabel(u, v, f),
        font: { size: edgeFont, align: "middle", background: "rgba(255,255,255,0.85)" },
        color: { color: offEdge ? "#bbbbbb" : zeroFlow ? "#aaaaaa" : "#555555", highlight: "#333333" },
        width: offEdge ? 2 : 3,
        dashes: dashed ? [8, 10] : false,
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

  function buildPanel(nodes, edges) {
    const manual = [];
    const autoFailed = [];
    for (const n of nodes) {
      const letter = n.label.split("\n")[0];
      const entry = { letter, label: n.label.replace(/\n/g, " ") };
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
    const { edgeFlow, surplus, failed } = computeFlows(
      G, state.roles, state.production, state.consumption, params.seed, disabled
    );
    const balances = nodeBalance(G, state.production, state.consumption, edgeFlow, surplus);
    const isMap = !!(state.geo && Object.keys(state.geo).length);
    const { nodes, edges } = isMap
      ? buildMapVisData(
          G, state.roles, state.production, state.consumption,
          edgeFlow, surplus, params.seed, disabled, failed, state.geo, positions
        )
      : buildVisData(
          G, state.roles, state.production, state.consumption,
          edgeFlow, surplus, params.seed, disabled, failed, positions
        );
    const checks = isMap
      ? runMapChecks(G, state.roles, state.production, state.consumption, surplus, balances, params, disabled, failed)
      : runChecks(
          G, state.roles, state.production, state.consumption,
          surplus, balances, params, disabled, failed
        );
    let activeConsumption = 0;
    for (const v of G.nodes()) {
      if (state.roles[v] === "consumer" && !disabled.has(v) && !failed.has(v)) {
        activeConsumption += state.consumption[v] || 0;
      }
    }
    return {
      ok: true,
      nodes,
      edges,
      checks,
      state: stateToJson(state),
      disabled: [...disabled].sort((a, b) => a - b),
      failed: [...failed].sort((a, b) => a - b),
      summary: {
        vertices: params.n_vertices,
        production: params.total_production,
        consumption: params.total_consumption,
        surplus: params.total_surplus,
        edges_count: G.edgeCount(),
        disabled_count: disabled.size,
        failed_count: failed.size,
        served_consumption: activeConsumption,
      },
      panel: buildPanel(nodes, edges),
    };
  }

  function findWeakestVertex(state) {
    const G = stateToGraph(state);
    const params = state.params;
    let bestV = 0;
    let bestFailed = new Set();
    let bestCount = -1;

    for (const v of G.nodes()) {
      const { failed } = computeFlows(
        G, state.roles, state.production, state.consumption, params.seed, new Set([v])
      );
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
    return evaluateState(state, new Set());
  }

  function rebalance(stateJson, disabledList, positions) {
    const state = stateFromJson(stateJson);
    const disabled = new Set(disabledList.map(Number));
    return evaluateState(state, disabled, positions);
  }

  function showWeakest(stateJson, positions) {
    const state = stateFromJson(stateJson);
    const weakest = findWeakestVertex(state);
    const result = evaluateState(state, new Set([weakest.vertex]), positions);
    result.weakest = weakest;
    return result;
  }

  global.GraphCore = { generate, rebalance, showWeakest, generateFromSolarStations, pickSolarStations };
})(typeof window !== "undefined" ? window : globalThis);
