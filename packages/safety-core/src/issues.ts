export type IssueSeverity = "error" | "warning";

/** 整合性チェックの検出結果。Puzzle View の「安全」軸や問題パネルに表示する。 */
export interface Issue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** 該当するノード/要素/要求の ID */
  ref?: string;
}
