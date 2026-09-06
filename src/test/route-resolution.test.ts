import { getRouteConfigByPath, lambdaRouteProxyEntryHandler } from "../lib/lambda-route-proxy-entry-handler";
import { CustomError } from "../lib/custom-error";
import type { ConfigRouteEntry, RouteConfig, RouteModule } from "../lib/types-and-interfaces";

// ---------------------------------------------------------------------------
// Test route table — self-contained, mirrors real nova-api patterns
// ---------------------------------------------------------------------------

function route(
  method: ConfigRouteEntry["method"],
  path: string,
  handlerPath?: string
): ConfigRouteEntry {
  return {
    method,
    path,
    handlerPath: handlerPath ?? `src/routes${path}/${method.toLowerCase()}`,
    description: `${method} ${path}`,
    generateOpenApiDocs: false,
  };
}

const ROUTES: ConfigRouteEntry[] = [
  // Users — static vs param
  route("GET", "/api/v1/users/me"),
  route("GET", "/api/v1/users/{userId}"),
  route("PUT", "/api/v1/users/me"),
  route("PUT", "/api/v1/users/{userId}"),

  // Templates — static vs param
  route("GET", "/api/v1/templates/closure-projects"),
  route("GET", "/api/v1/templates/{templateId}"),

  // Contacts — static vs param
  route("GET", "/api/v1/contacts/field-values"),
  route("GET", "/api/v1/contacts/{contactId}"),

  // Outreach pages — static vs param
  route("GET", "/api/v1/outreach-pages/templates"),
  route("GET", "/api/v1/outreach-pages/{pageId}"),

  // Merge fields — static vs param
  route("GET", "/api/v1/merge-fields/catalog"),
  route("GET", "/api/v1/merge-fields/{key}"),

  // Datasets — nested static vs nested param
  route("GET", "/api/v1/datasets/{datasetId}/versions/diff"),
  route("GET", "/api/v1/datasets/{datasetId}/versions/{versionId}"),

  // Audiences — nested static vs nested param
  route("GET", "/api/v1/audiences/{audienceId}/versions/diff"),
  route("GET", "/api/v1/audiences/{audienceId}/versions/{versionId}"),

  // Campaigns — basic param extraction
  route("GET", "/api/v1/campaigns/{campaignId}"),
  route("POST", "/api/v1/campaigns"),

  // Health — no params
  route("GET", "/api/v1/health"),

  // ANY method route
  route("ANY", "/api/v1/catch-all/{proxy}"),
];

// ---------------------------------------------------------------------------
// 1. Basic resolution — exact path match with correct params
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — basic resolution", () => {
  it("resolves an exact static path", () => {
    const result = getRouteConfigByPath("/api/v1/health", "GET", ROUTES);
    expect(result.path).toBe("/api/v1/health");
    expect(result.params).toEqual({});
  });

  it("resolves a path with a single param", () => {
    const result = getRouteConfigByPath(
      "/api/v1/campaigns/camp-123",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/campaigns/{campaignId}");
    expect(result.params).toEqual({ campaignId: "camp-123" });
  });

  it("resolves a path without a leading slash", () => {
    const result = getRouteConfigByPath(
      "api/v1/campaigns/camp-456",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/campaigns/{campaignId}");
    expect(result.params).toEqual({ campaignId: "camp-456" });
  });
});

// ---------------------------------------------------------------------------
// 2. Params extraction
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — params extraction", () => {
  it("extracts campaignId from a real path", () => {
    const result = getRouteConfigByPath(
      "/api/v1/campaigns/abc-def-123",
      "GET",
      ROUTES
    );
    expect(result.params).toEqual({ campaignId: "abc-def-123" });
  });

  it("extracts nested params (datasetId + versionId)", () => {
    const result = getRouteConfigByPath(
      "/api/v1/datasets/ds-1/versions/v-42",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/datasets/{datasetId}/versions/{versionId}");
    expect(result.params).toEqual({ datasetId: "ds-1", versionId: "v-42" });
  });

  it("extracts nested params (audienceId + versionId)", () => {
    const result = getRouteConfigByPath(
      "/api/v1/audiences/aud-9/versions/v-7",
      "GET",
      ROUTES
    );
    expect(result.path).toBe(
      "/api/v1/audiences/{audienceId}/versions/{versionId}"
    );
    expect(result.params).toEqual({ audienceId: "aud-9", versionId: "v-7" });
  });
});

