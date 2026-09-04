import { lambdaRouteProxyEntryHandler } from "../lib/lambda-route-proxy-entry-handler";
import type { RouteConfig, RouteModule } from "../lib/types-and-interfaces";

/**
 * End-to-end check on the entry handler itself.
 *
 * The unit tests prove the redaction helpers work. These prove the handler
 * actually *uses* them — which is the part that regressed, since the helpers
 * being correct is worthless if the handler still stringifies the raw event.
 */

const FAKE_JWT =
  "eyJraWQiOiJmYWtlIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
const SECRET_IN_BODY = "hunter2-should-never-appear";
const TOKEN_IN_QUERY = "signed.hmac.should.never.appear";

const routeModule: RouteModule = {
  routeChain: [async () => ({ ok: true })],
  // Required by RouteModule. Empty is fine here: this suite exercises logging, and
  // no validation middleware is in the chain.
  routeSchema: {},
};

const config: RouteConfig = {
  authorizeAllRoutes: false,
  routes: [
    {
      method: "POST",
      path: "/api/v1/things",
      handlerPath: "src/routes/things/post-thing",
      swaggerMethodName: "postThing",
      authorizeRoute: false,
    } as any,
  ],
};

const availableRouteModules = { "things/post-thing": routeModule };

function makeEvent() {
  return {
    version: "2.0",
    routeKey: "POST /api/v1/things",
    rawPath: "/api/v1/things",
    rawQueryString: `token=${TOKEN_IN_QUERY}`,
    headers: {
      authorization: `Bearer ${FAKE_JWT}`,
      "content-type": "application/json",
      cookie: "session=abc",
    },
    queryStringParameters: { token: TOKEN_IN_QUERY },
    pathParameters: {},
    body: JSON.stringify({ email: "a@b.com", password: SECRET_IN_BODY }),
    isBase64Encoded: false,
    requestContext: {
      requestId: "req-integration",
      http: {
        method: "POST",
        path: "/api/v1/things",
        sourceIp: "1.2.3.4",
      },
      authorizer: { jwt: { claims: { email: "a@b.com" } } },
    },
  } as any;
}

/** Capture everything written to console during a handler invocation. */
async function invokeCapturingLogs(cfg: RouteConfig) {
  const lines: string[] = [];
  const push = (...args: unknown[]) =>
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

  const log = jest.spyOn(console, "log").mockImplementation(push);
  const err = jest.spyOn(console, "error").mockImplementation(push);
  const warn = jest.spyOn(console, "warn").mockImplementation(push);

  try {
    await lambdaRouteProxyEntryHandler(cfg, availableRouteModules)(makeEvent());
  } finally {
    log.mockRestore();
    err.mockRestore();
    warn.mockRestore();
  }

  return lines.join("\n");
}

describe("lambdaRouteProxyEntryHandler logging", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LAMBDA_API_TOOLS_DEBUG;
    delete process.env.LOG_LEVEL;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  describe("default (debug off)", () => {
    it("never writes the Bearer token", async () => {
      const output = await invokeCapturingLogs(config);
      expect(output).not.toContain(FAKE_JWT);
    });

    it("never writes the request body", async () => {
      const output = await invokeCapturingLogs(config);
      expect(output).not.toContain(SECRET_IN_BODY);
    });

    it("never writes a query-string token", async () => {
      const output = await invokeCapturingLogs(config);
      expect(output).not.toContain(TOKEN_IN_QUERY);
    });

    it("does not dump the whole event", async () => {
      const output = await invokeCapturingLogs(config);
      expect(output).not.toContain("Event Data:");
    });

    it("still records that the request happened", async () => {
      // Silence would be its own problem: operators need to know a request
      // occurred even with verbose logging off.
      const output = await invokeCapturingLogs(config);
      expect(output).toContain("POST /api/v1/things");
      expect(output).toContain("requestId=req-integration");
    });
  });

  describe("debug on", () => {
    it("STILL never writes the Bearer token", async () => {
      // The point of the design: enabling debug increases verbosity, it does not
      // disable redaction. Otherwise the first person to debug production leaks
      // credentials.
      const output = await invokeCapturingLogs({ ...config, logging: { debug: true } });
      expect(output).toContain("Event Data:");
      expect(output).not.toContain(FAKE_JWT);
      expect(output).not.toContain(TOKEN_IN_QUERY);
    });

    it("logs the body but masks credential fields within it", async () => {
      const output = await invokeCapturingLogs({ ...config, logging: { debug: true } });
      expect(output).toContain("a@b.com"); // non-sensitive field retained
      expect(output).not.toContain(SECRET_IN_BODY);
    });

    it("logs the body exactly once", async () => {
      // It was previously emitted three times per request: `body:`,
      // `parsing body directly:`, then `parsedBody:`.
      const output = await invokeCapturingLogs({ ...config, logging: { debug: true } });
      const bodyLines = output
        .split("\n")
        .filter((l) => /^body \(isBase64Encoded=/.test(l));
      expect(bodyLines).toHaveLength(1);
      expect(output).not.toContain("parsing body directly");
      expect(output).not.toContain("parsedBody:");
    });
  });

  describe("env var override", () => {
    it("honours LAMBDA_API_TOOLS_DEBUG", async () => {
      process.env.LAMBDA_API_TOOLS_DEBUG = "true";
      const output = await invokeCapturingLogs(config);
      expect(output).toContain("Event Data:");
      expect(output).not.toContain(FAKE_JWT);
    });

    it("honours LOG_LEVEL=debug", async () => {
      process.env.LOG_LEVEL = "debug";
      const output = await invokeCapturingLogs(config);
      expect(output).toContain("Event Data:");
    });

    it("explicit config beats the env var", async () => {
      // An operator flipping the env var must not silently override a service
      // that has deliberately pinned debug off.
      process.env.LAMBDA_API_TOOLS_DEBUG = "true";
      const output = await invokeCapturingLogs({ ...config, logging: { debug: false } });
      expect(output).not.toContain("Event Data:");
    });

    it("ignores a non-truthy env value", async () => {
      process.env.LAMBDA_API_TOOLS_DEBUG = "false";
      const output = await invokeCapturingLogs(config);
      expect(output).not.toContain("Event Data:");
    });
  });

  it("can suppress the summary line entirely", async () => {
    const output = await invokeCapturingLogs({
      ...config,
      logging: { requestSummary: false },
    });
    expect(output).not.toContain("requestId=req-integration");
  });
});
