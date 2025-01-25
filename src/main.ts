// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

    const logger = new Logger('Bootstrap');

  // Configuração do CORS
  app.enableCors({
    origin: '*', // Ou uma lista de origens permitidas
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
    allowedHeaders: 'Origin,X-Requested-With,Content-Type,Accept,Authorization',
  });

    const port = process.env.PORT || 6000
    await app.listen(port);
    logger.log(`Application is running on: ${await app.getUrl()}`)
}
bootstrap();