import pino from 'pino';

export const getLogger = () => {
  const environment = process.env.NODE_ENV ?? 'development';
  const isProduction = environment === 'production';

  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'clean-my-mac',
      environment,
    },
    transport: isProduction
      ? undefined
      : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
  });
};
