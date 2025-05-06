// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Import ConfigService
import { json } from 'express'; // Import json middleware from express

async function bootstrap() {
  // Use the Logger from @nestjs/common
  const bootstrapLogger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // Configuração do CORS
  app.enableCors({
    origin: '*', // Ajuste para origens específicas em produção
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
    allowedHeaders: 'Origin,X-Requested-With,Content-Type,Accept,Authorization',
  });

   // Adiciona middleware para ter acesso ao raw body da requisição (necessário para validação HMAC do webhook)
   // O limit: '5mb' é um valor de exemplo, ajuste conforme necessário
   app.use(json({ verify: (req, res, buf) => { (req as any).rawBody = buf; }, limit: '5mb' }));


   // --- Adicionar delay configurável antes de iniciar o listener ---
   const configService = app.get(ConfigService); // Obter ConfigService da instância da app
   const startupDelayMs = configService.get<number>('STARTUP_DELAY_MS') || 5000; // Padrão 5 segundos (5000 ms)

   bootstrapLogger.log(`Aguardando ${startupDelayMs} ms para dar tempo da sincronização do DB (synchronize:true) terminar antes de iniciar o listener...`);
   await new Promise(resolve => setTimeout(resolve, startupDelayMs));
   bootstrapLogger.log('Aguarde concluído. Iniciando listener...');
   // --- Fim do delay ---


  const port = configService.get<number>('PORT') || 3000; // Obter a porta do ConfigService ou usar padrão
  await app.listen(port);
  bootstrapLogger.log(`Application is running on: ${await app.getUrl()}`)
}
bootstrap();