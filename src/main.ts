// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';
import * as express from 'express'; // <-- ADICIONAR ESTE IMPORT SE NÃO EXISTIR (json já implica express)
import * as path from 'path'; // <-- ADICIONAR ESTE IMPORT

async function bootstrap() {
  const bootstrapLogger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService); // Obter ConfigService

  // Configuração do CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
    allowedHeaders: 'Origin,X-Requested-With,Content-Type,Accept,Authorization',
  });

   // Adiciona middleware para ter acesso ao raw body da requisição
   app.use(json({ verify: (req, res, buf) => { (req as any).rawBody = buf; }, limit: '5mb' }));

   // --- Configurar o serviço de arquivos estáticos para os APKs ---
   const apkUploadDir = configService.get<string>('APK_UPLOAD_DIR') || './uploads/apks';
   const publicApkPath = configService.get<string>('PUBLIC_APK_PATH') || '/public/apks';

   // Certifique-se de que o caminho seja absoluto para express.static
   const absoluteApkUploadDir = path.resolve(__dirname, '..', apkUploadDir);
   bootstrapLogger.log(`Configurando servir arquivos estáticos de ${absoluteApkUploadDir} no caminho ${publicApkPath}`);
   app.use(publicApkPath, express.static(absoluteApkUploadDir));
   // --- Fim da configuração de arquivos estáticos ---


   // --- Adicionar delay configurável antes de iniciar o listener ---
   const startupDelayMs = configService.get<number>('STARTUP_DELAY_MS') || 5000;

   bootstrapLogger.log(`Aguardando ${startupDelayMs} ms para dar tempo da sincronização do DB (synchronize:true) terminar antes de iniciar o listener...`);
   await new Promise(resolve => setTimeout(resolve, startupDelayMs));
   bootstrapLogger.log('Aguarde concluído. Iniciando listener...');
   // --- Fim do delay ---


  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
  bootstrapLogger.log(`Application is running on: ${await app.getUrl()}`)
}
bootstrap();