module.exports = {
  env: { browser: true, es2022: true },
  extends: ["eslint:recommended"],
  parserOptions: { ecmaVersion: "latest", sourceType: "script" },
  rules: { "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }] },
  globals: { JSZip: "readonly", JSON5: "readonly", tinymce: "readonly" }
};
