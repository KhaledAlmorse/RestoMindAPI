import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { validateEnvironment } from './Common/Config/env.validation';

async function bootstrap() {
  // 1. Startup Environment Validation
  validateEnvironment();

  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // 2. Trust Proxy (Required when behind reverse proxies / load balancers)
  if (process.env.TRUST_PROXY === 'true') {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
  }

  // 3. Helmet Security Headers
  if (process.env.ENABLE_HELMET !== 'false') {
    app.use(
      helmet({
        contentSecurityPolicy:
          process.env.ENABLE_SWAGGER === 'true' ? false : undefined,
        crossOriginEmbedderPolicy: false,
      }),
    );
  }

  // 4. Request Body Size Protection
  app.use(json({ limit: process.env.MAX_JSON_BODY_SIZE || '1mb' }));
  app.use(
    urlencoded({
      extended: true,
      limit: process.env.MAX_URLENCODED_BODY_SIZE || '1mb',
    }),
  );

  // 5. Environment-Driven CORS Allow-List
  const allowedOriginsString = process.env.ALLOWED_ORIGINS || '';
  const allowedOrigins = allowedOriginsString
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (requestOrigin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, server-to-server)
      if (!requestOrigin) return callback(null, true);

      // In non-production, if ALLOWED_ORIGINS is unset or localhost, permit local origins
      if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(requestOrigin)) {
        return callback(null, true);
      }

      logger.warn(`CORS rejected request from origin: ${requestOrigin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Authorization,Content-Type,Accept,X-Requested-With',
  });

  // 6. Global DTO Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 7. Conditional Production-Safe Swagger
  const enableSwagger =
    process.env.ENABLE_SWAGGER === 'true' ||
    process.env.NODE_ENV !== 'production';
  if (enableSwagger) {
    const swaggerPath = process.env.SWAGGER_PATH || '/api/docs';
    const config = new DocumentBuilder()
      .setTitle('RestoMind API')
      .setDescription('RestoMind Backend REST API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document);
    logger.log(`Swagger documentation available at ${swaggerPath}`);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`RestoMind Backend running on port ${port}`);
}
bootstrap();
