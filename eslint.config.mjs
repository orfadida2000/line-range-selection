import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // 1. Ignore packaged extensions and typical VS Code test/output folders
  {
    ignores: ["**/*.vsix", ".vscode-test/**", "out/**", "dist/**"],
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    // 2. Add a rules object to customize or override recommended settings
    rules: {
      "no-unused-vars": "warn", // Changes the default error to a warning
      "no-useless-assignment": "warn", // Changes the default error to a warning
      "no-console": "off", // Allows console.log for debugging your extension
    },
  },
]);
