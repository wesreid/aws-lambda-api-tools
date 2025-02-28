import { build } from 'esbuild';
import { chmod } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

  // Run tsc command
  try {
    const { stdout, stderr } = await execAsync('tsc');
    console.log('TypeScript compilation output:', stdout);
    if (stderr) {
      console.error('TypeScript compilation errors:', stderr);
    }
  } catch (error) {
    console.error('Error running tsc:', error);
  }
}

buildBinary().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
}); 