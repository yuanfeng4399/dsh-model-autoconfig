import { defineConfig } from 'tsdown'
import { rename } from 'node:fs/promises'

const PKG = 'dsh-model-autoconfig'

/**
 * The package `exports` map names `./lib/client.js`, but a CJS-format build
 * lands as `client.cjs`. Rather than publish an unexpected extension, rename
 * after the build — the file is evaluated by DSH's loader, never imported by
 * Node's CJS resolver, so the extension carries no meaning here.
 */
const renameClient = {
  name: 'rename-client-bundle',
  async closeBundle() {
    await rename(new URL('./lib/client.cjs', import.meta.url), new URL('./lib/client.js', import.meta.url)).catch(
      () => {
        // Already renamed, or the build produced no CJS chunk.
      },
    )
  },
}

// Two independently loaded halves.
//
//   lib/index.js  — Host entry. Plain ESM; Node resolves it from package `main`.
//
//   lib/client.js — Client entry. DSH's web shell does not `import()` this file:
//                   it evaluates it, so the bundle must register itself with
//                   `window.__ModuleLoader__`. The loader's factory receives a
//                   `require` that resolves the host's own module table, which
//                   is why React stays external and is never bundled.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The loader answers these; bundling a second React would break hooks.
    deps: { neverBundle: [/^@deepseek-ai\//, 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] },
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: `window.__ModuleLoader__.load({ id: '${PKG}', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    footer: `return module.exports; } });`,
    plugins: [renameClient],
  },
])
