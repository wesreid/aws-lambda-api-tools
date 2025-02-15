import { build } from 'esbuild';
import { chmod, writeFile } from 'fs/promises';
import { join } from 'path';

async function buildBinary() {
  const outFile = join(process.cwd(), 'bin/bootstrap-iam.js');
  
  await build({
    entryPoints: ['src/bin/bootstrap-iam.ts'],
    bundle: true,
    platform: 'node',
    target: 'node16',
    outfile: outFile,
    format: 'cjs',
    minify: true,
    sourcemap: false,
    external: ['aws-cdk-lib', 'aws-cdk-lib/*'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  });

  await chmod(outFile, '755');
}

buildBinary().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
}); 