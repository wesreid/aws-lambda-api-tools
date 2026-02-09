#!/usr/bin/env node

/*
Usage:
  npm run generate-swagger -- [configFile] [outputFile] [options]

Options:
  --no-group-tags                 Disable automatic tag grouping (all routes under a single tag)
  --no-method-names               Disable appending apiClient method names to descriptions

Examples:
  npm run generate-swagger -- ./dist/routes-config.js ./route-modules-oas.json
  npm run generate-swagger -- ./dist/routes-config.js ./route-modules-oas.json --no-group-tags
*/

const minimist = require('minimist');
const path = require('path');
const argv = minimist(process.argv.slice(2), {
  boolean: ['no-group-tags', 'no-method-names'],
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

const swaggerModulePath = path.join('.', '../dist/lib/swagger-route-specification-generator');
const { generateRouteSwaggerSpec } = require(swaggerModulePath);

const configFilePath = path.join(process.cwd(), configFile);
console.log(`config file path: ${configFilePath}`);
const { config, routesBaseUrlPath } = require(configFilePath);

const generatorOptions = {
  routesBaseUrlPath,
  groupByTag,
  includeMethodNameInDescription,
};

const swaggerSpec = { paths: {}, components: {} };

config.routes.filter(r => r.generateOpenApiDocs).forEach(r => {

  const routeHandlerModulePath = r.handlerPath.replace(process.cwd(), '.').replace('src/', 'dist/');

  const loadedModule = require(path.join(process.cwd(), routeHandlerModulePath));
  const { routeSchema } = loadedModule.default || loadedModule;

  const { path: swaggerPathAndMethodSpec, components } = generateRouteSwaggerSpec(routeSchema, r, generatorOptions);

  // Fallback: if tags weren't set by the generator (groupByTag=false), use base URL path
  if (!swaggerPathAndMethodSpec.tags || swaggerPathAndMethodSpec.tags.length === 0) {
    swaggerPathAndMethodSpec.tags = [routesBaseUrlPath.replace('/','.')];
  }

  let pathMethodItems = swaggerSpec.paths[r.path];
  if (!pathMethodItems) {
    pathMethodItems = swaggerSpec.paths[r.path] = {};
  }
  pathMethodItems[r.method.toLowerCase()] = swaggerPathAndMethodSpec;
  swaggerSpec.paths[r.path] = { ...swaggerSpec.paths[r.path], ...pathMethodItems };
  swaggerSpec.components.schemas = { ...swaggerSpec.components.schemas, ...components.schemas };
});

fs.writeFileSync(path.join(process.cwd(), outputFile), JSON.stringify(swaggerSpec, null, 2));
console.log(`OpenAPI spec written to ${outputFile} (${Object.keys(swaggerSpec.paths).length} paths)`);
process.exit(0);
