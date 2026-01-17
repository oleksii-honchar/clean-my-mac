import pino from 'pino';
import pretty from 'pino-pretty';

export const getLogger = () => {
  const environment = process.env.NODE_ENV ?? 'development';
  const isProduction = environment === 'production';

  const loggerConfig: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'clean-my-mac',
      environment,
    },
  };

  if (!isProduction) {
    // In development, use pino-pretty but write to stderr to avoid interfering with interactive prompts
    // Create a pretty stream that writes to stderr
    const prettyStream = pretty({
      colorize: true,
      singleLine: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      destination: process.stderr,
    });

    // Pass the pretty stream directly to pino
    return pino(loggerConfig, prettyStream);
  }

  return pino(loggerConfig);
};
