/**
 * `openApiVersion: '3.1'` emits schemas as OpenAPI 3.1 (JSON Schema 2020-12) defines
 * them. joi-to-swagger writes 3.0's `nullable`, which 3.1 removed: a 3.1 reader
 * would silently treat those fields as non-nullable.
 */
import * as Joi from 'joi';
import { buildOpenApiDocument } from '../lib/openapi-document-generator';
import { toOpenApi31Schema } from '../lib/openapi-31';
import type { RouteConfig, RouteModule } from '../lib/types-and-interfaces';

describe('toOpenApi31Schema', () => {
  it('turns nullable into a null type, and keeps everything else', () => {
    expect(toOpenApi31Schema({ type: 'string', nullable: true, maxLength: 5 })).toEqual({ type: ['string', 'null'], maxLength: 5 });
    expect(toOpenApi31Schema({ type: 'string', enum: ['a', 'b'], nullable: true })).toEqual({
      type: ['string', 'null'],
      enum: ['a', 'b', null],
    });
    expect(toOpenApi31Schema({ type: 'integer', nullable: false })).toEqual({ type: 'integer' });
  });

  it('wraps a nullable reference or composition, which has no type to widen', () => {
    expect(toOpenApi31Schema({ $ref: '#/components/schemas/Thing', nullable: true, description: 'A thing' })).toEqual({
      description: 'A thing',
      anyOf: [{ $ref: '#/components/schemas/Thing' }, { type: 'null' }],
    });
    expect(toOpenApi31Schema({ oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true })).toEqual({
      anyOf: [{ oneOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'null' }],
    });
  });

  it('drops nullable where nothing restricts the value, since it already admits null', () => {
    expect(toOpenApi31Schema({ nullable: true, description: 'Anything' })).toEqual({ description: 'Anything' });
  });

  it('converts nested schemas and 3.0’s example and boolean exclusive bounds', () => {
    expect(
      toOpenApi31Schema({
        type: 'object',
        properties: {
          note: { type: 'string', nullable: true, example: 'hi' },
          tags: { type: 'array', items: { type: 'string', nullable: true } },
          ratio: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 1, exclusiveMaximum: false },
        },
        additionalProperties: { type: 'integer', nullable: true },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        note: { type: ['string', 'null'], examples: ['hi'] },
        tags: { type: 'array', items: { type: ['string', 'null'] } },
        ratio: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      },
      additionalProperties: { type: ['integer', 'null'] },
    });
  });
});

describe('buildOpenApiDocument with openApiVersion 3.1', () => {
  const config: RouteConfig = {
    routesBaseUrlPath: '/api/v1',
    routes: [
      {
        method: 'PATCH',
        path: '/api/v1/notes/{noteId}',
        handlerPath: 'src/routes/notes/update-note',
        description: 'Update a note',
        swaggerMethodName: 'updateNote',
        generateOpenApiDocs: true,
      },
    ],
  };
  const modules: Record<string, RouteModule> = {
    'src/routes/notes/update-note': {
      routeChain: [],
      routeSchema: {
        params: { noteId: Joi.string().required() },
        query: { draft: Joi.boolean().allow(null).optional() },
        requestBody: Joi.object({ text: Joi.string().allow(null).optional(), pinned: Joi.boolean() }).meta({ className: 'UpdateNoteRequest' }),
        responseBody: Joi.object({ id: Joi.string().required(), text: Joi.string().allow(null) }).meta({ className: 'Note' }),
      },
    },
  };

  it('emits no 3.0-only keyword anywhere: parameters, bodies and components', () => {
    const doc = buildOpenApiDocument(config, (h) => modules[h]!, { openApiVersion: '3.1' });
    const json = JSON.stringify(doc);
    expect(json).not.toContain('"nullable"');
    expect(doc.components.schemas?.UpdateNoteRequest).toMatchObject({ properties: { text: { type: ['string', 'null'] } } });
    expect(doc.components.schemas?.Note).toMatchObject({ properties: { text: { type: ['string', 'null'] } } });
    expect(doc.paths['/api/v1/notes/{noteId}']!.patch!.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'draft', schema: { type: ['boolean', 'null'] } })]),
    );
  });

  it('leaves the document 3.0-shaped by default', () => {
    const doc = buildOpenApiDocument(config, (h) => modules[h]!);
    expect(JSON.stringify(doc)).toContain('"nullable":true');
  });
});
