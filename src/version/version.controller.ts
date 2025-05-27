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
               // Chamar o novo método createOrUpdate
               const { versionRecord, operation } = await this.versionService.createOrUpdate(
                   uploadData.version,
                   uploadData.forceUpdate,
                   uploadData.message || '',
                   file.filename // Passa o nome que o Multer salvou (o nome fixo)
               );

                // Ajustar a mensagem de resposta com base na operação
                const message = operation === 'created'
                    ? 'Nova versão uploaded e registrada com sucesso.'
                    : 'Versão existente sobrescrita e atualizada com sucesso.';


                return {
                   message: message,
                   operation: operation, // Indica se foi created ou updated
                   version: versionRecord.version,
                   forceUpdate: versionRecord.forceUpdate,
                   filename: versionRecord.filename, // Usar o nome que está agora no DB (o nome fixo)
                   uploadDate: versionRecord.createdAt, // createdAt pode não mudar no update, talvez usar updatedAt
                   updatedAt: versionRecord.updatedAt, // Adicionar updatedAt para clareza na sobreposição
                };

          } catch (error) {
               this.logger.error(`Erro ao processar upload da versão ${uploadData.version}: ${(error as Error).message}`, (error as Error).stack);
               // Em caso de falha APÓS o Multer salvar o arquivo mas ANTES de salvar/atualizar no DB,
               // o arquivo upado já estará no sistema de arquivos com o nome fixo.
               // A lógica de exclusão no service tenta remover o ARQUIVO *ANTIGO* na sobreposição.
               // Se a falha ocorrer na CRIAÇÃO (versão nova, mas DB falhou) ou na ATUALIZAÇÃO
               // (DB falhou após encontrar a versão antiga), o *novo* arquivo upado com o nome fixo
               // pode permanecer no disco. Seria necessário adicionar lógica para deletar o `file.path`
               // aqui no catch *apenas* se a falha não for um BadRequestException por versão inválida
               // (que é tratada antes do Multer) e se a operação no service falhou antes de deletar
               // o arquivo antigo (cenário complexo de cobrir todas as pontas).
               // Por ora, vamos manter a exclusão no service e aceitar que em raros casos de erro
               // no DB durante a sobreposição, o arquivo antigo pode não ser deletado, mas o novo estará lá.
               // Se a falha for na criação e o arquivo upado com o nome fixo já existia (mas DB não),
               // o service tentará atualizar e pode falhar.
               // Simplified cleanup: Just attempt to delete the newly uploaded file if the service throws an error.
               // This assumes the service didn't already handle deletion of the *old* file.
               const filePath = file.path;
                if (fs.existsSync(filePath)) {
                   fs.unlink(filePath, (err) => {
                       if (err) this.logger.error(`Erro ao deletar arquivo upado (${filePath}) após falha no service: ${err.message}`);
                       else this.logger.debug(`Arquivo upado (${filePath}) deletado após falha no service.`);
                   });
                }


              throw error; // Re-lança o erro para o NestJS handler padrão
          }
      }

      // O endpoint /latest não precisa de alterações, pois ele usa o método getFormattedLatest
      // que já foi ajustado no service para buscar a URL do arquivo fixo.
      @Get('latest')
      async getLatestVersion(@Req() req: Request) {
           // Detecta a URL base da requisição (protocolo + host)
           const baseUrl = `${req.protocol}://${req.get('Host')}`;
           this.logger.debug(`Base URL detectada para construção da URL do APK: ${baseUrl}`);

          this.logger.log('Consultando a versão mais recente disponível...');
          return await this.versionService.getFormattedLatest(baseUrl);
      }
  }