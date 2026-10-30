import { defineConfig } from 'tsdown'

// Verification-only bundle: compiles the plugin's pure logic plus the harness
// into one runnable file, so the logic can be exercised without going through
// the GUI.
export default defineConfig({
  entry: {
    'model-fields': 'test/model-fields.ts',
    // The library itself, so the real profile can be dry-run against the exact
    // code that ships rather than against a copy of its logic.
    'model-fields-lib': 'src/client/model-fields.ts',
    'card-render': 'test/card-render.ts',
    'settings-harness': 'test/settings-harness.ts',
  },
  outDir: 'test/out',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  external: [/^node:/, 'react', 'react-dom/server'],
})
