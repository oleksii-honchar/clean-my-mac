const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      '**/.history/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '.prettierrc.js',
      'eslint.config.js',
      'jest.config.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  require('eslint-config-prettier'),
  {
    files: ['**/*.md'],
    plugins: {
      markdown: require('eslint-plugin-markdown'),
    },
    processor: 'markdown/markdown',
  },
);
