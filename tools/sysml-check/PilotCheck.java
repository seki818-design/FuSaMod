import java.nio.file.*;
import org.omg.sysml.interactive.*;

/** 使い方: java PilotCheck <sysml.library> <file.sysml>...  同一セッションに順に読み込み、診断を表示する。 */
public class PilotCheck {
    public static void main(String[] a) throws Exception {
        SysMLInteractive s = SysMLInteractive.createInstance();
        s.loadLibrary(a[0]);
        int bad = 0;
        for (int i = 1; i < a.length; i++) {
            String text = Files.readString(Path.of(a[i]));
            SysMLInteractiveResult r = s.process(text);
            System.out.println("== " + Path.of(a[i]).getFileName() + " : errors=" + r.hasErrors() + " warnings=" + r.hasWarnings()
                + (r.getException() != null ? " exception=" + r.getException() : ""));
            String f = r.formatIssues();
            if (f != null && !f.isBlank()) System.out.println(f);
            if (r.hasErrors() || r.getException() != null) bad++;
        }
        System.exit(bad == 0 ? 0 : 1);
    }
}
