// アクティビティ図（action の後続関係: first … then …）と、シーケンス図（message）の書き方。
package BehaviorDiagrams {
    private import ScalarValues::*;

    action def Accelerate {
        action readPedal;
        action computeTorque;
        action outputTorque;
        first start then readPedal;
        first readPedal then computeTorque;
        first computeTorque then outputTorque;
        first outputTorque then done;
    }

    part system {
        part driver;
        part vcu;
        part inverter;
        message pedalPos of Real from driver to vcu;
        message torqueCmd of Real from vcu to inverter;
        message ack from inverter to vcu;
    }
}
