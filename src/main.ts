import * as dotenv from 'dotenv';
dotenv.config();

import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { validateEnvironment } from './Common/Config/env.validation';
import { corsOriginHandler } from './Common/Utils';

async function bootstrap() {
  // 1. Startup Environment Validation
  validateEnvironment();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // Serve static assets from public/ (Option 1)
  app.useStaticAssets(join(process.cwd(), 'public'), { prefix: '/public' });

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
        crossOriginResourcePolicy: { policy: 'cross-origin' },
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
  app.enableCors({
    origin: corsOriginHandler,
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
