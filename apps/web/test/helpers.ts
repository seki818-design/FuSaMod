import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, parseSafetyData } from "@fusamod/analysis";
import type { ElementGraph } from "@fusamod/sysml-graph";

const proj = resolve(dirname(fileURLToPath(import.meta.url)), "../../../projects/ev-powertrain");
export const graph = (): ElementGraph => JSON.parse(readFileSync(resolve(proj, "model.graph.json"), "utf8"));
export const safety = () => {
  const r = parseSafetyData(JSON.parse(readFileSync(resolve(proj, "safety.json"), "utf8")));
  if (!r.ok) throw new Error(r.errors.join());
  return r.data;
};
export const analysis = () => analyzeProject(graph(), safety());
