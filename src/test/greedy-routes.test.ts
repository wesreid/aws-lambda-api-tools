import {
  deriveUrlGroups,
  findMisroutedRoutes,
  greedyPathsFor,
  urlGroupOf,
} from "../lib/greedy-routes";
import { lambdaRouteProxyEntryHandler } from "../lib/lambda-route-proxy-entry-handler";
import type { ConfigRouteEntry, RouteConfig, RouteModule } from "../lib/types-and-interfaces";

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

// ---------------------------------------------------------------------------
// urlGroupOf
// ---------------------------------------------------------------------------
describe("urlGroupOf", () => {
  const BASE = "/api/v1";

  it.each([
    ["/api/v1/voices", "/api/v1/voices"],
    ["/api/v1/voices/{voiceId}", "/api/v1/voices"],
    ["/api/v1/users/me", "/api/v1/users"],
    ["/api/v1/projects/{projectId}/assets/{assetId}", "/api/v1/projects"],
    ["/api/v1/voices?limit=5", "/api/v1/voices"],
    ["/internal/users/lookup", "/internal"],
    ["internal/users/lookup", "/internal"],
  ])("%s → %s", (path, group) => {
    expect(urlGroupOf(path, BASE)).toBe(group);
  });

  it("accepts a base path with or without slashes at either end", () => {
    expect(urlGroupOf("/api/v1/voices", "api/v1/")).toBe("/api/v1/voices");
  });

  it("uses the first segment when there is no base path", () => {
    expect(urlGroupOf("/voices/{voiceId}")).toBe("/voices");
  });

  it.each([
    ["/"],
    ["/api/v1"],
    ["/api/v1/"],
    // The group would be `/api/v1/{id}`: its greedy route answers every path in the namespace.
    ["/api/v1/{id}"],
    // The group would be `/api`: a catch-all over every group on the API.
    ["/api/v2/voices"],
    ["/api"],
  ])("refuses %s", (path) => {
    expect(urlGroupOf(path, BASE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// greedyPathsFor / deriveUrlGroups
// ---------------------------------------------------------------------------
describe("greedyPathsFor", () => {
  it("registers the collection path and everything beneath it", () => {
    expect(greedyPathsFor("/api/v1/voices")).toEqual([
      "/api/v1/voices",
      "/api/v1/voices/{proxy+}",
    ]);
  });
});

describe("deriveUrlGroups", () => {
  it("returns each group once, in first-seen order", () => {
    const routes = [
      route("GET", "/api/v1/voices"),
      route("GET", "/api/v1/avatars/{avatarId}"),
      route("POST", "/api/v1/voices/{voiceId}/clone"),
      route("GET", "/internal/ecr-key-rotated"),
    ];
    expect(deriveUrlGroups(routes, "/api/v1")).toEqual([
      "/api/v1/voices",
      "/api/v1/avatars",
      "/internal",
    ]);
  });

  it("throws, naming every route with no safe group, rather than skipping it", () => {
    const routes = [
      route("GET", "/api/v1/voices"),
      route("GET", "/api/v1/{id}"),
      route("GET", "/api/v2/things"),
    ];
    expect(() => deriveUrlGroups(routes, "/api/v1")).toThrow(
      /2 route\(s\): GET \/api\/v1\/\{id\}, GET \/api\/v2\/things/
    );
  });
});

// ---------------------------------------------------------------------------
// findMisroutedRoutes
// ---------------------------------------------------------------------------
describe("findMisroutedRoutes", () => {
  it("passes a table where static segments outrank parameters", () => {
    const routes = [
      route("GET", "/api/v1/users/{userId}"),
      route("GET", "/api/v1/users/me"),
      route("PUT", "/api/v1/users/me"),
      route("GET", "/api/v1/projects/{projectId}/assets"),
      route("ANY", "/api/v1/webhooks/{provider}"),
    ];
    expect(findMisroutedRoutes(routes)).toEqual([]);
  });

  it("reports a route whose request resolves to a different handler", () => {
    // Same method and path, two handlers: the second declaration can never run.
    const routes = [
      route("GET", "/api/v1/voices/{voiceId}", "src/routes/voices/get-voice"),
      route("GET", "/api/v1/voices/{id}", "src/routes/voices/get-voice-v2"),
    ];
    expect(findMisroutedRoutes(routes)).toEqual([
      "GET /api/v1/voices/{id}: resolves to GET /api/v1/voices/{voiceId} " +
        "(src/routes/voices/get-voice), not its own handler src/routes/voices/get-voice-v2",
    ]);
  });

  it("accepts a duplicate declaration of the same handler", () => {
    const routes = [
      route("GET", "/api/v1/productions/{id}", "src/routes/projects/get-project"),
      route("GET", "/api/v1/productions/{productionId}", "src/routes/projects/get-project"),
    ];
    expect(findMisroutedRoutes(routes)).toEqual([]);
  });

  it("reports an Express-style :param, which the matcher never resolves", () => {
    const routes = [route("GET", "/api/v1/voices/:voiceId")];
    expect(findMisroutedRoutes(routes)).toEqual([
      "GET /api/v1/voices/:voiceId: declares an Express-style :param; use {param}",
    ]);
  });
});

// ---------------------------------------------------------------------------
// CORS preflight behind greedy routes (useRawPath)
// ---------------------------------------------------------------------------
describe("lambdaRouteProxyEntryHandler — CORS preflight in rawPath mode", () => {
  const calls: string[] = [];
  const module = (name: string): RouteModule => ({
    routeChain: [
      async () => {
        calls.push(name);
        return { handled: name };
      },
    ],
    routeSchema: {},
  });

  const config: RouteConfig = {
    authorizeAllRoutes: false,
    useRawPath: true,
    routes: [
      route("GET", "/api/v1/voices/{voiceId}", "src/routes/voices/get-voice"),
      route("OPTIONS", "/api/v1/uploads", "src/routes/uploads/options-upload"),
    ],
    logging: { requestSummary: false },
  };
  const modules = {
    "voices/get-voice": module("get-voice"),
    "uploads/options-upload": module("options-upload"),
  };

  function v2Event(method: string, rawPath: string) {
    return {
      version: "2.0",
      routeKey: "ANY /api/v1/voices/{proxy+}",
      rawPath,
      rawQueryString: "",
      headers: { origin: "http://localhost:5173" },
      queryStringParameters: {},
      pathParameters: { proxy: rawPath.split("/").slice(4).join("/") },
      body: null,
      isBase64Encoded: false,
      requestContext: {
        requestId: "req-preflight",
        http: { method, path: rawPath, sourceIp: "127.0.0.1" },
      },
    } as any;
  }

  beforeEach(() => {
    calls.length = 0;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("answers 204 with an empty body, without running any handler", async () => {
    const handler = lambdaRouteProxyEntryHandler(config, modules);
    const result: any = await handler(v2Event("OPTIONS", "/api/v1/voices/voice-1"));
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe("");
    expect(calls).toEqual([]);
  });

  it("answers 204 for an unknown path too: a preflight grants nothing", async () => {
    const handler = lambdaRouteProxyEntryHandler(config, modules);
    const result: any = await handler(v2Event("options", "/api/v1/nothing-here"));
    expect(result.statusCode).toBe(204);
    expect(calls).toEqual([]);
  });

  it("still runs a declared OPTIONS route", async () => {
    const handler = lambdaRouteProxyEntryHandler(config, modules);
    const result: any = await handler(v2Event("OPTIONS", "/api/v1/uploads"));
    expect(result.statusCode).toBe(200);
    expect(calls).toEqual(["options-upload"]);
  });

  it("still returns 404 for a real request to an unknown path", async () => {
    const handler = lambdaRouteProxyEntryHandler(config, modules);
    const result: any = await handler(v2Event("GET", "/api/v1/nothing-here"));
    expect(result.statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it("still routes the real request that follows the preflight", async () => {
    const handler = lambdaRouteProxyEntryHandler(config, modules);
    const result: any = await handler(v2Event("GET", "/api/v1/voices/voice-1"));
    expect(result.statusCode).toBe(200);
    expect(calls).toEqual(["get-voice"]);
  });
});
