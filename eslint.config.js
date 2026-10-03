import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/test-results/**", "**/playwright-report/**", "docs/**", "projects/**", "examples/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["error", "warn"] }],
      // 保守性の指標: 循環的複雑度が高い関数を警告する
      complexity: ["warn", 25],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // スクロールできる領域は、キーボードで操作できるよう tabIndex を付ける(axe の scrollable-region-focusable)
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["tabpanel", "region"], tags: [] }],
    },
  },
  { files: ["**/test/**", "**/e2e/**"], rules: { complexity: "off", "no-console": "off" } },
  { files: ["tools/**", "**/*.mjs"], rules: { "no-console": "off" } },
);
