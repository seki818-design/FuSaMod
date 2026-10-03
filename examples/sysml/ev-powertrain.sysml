/*
 * EV パワートレインの縮小例(SysML v2 標準の記述だけを使う。SCDL ステレオタイプは不要)。
 *
 * 安全分析ネットへの対応規約:
 *   構造ネット: part の入れ子(車両 > パワートレイン > インバータ/モータ)
 *   機能ネット: action。上位の action を下位の action に分解し、下位の part が perform で実施する
 *               (機能の割り付け)。part が直接所有する action は、その part の機能。
 *   要求      : requirement と、それを実現する part への satisfy
 */
package 'EV Powertrain' {
    private import ScalarValues::*;

    part vehicle {
        doc /* 車両(最上位のシステム) */

        action 'drive vehicle' {
            doc /* 運転者の要求に従って車両を駆動する */
            in 'accelerator request' : Real;

            action 'output drive torque' {
                doc /* 要求に応じた駆動トルクを出力する */
                out 'drive torque' : Real;

                action 'convert power' {
                    doc /* 直流電力を三相交流に変換する */
                    out 'phase current' : Real;
                }
                action 'generate torque' {
                    doc /* 三相交流からトルクを発生する */
                    out 'motor torque' : Real;
                }
            }
        }

        part powertrain {
            doc /* パワートレイン */
            perform 'drive vehicle'.'output drive torque';

            part inverter {
                doc /* インバータ */
                perform 'drive vehicle'.'output drive torque'.'convert power';
            }
            part motor {
                doc /* 駆動モータ */
                perform 'drive vehicle'.'output drive torque'.'generate torque';
            }
        }
    }

    requirement 'REQ-001' {
        doc /* 加速要求に対して、意図しない過大トルクを出力しないこと */
    }
    requirement 'REQ-002' {
        doc /* モータは要求トルクに従ってトルクを発生すること */
    }
    satisfy 'REQ-001' by vehicle.powertrain;
    satisfy 'REQ-002' by vehicle.powertrain.motor;
}
