import { default as atob } from 'atob';

export const parseJwt = (token: string) => {
  var base64Url = token.includes('.') ? token.split('.')[1] : token;
  var base64 = base64Url!.replace(/-/g, '+').replace(/_/g, '/');
  var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c: string) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));

  return JSON.parse(jsonPayload);
};