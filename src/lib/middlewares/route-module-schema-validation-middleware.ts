import joi from 'joi';
import { RouteArguments, RouteSchema } from '../types-and-interfaces';
import { CustomError } from '../custom-error';

export const schemaValidationMiddleware = (routeSchema: RouteSchema) => (incomingData: RouteArguments): RouteArguments => {
  console.log(JSON.stringify(incomingData));
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
    console.log(`params schema: ${JSON.stringify(sParams)}`);
    console.log(`params data: ${JSON.stringify(params)}`);
    try {
      validatedOutput.params = joi.attempt(params, joi.compile(sParams), { abortEarly: false });
    } catch (err: any) {
      console.error(`sParams Error: ${JSON.stringify(err)}`);
      errorMap.params.push(...err.details.map((d: { message: any; }) => d.message));
    }
  }
  if (sBody) {
    console.log(`body schema: ${JSON.stringify(sBody)}`);
    console.log(`body data: ${JSON.stringify(body)}`);
    try {
      validatedOutput.body = joi.attempt(body, joi.compile(sBody), { allowUnknown: true, abortEarly: false });
    } catch (err: any) {
      console.error(`sBody Error: ${JSON.stringify(err)}`);
      errorMap.body.push(...err.details.map((d: { message: any; }) => d.message));
    }
  }
  if (sQuery) {
    console.log(`query schema: ${JSON.stringify(sQuery)}`);
    console.log(`query data: ${JSON.stringify(query)}`);
    try {
      validatedOutput.query = joi.attempt(query, joi.compile(sQuery), { abortEarly: false });
    } catch (err: any) {
      console.error(`sQuery Error: ${JSON.stringify(err)}`);
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
