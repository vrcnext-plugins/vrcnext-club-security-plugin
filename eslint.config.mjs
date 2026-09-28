// @ts-check
// Mirrors the plugin host's own lint rules, so a plugin written against this config would pass
// the host's gate unchanged. Requires: eslint, @eslint/js, typescript-eslint.
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', 'vitest.config.ts']),
  eslint.configs.recommended,
  {
    // The release signer runs under Node, never in the page; it needs Node's globals declared.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', URL: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: false, skipComments: false }],
      'max-params': ['error', 4],
      'max-depth': ['error', 3],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use an `as const` object plus a literal union instead of `enum`.' },
        { selector: 'TSModuleDeclaration[kind="namespace"]', message: 'Use ES modules instead of `namespace`.' },
      ],
      // The bridge's source policy, as lint errors, so they are found before install refuses.
      'no-restricted-globals': [
        'error',
        'window', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage',
        'sessionStorage', 'indexedDB', 'eval', 'Function', 'require', 'process',
      ],
    },
  },
]);
