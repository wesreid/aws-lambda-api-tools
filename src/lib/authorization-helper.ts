import { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";
// import { CustomError } from './custom-error';

export const authorizeRoute = (event: APIGatewayProxyEventV2|APIGatewayProxyEvent) => {
  // extract token
  const token: string = event.headers!.authorization as string;
  if (!token) {
    // throw new CustomError('Request is unauthenticated. No bearer token exists.', 401);
  }
  // implement authorize check with jwt from issuer
};