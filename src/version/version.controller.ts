// src/version/version.controller.ts
import {
    Controller,
    Post,
    Get,
    Body,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe, // Para validação mais robusta do arquivo
    MaxFileSizeValidator, // Para validar tamanho máximo
    FileTypeValidator, // Para validar tipo de arquivo
    BadRequestException,
    Logger,
    UseGuards,
    Req, // Para acessar o request original
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { VersionService } from './version.service';
  import { AuthGuard } from '@nestjs/passport';
  import * as fs from 'fs'; // <-- ADICIONAR ESTE IMPORT
  import { Request } from 'express'; // <-- ADICIONAR ESTE IMPORT
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
  
      /**
       * Endpoint para fazer upload de um novo APK e registrar a versão.
       * Requer autenticação (e idealmente autorização de ADMIN).
       * O APK deve ser enviado no corpo da requisição com o nome 'apkFile'.
       * Os dados da versão (version, forceUpdate, message) devem vir no corpo como campos de formulário.
       */
      @UseGuards(AuthGuard('jwt')) // Protege o endpoint com JWT
      // @UseGuards(AuthGuard('jwt'), RolesGuard) // Exemplo com Role Guard
      // @Roles(UserRole.ADMIN) // Exemplo: apenas ADMIN pode usar
      @Post('upload') // Rota /versions/upload
      @UseInterceptors(FileInterceptor('apkFile')) // 'apkFile' é o nome do campo no formulário/multipart
      async uploadVersion(
        @Body() uploadData: UploadVersionDto,
        @UploadedFile(
            // Configuração de validação do arquivo
            new ParseFilePipe({
                 validators: [
                     new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 50 }), // Limite de 50MB
                     new FileTypeValidator({ fileType: 'application/vnd.android.package-archive' }), // Apenas APK
                     // Adicione outros validadores se necessário (ex: se arquivo é obrigatório)
                 ],
                 // Opcional: if true, permite upload sem arquivo (útil se quiser apenas atualizar o DB)
                 // fileIsRequired: true,
            })
        )
        file: Express.Multer.File, // Tipo do arquivo upado (Express.Multer.File requer @types/multer)
      ) {
          this.logger.log(`Recebida requisição para upload de versão: ${uploadData.version}`);
          if (!file) {
              throw new BadRequestException('Arquivo APK não enviado.');
          }
           // Multer já salvou o arquivo no destino configurado. O nome final está em file.filename
  
          try {
               // Criar o registro no DB com os dados da versão e o nome do arquivo salvo
               const newVersion = await this.versionService.create(
                   uploadData.version,
                   uploadData.forceUpdate,
                   uploadData.message || '', // Usar string vazia se message for undefined/null
                   file.filename // Nome que o Multer salvou
               );
  
                return {
                   message: 'Versão uploaded e registrada com sucesso.',
                   version: newVersion.version,
                   forceUpdate: newVersion.forceUpdate,
                   filename: newVersion.filename,
                   uploadDate: newVersion.createdAt,
                };
  
          } catch (error) {
               // Se a criação no DB falhar (ex: versão duplicada), precisamos limpar o arquivo upado
               this.logger.error(`Erro ao processar upload da versão ${uploadData.version}: ${(error as Error).message}`, (error as Error).stack);
               const filePath = file.path; // Caminho temporário/final onde Multer salvou
                if (fs.existsSync(filePath)) { // <-- Erro fs.existsSync corrigido
                   fs.unlink(filePath, (err) => { // <-- Erro fs.unlink corrigido
                       if (err) this.logger.error(`Erro ao deletar arquivo upado após falha no DB ${filePath}: ${err.message}`);
                       else this.logger.debug(`Arquivo upado ${filePath} deletado após falha no DB.`);
                   });
                }
  
              // Re-lançar o erro para o NestJS lidar
              throw error; // O service já lança BadRequestException ou InternalServerErrorException
          }
      }
  
      /**
       * Endpoint público para o aplicativo cliente consultar a versão mais recente.
       * Retorna os dados formatados, incluindo a URL para download do APK.
       */
      @Get('latest') // Rota /versions/latest
      async getLatestVersion(@Req() req: Request) { // <-- Usando o tipo Request importado do 'express'
           // Construir a URL base da API dinamicamente
           // req.protocol + '://' + req.get('Host')
           const baseUrl = `${req.protocol}://${req.get('Host')}`; // <-- Propriedades protocol e get corrigidas
           this.logger.debug(`Base URL detectada para construção da URL do APK: ${baseUrl}`);
  
          this.logger.log('Consultando a versão mais recente disponível...');
          // O service já retorna formatado, incluindo a URL completa
          return await this.versionService.getFormattedLatest(baseUrl);
      }
  }