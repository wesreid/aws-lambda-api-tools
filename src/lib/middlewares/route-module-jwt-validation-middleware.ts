import { RouteArguments } from '../types-and-interfaces';
import { CustomError } from '../custom-error';
import { parseJwt } from '../utils';

export const jwtValidationMiddleware = (incomingData: RouteArguments): RouteArguments => {
  const { routeData = {} } = incomingData;
  const authHeader = incomingData.rawEvent!.headers['authorization'];
  if (!authHeader) {
    throw new CustomError('No authorization header provided.', 401);
  }
  const tokenString = authHeader!.replace('Bearer ', '');
  const jwt = parseJwt(tokenString);
  console.log(`Decoded token: ${JSON.stringify(jwt)}`);
  if (!jwt) {
    throw new CustomError('Token not valid.', 401);
  }
  if (!jwt.email_verified) {
    throw new CustomError('Email for this account has not been verified.', 401);
  }
  if ((jwt.exp * 1000) < Date.now()) {
    throw new CustomError('Session token is expired.', 403);
  }
  if (!jwt || !(jwt.email && jwt.email_verified)) {
    throw new CustomError('Token not valid.', 401);
  }
  routeData.jwt = jwt;
  return { ...incomingData, routeData };
};

export default jwtValidationMiddleware;
