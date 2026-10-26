import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
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
