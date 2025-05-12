// src/version/version.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AppVersion } from '../models/appVersion/app-version.model';
import { VersionService } from './version.service';
import { VersionController } from './version.controller';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as multer from 'multer';
import { AuthModule } from 'src/Auth/auth.module'; // Importar AuthModule para usar guards

@Module({
  imports: [
    ConfigModule, // Necessário para usar ConfigService
    SequelizeModule.forFeature([AppVersion]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uploadDir = configService.get<string>('APK_UPLOAD_DIR') || './uploads/apks';
        // Cria o diretório se ele não existir
        require('fs').mkdirSync(uploadDir, { recursive: true });

        return {
          storage: multer.diskStorage({
            destination: (req, file, cb) => {
              cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
              // Use o nome do arquivo original com um timestamp para evitar conflitos
              // ou uma lógica baseada na versão se ela vier no body antes do upload
              const version = (req.body as any).version || 'unknown'; // Tenta pegar a versão do body
              const timestamp = Date.now();
              const fileExtension = path.extname(file.originalname);
              // Formato: app-[versao]-[timestamp].[extensao]
              const newFilename = `app-${version}-${timestamp}${fileExtension}`;
              cb(null, newFilename);
            },
          }),
           // Opcional: Limitar tamanho ou tipos de arquivo
          limits: {
              fileSize: 1024 * 1024 * 50, // 50MB limite, ajuste conforme necessário
          },
          fileFilter: (req, file, cb) => {
              if (file.mimetype === 'application/vnd.android.package-archive') {
                  cb(null, true); // Aceita arquivos .apk
              } else {
                   cb(new Error('Tipo de arquivo inválido. Apenas arquivos APK são permitidos.'), false);
              }
          },
        };
      },
      inject: [ConfigService],
    }),
     AuthModule, // Importar AuthModule
  ],
  providers: [VersionService],
  controllers: [VersionController],
  exports: [VersionService], // Exportar se outros módulos precisarem consultar a versão
})
export class VersionModule {}