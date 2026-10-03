import { createHash } from "node:crypto";

interface Rec {
  payload?: {
    elementId?: string;
    owner?: { "@id"?: string };
    // 関係要素(Membership・FeatureTyping など)の JSON には owner が無く、これらがある
    owningRelatedElement?: { "@id"?: string };
    owningNamespace?: { "@id"?: string };
    ownedRelatedElement?: { "@id"?: string }[];
    ownedRelationship?: { "@id"?: string }[];
    isLibraryElement?: boolean;
    target?: { "@id"?: string }[];
    source?: { "@id"?: string }[];
    name?: string;
    declaredName?: string;
    "@type"?: string;
  };
  identity?: { "@id"?: string };
}

const NS = "fusamod:sysml-json:v1";
const UUID_ONE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
type Payload = NonNullable<Rec["payload"]>;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** 変換器が標準ライブラリに付ける決定的な ID(UUID v5)。入力として渡した SCDL.sysml などは v4 のランダムなので区別できる */
const isStableLibraryId = (id: string) => id[14] === "5";

/** 変換器は出力順が実行ごとに変わるので、ID を除いた中身(署名)の順に並べ直す。署名は参照先・参照元の署名を繰り返し取り込む(Weisfeiler-Lehman 法)。 */
function sortBySignature(list: Rec[], byId: Map<string, Rec>): Rec[] {
  const content = new Map<Rec, string>();
  for (const r of list) content.set(r, JSON.stringify(r.payload ?? {}));
  // 参照される側（所有者の情報を持たない暗黙の要素など）は、参照する側の署名でも区別する
  const inRefs = new Map<string, string[]>();
  for (const r of list) {
    const id = r.payload?.elementId;
    if (!id) continue;
    for (const m of new Set(content.get(r)!.match(UUID) ?? [])) if (m !== id && byId.has(m)) (inRefs.get(m) ?? inRefs.set(m, []).get(m)!).push(id);
  }
  let hash = new Map<string, string>();
  for (const r of list) if (r.payload?.elementId) hash.set(r.payload.elementId, createHash("sha1").update(content.get(r)!.replace(UUID, "~")).digest("hex"));
  for (let round = 0; round < 6; round++) {
    const next = new Map<string, string>();
    for (const r of list) {
      const id = r.payload?.elementId;
      if (!id) continue;
      const body = content.get(r)!.replace(UUID, (m) => (m === id ? "self" : hash.get(m) ?? (isStableLibraryId(m) ? m : "ext")));
      const incoming = (inRefs.get(id) ?? []).map((x) => hash.get(x) ?? "").sort().join(",");
      next.set(id, createHash("sha1").update(`${body}|in:${incoming}`).digest("hex"));
    }
    hash = next;
  }
  const sig = (r: Rec) => hash.get(r.payload?.elementId ?? "") ?? "";
  return [...list].sort((p, q) => (sig(p) < sig(q) ? -1 : sig(p) > sig(q) ? 1 : 0));
}

/** 名前の無い要素(satisfy の使用・各種の関係)は、所有する要素・参照先の名前をたどって区別する(深さ 2 まで)。要素が増減しても、他の関係の ID がずれないように。 */
function labelOf(byId: Map<string, Rec>, p: Payload, depth = 2): string {
  const own = p.declaredName ?? p.name;
  if (own) return own;
  // 名前の無い根の名前空間は、全トップレベル要素の名前を連結してしまい、トップレベルの編集で全 ID が動く。ラベルを持たせない
  if (p["@type"] === "Namespace") return "";
  const parts: string[] = [];
  for (const r of [...(p.ownedRelatedElement ?? []), ...(p.target ?? []), ...(p.source ?? []), ...(p.ownedRelationship ?? [])]) {
    const q = r["@id"] ? byId.get(r["@id"])?.payload : undefined;
    if (!q) continue;
    const n = q.declaredName ?? q.name ?? (depth > 0 ? labelOf(byId, q, depth - 1) : "");
    parts.push(n || (q["@type"] ?? ""));
  }
  return parts.join("|");
}

