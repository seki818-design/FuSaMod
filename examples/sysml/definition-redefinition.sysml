// 定義の中の再定義(part def の中の :>>)、最上位の多重度、requirement def の展開を使う書き方。
package DefRedefinition {
    private import ScalarValues::*;

    part def Cell;
    part def Pack {
        part cells : Cell [4];
        part bms;
    }
    part def BigPack :> Pack {
        part :>> cells {
            part extra;
        }
    }
    part v : BigPack;
    part v2 : BigPack;
    part wheels : Cell [4];

    requirement def Rd {
        doc /* 定義の本文 */
        requirement subA;
    }
    requirement ra : Rd;
}
