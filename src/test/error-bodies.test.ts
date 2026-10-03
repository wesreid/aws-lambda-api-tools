import * as http from "http";
import { AddressInfo } from "net";
import { lambdaRouteProxyEntryHandler } from "../lib/lambda-route-proxy-entry-handler";
import { createDevServer } from "../lib/dev-server";
import { CustomError } from "../lib/custom-error";
import type { ErrorBodyInput, RouteConfig, RouteModule } from "../lib/types-and-interfaces";

/**
 * Every error the library answers with carries the body the product declares.
 *
 * Before this, an error body was the thrown message as plain text under
 * `Content-Type: application/json`: a client that believed the header failed to
 * parse it, and no OpenAPI document could describe it. A body that was not JSON
 * at all answered 500, as if the server had failed rather than the caller.
 */

class ProductError extends CustomError {
  constructor(message: string, statusCode: number, readonly code: string) {
    super(message, statusCode);
  }
}

const seen: ErrorBodyInput[] = [];

/** The fixture product's one error shape. */
const errorBody = (failure: ErrorBodyInput) => {
  seen.push(failure);
  const code = failure.error instanceof ProductError ? failure.error.code : `HTTP_${failure.statusCode}`;
  return { error: { code, message: failure.message } };
};

const MODULES: Record<string, RouteModule> = {
  "orders/place-order": {
    routeSchema: {},
    routeChain: [
      async (args) => {
        if (args.body?.quantity === 0) throw new ProductError("quantity must be positive", 422, "INVALID_QUANTITY");
        if (args.body?.quantity === -1) throw new Error("connection refused at 10.0.0.1");
        return { statusCode: 201, body: { id: "o-1" } };
      },
    ],
  },
};

const ROUTES = [
  {
    description: "Place an order",
    method: "POST",
    path: "/api/v1/orders",
    handlerPath: "src/routes/orders/place-order",
    generateOpenApiDocs: true,
  },
] as RouteConfig["routes"];

function v2Event(body: string, path = "/api/v1/orders") {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    queryStringParameters: {},
    pathParameters: {},
    body,
    isBase64Encoded: false,
    requestContext: { requestId: "r-1", http: { method: "POST", path, sourceIp: "1.2.3.4" } },
  } as any;
}

function v1Event(body: string) {
  return {
    path: "/api/v1/orders",
    httpMethod: "POST",
    headers: { "content-type": "application/json" },
    queryStringParameters: {},
    pathParameters: {},
    body,
    isBase64Encoded: false,
    requestContext: { requestId: "r-1", httpMethod: "POST", path: "/api/v1/orders", identity: { sourceIp: "1.2.3.4" } },
  } as any;
}

const quiet = () => {
  const spies = [jest.spyOn(console, "log"), jest.spyOn(console, "error"), jest.spyOn(console, "warn")];
  spies.forEach((s) => s.mockImplementation(() => undefined));
  return () => spies.forEach((s) => s.mockRestore());
};

let restore: () => void;
beforeEach(() => {
  seen.length = 0;
  restore = quiet();
});
afterEach(() => restore());

const FLOWS = [
  ["v2 by route key", { routes: ROUTES, errorBody }, v2Event],
  ["v2 by raw path", { routes: ROUTES, errorBody, useRawPath: true }, v2Event],
  ["v1 REST proxy", { routes: ROUTES, errorBody }, v1Event],
] as const;

describe.each(FLOWS)("lambdaRouteProxyEntryHandler with errorBody (%s)", (_name, config, event) => {
  const invoke = (body: string) => lambdaRouteProxyEntryHandler(config as RouteConfig, MODULES)(event(body));

  it("answers a thrown product error with the product's body and the error's status", async () => {
    const res: any = await invoke(JSON.stringify({ quantity: 0 }));
    expect(res.statusCode).toBe(422);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual({ error: { code: "INVALID_QUANTITY", message: "quantity must be positive" } });
  });

  it("hands the formatter what was thrown, so the product can read its own fields", async () => {
    await invoke(JSON.stringify({ quantity: 0 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.error).toBeInstanceOf(ProductError);
    expect(seen[0]!.statusCode).toBe(422);
  });

  it("answers an unexpected error as 500 through the same formatter", async () => {
    const res: any = await invoke(JSON.stringify({ quantity: -1 }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: { code: "HTTP_500", message: "connection refused at 10.0.0.1" } });
    expect(seen[0]!.error).toBeInstanceOf(Error);
  });

  it("answers a body that is not JSON as 400, not 500", async () => {
    const res: any = await invoke("{not json");
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: { code: "HTTP_400", message: "Request body is not valid JSON" } });
  });

  it("leaves a success untouched", async () => {
    const res: any = await invoke(JSON.stringify({ quantity: 1 }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ id: "o-1" });
    expect(seen).toHaveLength(0);
  });
});

describe("lambdaRouteProxyEntryHandler with errorBody, raw path mode", () => {
  it("answers an unknown path with the product's body", async () => {
    const res: any = await lambdaRouteProxyEntryHandler({ routes: ROUTES, errorBody, useRawPath: true }, MODULES)(
      v2Event("{}", "/api/v1/nowhere"),
    );
    expect(res.statusCode).toBe(404);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual({ error: { code: "HTTP_404", message: "Not found" } });
  });
});

describe("lambdaRouteProxyEntryHandler without errorBody is unchanged", () => {
  const invoke = (body: string, path?: string) =>
    lambdaRouteProxyEntryHandler({ routes: ROUTES, useRawPath: true }, MODULES)(v2Event(body, path));

  it("answers a thrown error with its message", async () => {
    const res: any = await invoke(JSON.stringify({ quantity: 0 }));
    expect(res.statusCode).toBe(422);
    expect(res.body).toBe("quantity must be positive");
  });

  it("answers an unknown path with the library's own body", async () => {
    const res: any = await invoke("{}", "/api/v1/nowhere");
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(JSON.stringify({ message: "Not found" }));
  });

  it("answers a body that is not JSON as 400", async () => {
    const res: any = await invoke("{not json");
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe("Request body is not valid JSON");
  });
});

describe("createDevServer with errorBody", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = createDevServer({ port: 0, routeConfig: { routes: ROUTES, errorBody }, routeModules: MODULES });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (path: string, body: string) =>
    new Promise<{ status: number; type: string; body: unknown }>((resolve, reject) => {
      const req = http.request(
        { port, path, method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () =>
            resolve({ status: res.statusCode!, type: String(res.headers["content-type"]), body: JSON.parse(data) }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });

  it("answers a thrown product error with the product's body", async () => {
    const res = await post("/api/v1/orders", JSON.stringify({ quantity: 0 }));
    expect(res.status).toBe(422);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: { code: "INVALID_QUANTITY", message: "quantity must be positive" } });
  });

  it("answers an unknown path with the product's body", async () => {
    const res = await post("/api/v1/nowhere", "{}");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "HTTP_404", message: "Not found" } });
  });

  it("answers a body that is not JSON as 400", async () => {
    const res = await post("/api/v1/orders", "{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "HTTP_400", message: "Request body is not valid JSON" } });
  });
});
