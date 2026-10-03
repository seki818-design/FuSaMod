import type { SafetyNet } from "../src/index.js";

/**
 * EV パワートレインの縮小例: Vehicle > Powertrain > Motor。
 * 走行不能(最上位 FE)← トルク出力喪失(Powertrain の FM)← 巻線短絡(Motor の FM)
 */
export function sampleNet(): SafetyNet {
  return {
    elements: [
      { id: "veh", name: "Vehicle" },
      { id: "pt", name: "Powertrain", parentId: "veh" },
      { id: "mot", name: "Motor", parentId: "pt" },
    ],
    functions: [
      { id: "f-veh", name: "車両を駆動する", ownerId: "veh" },
      { id: "f-pt", name: "駆動トルクを出力する", ownerId: "pt", parentFunctionId: "f-veh" },
      { id: "f-mot", name: "トルクを発生する", ownerId: "mot", parentFunctionId: "f-pt" },
    ],
    failures: [
      { id: "x-veh", description: "走行不能", functionId: "f-veh", severity: 10 },
      { id: "x-pt", description: "駆動トルクが出ない", functionId: "f-pt" },
      { id: "x-mot", description: "トルクが発生しない", functionId: "f-mot" },
      { id: "x-wind", description: "巻線短絡", functionId: "f-mot", isBasicCause: true },
    ],
    links: [
      { id: "l1", causeId: "x-pt", effectId: "x-veh", occurrence: 3, detection: 4 },
      { id: "l2", causeId: "x-mot", effectId: "x-pt", occurrence: 4, detection: 5 },
      { id: "l3", causeId: "x-wind", effectId: "x-mot", occurrence: 3, detection: 6 },
    ],
  };
}
