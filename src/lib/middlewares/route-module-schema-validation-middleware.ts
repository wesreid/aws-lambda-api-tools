import joi from 'joi';
import { RouteArguments, RouteSchema } from '../types-and-interfaces';
import { CustomError } from '../custom-error';

/**
 * Validate a request's params, query and body against the route's schema, and
 * answer 400 listing every failure.
 *
 * It writes nothing to the log. It used to log the whole incoming argument object
 * (which carries the raw event, so the caller's Authorization header), each schema,
 * and the body twice, on every request. A rejection's reasons are in the 400 itself.
 */
export const schemaValidationMiddleware = (routeSchema: RouteSchema) => (incomingData: RouteArguments): RouteArguments => {
  let { params, body, query, ...rest } = incomingData;
  params = params || {};
  body = body || {};
  query = query || {};
  const { params: sParams, requestBody: sBody, query: sQuery } = routeSchema;
  const validatedOutput: RouteArguments = {};
  const errorMap = {
    params: [] as Array<any>,
    body: [] as Array<any>,
    query: [] as Array<any>,
  };
  if (sParams) {
    try {
      validatedOutput.params = joi.attempt(params, joi.compile(sParams), { abortEarly: false });
    } catch (err: any) {
      errorMap.params.push(...err.details.map((d: { message: any; }) => d.message));
    }
  }
  if (sBody) {
    try {
      validatedOutput.body = joi.attempt(body, joi.compile(sBody), { allowUnknown: true, abortEarly: false });
    } catch (err: any) {
      errorMap.body.push(...err.details.map((d: { message: any; }) => d.message));
    }
  }
  if (sQuery) {
    try {
      validatedOutput.query = joi.attempt(query, joi.compile(sQuery), { abortEarly: false });
    } catch (err: any) {
      errorMap.query.push(...err.details.map((d: { message: any; }) => d.message));
    }
  }
  if (errorMap.body.length || errorMap.params.length || errorMap.query.length) {
    const validationErrorMessage = `The request contains validation errors.
    ${errorMap.params.length ? 'Path Parameters:\n' + errorMap.params.join('\n') : ''}
    ${errorMap.query.length ? 'Querystring Parameters:\n' + errorMap.query.join('\n') : ''}
    ${errorMap.body.length ? 'Request Body:\n' + errorMap.body.join('\n') : ''}
    `;
    throw new CustomError(validationErrorMessage, 400);
  } else {
    return {
      ...validatedOutput,
      ...rest,
    };
  }
};

export default schemaValidationMiddleware;
