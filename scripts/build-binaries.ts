import { build } from 'esbuild';
import { chmod } from 'fs/promises';
import { join } from 'path';

async function buildBinary() {
  const files = [
    {
      entry: 'src/bin/bootstrap-iam.ts',
      out: 'bin/bootstrap-iam.js'
    },
    {
      entry: 'src/bin/cli.ts',
      out: 'bin/cli.js'
    }
  ];

  for (const file of files) {
    const outFile = join(process.cwd(), file.out);
    
    await build({
      entryPoints: [file.entry],
      bundle: true,
      platform: 'node',
      target: 'node16',
      outfile: outFile,
      format: 'cjs',
      minify: true,
      sourcemap: false,
      external: ['aws-cdk-lib', 'aws-cdk-lib/*', 'aws-cdk', 'commander'],
      banner: {
        js: '#!/usr/bin/env node',
      },
    });

    await chmod(outFile, '755');
  }
}

buildBinary().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
}); 