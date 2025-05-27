// src/version/version.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common'; // Importar InternalServerErrorException
import { InjectModel } from '@nestjs/sequelize';
import { AppVersion } from '../models/appVersion/app-version.model';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { QueryError } from 'sequelize'; // Importar QueryError (ou usar 'any' se preferir)

@Injectable()
export class VersionService {
    private readonly logger = new Logger(VersionService.name);
    private uploadDir: string;
    private publicPath: string; // Mantido para getFormattedLatest

    constructor(
        @InjectModel(AppVersion)
        private appVersionModel: typeof AppVersion,
        private configService: ConfigService,
    ) {
         this.uploadDir = this.configService.get<string>('APK_UPLOAD_DIR') || './uploads/apks';
         this.publicPath = this.configService.get<string>('PUBLIC_APK_PATH') || '/public/apks'; // Mantido
         // Garantir que o diretório de upload existe ao iniciar o serviço
         if (!fs.existsSync(this.uploadDir)) {
             fs.mkdirSync(this.uploadDir, { recursive: true });
         }
    }

    /**
     * Cria um novo registro de versão ou atualiza um existente no banco de dados
     * após um upload bem-sucedido. Permite sobrescrever uma versão existente
     * e lida com a condição de concorrência na criação.
     * @param version Número da versão (ex: "1.0.5").
     * @param forceUpdate Indica se o usuário deve ser forçado a atualizar.
     * @param message Mensagem opcional para o usuário.
     * @param newFilename Nome do arquivo APK salvo no servidor (o novo arquivo upado).
     * @returns O registro AppVersion criado ou atualizado e a operação realizada.
     * @throws BadRequestException se o formato da versão for inválido.
     * @throws InternalServerErrorException em caso de outros erros inesperados do DB.
     */
    async createOrUpdate(version: string, forceUpdate: boolean, message: string, newFilename: string): Promise<{ versionRecord: AppVersion, operation: 'created' | 'updated' }> {
        this.logger.log(`Processando versão no DB (create or update): ${version}, Forçar: ${forceUpdate}, Arquivo: ${newFilename}`);

         // Adicionar validação básica na string da versão
        if (!/^\d+(\.\d+){0,3}$/.test(version)) {
             this.logger.error(`Formato de versão inválido: ${version}`);
            throw new BadRequestException('Formato de número de versão inválido. Use X.Y.Z.');
        }

        let versionRecord: AppVersion | null = null;
        let operation: 'created' | 'updated' = 'created';
        let oldFilename: string | null = null; // Para armazenar o nome do arquivo antigo se for atualização


         try {
              // 1. Tentar encontrar um registro existente
             versionRecord = await this.appVersionModel.findOne({ where: { version: version } });

             if (versionRecord) {
                  // 2. Se encontrar, preparar para atualizar
                  operation = 'updated';
                  oldFilename = versionRecord.filename; // Guardar nome antigo antes da atualização
                  this.logger.warn(`Versão ${version} já existe no DB. Preparando para sobrescrever registro.`);

                   // Atualizar o registro com os NOVOS dados
                  await versionRecord.update({
                      forceUpdate: forceUpdate,
                      message: message || '',
                      filename: newFilename, // Atualiza para o nome do NOVO arquivo upado
                  });
                  // Recarregar o registro para garantir que temos a instância atualizada (incluindo updatedAt)
                   versionRecord = await this.appVersionModel.findByPk(versionRecord.id);


             } else {
                  // 3. Se não encontrar, tentar criar um novo registro
                   this.logger.log(`Versão ${version} não encontrada no DB. Tentando criar novo registro.`);
                  operation = 'created';
                  versionRecord = await this.appVersionModel.create({
                      version,
                      forceUpdate,
                      message: message || '',
                      filename: newFilename,
                  });
                   this.logger.log(`Novo registro da versão ${versionRecord.version} criado com ID ${versionRecord.id}.`);
             }

         } catch (error) {
             const dbError = error as any; // Usar 'any' ou importar o tipo específico de erro do Sequelize
             // 4. Capturar erro de violação de unicidade durante a CRIAÇÃO
             // Código de erro '23505' é comum para violação de unicidade no PostgreSQL
             if (operation === 'created' && dbError.original?.code === '23505') {
                  // Isso significa que o registro foi criado por outro processo entre o findOne e o create
                  this.logger.warn(`Race condition detectada: Versão ${version} criada por outro processo. Tentando recuperar e atualizar.`);

                   // 5. Tentar encontrar o registro novamente (agora ele DEVE existir)
                   versionRecord = await this.appVersionModel.findOne({ where: { version: version } });

                   if (versionRecord) {
                       // Proceder com a lógica de atualização
                        operation = 'updated';
                        oldFilename = versionRecord.filename; // Guardar nome antigo
                        this.logger.debug(`Recuperado registro para atualização após race condition.`);

                        await versionRecord.update({
                           forceUpdate: forceUpdate,
                           message: message || '',
                           filename: newFilename,
                       });
                        // Recarregar novamente
                        versionRecord = await this.appVersionModel.findByPk(versionRecord.id);
                        this.logger.log(`Registro da versão ${version} atualizado com sucesso após race condition.`);

                   } else {
                       // Cenário muito improvável, mas possível se o registro foi criado E deletado rapidamente por outro processo
                       this.logger.error(`Falha crítica: Versão ${version} violou unicidade, mas não foi encontrada imediatamente após.`);
                        throw new InternalServerErrorException('Erro interno: Falha ao processar versão devido a concorrência inesperada.');
                   }

             } else {
                 // 6. Outro tipo de erro de banco de dados
                 this.logger.error(`Erro inesperado do DB ao processar versão ${version}: ${(error as Error).message}`, (error as Error).stack);
                 throw new InternalServerErrorException('Erro interno ao salvar versão no banco de dados.');
             }
         }


         // Após criação OU atualização (incluindo o caso de race condition)
         if (operation === 'updated') {
             // Tentar deletar o arquivo antigo (async)
             if (oldFilename && oldFilename !== newFilename) { // Evita tentar deletar o arquivo que acabou de ser upado se o nome for igual
                   const oldFilePath = path.join(this.uploadDir, oldFilename);
                   fs.unlink(oldFilePath, (err) => {
                       if (err) {
                           // Logar o erro, mas não falhar a requisição API principal
                           this.logger.error(`Erro ao deletar arquivo APK antigo ${oldFilePath} para versão ${version}: ${err.message}`, err.stack);
                       } else {
                           this.logger.log(`Arquivo APK antigo ${oldFilePath} deletado com sucesso.`);
                       }
                   });
              } else if (oldFilename === newFilename) {
                   this.logger.debug(`Nome do arquivo antigo (${oldFilename}) é o mesmo do novo (${newFilename}). Nenhuma exclusão necessária.`);
              } else {
                   this.logger.debug(`Nenhum nome de arquivo antigo válido encontrado para a versão ${version} durante atualização.`);
              }
         }


         // Retorna o registro final (criado ou atualizado) e a operação realizada
         if (!versionRecord) {
             // Isso não deveria acontecer se a lógica estiver correta, mas é um fallback
             throw new InternalServerErrorException('Erro interno: Registro de versão não foi criado ou atualizado corretamente.');
         }

         return { versionRecord, operation };
    }


