import { finalizeApiGatewayResponse } from "../lib/lambda-route-proxy-entry-handler";

/**
 * The response path every consumer touches, and the one place where the
 * two payload formats used to disagree.
 *
 * The bug these cover: `statusCode !== 200` was used as the test for "is
 * this an explicit response envelope", which made a 200 envelope
 * indistinguishable from domain data. It was re-wrapped — headers
 * dropped, the envelope itself serialized into the body — so no handler
 * could answer a success with headers of its own.
 */

const securityConfig = {
  defaultHeaders: { "X-Content-Type-Options": "nosniff" },
  cors: { allowedOrigins: ["https://app.example.com"] },
} as any;

// The real header generators are exercised by their own suites; here we
// only care that the normalizer applies them in the right precedence.
jest.mock("../lib/security-config-loader", () => {
  const actual = jest.requireActual("../lib/security-config-loader");
  return {
    ...actual,
    generateCorsHeaders: jest.fn(() => ({
      "Access-Control-Allow-Origin": "https://app.example.com",
    })),
    generateJwtRotationHeaders: jest.fn(() => ({ "X-Rotated-Token": "t" })),
  };
});

const v2Event = {
  version: "2.0",
  headers: { origin: "https://app.example.com" },
  requestContext: { http: { method: "POST", path: "/x" } },
} as any;

const v1Event = {
  headers: { origin: "https://app.example.com" },
  requestContext: { httpMethod: "POST", path: "/x" },
} as any;

const ctx = (event: any = v2Event) => ({ event, securityConfig });

describe("finalizeApiGatewayResponse", () => {
  it("wraps a plain handler return as a 200 with a serialized body", () => {
    const res = finalizeApiGatewayResponse({ ok: true, count: 2 }, ctx());
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ ok: true, count: 2 }));
    expect(res.headers["Content-Type"]).toBe("application/json");
  });

  it("passes a 200 envelope through, keeping its status, body and headers", () => {
    const res = finalizeApiGatewayResponse(
      {
        statusCode: 200,
        headers: { "X-Hook-Secret": "abc123" },
        body: JSON.stringify({ received: true }),
      },
      ctx()
    );
    // The regression: this used to come back as a 200 whose body was the
    // whole envelope, with X-Hook-Secret gone.
    expect(res.statusCode).toBe(200);
    expect(res.headers["X-Hook-Secret"]).toBe("abc123");
    expect(res.body).toBe(JSON.stringify({ received: true }));
    expect(JSON.parse(res.body)).not.toHaveProperty("statusCode");
  });

  it("passes a non-200 envelope through with its status", () => {
    const res = finalizeApiGatewayResponse(
      { statusCode: 404, body: JSON.stringify({ message: "Not found" }) },
      ctx()
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(JSON.stringify({ message: "Not found" }));
  });

  it("serializes an object body inside an envelope", () => {
    // API Gateway rejects a non-string body with a malformed-response 502,
    // so this must never pass an object through verbatim.
    const res = finalizeApiGatewayResponse(
      { statusCode: 201, body: { id: 7 } },
      ctx()
    );
    expect(typeof res.body).toBe("string");
    expect(res.body).toBe(JSON.stringify({ id: 7 }));
  });

  it("treats a non-JSON string body as already serialized", () => {
    const res = finalizeApiGatewayResponse(
      {
        statusCode: 200,
        headers: { "Content-Type": "text/csv" },
        body: "name,email\na,b@c.d",
      },
      ctx()
    );
    expect(res.body).toBe("name,email\na,b@c.d");
    expect(res.headers["Content-Type"]).toBe("text/csv");
  });

  it("applies header precedence: handler beats middleware beats generated", () => {
    const res = finalizeApiGatewayResponse(
      { statusCode: 200, body: "{}", headers: { "X-Layer": "handler" } },
      {
        ...ctx(),
        responseHeaders: { "X-Layer": "middleware", "X-Only-Mw": "1" },
      }
    );
    expect(res.headers["X-Layer"]).toBe("handler");
    expect(res.headers["X-Only-Mw"]).toBe("1");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(
      "https://app.example.com"
    );
  });

  it("applies CORS and security headers to plain 200 returns too", () => {
    // Previously the v2 success path emitted only Content-Type, so the
    // configured security headers never reached a normal response.
    const res = finalizeApiGatewayResponse({ ok: true }, ctx());
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(
      "https://app.example.com"
    );
    expect(res.headers["X-Rotated-Token"]).toBe("t");
  });

  it("shapes v1 and v2 events identically", () => {
    const payload = { statusCode: 200, body: "{}", headers: { A: "1" } };
    const v2 = finalizeApiGatewayResponse(payload, ctx(v2Event));
    const v1 = finalizeApiGatewayResponse(payload, ctx(v1Event));
    expect(v1).toEqual(v2);
  });

  it("preserves isBase64Encoded and v2 cookies from an envelope", () => {
    const res = finalizeApiGatewayResponse(
      {
        statusCode: 200,
        body: "eA==",
        isBase64Encoded: true,
        cookies: ["session=abc; HttpOnly"],
      },
      ctx()
    );
    expect(res.isBase64Encoded).toBe(true);
    expect(res.cookies).toEqual(["session=abc; HttpOnly"]);
  });

  it("defaults isBase64Encoded to false and omits cookies when absent", () => {
    const res = finalizeApiGatewayResponse({ ok: true }, ctx());
    expect(res.isBase64Encoded).toBe(false);
    expect(res).not.toHaveProperty("cookies");
  });

  it("renders an empty body rather than the string 'undefined'", () => {
    const res = finalizeApiGatewayResponse({ statusCode: 204 }, ctx());
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("does not mistake a domain object that merely has a body field", () => {
    // No numeric statusCode, so this is data, not an envelope.
    const res = finalizeApiGatewayResponse({ body: "post text" }, ctx());
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ body: "post text" }));
  });

  it("does not mark plain data as base64 because it has that field name", () => {
    // The guard this pins: a domain object carrying `isBase64Encoded` is
    // still data. Honouring it would tell API Gateway to base64-decode a
    // JSON payload.
    const res = finalizeApiGatewayResponse(
      { isBase64Encoded: true, data: "plain" },
      ctx()
    );
    expect(res.isBase64Encoded).toBe(false);
    expect(res.body).toBe(JSON.stringify({ isBase64Encoded: true, data: "plain" }));
  });

  it("always returns a boolean isBase64Encoded", () => {
    const res = finalizeApiGatewayResponse(
      { statusCode: 200, body: "x", isBase64Encoded: "yes" as any },
      ctx()
    );
    expect(res.isBase64Encoded).toBe(false);
  });

  it("treats a non-numeric statusCode as data, not an envelope", () => {
    const res = finalizeApiGatewayResponse(
      { statusCode: "200", body: "x" },
      ctx()
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ statusCode: "200", body: "x" }));
  });
});
