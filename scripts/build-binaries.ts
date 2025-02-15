import { build } from 'esbuild';
import { chmod } from 'fs/promises';
import { join } from 'path';

async function buildBinary() {
  await build({
    entryPoints: ['src/bin/bootstrap-iam.ts'],
    bundle: true,
    platform: 'node',
    target: 'node16',
    outfile: 'bin/bootstrap-iam.js',
    format: 'cjs',
  });

  // Make the output file executable
  await chmod(join(process.cwd(), 'bin/bootstrap-iam.js'), '755');
}

buildBinary().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
}); 