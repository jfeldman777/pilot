#!/usr/bin/env node
/**
 * Batch War-Gaming (phase 3) — runs N scenarios via graph_core.js, writes CSV + summary JSON.
 * Usage: node scripts/run_mc_batch.mjs [runs] [seed]
 * Example: node scripts/run_mc_batch.mjs 1000 42
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "data", "batch");

const runs = Math.min(Math.max(parseInt(process.argv[2] || "1000", 10), 10), 50000);
const seed = parseInt(process.argv[3] || "42", 10);
const nodeCount = parseInt(process.argv[4] || "100", 10);

const corePath = path.join(root, "graph_core.js");
if (!fs.existsSync(corePath)) {
  console.error("graph_core.js not found");
  process.exit(1);
}

eval(fs.readFileSync(corePath, "utf8"));

if (typeof GraphCore === "undefined") {
  console.error("GraphCore not loaded");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
console.log(`Batch War-Gaming: ${runs} runs · ${nodeCount} nodes · seed ${seed} · TSO profile`);

const raw = GraphCore.generateEngineeringLargeGeo([], {
  count: nodeCount,
  seed,
  profile: "tso_backbone",
});
const state = raw.state;
const engOpts = { flowMode: "dc" };
const mcOpts = {
  runs,
  maxOutagesPerScenario: 3,
  seed,
  useCascade: true,
  tripThreshold: 120,
  maxCascadeSteps: 10,
};

const batchSize = runs <= 200 ? runs : 100;
const allRuns = [];
let completed = 0;

while (completed < runs) {
  const batch = GraphCore.runMonteCarloBatch(
    state,
    [],
    engOpts,
    mcOpts,
    { startRun: completed, count: Math.min(batchSize, runs - completed) }
  );
  allRuns.push(...batch.runs);
  completed = batch.progress.completed;
  if (completed % 500 === 0 || completed === runs) {
    process.stdout.write(`\r  ${completed}/${runs}`);
  }
}

const aggregate = GraphCore.aggregateMonteCarloRuns(allRuns);
const pareto = GraphCore.computeParetoRecommendations(
  state,
  [],
  engOpts,
  { ...mcOpts, runs: Math.min(runs, 200) },
  aggregate
);

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const csvPath = path.join(outDir, `mc_batch_${ts}.csv`);
const summaryPath = path.join(outDir, "latest_summary.json");

const csvHeader = "run_id,damage_score,unserved_load_mw,critical_unserved_count,cascade_steps,outages_label\n";
const csvBody = allRuns
  .map((r) =>
  [
    r.run_id,
    r.damage_score,
    r.unserved_load_mw,
    r.critical_unserved_count,
    r.cascade_steps,
    `"${(r.outaged_objects_label || "").replace(/"/g, '""')}"`,
  ].join(",")
  )
  .join("\n");
fs.writeFileSync(csvPath, csvHeader + csvBody, "utf8");

const summary = {
  generated_at: new Date().toISOString(),
  engine: "graph_core.js batch worker",
  profile: "tso_backbone",
  nodes: nodeCount,
  seed,
  runs: allRuns.length,
  elapsed_ms: Date.now() - t0,
  avg_damage_score: aggregate.avg_damage_score,
  worst_run_id: aggregate.worst_scenarios[0]?.run_id ?? null,
  worst_damage: aggregate.worst_scenarios[0]?.damage_score ?? null,
  pareto: pareto.map((p) => ({
    protect_count: p.protect_count,
    damage_reduced_percent: p.damage_reduced_percent,
  })),
  top_risk_objects: (aggregate.object_frequency || []).slice(0, 5).map((o) => ({
    object: o.object,
    frequency_in_worst: o.frequency_in_worst,
    avg_damage_score: o.avg_damage_score,
  })),
  csv_file: path.basename(csvPath),
  disclaimer: "SYNTHETIC screening batch · NOT operational",
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

console.log(`\nDone in ${summary.elapsed_ms} ms`);
console.log(`CSV: ${csvPath}`);
console.log(`Summary: ${summaryPath}`);
console.log(`avg damage: ${summary.avg_damage_score} · worst: ${summary.worst_damage}`);
