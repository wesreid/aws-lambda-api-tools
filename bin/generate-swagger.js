#!/usr/bin/env node

/*
Usage:
npm run generate-swagger --args path/to/config/file output/directory
*/

const minimist = require('minimist');
const path = require('path');
const argv = minimist(process.argv.slice(2));
const fs = require('fs');

if (argv._.length === 0) {
  argv._ = [undefined, undefined];
} else if (argv._.length === 1) {
  argv._.push(undefined);
}

console.log(JSON.stringify(argv._));

const [configFile = './dist/routes-config.js', outputFile = './route-modules-oas.json'] = argv._;

const swaggerModulePath = path.join('.', '../dist/lib/swagger-route-specification-generator');
const { generateRouteSwaggerSpec } = require(swaggerModulePath);

const configFilePath = path.join(process.cwd(), configFile);
console.log(`config file path: ${configFilePath}`);
const { config, routesBaseUrlPath } = require(configFilePath);

const swaggerSpec = { paths: {}, components: {} };
const swaggerPaths = {};
const swaggerModels = {};

config.routes.filter(r => r.generateOpenApiDocs).forEach(r => {

  const routeHandlerModulePath = r.handlerPath.replace(process.cwd(), '.').replace('src/', 'dist/');

  const loadedModule = require(path.join(process.cwd(), routeHandlerModulePath));
  const { routeSchema } = loadedModule.default || loadedModule;

  const { path: swaggerPathAndMethodSpec, components } = generateRouteSwaggerSpec(routeSchema, r);
  swaggerPathAndMethodSpec.tags = [routesBaseUrlPath.replace('/','.')];
  let pathMethodItems = swaggerSpec.paths[r.path];
  if (!pathMethodItems) {
    pathMethodItems = swaggerSpec.paths[r.path] = {};
  }
  pathMethodItems[r.method.toLowerCase()] = swaggerPathAndMethodSpec;
  swaggerSpec.paths[r.path] = { ...swaggerSpec.paths[r.path], ...pathMethodItems };
  swaggerSpec.components.schemas = { ...swaggerSpec.components.schemas, ...components.schemas };
});
fs.writeFileSync(path.join(process.cwd(), outputFile), JSON.stringify(swaggerSpec));
console.log(JSON.stringify(swaggerSpec));
process.exit(0);

// require('../lib')(argv);