/** 各要素の鍵: 所有者の鍵 + 種類 + 名前(無ければ中身の名前) + 同じ鍵の中での出現順。 */
function buildKeys(list: Rec[], byId: Map<string, Rec>): Map<string, string> {
  const keyOf = new Map<string, string>();
  const ordinal = new Map<string, number>();
  const compute = (id: string, depth = 0): string => {
    const hit = keyOf.get(id);
    if (hit !== undefined) return hit;
    const p = byId.get(id)?.payload;
    if (!p || depth > 200) return `ext:${id}`;
    const ownerId = p.owner?.["@id"] ?? p.owningRelatedElement?.["@id"] ?? p.owningNamespace?.["@id"];
    const ownerKey = ownerId && byId.has(ownerId) ? compute(ownerId, depth + 1) : "";
    const base = `${ownerKey}/${p["@type"] ?? ""}:${labelOf(byId, p)}`;
    const n = ordinal.get(base) ?? 0;
    ordinal.set(base, n + 1);
    keyOf.set(id, `${base}#${n}`);
    return keyOf.get(id)!;
  };
  for (const r of list) if (r.payload?.elementId) compute(r.payload.elementId);
  return keyOf;
}

/**
 * 出力に含まれない要素(渡したライブラリの要素など)への参照の ID は、変換のたびに変わる。
 * 参照する側の鍵・項目名・位置から決めた ID に置き換える(同じ外部要素への参照は、最初の参照元で決まるので一つにまとまる)。
 */
function externalIds(list: Rec[], byId: Map<string, Rec>, keyOf: Map<string, string>): Map<string, string> {
  const first = new Map<string, string>();
  for (const r of list) {
    const id = r.payload?.elementId;
    if (!id) continue;
    for (const [field, v] of Object.entries(r.payload ?? {})) {
      ((Array.isArray(v) ? v : [v]) as unknown[]).forEach((x, i) => {
        const ref = x && typeof x === "object" ? (x as { "@id"?: unknown })["@id"] : undefined;
        if (typeof ref !== "string" || byId.has(ref) || !UUID_ONE.test(ref) || isStableLibraryId(ref)) return;
        const k = `${keyOf.get(id) ?? ""}|${field}|${i}`;
        const prev = first.get(ref);
        if (prev === undefined || k < prev) first.set(ref, k);
      });
    }
  }
  return new Map([...first].map(([ref, k]) => [ref, uuidFrom(`ext|${k}`)]));
}

export function stabilizeJsonIds(json: string): string {
  let parsed: Rec[];
  try {
    parsed = JSON.parse(json) as Rec[];
  } catch {
    return json;
  }
  if (!Array.isArray(parsed)) return json;
  const byId = new Map<string, Rec>();
  for (const r of parsed) if (r.payload?.elementId) byId.set(r.payload.elementId, r);
  const list = sortBySignature(parsed, byId);
  const keyOf = buildKeys(list, byId);
  const map = externalIds(list, byId, keyOf);
  for (const r of list) {
    const id = r.payload?.elementId;
    // 標準ライブラリ要素の ID は変換器が決定的に付けている。そのまま残し、JSON と XMI で一致させる
    if (id && !(r.payload?.isLibraryElement && isStableLibraryId(id))) map.set(id, uuidFrom(keyOf.get(id)!));
  }
  // 置き換えは 1 回の走査で行う(新しい ID が別の古い ID と衝突しても二重に置き換わらない)。出力も新しい ID の順に並べる
  const text = JSON.stringify(list, null, 2).replace(UUID, (m) => map.get(m) ?? m);
  const out = (JSON.parse(text) as Rec[]).sort((p, q) => ((p.payload?.elementId ?? "") < (q.payload?.elementId ?? "") ? -1 : 1));
  return JSON.stringify(out, null, 2);
}
