import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored reporter assets from `vitest run --coverage`. Git already ignores
    // the directory, but this list REPLACES the defaults rather than extending
    // them, so anything not named here gets linted — and istanbul's bundled JS
    // carries its own eslint directives, which surface as warnings we did not
    // write and cannot fix.
    "coverage/**",
  ]),
  {
    rules: {
      // Allow the `{ omit, ...rest }` and `_`-prefixed intentional-throwaway idioms.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
