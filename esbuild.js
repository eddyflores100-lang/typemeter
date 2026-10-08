const esbuild = require('esbuild');

// Bundle the VS Code extension entrypoint. `vscode` stays external;
// everything else (providers, shared types) is inlined.
esbuild
  .build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
