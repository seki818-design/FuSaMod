// 定義(part def / action def)と型付きの使用を使った書き方。deriveNet は、型の中身を使用ごとに展開する。
package TypedDefinitions {
    private import ScalarValues::*;

    action def Drive {
        out torque : Real;
    }

    part def Motor {
        perform action generate : Drive;
        part rotor;
    }

    part def Car {
        part front : Motor;
        part rear : Motor;
        perform action go : Drive;
    }

    part car : Car;

    requirement def TorqueDef {
        doc /* 駆動トルクを出力する */
    }
    requirement torque : TorqueDef;
    satisfy torque by car.front;
}
