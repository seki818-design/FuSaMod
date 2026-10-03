// 定義の入れ子、定義内の ref part、多重度、名前のない再定義、入れ子の requirement を使う書き方。
package T3 {
    private import ScalarValues::*;
    part def Cell { part elec; }
    part def Pack { ref part charger : Cell; part cells : Cell [4]; part bms; }
    part def Car { part aux { part pack : Pack; } part main : Pack; }
    part car1 : Car { part :>> main { part extra; } }
    requirement r1 { requirement sub; }
    satisfy r1 by car1.main;
}
