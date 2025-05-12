// src/version/version.controller.ts
import {
    Controller,
    Post,
    Get,
    Body,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
    BadRequestException,
    Logger,
    UseGuards,
    Req,
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { VersionService } from './version.service';
  import { AuthGuard } from '@nestjs/passport';
  import * as fs from 'fs';
  import { Request } from 'express';
  // Importe UserRole e Roles/RolesGuard se você tiver um sistema de roles
  // import { UserRole } from '../models/user/user.model';
  // import { Roles } from '../Auth/roles.decorator';
  // import { RolesGuard } from '../Auth/roles.guard';
  
  
  // Definir um DTO (Data Transfer Object) para os dados do body na requisição de upload
  class UploadVersionDto {
      version!: string;
      forceUpdate!: boolean;
      message?: string;
  }
  
  @Controller('versions') // Rota base /versions
  export class VersionController {
      private readonly logger = new Logger(VersionController.name);
  
      constructor(
          private readonly versionService: VersionService,
      ) {}
  
      @UseGuards(AuthGuard('jwt'))
      // @UseGuards(AuthGuard('jwt'), RolesGuard)
      // @Roles(UserRole.ADMIN)
      @Post('upload')
      @UseInterceptors(FileInterceptor('apkFile'))
      async uploadVersion(
        @Body() uploadData: UploadVersionDto,
        @UploadedFile(
            new ParseFilePipe({
                 validators: [
                     // ALTERAR ESTA LINHA PARA UM VALOR MAIOR (2GB neste exemplo)
                     new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 2048 }), // Limite de 2GB
                     new FileTypeValidator({ fileType: 'application/vnd.android.package-archive' }),
                 ],
                 // fileIsRequired: true, // Mantido comentado, se descomentar, arquivo se torna obrigatório
            })
        )
        file: Express.Multer.File,
      ) {
          this.logger.log(`Recebida requisição para upload de versão: ${uploadData.version}`);
          if (!file) {
               // Este if é redundante se fileIsRequired: true, mas é bom ter.
              throw new BadRequestException('Arquivo APK não enviado.');
          }
  
          try {
               const newVersion = await this.versionService.create(
                   uploadData.version,
                   uploadData.forceUpdate,
                   uploadData.message || '',
                   file.filename
               );
  
                return {
                   message: 'Versão uploaded e registrada com sucesso.',
                   version: newVersion.version,
                   forceUpdate: newVersion.forceUpdate,
                   filename: file.filename, // Usar o nome que o Multer salvou
                   uploadDate: newVersion.createdAt,
                };
  
          } catch (error) {
               this.logger.error(`Erro ao processar upload da versão ${uploadData.version}: ${(error as Error).message}`, (error as Error).stack);
               const filePath = file.path;
                if (fs.existsSync(filePath)) {
                   fs.unlink(filePath, (err) => {
                       if (err) this.logger.error(`Erro ao deletar arquivo upado após falha no DB ${filePath}: ${err.message}`);
                       else this.logger.debug(`Arquivo upado ${filePath} deletado após falha no DB.`);
                   });
                }
  
              throw error;
          }
      }
  
      @Get('latest')
      async getLatestVersion(@Req() req: Request) {
           const baseUrl = `${req.protocol}://${req.get('Host')}`;
           this.logger.debug(`Base URL detectada para construção da URL do APK: ${baseUrl}`);
  
          this.logger.log('Consultando a versão mais recente disponível...');
          return await this.versionService.getFormattedLatest(baseUrl);
      }
  }