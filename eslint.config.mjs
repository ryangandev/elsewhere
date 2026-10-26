import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Code that runs in the browser must not pull in content, the gazetteer, or zod; it reads view
// models and the generated indexes instead. See docs/architecture.md#server-and-client-boundary.
// `src/content/index.ts` also imports 'server-only', so the build fails if this is bypassed.
const SERVER_ONLY_MESSAGE =
  'Browser code reads view models and generated indexes, not content. See docs/architecture.md#server-and-client-boundary.';
const clientCode = [
  'src/ui/**/*.{ts,tsx}',
  'src/globe/**/*.{ts,tsx}',
  'src/i18n/**/*.ts',
  'src/domain/{atlas-index,destination,library,search,use-library,view-models}.ts',
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts', '.claude/**']),
  {
    files: clientCode,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'zod', message: SERVER_ONLY_MESSAGE },
            { name: '@/content', message: SERVER_ONLY_MESSAGE, allowTypeImports: true },
          ],
          patterns: [
            {
              group: ['@/content/*', '**/content/**', '**/data/geo/**'],
              message: SERVER_ONLY_MESSAGE,
              allowTypeImports: true,
            },
            {
              group: ['slugs', 'paths', 'page-views', 'client-indexes'].flatMap((module) => [
                `@/domain/${module}`,
                `./${module}`,
              ]),
              message: SERVER_ONLY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/primitives/**/*.{ts,tsx}'],
    rules: {
      // These files are vendored from shadcn/ui. Keep the registry source intact while
      // applying the stricter rules to the rest of the code.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
]);

export default eslintConfig;