// ---------------------------------------------------------------------------
// 3. Most-specific-wins — static beats param at same depth
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — specificity ranking", () => {
  it("static route beats param route at same depth", () => {
    const result = getRouteConfigByPath("/api/v1/users/me", "GET", ROUTES);
    expect(result.path).toBe("/api/v1/users/me");
    expect(result.params).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 4. All 8 shadowing pairs — exhaustive
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — shadowing pairs", () => {
  it("GET /api/v1/users/me beats GET /api/v1/users/{userId}", () => {
    const result = getRouteConfigByPath("/api/v1/users/me", "GET", ROUTES);
    expect(result.path).toBe("/api/v1/users/me");
    expect(result.params).toEqual({});
  });

  it("PUT /api/v1/users/me beats PUT /api/v1/users/{userId}", () => {
    const result = getRouteConfigByPath("/api/v1/users/me", "PUT", ROUTES);
    expect(result.path).toBe("/api/v1/users/me");
    expect(result.params).toEqual({});
  });

  it("GET /api/v1/templates/closure-projects beats GET /api/v1/templates/{templateId}", () => {
    const result = getRouteConfigByPath(
      "/api/v1/templates/closure-projects",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/templates/closure-projects");
    expect(result.params).toEqual({});
  });

  it("GET /api/v1/contacts/field-values beats GET /api/v1/contacts/{contactId}", () => {
    const result = getRouteConfigByPath(
      "/api/v1/contacts/field-values",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/contacts/field-values");
    expect(result.params).toEqual({});
  });

  it("GET /api/v1/outreach-pages/templates beats GET /api/v1/outreach-pages/{pageId}", () => {
    const result = getRouteConfigByPath(
      "/api/v1/outreach-pages/templates",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/outreach-pages/templates");
    expect(result.params).toEqual({});
  });

  it("GET /api/v1/merge-fields/catalog beats GET /api/v1/merge-fields/{key}", () => {
    const result = getRouteConfigByPath(
      "/api/v1/merge-fields/catalog",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/merge-fields/catalog");
    expect(result.params).toEqual({});
  });

  it("GET /api/v1/datasets/{datasetId}/versions/diff beats …/versions/{versionId}", () => {
    const result = getRouteConfigByPath(
      "/api/v1/datasets/ds-1/versions/diff",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/datasets/{datasetId}/versions/diff");
    expect(result.params).toEqual({ datasetId: "ds-1" });
  });

  it("GET /api/v1/audiences/{audienceId}/versions/diff beats …/versions/{versionId}", () => {
    const result = getRouteConfigByPath(
      "/api/v1/audiences/aud-5/versions/diff",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/audiences/{audienceId}/versions/diff");
    expect(result.params).toEqual({ audienceId: "aud-5" });
  });

  it("param route still works for non-static paths (users)", () => {
    const result = getRouteConfigByPath(
      "/api/v1/users/usr-999",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/users/{userId}");
    expect(result.params).toEqual({ userId: "usr-999" });
  });
});

// ---------------------------------------------------------------------------
// 5. Unknown path returns 404 (not 400 or 500)
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — 404 on unknown path", () => {
  it("throws CustomError with status 404 for unmatched path", () => {
    expect(() =>
      getRouteConfigByPath("/api/v1/nonexistent", "GET", ROUTES)
    ).toThrow(CustomError);

    try {
      getRouteConfigByPath("/api/v1/nonexistent", "GET", ROUTES);
    } catch (err: any) {
      expect(err).toBeInstanceOf(CustomError);
      expect(err.httpStatusCode).toBe(404);
      expect(err._httpStatusCode).toBe(404);
    }
  });

  it("throws 404 — not 400", () => {
    try {
      getRouteConfigByPath("/totally/unknown", "GET", ROUTES);
    } catch (err: any) {
      expect(err.httpStatusCode).not.toBe(400);
      expect(err.httpStatusCode).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Method matching
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — method matching", () => {
  it("GET route does not match POST request", () => {
    expect(() =>
      getRouteConfigByPath("/api/v1/health", "POST", ROUTES)
    ).toThrow(CustomError);
  });

  it("POST route matches POST request", () => {
    const result = getRouteConfigByPath("/api/v1/campaigns", "POST", ROUTES);
    expect(result.path).toBe("/api/v1/campaigns");
    expect(result.method).toBe("POST");
  });

  it("case-insensitive method matching", () => {
    const result = getRouteConfigByPath("/api/v1/health", "get", ROUTES);
    expect(result.path).toBe("/api/v1/health");
  });

  it("ANY method matches any request method", () => {
    const result = getRouteConfigByPath(
      "/api/v1/catch-all/something",
      "DELETE",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/catch-all/{proxy}");
    expect(result.params).toEqual({ proxy: "something" });
  });
});

// ---------------------------------------------------------------------------
// 7. Query string stripped
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — query string stripping", () => {
  it("path with ?foo=bar still resolves", () => {
    const result = getRouteConfigByPath(
      "/api/v1/campaigns/c-1?foo=bar&baz=qux",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/campaigns/{campaignId}");
    expect(result.params).toEqual({ campaignId: "c-1" });
  });

  it("path with only ? resolves", () => {
    const result = getRouteConfigByPath("/api/v1/health?", "GET", ROUTES);
    expect(result.path).toBe("/api/v1/health");
  });
});

// ---------------------------------------------------------------------------
// 8. v2 rawPath mode — greedy routeKey resolved via rawPath
// ---------------------------------------------------------------------------
describe("lambdaRouteProxyEntryHandler — v2 rawPath mode", () => {
  const routeModule: RouteModule = {
    routeChain: [async () => ({ status: "ok" })],
    routeSchema: {},
  };

  const rawPathConfig: RouteConfig = {
    authorizeAllRoutes: false,
    useRawPath: true,
    routes: [
      route("GET", "/api/v1/campaigns/{campaignId}", "src/routes/campaigns/get-campaign"),
      route("GET", "/api/v1/health", "src/routes/health/get-health"),
    ],
    logging: { requestSummary: false },
  };

  const availableRouteModules: Record<string, RouteModule> = {
    "campaigns/get-campaign": routeModule,
    "health/get-health": routeModule,
  };

  function makeV2Event(overrides: Record<string, any> = {}) {
    return {
      version: "2.0",
      routeKey: "ANY /api/v1/{proxy+}",
      rawPath: "/api/v1/campaigns/camp-42",
      rawQueryString: "",
      headers: { "content-type": "application/json" },
      queryStringParameters: {},
      pathParameters: { "proxy+": "campaigns/camp-42" },
      body: null,
      isBase64Encoded: false,
      requestContext: {
        requestId: "req-rawpath-test",
        http: {
          method: "GET",
          path: "/api/v1/campaigns/camp-42",
          sourceIp: "127.0.0.1",
        },
      },
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("resolves the actual path from rawPath, not the greedy routeKey", async () => {
    const handler = lambdaRouteProxyEntryHandler(
      rawPathConfig,
      availableRouteModules
    );
    const result = await handler(makeV2Event());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe("ok");
  });

  it("returns 404 before auth for unknown rawPath", async () => {
    const handler = lambdaRouteProxyEntryHandler(
      rawPathConfig,
      availableRouteModules
    );
    const result = await handler(
      makeV2Event({ rawPath: "/api/v1/nonexistent/path" })
    );
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ message: "Not found" });
  });

  it("extracts params from rawPath correctly", async () => {
    // Use a route module that echoes back the params
    const echoModule: RouteModule = {
      routeChain: [async (args: any) => ({ params: args.params })],
      routeSchema: {},
    };
    const echoModules = { "campaigns/get-campaign": echoModule, "health/get-health": routeModule };

    const handler = lambdaRouteProxyEntryHandler(rawPathConfig, echoModules);
    const result = await handler(makeV2Event());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.params).toEqual({ campaignId: "camp-42" });
  });
});

// ---------------------------------------------------------------------------
// 9. Backward compatibility — v2 without useRawPath still uses routeKey
// ---------------------------------------------------------------------------
describe("lambdaRouteProxyEntryHandler — v2 routeKey backward compat", () => {
  const routeModule: RouteModule = {
    routeChain: [async () => ({ compat: true })],
    routeSchema: {},
  };

  const standardConfig: RouteConfig = {
    authorizeAllRoutes: false,
    // useRawPath NOT set — default behaviour
    routes: [
      route("POST", "/api/v1/things", "src/routes/things/post-thing"),
    ],
    logging: { requestSummary: false },
  };

  const availableRouteModules = { "things/post-thing": routeModule };

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("uses routeKey when useRawPath is not set", async () => {
    const handler = lambdaRouteProxyEntryHandler(
      standardConfig,
      availableRouteModules
    );
    const event = {
      version: "2.0",
      routeKey: "POST /api/v1/things",
      rawPath: "/api/v1/things",
      rawQueryString: "",
      headers: { "content-type": "application/json" },
      queryStringParameters: {},
      pathParameters: {},
      body: null,
      isBase64Encoded: false,
      requestContext: {
        requestId: "req-compat",
        http: {
          method: "POST",
          path: "/api/v1/things",
          sourceIp: "127.0.0.1",
        },
      },
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.compat).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: declaration order as tiebreaker
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — declaration order tiebreaker", () => {
  it("first declared route wins when specificity is identical", () => {
    const routes: ConfigRouteEntry[] = [
      route("GET", "/api/v1/items/{itemId}", "handler-A"),
      route("GET", "/api/v1/items/{id}", "handler-B"),
    ];
    // Both patterns match — handler-A was declared first
    const result = getRouteConfigByPath("/api/v1/items/xyz", "GET", routes);
    expect(result.handlerPath).toBe("handler-A");
  });
});

// ---------------------------------------------------------------------------
// Edge case: param route still matches when no static shadows it
// ---------------------------------------------------------------------------
describe("getRouteConfigByPath — param routes still work normally", () => {
  it("resolves to param route when no static alternative exists", () => {
    const result = getRouteConfigByPath(
      "/api/v1/templates/tmpl-42",
      "GET",
      ROUTES
    );
    expect(result.path).toBe("/api/v1/templates/{templateId}");
    expect(result.params).toEqual({ templateId: "tmpl-42" });
  });
});
