# ADR-0002: SysML v2 アダプタ方式

- 状態: 提案(P0 の PoC で確定)
- 候補: A) Eclipse SysML v2 パイロット実装(Java)をサービス利用 / B) Langium による TS パーサー / C) 完全自作
- 推奨: A。意味論の正確さと Systems Modeling API 互換を優先する。
- 方針: 安全分析コアは SysML 要素を `modelRef` で参照するだけとし、アダプタ層で隔離して後から差し替え可能にする。
- 確定条件: A と B で EV パワートレインのサンプルモデルを読み込み、MBSE 専門家が準拠度を評価する。
- 追加の確認項目(ADR-0007): `libs/sysml/scdl/SCDL.sysml` と `examples/sysml/` を公式パイロット実装に取り込み、型・参照・多重度を検証する。
