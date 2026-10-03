package ExhibitState {
    state def S;
    part h2 {
        exhibit state st2 : S;     // 状態は導出の対象外（警告される）
        state st1 : S;
    }
}
