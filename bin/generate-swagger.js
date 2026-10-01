#!/usr/bin/env node

/*
Usage:
  npm run generate-swagger -- [configFile] [outputFile] [options]

Options:
  --no-group-tags                 Disable automatic tag grouping (all routes under a single tag)
  --no-method-names               Disable appending apiClient method names to descriptions
  --openapi <3.0|3.1>             The OpenAPI version the schemas are written for (default 3.0);
                                  3.1 writes a null type instead of 3.0's nullable

Examples:
  npm run generate-swagger -- ./dist/routes-config.js ./route-modules-oas.json
  npm run generate-swagger -- ./dist/routes-config.js ./route-modules-oas.json --no-group-tags
*/

const minimist = require('minimist');
const path = require('path');
const argv = minimist(process.argv.slice(2), {
  boolean: ['no-group-tags', 'no-method-names'],
  string: ['openapi'],
  default: {
    'no-group-tags': false,
    'no-method-names': false,
  },
});
const fs = require('fs');

if (argv._.length === 0) {
  argv._ = [undefined, undefined];
} else if (argv._.length === 1) {
  argv._.push(undefined);
}

const [configFile = './dist/routes-config.js', outputFile = './route-modules-oas.json'] = argv._;

const groupByTag = !argv['no-group-tags'];
const includeMethodNameInDescription = !argv['no-method-names'];
const openApiVersion = argv.openapi === undefined ? '3.0' : String(argv.openapi);
if (openApiVersion !== '3.0' && openApiVersion !== '3.1') {
  console.error(`--openapi must be 3.0 or 3.1, not ${openApiVersion}`);
  process.exit(2);
}

const { buildOpenApiDocument } = require(path.join('.', '../dist/lib/openapi-document-generator'));

const configFilePath = path.join(process.cwd(), configFile);
console.log(`config file path: ${configFilePath}`);
const { config, routesBaseUrlPath } = require(configFilePath);

// Each route's module supplies its schema and its middleware chain; the chain's
// declared security becomes the operation's standard `security`.
const loadRouteModule = (handlerPath) => {
  const routeHandlerModulePath = handlerPath.replace(process.cwd(), '.').replace('src/', 'dist/');
  const loadedModule = require(path.join(process.cwd(), routeHandlerModulePath));
  return loadedModule.default || loadedModule;
};

const swaggerSpec = buildOpenApiDocument(
  { ...config, routesBaseUrlPath: routesBaseUrlPath ?? config.routesBaseUrlPath },
  loadRouteModule,
  { groupByTag, includeMethodNameInDescription, openApiVersion },
);

fs.writeFileSync(path.join(process.cwd(), outputFile), JSON.stringify(swaggerSpec, null, 2));
console.log(`OpenAPI spec written to ${outputFile} (${Object.keys(swaggerSpec.paths).length} paths)`);
process.exit(0);
