/**
 * OpenAPI 3.0 schemas as OpenAPI 3.1 defines them (JSON Schema 2020-12).
 *
 * joi-to-swagger writes 3.0's dialect. Three of its keywords mean something else,
 * or nothing, in 3.1:
 * - `nullable: true` was removed. A 3.1 reader ignores it, so a field that admits
 *   null would read as one that does not. It becomes a `null` type, or for a
 *   reference or composition, which has no type to widen, `anyOf` with `null`.
 * - `exclusiveMinimum` / `exclusiveMaximum` are numbers, not flags on `minimum` /
 *   `maximum`.
 * - `example` is deprecated in favour of `examples`.
 */

type Schema = Record<string, unknown>;

/** Keywords whose value is one schema. */
const SUBSCHEMA = ['items', 'additionalProperties', 'not', 'contains', 'propertyNames', 'if', 'then', 'else'];
/** Keywords whose value is a list of schemas. */
const SUBSCHEMA_LIST = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
/** Keywords whose value maps names to schemas. */
const SUBSCHEMA_MAP = ['properties', 'patternProperties', 'dependentSchemas', '$defs'];

function isSchema(value: unknown): value is Schema {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** One schema, and every schema inside it, in 3.1's dialect. */
export function toOpenApi31Schema(input: Schema): Schema {
  const out: Schema = {};
  for (const [key, value] of Object.entries(input)) {
    if (SUBSCHEMA.includes(key) && isSchema(value)) out[key] = toOpenApi31Schema(value);
    else if (SUBSCHEMA_LIST.includes(key) && Array.isArray(value)) out[key] = value.map((v) => (isSchema(v) ? toOpenApi31Schema(v) : v));
    else if (SUBSCHEMA_MAP.includes(key) && isSchema(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, v]) => [name, isSchema(v) ? toOpenApi31Schema(v) : v]));
    } else out[key] = value;
  }

  // 3.0's boolean exclusive bounds become 3.1's numeric ones.
  for (const [flag, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (out[flag] === true && typeof out[bound] === 'number') {
      out[flag] = out[bound];
      delete out[bound];
    } else if (out[flag] === false) delete out[flag];
  }

  if (out.example !== undefined) {
    if (out.examples === undefined) out.examples = [out.example];
    delete out.example;
  }

  const nullable = out.nullable === true;
  delete out.nullable;
  if (!nullable) return out;

  if (out.type !== undefined) {
    const types = Array.isArray(out.type) ? (out.type as unknown[]) : [out.type];
    out.type = types.includes('null') ? types : [...types, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return out;
  }
  const restricted = out.$ref !== undefined || out.allOf || out.anyOf || out.oneOf || out.enum || out.const !== undefined;
  if (!restricted) return out; // Nothing restricts the value, so it already admits null.

  const { description, title, ...rest } = out;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    anyOf: [rest, { type: 'null' }],
  };
}

/** Every schema in an operation (parameters, request body, responses) in 3.1's dialect. */
export function toOpenApi31Operation<T extends Record<string, unknown>>(operation: T): T {
  const out: Record<string, unknown> = { ...operation };
  if (Array.isArray(out.parameters)) {
    out.parameters = out.parameters.map((p) => (isSchema(p) && isSchema(p.schema) ? { ...p, schema: toOpenApi31Schema(p.schema) } : p));
  }
  const content = (holder: unknown) => {
    if (!isSchema(holder) || !isSchema(holder.content)) return holder;
    return {
      ...holder,
      content: Object.fromEntries(
        Object.entries(holder.content).map(([type, media]) => [
          type,
          isSchema(media) && isSchema(media.schema) ? { ...media, schema: toOpenApi31Schema(media.schema) } : media,
        ]),
      ),
    };
  };
  if (out.requestBody) out.requestBody = content(out.requestBody);
  if (isSchema(out.responses)) {
    out.responses = Object.fromEntries(Object.entries(out.responses).map(([status, r]) => [status, content(r)]));
  }
  if (isSchema(out['x-async-binding']) && isSchema((out['x-async-binding'] as Schema).payload)) {
    const binding = out['x-async-binding'] as Schema;
    out['x-async-binding'] = { ...binding, payload: toOpenApi31Schema(binding.payload as Schema) };
  }
  return out as T;
}
