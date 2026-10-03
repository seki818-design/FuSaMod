import com.google.gson.GsonBuilder;
import java.nio.file.*;
import java.util.*;
import org.eclipse.emf.common.util.TreeIterator;
import org.eclipse.emf.ecore.EObject;
import org.omg.sysml.interactive.*;
import org.omg.sysml.lang.sysml.*;

/**
 * 公式パイロット実装でモデルを読み、SCDL に依存しない汎用の要素グラフ(JSON)を出力する。
 * 使い方: java SysmlExtract <sysml.library> <出力ディレクトリ> <ライブラリ.sysml> <モデル.sysml>...
 *   最初のファイルはライブラリとして読み込むだけ。以降は各ファイルごとに <名前>.graph.json を出力する。
 */
public class SysmlExtract {
    static String q(Element e) { return e == null ? null : e.getQualifiedName(); }

    static String nameOf(Feature f) {
        if (f.getDeclaredName() != null) return f.getDeclaredName();
        for (Redefinition r : f.getOwnedRedefinition())
            if (r.getRedefinedFeature() != null && r.getRedefinedFeature().getName() != null) return r.getRedefinedFeature().getName();
        return f.getName();
    }

    static Object valueOf(Feature f) {
        for (Relationship r : f.getOwnedRelationship()) {
            if (!(r instanceof FeatureValue fv)) continue;
            Expression x = fv.getValue();
            if (x instanceof LiteralString s) return s.getValue();
            if (x instanceof LiteralBoolean b) return b.isValue();
            if (x instanceof FeatureReferenceExpression ref && ref.getReferent() != null) return ref.getReferent().getName();
            return "<" + (x == null ? "null" : x.eClass().getName()) + ">";
        }
        return null;
    }

