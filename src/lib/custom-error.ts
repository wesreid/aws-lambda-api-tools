
  export class CustomError extends Error {
    _httpStatusCode: number;
    _message: string;
  
    constructor(message: string, statusCode: number) {
      super(message);
      this._httpStatusCode = statusCode || 500;
      this._message = message;
    }
  
    get httpStatusCode() {
      return this._httpStatusCode;
    }
  
    override get message() {
      return this._message;
    }
  };