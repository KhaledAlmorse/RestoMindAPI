import { Logger } from '@nestjs/common';

export function validateEnvironment(): void {
  const logger = new Logger('EnvironmentValidation');
  const isProduction = process.env.NODE_ENV === 'production';

  const requiredVariables = [
    'DB_URL',
    'ACCESS_TOKEN_SECRET',
    'REFRESH_TOKEN_SECRET',
  ];

  const missing = requiredVariables.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(errorMsg);
    if (isProduction) {
      throw new Error(errorMsg);
    }
  }

  // Secret strength checks
  const secretsToCheck = [
    { name: 'ACCESS_TOKEN_SECRET', val: process.env.ACCESS_TOKEN_SECRET },
    { name: 'REFRESH_TOKEN_SECRET', val: process.env.REFRESH_TOKEN_SECRET },
  ];

  for (const { name, val } of secretsToCheck) {
    if (val && val.length < 32) {
      const warnMsg = `Security Warning: ${name} is under 32 characters. Consider using a stronger secret in production.`;
      logger.warn(warnMsg);
    }
  }

  if (isProduction && (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === '*')) {
    const errorMsg =
      'ALLOWED_ORIGINS must be set to a specific origin (not unset or "*") in production.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  logger.log(`Environment validation complete (NODE_ENV=${process.env.NODE_ENV || 'development'}).`);
}
