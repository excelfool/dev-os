// Flat config for ESLint 9. `next lint` in Next 14.2 only understands the
// legacy .eslintrc format, so `npm run lint` invokes `eslint .` directly with
// Next's recommended (core-web-vitals) rule set, which is TypeScript-aware.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: [
      '.next/**',
      '.next-*/**',
      '.netlify/**',
      'node_modules/**',
      'eval/reports/**',
      'playwright-report/**',
      'test-results/**',
      'src/generated/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // eslint-config-next 16 bundles the React Compiler-era hook rules. This
      // is a Next 14.2 codebase without the compiler; the patterns those rules
      // flag (setState inside an effect, Date.now() during render) are the
      // documented React 18 idioms this app uses, so they are not enforced.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
];
