import "reflect-metadata";
require("dotenv").config();
import bodyParser = require("body-parser");
import express, { Response, NextFunction, Request } from "express";
import { logger } from "./utils/logger";
import { singleUploadRouter } from "./routers/single-upload.router";

class AppError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);

    Object.setPrototypeOf(this, new.target.prototype);
    this.name = Error.name;
    this.statusCode = statusCode;
    Error.captureStackTrace(this);
  }
}

const main = async () => {
  const app = express();

  // Configuring body parser middleware
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  app.use(singleUploadRouter);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = +new Date();
  
    res.once("finish", () => {
      const duration = Date.now() - start;
      logger.info(
        "Time taken to process " + req.originalUrl + " is: " + duration + "(ms)"
      );
    });
  
    next();
  });  

  app.get("/api/health-check", async function (req, res, next) {
    res.send(true);
  });

  const errorLogger = (
    error: Error,
    request: Request,
    response: Response,
    next: Function
  ) => {
    logger.error(`error ${error.message}`);
    next(error); // calling next middleware
  };
  app.use(errorLogger);  
  
  // Error handling Middleware function reads the error message
  // and sends back a response in JSON format
  
  const errorResponder = (
    error: AppError,
    request: Request,
    response: Response,
    next: Function
  ) => {
    response.header("Content-Type", "application/json");
  
    const status = error.statusCode || 400;
    response.status(status).send({ error: error.message });
  };
  app.use(errorResponder);

  app.listen(4002, () => {
    console.log("server started on http://localhost:4002/graphql");
  });
};

main();
