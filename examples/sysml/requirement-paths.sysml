// 要求の側にも経路がある satisfy(satisfy r1.subB.deep by v.front.brake)と、多重度の書き方([n]、[0]、[0..*])。
package RequirementPaths {
    private import ScalarValues::*;

    part def Axle {
        part brake;
    }
    part def Vehicle {
        part front : Axle;
        part rear : Axle;
    }
    part v : Vehicle;

    requirement def ReqD {
        requirement subA;
        requirement subB {
            requirement deep;
        }
    }
    requirement r1 : ReqD;
    requirement r2 : ReqD;
    satisfy r1.subB.deep by v.front.brake;
    satisfy r2.subA by v.rear.brake;

    attribute n = 3;
    part wheels : Axle [n];
    part none : Axle [0];
    part opt : Axle [0..1];
}
