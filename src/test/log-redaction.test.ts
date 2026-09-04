import {
  REDACTED,
  redactHeaders,
  redactQueryParams,
  redactBody,
  safeEventForLog,
  requestSummary,
} from "../lib/log-redaction";

// A representative JWT shape. Not a real token, but it must be recognisable in
// assertions so a leak is unambiguous.
const FAKE_JWT =
  "eyJraWQiOiJmYWtlIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";

describe("redactHeaders", () => {
  it("masks the Authorization header", () => {
    const out = redactHeaders({ authorization: `Bearer ${FAKE_JWT}` });
    expect(out.authorization).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain(FAKE_JWT);
  });

  it("matches header names case-insensitively", () => {
    // API Gateway v2 lowercases header names; v1 and the local dev server do not.
    for (const name of ["Authorization", "AUTHORIZATION", "authorization"]) {
      const out = redactHeaders({ [name]: `Bearer ${FAKE_JWT}` });
      expect(out[name]).toBe(REDACTED);
    }
  });

  it("masks cookies and API keys", () => {
    const out = redactHeaders({
      cookie: "session=abc123",
      "x-api-key": "super-secret",
      "x-amz-security-token": "sts-token",
    });
    expect(out.cookie).toBe(REDACTED);
    expect(out["x-api-key"]).toBe(REDACTED);
    expect(out["x-amz-security-token"]).toBe(REDACTED);
  });

  it("leaves non-sensitive headers readable", () => {
    // Redacting everything would make the logs useless, which is how redaction
    // ends up being switched off.
    const out = redactHeaders({
      "content-type": "application/json",
      host: "api.example.com",
      authorization: "Bearer x",
    });
    expect(out["content-type"]).toBe("application/json");
    expect(out.host).toBe("api.example.com");
    expect(out.authorization).toBe(REDACTED);
  });

  it("does not mutate the input", () => {
    // The handler passes the original event to route handlers as `rawEvent`, and
    // auth middleware reads headers.authorization from it. Mutating here would
    // break authentication.
    const original = { authorization: `Bearer ${FAKE_JWT}` };
    redactHeaders(original);
    expect(original.authorization).toBe(`Bearer ${FAKE_JWT}`);
  });

  it("accepts extra header names", () => {
    const out = redactHeaders({ "x-custom-secret": "v" }, ["x-custom-secret"]);
    expect(out["x-custom-secret"]).toBe(REDACTED);
  });

  it("tolerates null and undefined", () => {
    expect(redactHeaders(undefined)).toBeUndefined();
    expect(redactHeaders(null)).toBeNull();
  });
});

describe("redactQueryParams", () => {
  it("masks a signed token in the query string", () => {
    // Real case: a one-click unsubscribe link is GET /public/unsubscribe?token=<hmac>.
    // Without this the signed token is logged verbatim and stays replayable.
    const out = redactQueryParams({ token: "signed.hmac.value", page: "2" });
    expect(out.token).toBe(REDACTED);
    expect(out.page).toBe("2");
  });

  it("masks OAuth and presigned-URL parameters", () => {
    const out = redactQueryParams({
      code: "oauth-code",
      access_token: "at",
      signature: "sig",
    });
    expect(out.code).toBe(REDACTED);
    expect(out.access_token).toBe(REDACTED);
    expect(out.signature).toBe(REDACTED);
  });
});

describe("redactBody", () => {
  it("masks credential fields", () => {
    const out = redactBody({ email: "a@b.com", password: "hunter2" }) as any;
    expect(out.email).toBe("a@b.com");
    expect(out.password).toBe(REDACTED);
  });

  it("masks nested credential fields", () => {
    const out = redactBody({ user: { name: "A", apiKey: "k" } }) as any;
    expect(out.user.name).toBe("A");
    expect(out.user.apiKey).toBe(REDACTED);
  });

  it("walks arrays", () => {
    const out = redactBody([{ token: "t" }, { token: "u" }]) as any;
    expect(out[0].token).toBe(REDACTED);
    expect(out[1].token).toBe(REDACTED);
  });

  it("caps depth instead of recursing without bound", () => {
    // Bodies are attacker-controlled, so logging must not be turned into a stack
    // overflow by a deeply nested payload.
    let deep: any = { value: "leaf" };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    const out = JSON.stringify(redactBody(deep));
    expect(out).toContain("[TRUNCATED: max depth]");
  });

  it("survives a circular reference", () => {
    const a: any = { name: "a" };
    a.self = a;
    expect(() => redactBody(a)).not.toThrow();
    expect(JSON.stringify(redactBody(a))).toContain("[CIRCULAR]");
  });

  it("passes primitives through", () => {
    expect(redactBody("plain")).toBe("plain");
    expect(redactBody(42)).toBe(42);
    expect(redactBody(null)).toBeNull();
  });
});

