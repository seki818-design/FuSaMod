import { createHash } from "node:crypto";

interface Rec {
  payload?: { elementId?: string; owner?: { "@id"?: string }; name?: string; declaredName?: string; "@type"?: string };
  identity?: { "@id"?: string };
}

const NS = "fusamod:sysml-json:v1";

function uuidFrom(key: string): string {
  const h = createHash("sha1").update(`${NS}|${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // バージョン 5 相当
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * 公式変換器の JSON は、elementId が毎回ランダムな UUID。同じモデルから同じ出力になるよう、
 * 「所有者の経路 + 名前 + 種類 + 同じ所有者・種類・名前の中での出現順」から決めた UUID に置き換える(参照もすべて置き換える)。
 * 出現順は変換器の出力順に依存する(同じモデルなら同じ)。モデルを編集して要素が増減すると、同名・同種の兄弟の ID はずれうる。
 */
export function stabilizeJsonIds(json: string): string {
  let list: Rec[];
  try {
    list = JSON.parse(json) as Rec[];
  } catch {
    return json;
  }
  if (!Array.isArray(list)) return json;
  const byId = new Map<string, Rec>();
  for (const r of list) if (r.payload?.elementId) byId.set(r.payload.elementId, r);
  // 変換器は出力順が実行ごとに変わるので、ID を除いた中身(署名)の順に並べ直してから、出現順の番号を振る。
  // 署名は、参照先の署名を数回繰り返し取り込んで(Weisfeiler-Lehman 法)、似た要素を区別する。
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const content = new Map<Rec, string>();
  for (const r of list) content.set(r, JSON.stringify(r.payload ?? {}));
  let hash = new Map<string, string>();
  for (const r of list) if (r.payload?.elementId) hash.set(r.payload.elementId, createHash("sha1").update(content.get(r)!.replace(UUID, "~")).digest("hex"));
  for (let round = 0; round < 6; round++) {
    const next = new Map<string, string>();
    for (const r of list) {
      const id = r.payload?.elementId;
      if (id) next.set(id, createHash("sha1").update(content.get(r)!.replace(UUID, (m) => (m === id ? "self" : hash.get(m) ?? m))).digest("hex"));
    }
    hash = next;
  }
  const sig = new Map<Rec, string>();
  for (const r of list) sig.set(r, hash.get(r.payload?.elementId ?? "") ?? "");
  list = [...list].sort((p, q) => (sig.get(p)! < sig.get(q)! ? -1 : sig.get(p)! > sig.get(q)! ? 1 : 0));
  const keyOf = new Map<string, string>();
  const ordinal = new Map<string, number>();
  const compute = (id: string, depth = 0): string => {
    const hit = keyOf.get(id);
    if (hit !== undefined) return hit;
    const r = byId.get(id);
    if (!r?.payload || depth > 200) return `ext:${id}`;
    const p = r.payload;
    const ownerKey = p.owner?.["@id"] && byId.has(p.owner["@id"]) ? compute(p.owner["@id"], depth + 1) : "";
    const base = `${ownerKey}/${p["@type"] ?? ""}:${p.declaredName ?? p.name ?? ""}`;
    const n = ordinal.get(base) ?? 0;
    ordinal.set(base, n + 1);
    const key = `${base}#${n}`;
    keyOf.set(id, key);
    return key;
  };
  const map = new Map<string, string>();
  for (const r of list) {
    const id = r.payload?.elementId;
    if (id) map.set(id, uuidFrom(compute(id)));
  }
  // 置き換えは 1 回の走査で行う(新しい ID が別の古い ID と衝突しても二重に置き換わらない)。出力も新しい ID の順に並べる
  const text = JSON.stringify(list, null, 2).replace(UUID, (m) => map.get(m) ?? m);
  const out = (JSON.parse(text) as Rec[]).sort((p, q) => ((p.payload?.elementId ?? "") < (q.payload?.elementId ?? "") ? -1 : 1));
  return JSON.stringify(out, null, 2);
}
