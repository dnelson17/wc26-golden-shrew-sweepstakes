import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default tseslint.config(
  // Generated / build artefacts — never lint these.
  { ignores: ['dist/', '.astro/', 'data/'] },

  // Baseline JS correctness rules.
  js.configs.recommended,

  // Strictest type-aware TypeScript rules + the opinionated stylistic set.
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  // Type information for the whole project. The two root tooling configs are
  // excluded from tsconfig.json, so allow them onto the default project.
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'commitlint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Astro single-file components.
  astro.configs['flat/recommended'],
  {
    files: ['**/*.astro'],
    languageOptions: {
      parserOptions: { extraFileExtensions: ['.astro'] },
    },
  },

  // Execution environments: browser for the client bundle, Node for the pipeline.
  { files: ['src/**/*.{ts,astro}'], languageOptions: { globals: globals.browser } },
  { files: ['scripts/**/*.mjs', 'astro.config.mjs'], languageOptions: { globals: globals.node } },

  // The data pipeline ingests untyped JSON at its edges (the live FIFA API and
  // local data/*.json). The shapes are asserted with JSDoc @type casts — which
  // tsc honours but typescript-eslint's no-unsafe-* rules can't see in .js — so
  // these three fire only at those unavoidable ingestion points. tsc (checkJs)
  // still verifies the cast targets and compute()'s typed Results output, and
  // no-unsafe-member-access/-call stay on to catch any that leaks past a cast.
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  {
    rules: {
      // tsconfig sets noPropertyAccessFromIndexSignature, which forces bracket
      // access on index signatures (dataset['nav'], process.env['X']). Stop
      // dot-notation from demanding the dot form those very rules forbid.
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      // Keep `||` for string fallbacks where an empty string should also fall
      // through (e.g. `textContent || '{}'`, `placeholder || 'TBD'`).
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      // Numbers (scores, points, goal difference) are safe to interpolate into
      // the HTML template strings; only nullish/objects/booleans are dangerous.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // The astro-eslint-parser types template (JSX-like) markup expressions as the
  // synthetic `error` type, which trips the type-unsafe rules on otherwise-fine
  // markup. Frontmatter (the fenced TS) is still fully type-checked.
  {
    files: ['**/*.astro'],
    rules: {
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // Root tooling configs: lint for style, but no type-aware rules.
  {
    files: ['eslint.config.js', 'commitlint.config.js'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },
);
