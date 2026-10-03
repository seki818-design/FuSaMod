// インスタンスの経路(car1.front)、特殊化(:>)、再定義(:>>)、ref、入れ子の requirement、by 省略の satisfy を使う書き方。
package T2 {
    private import ScalarValues::*;
    action def Drive { out torque : Real; }
    part def Motor { perform action gen : Drive; part rotor; }
    part def Car { part front : Motor; part rear : Motor; part ax; }
    part car1 : Car { part :>> ax { part w1; } }
    part car2 : Car;
    part base { part b1; }
    part sub1 :> base { part d1; }
    part holder { ref part r : Motor; }
    requirement r1; requirement r2;
    requirement outer { requirement inner; }
    satisfy r1 by car1.front;
    satisfy r2 by car2.front.rotor;
    part sat1 { satisfy r1; }
}
