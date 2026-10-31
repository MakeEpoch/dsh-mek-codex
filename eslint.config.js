export default [{ ignores: ['lib/**', 'artifacts/**', 'node_modules/**'] }, {
  files: ['host/**/*.js', 'client/**/*.js', 'shared/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: Object.fromEntries([
    'window','document','navigator','FileReader','ResizeObserver','AbortController','Response','Request','Buffer','process','console','setTimeout','clearTimeout','setInterval','clearInterval','URL','globalThis',
  ].map(name => [name, 'readonly'])) },
  rules: { 'no-undef': 'error' },
}];
