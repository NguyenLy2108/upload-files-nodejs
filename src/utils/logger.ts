const { createLogger, format, transports } = require("winston");
import WinstonCloudWatch from 'winston-cloudwatch';
 
const logLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};
 
export const logger = createLogger({
  format: format.combine(format.timestamp(), format.json()),
  levels: logLevels,
  transports: process.env.AWS_CLOUDWATCH_LOG_GROUP_NAME ? [
    new transports.Console(),
    new WinstonCloudWatch({
      name: process.env.AWS_CLOUDWATCH_LOG_GROUP_NAME,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY,
      awsSecretKey: process.env.AWS_SECRET_KEY,
      awsRegion: process.env.AWS_REGION,
      logGroupName: process.env.AWS_CLOUDWATCH_LOG_GROUP_NAME,
      logStreamName: 'payment',
      jsonMessage: true,
    }),
  ] : [new transports.Console()],
});

// module.exports = { logger };