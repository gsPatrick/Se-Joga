// src/version/version.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AppVersion } from '../models/appVersion/app-version.model';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class VersionService {
    private readonly logger = new Logger(VersionService.name);
    private uploadDir: string;
    private publicPath: string;

    constructor(
        @InjectModel(AppVersion)
        private appVersionModel: typeof AppVersion,
        private configService: ConfigService,
    ) {
         this.uploadDir = this.configService.get<string>('APK_UPLOAD_DIR') || './uploads/apks';
         this.publicPath = this.configService.get<string>('PUBLIC_APK_PATH') || '/public/apks';
         // Garantir que o diretório de upload existe ao iniciar o serviço
         if (!fs.existsSync(this.uploadDir)) {
             fs.mkdirSync(this.uploadDir, { recursive: true });
         }
    }

    /**
     * Cria um novo registro de versão no banco de dados após um upload bem-sucedido.
     * @param version Número da versão (ex: "1.0.5").
     * @param forceUpdate Indica se o usuário deve ser forçado a atualizar.
     * @param message Mensagem opcional para o usuário.
     * @param filename Nome do arquivo APK salvo no servidor.
     * @returns O novo registro AppVersion criado.
     */
    async create(version: string, forceUpdate: boolean, message: string, filename: string): Promise<AppVersion> {
        this.logger.log(`Salvando nova versão no DB: ${version}, Forçar: ${forceUpdate}, Arquivo: ${filename}`);

         // Opcional: Adicionar validação básica na string da versão
        if (!/^\d+(\.\d+){0,3}$/.test(version)) {
             this.logger.error(`Formato de versão inválido: ${version}`);
            throw new BadRequestException('Formato de número de versão inválido. Use X.Y.Z.');
        }

         // Verificar se já existe uma versão exata com este número (unique constraint no DB já ajuda)
         const existingVersion = await this.appVersionModel.findOne({ where: { version: version } });
         if (existingVersion) {
              // Decide como tratar: lançar erro, deletar o arquivo antigo e atualizar o registro?
              // Para simplificar, vamos impedir o upload da MESMA string de versão novamente.
              // Se precisar re-upar o APK para a mesma versão, terá que deletar o registro anterior manualmente.
              this.logger.warn(`Versão ${version} já existe no DB.`);
               // Opcional: Remover o arquivo que acabou de ser upado, pois não salvaremos no DB
              const filePath = path.join(this.uploadDir, filename);
              if (fs.existsSync(filePath)) {
                  fs.unlink(filePath, (err) => {
                      if (err) this.logger.error(`Erro ao deletar arquivo duplicado ${filename}: ${err.message}`);
                      else this.logger.debug(`Arquivo duplicado ${filename} deletado.`);
                  });
              }
              throw new BadRequestException(`A versão ${version} já existe.`);
         }


        const appVersion = await this.appVersionModel.create({
            version,
            forceUpdate,
            message,
            filename,
        });

         this.logger.log(`Nova versão ${appVersion.version} salva no DB com ID ${appVersion.id}.`);
        return appVersion;
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
            order: [['createdAt', 'DESC']],
            limit: 1,
        });

        if (latestVersion) {
            this.logger.debug(`Última versão encontrada: ${latestVersion.version}, Arquivo: ${latestVersion.filename}`);
             // A URL é construída no controller para incluir o host/protocolo,
             // ou podemos retornar apenas o caminho relativo aqui.
             // Vamos retornar o objeto completo do DB e o controller constrói a URL.
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
         const latestVersion = await this.getLatest();

         if (!latestVersion) {
             // Retornar um objeto padrão se nenhuma versão for encontrada
             return {
                 latest_version: "0.0.0",
                 force_update: false,
                 apk_url: null,
                 message: "Nenhuma atualização disponível.",
             };
         }

         // Construir a URL completa do APK
         const apkUrl = `${baseUrl}${this.publicPath}/${latestVersion.filename}`;

         return {
             latest_version: latestVersion.version,
             force_update: latestVersion.forceUpdate,
             apk_url: apkUrl,
             message: latestVersion.message || "Atualização disponível!", // Usar mensagem padrão se nula
         };
     }

}