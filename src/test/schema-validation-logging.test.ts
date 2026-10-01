import * as Joi from "joi";
import { schemaValidationMiddleware } from "../lib/middlewares/route-module-schema-validation-middleware";

/**
 * The schema-validation middleware writes nothing to the log.
 *
 * It used to log the whole incoming argument object, which carries the raw event
 * and so the caller's `Authorization` header, then the body twice, on every
 * request. The entry handler stopped doing the same in 0.1.47; this middleware
 * kept doing it.
 */

const FAKE_JWT = "eyJraWQiOiJmYWtlIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
const SECRET = "hunter2-should-never-appear";

const validate = schemaValidationMiddleware({
  params: { id: Joi.string().required() },
  requestBody: Joi.object({ password: Joi.string().required() }),
});

const args = (body: unknown) => ({
  params: { id: "u-1" },
  body,
  rawEvent: { headers: { authorization: `Bearer ${FAKE_JWT}` } } as any,
});

async function captured(run: () => unknown) {
  const lines: string[] = [];
  const push = (...a: unknown[]) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const spies = [jest.spyOn(console, "log"), jest.spyOn(console, "error"), jest.spyOn(console, "warn")];
  spies.forEach((s) => s.mockImplementation(push));
  try {
    await run();
  } catch {
    // A rejected request is part of what is checked.
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
  return lines.join("\n");
}

describe("schemaValidationMiddleware logging", () => {
  it("never writes the Bearer token or the body of a valid request", async () => {
    const out = await captured(() => validate(args({ password: SECRET })));
    expect(out).not.toContain(FAKE_JWT);
    expect(out).not.toContain(SECRET);
  });

  it("never writes the Bearer token or the body of an invalid request", async () => {
    const out = await captured(() => validate(args({ password: SECRET, extra: 1, other: SECRET })));
    expect(out).not.toContain(FAKE_JWT);
    expect(out).not.toContain(SECRET);
  });

  it("still rejects an invalid request with 400", () => {
    expect(() => validate(args({}))).toThrow(expect.objectContaining({ httpStatusCode: 400 }));
  });
});
