/*
 * EV パワートレイン(デモプロジェクト)
 * 構造: 車両 > パワートレイン > VCU / インバータ(ゲートドライバ・パワーステージ)/ モータ / 独立監視マイコン
 * 機能: 上位の action を下位の action に分解し、下位の part が perform する(ADR-0008)
 */
package EvPowertrainDemo {
    private import ScalarValues::*;

    part vehicle {
        doc /* 車両(システム) */

        action 'drive vehicle' {
            doc /* 運転者の要求に従って車両を駆動する */
            in 'accelerator request' : Real;

            action 'output drive torque' {
                doc /* 要求に応じた駆動トルクを出力する */
                out 'drive torque' : Real;

                action 'compute torque request' {
                    doc /* アクセル要求から目標トルクを演算する */
                    out 'torque request' : Real;
                }
                action 'convert power' {
                    doc /* 直流電力を三相交流に変換する */
                    out 'phase current' : Real;

                    action 'drive gate signals' {
                        doc /* 目標トルクに応じたゲート信号を生成する */
                        out 'gate signal' : Real;
                    }
                    action 'switch power' {
                        doc /* パワー素子で電力をスイッチングする */
                        out 'switched current' : Real;
                    }
                }
                action 'generate torque' {
                    doc /* 三相交流からトルクを発生する */
                    out 'motor torque' : Real;
                }
                action 'monitor torque' {
                    doc /* 推定トルクと指令を独立に比較し、逸脱時にゲートを遮断する */
                    out 'gate shutdown' : Real;
                }
            }
        }

        part powertrain {
            doc /* パワートレイン(サブシステム) */
            perform 'drive vehicle'.'output drive torque';

            part vcu {
                doc /* 車両制御ユニット */
                perform 'drive vehicle'.'output drive torque'.'compute torque request';
            }
            part inverter {
                doc /* インバータ */
                perform 'drive vehicle'.'output drive torque'.'convert power';

                part gateDriver {
                    doc /* ゲートドライバ */
                    perform 'drive vehicle'.'output drive torque'.'convert power'.'drive gate signals';
                }
                part powerStage {
                    doc /* パワーステージ(IGBT/SiC) */
                    perform 'drive vehicle'.'output drive torque'.'convert power'.'switch power';
                }
            }
            part motor {
                doc /* 駆動モータ */
                perform 'drive vehicle'.'output drive torque'.'generate torque';
            }
            part safetyMonitor {
                doc /* 独立した監視マイコン(VCU とは電源・クロック・ソフトウェアが独立) */
                perform 'drive vehicle'.'output drive torque'.'monitor torque';
            }
        }
    }

    requirement 'REQ-001' {
        doc /* 加速要求に対して、意図しない過大トルクを出力しないこと */
    }
    requirement 'REQ-002' {
        doc /* モータは要求トルクに従ってトルクを発生すること */
    }
    requirement 'REQ-003' {
        doc /* 過大トルクを検出した場合、FTTI 内に安全状態へ遷移すること */
    }
    requirement 'REQ-004' {
        doc /* パワートレインは、指令トルクに対して所定の精度でトルクを出力すること */
    }
    satisfy 'REQ-001' by vehicle;
    satisfy 'REQ-002' by vehicle.powertrain.motor;
    satisfy 'REQ-003' by vehicle.powertrain.safetyMonitor;
    satisfy 'REQ-004' by vehicle.powertrain;
}
