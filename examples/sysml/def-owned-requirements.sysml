package DefOwnedReq {
    part def Axle { part brake; }
    part def Car {
        part front : Axle;
        requirement inCar;                       // 暗黙の subject = この Car
        satisfy inCar;
        requirement inCar2;
        satisfy inCar2 by front;                 // 定義の中の part へ
    }
    part c1 : Car;
    part c2 : Car;
    part c3 : Car {
        requirement extra;
        satisfy extra by front.brake;            // 使用側から、型の中身を相対の経路で指す
    }
}
