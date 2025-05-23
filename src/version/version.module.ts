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
import { AuthModule } from 'src/Auth/auth.module';
import * as fs from 'fs'; // <-- Garantir que fs está importado aqui também

@Module({
  imports: [
    ConfigModule,
    SequelizeModule.forFeature([AppVersion]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uploadDir = configService.get<string>('APK_UPLOAD_DIR') || './uploads/apks';
        // Cria o diretório se ele não existir
        if (!fs.existsSync(uploadDir)) {
             fs.mkdirSync(uploadDir, { recursive: true });
         }

        return {
          storage: multer.diskStorage({
            destination: (req, file, cb) => {
              cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
              // ALTERADO: Usar nome de arquivo fixo "lotojack-lastversion" com a extensão original do arquivo.
              const fileExtension = path.extname(file.originalname); // ex: '.apk'
              const newFilename = `lotojack-lastversion${fileExtension}`;
              cb(null, newFilename);
            },
          }),
           // Opcional: Limitar tamanho ou tipos de arquivo
          limits: {
              // ALTERAR ESTA LINHA PARA UM VALOR MAIOR (2GB neste exemplo)
              fileSize: 1024 * 1024 * 2048, // 2GB limite, ajuste conforme necessário
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
     AuthModule,
  ],
  providers: [VersionService],
  controllers: [VersionController],
  exports: [VersionService],
})
export class VersionModule {}