describe("safeEventForLog", () => {
  const v2Event = {
    version: "2.0",
    rawPath: "/api/v1/things",
    rawQueryString: "token=signed.value&page=2",
    headers: {
      authorization: `Bearer ${FAKE_JWT}`,
      "content-type": "application/json",
    },
    queryStringParameters: { token: "signed.value", page: "2" },
    body: '{"password":"hunter2"}',
    requestContext: {
      requestId: "req-1",
      http: { method: "POST", path: "/api/v1/things", sourceIp: "1.2.3.4" },
      authorizer: { jwt: { claims: { email: "a@b.com" } } },
    },
  };

  it("contains no trace of the token anywhere in the serialized output", () => {
    // The single assertion that matters: whatever the shape, the credential must
    // not survive serialization.
    const serialized = JSON.stringify(safeEventForLog(v2Event));
    expect(serialized).not.toContain(FAKE_JWT);
    expect(serialized).not.toContain("signed.value");
  });

  it("redacts the authorizer, which carries token claims", () => {
    const out = safeEventForLog(v2Event) as any;
    expect(out.requestContext.authorizer).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain("a@b.com");
  });

  it("drops the body, which is logged separately under debug", () => {
    const out = safeEventForLog(v2Event) as any;
    expect(out.body).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("redacts rawQueryString, which cannot be masked per key", () => {
    const out = safeEventForLog(v2Event) as any;
    expect(out.rawQueryString).toBe(REDACTED);
  });

  it("keeps non-sensitive routing fields for diagnosis", () => {
    const out = safeEventForLog(v2Event) as any;
    expect(out.rawPath).toBe("/api/v1/things");
    expect(out.headers["content-type"]).toBe("application/json");
    expect(out.requestContext.requestId).toBe("req-1");
  });

  it("does not mutate the original event", () => {
    safeEventForLog(v2Event);
    expect(v2Event.headers.authorization).toBe(`Bearer ${FAKE_JWT}`);
    expect(v2Event.body).toBe('{"password":"hunter2"}');
    expect(v2Event.requestContext.authorizer).toEqual({
      jwt: { claims: { email: "a@b.com" } },
    });
  });

  it("handles a v1 event, including multiValueHeaders", () => {
    // v1 carries the same Authorization value twice; missing the multiValue copy
    // would leak the token while appearing to have redacted it.
    const v1Event = {
      httpMethod: "GET",
      path: "/api/v1/things",
      headers: { Authorization: `Bearer ${FAKE_JWT}` },
      multiValueHeaders: { Authorization: [`Bearer ${FAKE_JWT}`] },
      requestContext: { requestId: "r", identity: { sourceIp: "9.9.9.9" } },
    };
    const serialized = JSON.stringify(safeEventForLog(v1Event));
    expect(serialized).not.toContain(FAKE_JWT);
  });

  it("tolerates a malformed event", () => {
    expect(() => safeEventForLog(undefined)).not.toThrow();
    expect(() => safeEventForLog({})).not.toThrow();
    expect(safeEventForLog("nope")).toBe("nope");
  });
});

describe("requestSummary", () => {
  it("summarizes a v2 event without any credential", () => {
    const s = requestSummary({
      requestContext: {
        requestId: "req-9",
        http: { method: "GET", path: "/health", sourceIp: "1.1.1.1" },
      },
      headers: { authorization: `Bearer ${FAKE_JWT}` },
    });
    expect(s).toBe("GET /health requestId=req-9 sourceIp=1.1.1.1");
    expect(s).not.toContain(FAKE_JWT);
  });

  it("summarizes a v1 event", () => {
    const s = requestSummary({
      httpMethod: "POST",
      path: "/things",
      requestContext: { requestId: "r1", identity: { sourceIp: "2.2.2.2" } },
    });
    expect(s).toContain("POST");
    expect(s).toContain("/things");
    expect(s).toContain("requestId=r1");
  });

  it("degrades gracefully rather than throwing", () => {
    expect(requestSummary({})).toBe("? ? requestId=- sourceIp=-");
    expect(requestSummary(undefined)).toBe("request");
  });
});
