/**
 * Tests for the route-modules generator.
 */

import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectHandlerPaths,
  handlerPathToIdentifier,
  renderRouteModules,
  generateRouteModules,
  checkRouteModules,
} from '../lib/route-modules-generator';

async function makeFixture(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'alat-rm-'));
  const layoutsDir = path.join(root, 'src/routes/core/dashboard-layouts');
  const templatesDir = path.join(root, 'src/routes/core/dashboard-templates');
  await fsp.mkdir(layoutsDir, { recursive: true });
  await fsp.mkdir(templatesDir, { recursive: true });

  // Handler files (default exports) so imports resolve conceptually.
  for (const f of ['get-dashboard-layout', 'upsert-dashboard-layout']) {
    await fsp.writeFile(path.join(layoutsDir, `${f}.ts`), 'export default {};\n');
  }
  await fsp.writeFile(path.join(templatesDir, 'list-dashboard-templates.ts'), 'export default {};\n');

  // A route-config file declaring handlerPaths (mixed quote styles).
  await fsp.writeFile(
    path.join(layoutsDir, '_routes-config.dashboard-layouts.ts'),
    `export const routes = [
      { method: 'GET', handlerPath: 'src/routes/core/dashboard-layouts/get-dashboard-layout' },
      { method: "POST", handlerPath: "src/routes/core/dashboard-layouts/upsert-dashboard-layout" },
    ];\n`,
  );
  await fsp.writeFile(
    path.join(templatesDir, '_routes-config.dashboard-templates.ts'),
    `export const routes = [
      { method: 'GET', handlerPath: 'src/routes/core/dashboard-templates/list-dashboard-templates' },
    ];\n`,
  );
  return root;
}

describe('route-modules generator', () => {
  test('handlerPathToIdentifier produces deterministic camelCase identifiers', () => {
    expect(handlerPathToIdentifier('src/routes/core/dashboard-layouts/get-dashboard-layout')).toBe(
      'coreDashboardLayoutsGetDashboardLayout',
    );
    expect(handlerPathToIdentifier('src/routes/core/health/health-check')).toBe('coreHealthHealthCheck');
  });

  test('collectHandlerPaths scans _routes-config files (both quote styles)', async () => {
    const cwd = await makeFixture();
    const handlerPaths = await collectHandlerPaths({ cwd });
    expect(handlerPaths).toEqual([
      'src/routes/core/dashboard-layouts/get-dashboard-layout',
      'src/routes/core/dashboard-layouts/upsert-dashboard-layout',
      'src/routes/core/dashboard-templates/list-dashboard-templates',
    ]);
  });

  test('renderRouteModules emits imports + a handlerPath-keyed map', () => {
    const content = renderRouteModules(
      [
        'src/routes/core/dashboard-layouts/get-dashboard-layout',
        'src/routes/core/dashboard-templates/list-dashboard-templates',
      ],
      { cwd: '/proj', outFile: 'src/route-modules.ts' },
    );
    expect(content).toContain("import { RouteModule } from 'aws-lambda-api-tools';");
    expect(content).toContain(
      "import coreDashboardLayoutsGetDashboardLayout from './routes/core/dashboard-layouts/get-dashboard-layout';",
    );
    expect(content).toContain(
      "'src/routes/core/dashboard-layouts/get-dashboard-layout': coreDashboardLayoutsGetDashboardLayout,",
    );
    expect(content).toContain('export default routeModules;');
  });

  test('generateRouteModules writes a file that checkRouteModules then reports in sync', async () => {
    const cwd = await makeFixture();
    const gen = await generateRouteModules({ cwd });
    expect(gen.changed).toBe(true);
    expect(gen.handlerPaths).toHaveLength(3);

    const check = await checkRouteModules({ cwd });
    expect(check.inSync).toBe(true);
    expect(check.missing).toEqual([]);
    expect(check.extra).toEqual([]);

    // Idempotent: a second generate makes no change.
    const again = await generateRouteModules({ cwd });
    expect(again.changed).toBe(false);
  });

  test('checkRouteModules flags a route declared in config but missing from the map', async () => {
    const cwd = await makeFixture();
    await generateRouteModules({ cwd });

    // Add a new route to config without regenerating the map.
    await fsp.writeFile(
      path.join(cwd, 'src/routes/core/dashboard-templates/_routes-config.extra.ts'),
      `export const routes = [
        { method: 'DELETE', handlerPath: 'src/routes/core/dashboard-templates/delete-dashboard-template' },
      ];\n`,
    );

    const check = await checkRouteModules({ cwd });
    expect(check.inSync).toBe(false);
    expect(check.missing).toContain('src/routes/core/dashboard-templates/delete-dashboard-template');
  });
});
