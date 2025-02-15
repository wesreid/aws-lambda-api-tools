import { build } from 'esbuild';
import { chmod, writeFile } from 'fs/promises';
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
    
    // First build without banner
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
    });

    // Read the output and prepend shebang
    const content = await import('fs').then(fs => 
      fs.readFileSync(outFile, 'utf8')
    );
    await writeFile(outFile, `#!/usr/bin/env node\n${content}`);
    await chmod(outFile, '755');
  }
}

buildBinary().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
}); 