    static Map<String, Object> node(Element e, String kind) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("qualifiedName", q(e));
        m.put("name", e.getDeclaredName());
        m.put("owner", q(e.getOwningNamespace()));
        StringBuilder doc = new StringBuilder();
        for (Documentation d : e.getDocumentation())
            if (d.getBody() != null) doc.append(doc.length() > 0 ? "\n" : "").append(d.getBody().strip());
        if (doc.length() > 0) m.put("doc", doc.toString());
        return m;
    }

    /** satisfy の `by` に書かれた特徴の連鎖(`car.front` なら [car, Car::front])。連鎖でなければ空。 */
    static List<String> chainOf(SatisfyRequirementUsage s) {
        List<String> out = new ArrayList<>();
        TreeIterator<EObject> it = s.eAllContents();
        while (it.hasNext()) {
            EObject o = it.next();
            if (o instanceof FeatureReferenceExpression && !(o.eContainer() instanceof FeatureReferenceExpression)) {
                for (Element c : ((Element) o).getOwnedElement())
                    if (c instanceof Feature f && !f.getChainingFeature().isEmpty()) {
                        for (Feature cf : f.getChainingFeature()) out.add(q(cf));
                        return out;
                    }
            }
        }
        return out;
    }

    /** 多重度の上限(`[4]` や `[0..4]` なら 4)。リテラルでない・無限(*)・宣言なしなら null。 */
    static Integer multiplicityUpper(Feature f) {
        Multiplicity m = f.getMultiplicity();
        if (!(m instanceof MultiplicityRange mr)) return null;
        Expression ub = mr.getUpperBound();
        if (ub == null) {
            for (Element c : mr.getOwnedElement()) if (c instanceof LiteralInteger li) return li.getValue();
            return null;
        }
        return ub instanceof LiteralInteger li ? li.getValue() : null;
    }

    /** 宣言された型(`: Def`)の完全修飾名。 */
    static List<String> typesOf(Feature f) {
        List<String> out = new ArrayList<>();
        for (FeatureTyping t : f.getOwnedTyping()) if (t.getType() != null) out.add(q(t.getType()));
        return out;
    }

    /** 宣言された上位の型(`:>`)の完全修飾名。 */
    static List<String> supertypesOf(Type t) {
        List<String> out = new ArrayList<>();
        for (Specialization sp : t.getOwnedSpecialization())
            if (!(sp instanceof FeatureTyping) && sp.getGeneral() != null) out.add(q(sp.getGeneral()));
        return out;
    }

    /** action(定義・使用)の入出力パラメータ。 */
    static List<Object> parametersOf(Type au) {
        List<Object> params = new ArrayList<>();
        for (Feature f : au.getOwnedFeature()) {
            FeatureDirectionKind dir = f.getDirection();
            if (dir == null) continue;
            Map<String, Object> pm = new LinkedHashMap<>();
            pm.put("name", nameOf(f));
            pm.put("direction", dir.getName());
            pm.put("type", f.getType().isEmpty() ? null : f.getType().get(0).getName());
            params.add(pm);
        }
        return params;
    }

    static Map<String, Object> usageNode(Feature f, String kind) {
        Map<String, Object> n = node(f, kind);
        List<String> types = typesOf(f);
        if (!types.isEmpty()) n.put("types", types);
        List<String> sup = supertypesOf(f);
        if (!sup.isEmpty()) n.put("supertypes", sup);
        if (!f.getOwnedRedefinition().isEmpty()) {
            n.put("redefines", true);
            List<String> red = new ArrayList<>();
            for (Redefinition r : f.getOwnedRedefinition()) if (r.getRedefinedFeature() != null) red.add(q(r.getRedefinedFeature()));
            if (!red.isEmpty()) n.put("redefinedFeatures", red);
        }
        if (f instanceof PartUsage pu && f.getOwningType() != null && pu.isReference()) n.put("isRef", true);
        Integer upper = multiplicityUpper(f);
        if (upper != null) n.put("multiplicityUpper", upper);
        return n;
    }

    static Map<String, Object> definitionNode(Type d, String kind) {
        Map<String, Object> n = node(d, kind);
        List<String> sup = supertypesOf(d);
        if (!sup.isEmpty()) n.put("supertypes", sup);
        return n;
    }

    public static Map<String, Object> extract(Element root) {
        List<Object> elements = new ArrayList<>();
        List<Object> dependencies = new ArrayList<>();
        List<Object> metadata = new ArrayList<>();
        List<Object> satisfies = new ArrayList<>();
        List<Object> performs = new ArrayList<>();
        Map<String, Integer> anon = new HashMap<>();
        TreeIterator<EObject> it = root.eAllContents();
        while (it.hasNext()) {
            EObject o = it.next();
            if (o instanceof MetadataUsage mu) {
                Map<String, Object> n = node(mu, "MetadataUsage");
                // dependency の本体に書いた注釈は、所有者が名前空間ではなく関係(Dependency)になる
                Element ownerEl = mu.getOwningNamespace() != null ? mu.getOwningNamespace() : mu.getOwner();
                if (n.get("owner") == null) n.put("owner", q(ownerEl));
                if (n.get("qualifiedName") == null) {
                    String owner = String.valueOf(n.get("owner"));
                    n.put("qualifiedName", owner + "/@" + (mu.getMetadataDefinition() == null ? "?" : mu.getMetadataDefinition().getName())
                        + "#" + anon.merge(owner, 1, Integer::sum));
                }
                n.put("type", mu.getMetadataDefinition() == null ? null : mu.getMetadataDefinition().getName());
                List<String> about = new ArrayList<>();
                for (Element a : mu.getAnnotatedElement()) about.add(q(a));
                if (about.isEmpty() && ownerEl instanceof Dependency) about.add(q(ownerEl));
                n.put("annotated", about);
                Map<String, Object> attrs = new LinkedHashMap<>();
                for (Feature f : mu.getOwnedFeature()) {
                    String k = nameOf(f);
                    Object v = valueOf(f);
                    if (k != null && v != null) attrs.put(k, v);
                }
                n.put("attributes", attrs);
                metadata.add(n);
            } else if (o instanceof SatisfyRequirementUsage s) {
                Map<String, Object> n = new LinkedHashMap<>();
                n.put("requirement", q(s.getSatisfiedRequirement()));
                Feature by = s.getSatisfyingFeature();
                n.put("by", by == null ? null : q(by.getFeatureTarget() == null ? by : by.getFeatureTarget()));
                // `car.front` のような連鎖は、途中の経路も出力する(定義側の特徴だけでは、どのインスタンスか分からないため)
                List<String> chain = chainOf(s);
                if (!chain.isEmpty()) n.put("byChain", chain);
                // `by` を省略した satisfy(part の中で書く)は、その part が満たす
                if (by == null || n.get("by") == null) {
                    Element own = s.getOwningNamespace();
                    if (own instanceof PartUsage || own instanceof PartDefinition) n.put("by", q(own));
                }
                satisfies.add(n);
            } else if (o instanceof PerformActionUsage p) {
                Map<String, Object> n = new LinkedHashMap<>();
                n.put("performer", q(p.getOwningNamespace()));
                n.put("performed", q(p.getPerformedAction()));
                performs.add(n);
                // `perform action x : Def;` は、その場で action を宣言する。action としても出力する
                if (p.getPerformedAction() == p) {
                    Map<String, Object> an = usageNode(p, "ActionUsage");
                    an.put("parameters", parametersOf(p));
                    elements.add(an);
                }
            } else if (o instanceof ActionUsage au && "ActionUsage".equals(au.eClass().getName())) {
                Map<String, Object> n = usageNode(au, "ActionUsage");
                n.put("parameters", parametersOf(au));
                elements.add(n);
            } else if (o instanceof ActionDefinition ad) {
                Map<String, Object> n = definitionNode(ad, "ActionDefinition");
                n.put("parameters", parametersOf(ad));
                elements.add(n);
            } else if (o instanceof PartDefinition pd) {
                elements.add(definitionNode(pd, "PartDefinition"));
            } else if (o instanceof RequirementDefinition rd) {
                elements.add(definitionNode(rd, "RequirementDefinition"));
            } else if (o instanceof Dependency d) {
                Map<String, Object> n = node(d, "Dependency");
                List<String> c = new ArrayList<>(), s = new ArrayList<>();
                for (Element x : d.getClient()) c.add(q(x));
                for (Element x : d.getSupplier()) s.add(q(x));
                n.put("client", c);
                n.put("supplier", s);
                dependencies.add(n);
            } else if (o instanceof PartUsage || o instanceof RequirementUsage) {
                elements.add(usageNode((Feature) o, ((Element) o).eClass().getName()));
            } else if (o instanceof PortUsage || o instanceof ConnectionUsage || o instanceof StateUsage || o instanceof AllocationUsage) {
                // 導出の対象外だが、「対象外の構成がある」ことを利用側が警告できるよう、種類と名前だけ出力する
                elements.add(usageNode((Feature) o, ((Element) o).eClass().getName()));
            } else if (o instanceof org.omg.sysml.lang.sysml.Package) {
                elements.add(node((Element) o, ((Element) o).eClass().getName()));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("elements", elements);
        out.put("dependencies", dependencies);
        out.put("metadata", metadata);
        out.put("satisfies", satisfies);
        out.put("performs", performs);
        return out;
    }

    public static void main(String[] a) throws Exception {
        SysMLInteractive s = SysMLInteractive.createInstance();
        s.loadLibrary(a[0]);
        Path outDir = Path.of(a[1]);
        Files.createDirectories(outDir);
        int bad = 0;
        for (int i = 2; i < a.length; i++) {
            SysMLInteractiveResult r = s.process(Files.readString(Path.of(a[i])));
            String base = Path.of(a[i]).getFileName().toString().replaceFirst("\\.sysml$", "");
            if (r.hasErrors() || r.getException() != null) {
                System.err.println("エラー: " + base + "\n" + r.formatIssues());
                bad++;
                continue;
            }
            if (i == 2) continue; // ライブラリは読み込むだけ
            String json = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(extract(r.getRootElement()));
            Files.writeString(outDir.resolve(base + ".graph.json"), json + "\n");
            System.out.println("出力: " + base + ".graph.json");
        }
        System.exit(bad == 0 ? 0 : 1);
    }
}
