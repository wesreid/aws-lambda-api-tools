#!/usr/bin/env node

// Register ts-node with esm support
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs'
  }
});

// Run the TypeScript file
require('./bootstrap-iam.ts'); 