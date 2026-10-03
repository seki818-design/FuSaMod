import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.eclipse.xtext.validation.Issue;
import org.omg.sysml.interactive.*;

/**
 * 公式パイロット実装を常駐させ、JSON Lines で解析を受け付ける。
 *   起動: java SysmlServer <sysml.library> <ライブラリ.sysml>...   (ライブラリは起動時に 1 回だけ読み込む)
 *   要求(1 行): {"id": 1, "text": "<SysML テキスト>"}
 *   応答(1 行): {"id": 1, "ok": true|false, "diagnostics": [{severity, line, column, message}], "graph": {...}}
 *   起動完了時に {"ready": true} を 1 行出力する。標準出力はプロトコル専用(ライブラリの進捗ログは標準エラーへ)。
 */
public class SysmlServer {
    public static void main(String[] a) throws Exception {
        PrintStream proto = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(System.err); // ライブラリ読み込みなどの標準出力を、プロトコルから切り離す
        Gson gson = new GsonBuilder().disableHtmlEscaping().create();

        SysMLInteractive s = SysMLInteractive.createInstance();
        s.loadLibrary(a[0]);
        for (int i = 1; i < a.length; i++) {
            SysMLInteractiveResult r = s.process(Files.readString(Path.of(a[i])));
            if (r.hasErrors() || r.getException() != null) {
                System.err.println("ライブラリの読み込みに失敗: " + a[i] + "\n" + r.formatIssues());
                System.exit(2);
            }
        }
        proto.println("{\"ready\":true}");

        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (String line; (line = in.readLine()) != null; ) {
            Map<String, Object> res = new LinkedHashMap<>();
            Object id = null;
            try {
                JsonObject req = JsonParser.parseString(line).getAsJsonObject();
                id = req.has("id") ? gson.fromJson(req.get("id"), Object.class) : null;
                res.put("id", id);
                SysMLInteractiveResult r = s.process(req.get("text").getAsString());
                List<Object> diags = new ArrayList<>();
                for (Issue is : r.getIssues()) {
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("severity", is.getSeverity().name().toLowerCase());
                    d.put("line", is.getLineNumber());
                    d.put("column", is.getColumn());
                    d.put("message", is.getMessage());
                    diags.add(d);
                }
                boolean ok = !r.hasErrors() && r.getException() == null;
                res.put("ok", ok);
                res.put("diagnostics", diags);
                if (r.getException() != null) res.put("exception", String.valueOf(r.getException()));
                if (ok && r.getRootElement() != null) res.put("graph", SysmlExtract.extract(r.getRootElement()));
                // 次の要求のために、このスニペットの要素を取り除く(ライブラリは残る)
                s.removeResource();
            } catch (Throwable t) {
                res.put("id", id);
                res.put("ok", false);
                res.put("diagnostics", List.of());
                res.put("exception", t.toString());
            }
            proto.println(gson.toJson(res));
        }
    }
}