    /**
     * Retorna a versão mais recente disponível no banco de dados.
     * Ordena por data de criação descendente e pega a primeira.
     * Inclui a URL completa do APK.
     * @returns O registro da versão mais recente ou null se nenhum for encontrado.
     */
    async getLatest(): Promise<AppVersion | null> {
        this.logger.debug('Buscando a versão mais recente...');
        const latestVersion = await this.appVersionModel.findOne({
            order: [['createdAt', 'DESC']], // ORDENA POR DATA DE CRIAÇÃO
            limit: 1,
        });

        if (latestVersion) {
            this.logger.debug(`Última versão encontrada (pela data de criação): ${latestVersion.version}, Arquivo: ${latestVersion.filename}, Data: ${latestVersion.createdAt}`);
        } else {
             this.logger.debug('Nenhuma versão encontrada no DB.');
        }

        return latestVersion;
    }


     /**
      * Retorna os dados da última versão formatados para o frontend,
      * incluindo a URL completa do APK.
      * @param baseUrl A URL base da API (ex: "https://api.seusite.com").
      * @returns Objeto formatado com os dados da última versão.
      */
     async getFormattedLatest(baseUrl: string): Promise<any> {
         const latestVersion = await this.getLatest(); // Busca a versão mais recente pela data de criação

         if (!latestVersion) {
             // Retornar um objeto padrão se nenhuma versão for encontrada
             return {
                 latest_version: "0.0.0",
                 force_update: false,
                 apk_url: null,
                 message: "Nenhuma atualização disponível.",
             };
         }

          // Buscar o arquivo APK correspondente à última versão no sistema de arquivos
         // O nome do arquivo é fixo (`lotojack-lastversion.apk`) conforme configurado no Multer
         // A extensão é a do arquivo upado originalmente.
         const latestApkFilename = `lotojack-lastversion${path.extname(latestVersion.filename)}`; // Nome fixo + extensão original upada
         const latestApkPath = path.join(this.uploadDir, latestApkFilename);

         let apkUrl: string | null = null;
         // Verificar se o arquivo físico com o nome fixo existe
         if (fs.existsSync(latestApkPath)) {
             // Construir a URL completa do APK usando o nome de arquivo FIXO e o caminho público configurado
             apkUrl = `${baseUrl}${this.publicPath}/${latestApkFilename}`;
             this.logger.debug(`Arquivo APK ${latestApkFilename} encontrado. URL gerada: ${apkUrl}`);
         } else {
             this.logger.warn(`Arquivo APK ${latestApkFilename} (correspondente à versão ${latestVersion.version} no DB) NÃO encontrado no diretório de upload. A URL do APK será nula. Verifique se o Multer salvou o arquivo com este nome fixo.`);
         }


         return {
             latest_version: latestVersion.version, // Número da versão do DB
             force_update: latestVersion.forceUpdate,
             apk_url: apkUrl, // URL do arquivo FIXO, se existir
             message: latestVersion.message || "Atualização disponível!",
         };
     }

    // Método auxiliar para buscar uma versão por número exato (não usado diretamente no upload agora)
    async findByVersionNumber(version: string): Promise<AppVersion | null> {
         return this.appVersionModel.findOne({ where: { version: version } });
    }
}