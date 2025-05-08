// src/payment/efi-pix.service.ts
import {
    Injectable,
    Inject,
    forwardRef,
    BadRequestException,
    NotFoundException,
    InternalServerErrorException,
    UnauthorizedException,
    Logger,
    OnModuleInit,
  } from '@nestjs/common';
  import { InjectModel } from '@nestjs/sequelize';
  import { Deposit, DepositStatus } from '../models/payment/deposit.model';
  import { Withdrawal, WithdrawalStatus } from '../models/payment/withdrawal.model';
  import { User } from '../models/user/user.model';
  import { HttpService } from '@nestjs/axios';
  import { ConfigService } from '@nestjs/config';
  import { AuthService } from '../Auth/auth.service';
  import { Sequelize } from 'sequelize-typescript';
  import { Transaction, Op } from 'sequelize'; // Importar Op para buscas OR
  import { v4 as uuidv4 } from 'uuid';
  import * as https from 'https';
  import * as fs from 'fs';
  import * as path from 'path';
  import { firstValueFrom } from 'rxjs';
  import { AxiosError } from 'axios';
  // REMOVIDO: Interval não é mais usado para polling agendado
  // import { Interval } from '@nestjs/schedule';
  
  
  @Injectable()
  export class EfiPixService implements OnModuleInit { // Mantido 'export class' para exportar a classe
  
    private readonly logger = new Logger(EfiPixService.name);
    private accessToken: string | null = null;
    private tokenExpiry: Date | null = null;
    private httpsAgent: https.Agent | undefined;
  
    // A flag isInitialized ainda é útil para garantir que o mTLS está pronto
    private isInitialized = false;
  
    // --- CREDENCIAIS EFI HARDCODED (CONFORME SEU .env) ---
    // !!! ATENÇÃO: HARDCODING É DESENCORAJADO EM PRODUÇÃO. !!!
    // !!! USE ConfigService EM PRODUÇÃO PARA CARREGAR ESTAS CONFIGURAÇÕES. !!!
    private readonly efiClientId = 'Client_Id_906a40d0e36fbc91d9ff27606eaa73f690696842';
    private readonly efiClientSecret = 'Client_Secret_89388ab4e036b9af7cfe60476104e8964232a0c4';
    private readonly efiCertPath = path.resolve(__dirname, '../../producao-756649-MundojackProducao.p12');
    private readonly efiCertPassword = '';
    private readonly efiBaseUrl = 'https://pix.api.efipay.com.br';
    private readonly efiPixKey = 'f3e32c5a-7149-455b-bec9-50533910586d';
    // --- FIM DAS CREDENCIAIS HARDCODED ---
  
  
    constructor(
      @InjectModel(Deposit)
      private depositModel: typeof Deposit,
      @InjectModel(Withdrawal)
      private withdrawalModel: typeof Withdrawal,
      private httpService: HttpService,
      @Inject(forwardRef(() => AuthService))
      private authService: AuthService,
      private sequelize: Sequelize, // Injete o Sequelize para transações
    ) {}
  
    async onModuleInit() {
      this.logger.log('Inicializando EfiPixService...');
      try {
          if (!fs.existsSync(this.efiCertPath)) {
               this.logger.error(`Arquivo de certificado não encontrado: ${this.efiCertPath}`);
               throw new InternalServerErrorException(`Arquivo de certificado não encontrado: ${this.efiCertPath}`);
          }
  
          this.httpsAgent = new https.Agent({
              pfx: fs.readFileSync(this.efiCertPath),
              passphrase: this.efiCertPassword,
              rejectUnauthorized: true, // Manter true para validação de certificado do servidor Efí
              minVersion: 'TLSv1.2', // Garantir TLS 1.2 ou superior
          });
           this.logger.log(`Certificado P12 carregado de: ${this.efiCertPath}`);
  
          // Marcar como inicializado APENAS se a configuração mTLS foi bem sucedida
          this.isInitialized = true;
          this.logger.log('EfiPixService inicializado com sucesso. Webhook será o método de atualização.');
  
  
      } catch (error) {
          const err = error as Error;
          this.logger.error(`Erro durante a inicialização do EfiPixService: ${err.message}`, err.stack);
          this.isInitialized = false;
          throw err;
      }
    }
  
    private async getAccessToken(): Promise<string> {
      const now = new Date();
      if (this.accessToken && this.tokenExpiry && this.tokenExpiry.getTime() > (now.getTime() + 5 * 60 * 1000)) {
          return this.accessToken!;
      }
  
      this.logger.debug('Solicitando novo token de acesso Efí...');
  
      const auth = Buffer.from(`${this.efiClientId}:${this.efiClientSecret}`).toString('base64');
      const tokenUrl = `${this.efiBaseUrl}/oauth/token`;
  
      try {
        if (!this.httpsAgent) {
             // Isso não deveria acontecer se onModuleInit foi bem sucedido, mas é um check de segurança
             throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
        }
        this.logger.debug(`Fazendo POST para ${tokenUrl} para obter token...`); // Log antes da chamada
        const response = await firstValueFrom(this.httpService.post(tokenUrl, { grant_type: 'client_credentials' }, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          httpsAgent: this.httpsAgent,
        }));
        this.logger.debug(`Resposta recebida de ${tokenUrl}. Status: ${response.status}`); // Log após a chamada
  
        this.accessToken = response.data.access_token;
        this.tokenExpiry = new Date(now.getTime() + (response.data.expires_in * 1000));
  
        this.logger.log('Novo token de acesso Efí obtido e cached.');
        return this.accessToken!;
  
      } catch (error) {
          const axiosError = error as AxiosError;
          this.logger.error(`Erro ao obter token de acesso Efí: ${axiosError.message}`, axiosError.stack);
           if (axiosError.response) {
              const errorData: any = axiosError.response.data;
              this.logger.error(`Efí Token Error Response: Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
           } else if (axiosError.request) {
               this.logger.error(`Efí Token Error Request: No response received.`, axiosError.request);
               this.logger.error(`Efí Token Error Request Config: ${JSON.stringify(axiosError.config)}`); // Logar config da requisição
           } else {
               this.logger.error(`Efí Token Error Message:`, axiosError.message);
           }
        throw new UnauthorizedException('Falha ao obter token de acesso da API Pix Efí.');
      }
    }
  
    // --- Métodos para Configuração de Webhook ---
  
    /**
     * Configura a URL do webhook na Efí para receber notificações de status Pix.
     * @param chave Sua chave Pix associada ao webhook.
     * @param webhookUrl A URL pública do seu endpoint de webhook.
     * @returns Promise<void>
     * @throws InternalServerErrorException se houver erro na comunicação com a Efí.
     */
    public async configureWebhook(chave: string, webhookUrl: string): Promise<void> {
         if (!this.isInitialized) {
              throw new InternalServerErrorException('Serviço Pix não inicializado. Configuração de webhook não disponível.');
         }
         this.logger.log(`Configurando webhook Efí para chave ${chave} na URL: ${webhookUrl}`);
  
         const accessToken = await this.getAccessToken();
         const webhookConfigUrl = `${this.efiBaseUrl}/v2/webhook/${chave}`;
  
         try {
              const requestBody = {
                  webhookUrl: webhookUrl
              };
  
              // Usamos o header x-skip-mtls-checking: true porque você não quer configurar mTLS no seu servidor AGORA.
              // ISSO REDUZ A SEGURANÇA. Em PRODUÇÃO, configure mTLS no seu servidor E NÃO use este header.
              // O PixController (webhook receiver) DEVE validar a origem com IP ou HMAC.
               this.logger.warn('Configurando webhook com x-skip-mtls-checking: true. Validação de origem NO SEU ENDPOINT É FUNDAMENTAL.');
  
              const response = await firstValueFrom(this.httpService.put(webhookConfigUrl, requestBody, {
                  headers: {
                      Authorization: `Bearer ${accessToken}`,
                      'Content-Type': 'application/json',
                      'x-skip-mtls-checking': 'true', // <--- Pular validação mTLS no seu servidor para Efí
                  },
                  httpsAgent: this.httpsAgent, // Usar agente com certificado Efí para autenticação Efí -> Efí
              }));
  
              this.logger.log(`Webhook configurado com sucesso para chave ${chave}. Status: ${response.status}.`);
              // A resposta 201 é esperada para sucesso na configuração.
              // A Efí deve enviar uma notificação de teste para a URL configurada logo após.
  
         } catch (error) {
             const axiosError = error as AxiosError;
             this.logger.error(`Erro ao configurar webhook na Efí para chave ${chave}, URL ${webhookUrl}: ${(error as Error).message}`, (error as Error).stack);
             if (axiosError.response) {
                 const errorData: any = axiosError.response.data;
                 this.logger.error(`Efí API Response Error (Configure Webhook): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                 // Mapear erros 4xx específicos, se aplicável
                 if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                     throw new BadRequestException(`Erro da API Efí ao configurar webhook: ${errorData?.detail || errorData?.mensagem || 'Detalhe não disponível'}`);
                 }
             } else if (axiosError.request) {
                 this.logger.error(`Efí API Request Error (Configure Webhook): No response received.`, axiosError.request);
             }
             throw new InternalServerErrorException('Erro ao configurar webhook na API Pix Efí.');
         }
    }
  
     /**
      * Consulta as informações do webhook configurado na Efí para uma chave Pix.
      * @param chave Sua chave Pix Efí para consultar.
      * @returns Informações do webhook configurado.
      */
      public async getWebhookConfig(chave: string): Promise<{ webhookUrl: string; chave: string; criacao: string }> {
          if (!this.isInitialized) {
              throw new InternalServerErrorException('Serviço Pix não inicializado. Consulta de webhook não disponível.');
          }
          this.logger.log(`Consultando configuração de webhook na Efí para chave: ${chave}`);
  
          const accessToken = await this.getAccessToken();
          const webhookConfigUrl = `${this.efiBaseUrl}/v2/webhook/${chave}`;
  
          try {
              if (!this.httpsAgent) {
                  throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
              }
              this.logger.debug(`Fazendo GET para ${webhookConfigUrl} para consultar webhook...`);
              const response = await firstValueFrom(this.httpService.get(webhookConfigUrl, {
                  headers: {
                      Authorization: `Bearer ${accessToken}`,
                  },
                  httpsAgent: this.httpsAgent,
              }));
              this.logger.debug(`Resposta recebida de ${webhookConfigUrl}. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`);
  
              return response.data; // Retorna os dados da configuração do webhook
  
          } catch (error) {
              const axiosError = error as AxiosError;
              this.logger.error(`Erro ao consultar configuração de webhook na Efí para chave ${chave}: ${(error as Error).message}`, (error as Error).stack);
  
              if (axiosError.response) {
                  const errorData: any = axiosError.response.data;
                  this.logger.error(`Efí API Response Error (Get Webhook Config): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                   if (axiosError.response.status === 404) {
                       throw new NotFoundException(`Webhook não configurado para a chave ${chave} na Efí.`);
                   }
                  if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                      throw new BadRequestException(`Erro 4xx da API Efí ao consultar webhook: ${errorData?.detail || errorData?.mensagem || 'Detalhe não disponível'}`);
                  }
              } else if (axiosError.request) {
                  this.logger.error(`Efí API Request Error (Get Webhook Config): No response received.`, axiosError.request);
              }
  
              throw new InternalServerErrorException('Erro ao consultar configuração de webhook na API Pix Efí.');
          }
      }
  
  
    // --- Métodos para Processamento de Webhook ---
  
    /**
     * Processa o payload de um webhook recebido da Efí.
     * Itera sobre as notificações Pix no payload e atualiza os registros locais e saldos.
     * @param payload O corpo da requisição POST recebida do webhook da Efí.
     * @returns Promise<void>
     */
    public async processWebhookNotification(payload: any): Promise<void> {
         if (!this.isInitialized) {
              this.logger.warn('Webhook recebido, mas serviço Pix não inicializado. Ignorando payload.');
             return;
         }
  
         this.logger.log(`Webhook recebido. Processando payload completo: ${JSON.stringify(payload)}`);
  
         // O payload deve conter um array 'pix' com as transações notificadas
         const pixNotifications = payload?.pix;
  
         if (!Array.isArray(pixNotifications) || pixNotifications.length === 0) {
             this.logger.warn('Webhook recebido, mas payload.pix não é um array ou está vazio. Nada para processar.');
             // Se for o webhook de teste, ele não tem payload.pix, e já é logado.
             // Se for um webhook real sem pix, pode ser um erro na Efí ou na sua infra que corrompeu o payload.
             return;
         }
  
         // Processa cada item (transação Pix) no array de notificações
         for (const notification of pixNotifications) {
             try {
                  // Adicionar log detalhado da notificação individual
                 this.logger.debug(`Processando item do webhook: ${JSON.stringify(notification)}`);
  
                 // Extrai dados relevantes. e2eId é o identificador único do Pix.
                 // txid é para cobranças (recebidos), idEnvio é para envios (saques).
                 const { endToEndId, txid, idEnvio, status: efiStatusNotif, valor } = notification;
  
  
                 if (!endToEndId) {
                       this.logger.warn(`Webhook notification item sem e2eId. Ignorando.`);
                       continue; // Não podemos processar sem um identificador principal
                  }
  
                  // Logar o status recebido na notificação para ver o que a Efí está enviando
                  this.logger.debug(`Notificação: e2eId: ${endToEndId}, txid: ${txid}, idEnvio: ${idEnvio}, status na notificação: ${efiStatusNotif}, valor: ${valor}`);
  
  
                  // --- Tentar encontrar e processar como DEPÓSITO (Pix Recebido) ---
                  // Depósitos são Pix Recebidos (usualmente associados a COB/COBV). Nosso registro tem txid.
                  // A notificação de DEPÓSITO CONCLUIDA deve ter nosso txid e o e2eId.
                  // Se a notificação tem txid e endToEndId E (opcionalmente) não tem idEnvio, é MUITO provável que seja um depósito concluído.
                  // Verificamos se o txid corresponde a um depósito PENDING local.
                  let deposit: Deposit | null = null; // Definir tipo e inicializar como null
                  if (txid) { // Se a notificação tem txid, é forte indicação de um recebido associado a COB/COBV
                      deposit = await this.depositModel.findOne({ where: { txid: txid, status: DepositStatus.PENDING }, include: [User] });
                  }
                   // Fallback por e2eId APENAS se não achou por txid e se o status na notificação for CONCLUIDA
                   // ou se a notificação não tem status mas tem e2eId E não tem idEnvio (implica PIX Recebido direto)
                  if (!deposit && endToEndId && (efiStatusNotif === 'CONCLUIDA' || (!efiStatusNotif && !idEnvio))) {
                       deposit = await this.depositModel.findOne({ where: { e2eId: endToEndId, status: DepositStatus.PENDING }, include: [User] });
                       if (deposit && !deposit.txid && txid) { // Se achou pelo e2eId mas o txid local está faltando, atualiza
                           await deposit.update({ txid: txid });
                       }
                  }
  
  
                 if (deposit) { // Verificar se deposit não é null
                     this.logger.debug(`Webhook matched PENDING Deposit ID ${deposit.id} by txid/e2eId. Status na notificação: ${efiStatusNotif}.`);
                     // Para depósitos, a notificação de pagamento recebido implica CONCLUIDA.
                     // Se o status na notificação for CONCLUIDA, usamos ele.
                     // Se não tiver status, assumimos CONCLUIDA para um PIX recebido (tem txid ou matched por e2eId sem idEnvio).
                     const finalDepositStatus = efiStatusNotif === 'CONCLUIDA' ? 'CONCLUIDA' : 'CONCLUIDA'; // Assumimos CONCLUIDA para notificação de pagamento
                     await this._updateDepositStatusFromWebhook(deposit, finalDepositStatus, endToEndId);
                     continue; // Processado como depósito, vai para o próximo item do webhook
                 }
  
                 // --- Tentar encontrar e processar como SAQUE (Pix Enviado) ---
                 // Saques são Pix Enviados. Nosso registro tem idEnvio.
                 // A notificação de SAQUE REALIZADO/NAO_REALIZADO deve ter nosso idEnvio e o e2eId.
                 // Se a notificação tem idEnvio E endToEndId E o status é 'REALIZADO' ou 'NAO_REALIZADO', é MUITO provável que seja um saque finalizado.
                   let withdrawal: Withdrawal | null = null; // CORRIGIDO: Definir tipo e inicializar como null
                   if (idEnvio) { // Se a notificação tem idEnvio, é forte indicação de um envio
                        withdrawal = await this.withdrawalModel.findOne({ where: { idEnvio: idEnvio, status: WithdrawalStatus.PROCESSING }, include: [User] });
                   }
                   // Fallback por e2eId APENAS se não achou por idEnvio e status PROCESSANDO
                  if (!withdrawal && endToEndId && (efiStatusNotif === 'REALIZADO' || efiStatusNotif === 'NAO_REALIZADO' || efiStatusNotif === 'EM_PROCESSAMENTO')) {
                        withdrawal = await this.withdrawalModel.findOne({ where: { e2eId: endToEndId, status: WithdrawalStatus.PROCESSING }, include: [User] });
                         if (withdrawal && !withdrawal.idEnvio && idEnvio) { // CORRIGIDO: Verificar se withdrawal não é null antes de acessar .idEnvio
                            await withdrawal.update({ idEnvio: idEnvio });
                         }
                   }
  
  
                 if (withdrawal) { // CORRIGIDO: Verificar se withdrawal não é null
                      this.logger.debug(`Webhook matched PROCESSING Withdrawal ID ${withdrawal.id} by idEnvio/e2eId. Status na notificação: ${efiStatusNotif}.`);
                     // Para saques, esperamos status 'REALIZADO' ou 'NAO_REALIZADO' na notificação.
                     // Se o status na notificação for um desses, processamos a atualização final.
                     // Se for EM_PROCESSAMENTO, apenas atualizamos e2eId se necessário.
                     if (efiStatusNotif === 'REALIZADO' || efiStatusNotif === 'NAO_REALIZADO') {
                           // Passamos o status vindo da notificação
                          await this._updateWithdrawalStatusFromWebhook(withdrawal, efiStatusNotif, endToEndId);
                     } else if (efiStatusNotif === 'EM_PROCESSAMENTO') {
                          this.logger.debug(`Webhook for Withdrawal ID ${withdrawal.id} has status EM_PROCESSAMENTO. Updating e2eId if necessary.`);
                          // Opcional: Ainda atualizar o e2eId se veio na notificação e não está salvo
                          if (endToEndId && endToEndId !== withdrawal.e2eId) {
                              await withdrawal.update({ e2eId: endToEndId });
                              this.logger.debug(`_updateWithdrawalStatusFromWebhook: e2eId para saque local ${withdrawal.id} atualizado para ${endToEndId} via webhook (status EM_PROCESSAMENTO).`);
                         }
                     } else {
                         this.logger.warn(`Webhook for Withdrawal ID ${withdrawal.id} has unexpected status '${efiStatusNotif}'. Ignoring update logic.`);
                     }
                     continue; // Processado como saque, vai para o próximo item do webhook
                 }
  
                 // Se chegou aqui, a notificação não corresponde a nenhum registro local PENDING/PROCESSING conhecido
                 this.logger.warn(`Webhook Pix notification with e2eId ${endToEndId}, txid ${txid}, idEnvio ${idEnvio}, status ${efiStatusNotif} did not match any local PENDING Deposit or PROCESSING Withdrawal record.`);
  
  
                } catch (error) {
                    const err = error as Error;
                    // Captura e loga erros ao processar UM item da notificação para não impedir os outros.
                    this.logger.error(`Error processing single webhook notification item (e2eId: ${notification?.endToEndId || 'N/A'}): ${err.message}`, err.stack);
                }
            }
       }
    
      /**
       * Gera um txid alfanumérico válido para a API Efí (26 a 35 caracteres).
       * Utiliza UUID e timestamp, removendo caracteres inválidos e garantindo o tamanho mínimo/máximo.
       * @param prefix Prefixo opcional para identificar o tipo de transação (ex: 'dep', 'saq').
       * @param entityId ID da entidade local (depósito, saque) para garantir unicidade.
       * @returns String alfanumérica entre 26 e 35 caracteres.
       */
      private generateEfiTxid(prefix: string, entityId: number): string { // Método definido como private
           const base = `${prefix}${entityId}${Date.now()}${uuidv4()}`.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
           let txid = base;
           while (txid.length < 26) {
               txid += base;
           }
           txid = txid.substring(0, 35);
    
           return txid;
      }
    
    
      /**
       * Atualiza o status de um Depósito local com base em uma notificação de webhook.
       * Se o status da Efí for CONCLUIDA e o depósito local ainda PENDING, credita o saldo.
       * @param deposit Instância do Depósito local.
       * @param efiStatus O status da Efí vindo do webhook ('ATIVA', 'CONCLUIDA', 'REMOVIDA_*').
       * @param e2eId O End-to-End ID da notificação.
       * @returns Promise<void>
       */
      private async _updateDepositStatusFromWebhook(deposit: Deposit, efiStatus: string, e2eId?: string): Promise<void> { // Método definido como private
           // Só processa se o depósito local ainda não tem um status final (PENDING)
           if ((deposit.status as string) !== DepositStatus.PENDING) {
               this.logger.debug(`_updateDepositStatusFromWebhook: Depósito ID ${deposit.id} já não está PENDING (${deposit.status}). Ignorando notificação de status ${efiStatus}.`);
               return;
           }
    
           let newStatus: DepositStatus | undefined = undefined;
           let transaction: Transaction | undefined;
    
           if (efiStatus === 'CONCLUIDA') { // Esperamos 'CONCLUIDA' para depósitos pagos
               transaction = await this.sequelize.transaction();
               try {
                   newStatus = DepositStatus.COMPLETED;
                   await deposit.update({
                       status: newStatus,
                       e2eId: e2eId || deposit.e2eId, // Atualiza e2eId se a notificação o fornecer
                   }, { transaction });
    
                   await this.authService.updateUserBalance(deposit.userId, Number(deposit.amount), transaction);
                   this.logger.log(`_updateDepositStatusFromWebhook: Saldo do usuário ${deposit.userId} creditado em ${deposit.amount} para depósito ${deposit.id} via webhook.`);
    
                   await transaction.commit();
                   this.logger.log(`_updateDepositStatusFromWebhook: Depósito local ${deposit.id} (txid ${deposit.txid}) marcado como CONCLUIDO via webhook.`);
    
               } catch (dbError) {
                   if (transaction) await transaction.rollback();
                   const err = dbError as Error;
                   this.logger.error(`_updateDepositStatusFromWebhook: Erro DB ao marcar depósito ${deposit.id} como CONCLUIDO e atualizar saldo via webhook: ${err.message}`, err.stack);
                   throw new InternalServerErrorException('Erro interno ao finalizar depósito e creditar saldo via webhook. Verifique logs.');
               }
    
           } else if (efiStatus === 'REMOVIDA_PELO_USUARIO_RECEBEDOR' || efiStatus === 'REMOVIDA_PELO_PSP') {
               newStatus = DepositStatus.CANCELLED;
               await deposit.update({ status: newStatus, e2eId: e2eId || deposit.e2eId });
    
               this.logger.log(`_updateDepositStatusFromWebhook: Depósito local ${deposit.id} (txid ${deposit.txid}) marcado como CANCELADO via webhook.`);
    
           } // Status 'ATIVA' da Efí na notificação para COB pendente não requer mudança no status PENDING local.
    
    
           // Opcional: Se o e2eId veio na notificação e ainda não está salvo localmente
           if (e2eId && e2eId !== deposit.e2eId && newStatus === undefined) {
                 await deposit.update({ e2eId: e2eId });
                 this.logger.debug(`_updateDepositStatusFromWebhook: e2eId para depósito local ${deposit.id} atualizado para ${e2eId} via webhook.`);
           }
       }
    
    
      /**
       * Atualiza o status de um Saque local com base em uma notificação de webhook.
       * Se o status da Efí for NAO_REALIZADO e o saque local ainda PROCESSING, reembolsa o saldo.
       * @param withdrawal Instância do Saque local.
       * @param efiStatus O status da Efí vindo do webhook ('EM_PROCESSAMENTO', 'REALIZADO', 'NAO_REALIZADO').
       * @param e2eId O End-to-End ID da notificação.
       * @returns Promise<void>
       */
       private async _updateWithdrawalStatusFromWebhook(withdrawal: Withdrawal, efiStatus: string, e2eId?: string): Promise<void> { // Método definido como private
           // Só processa se o saque local ainda não tem um status final (PROCESSING)
           if ((withdrawal.status as string) !== WithdrawalStatus.PROCESSING) {
               this.logger.debug(`_updateWithdrawalStatusFromWebhook: Saque ID ${withdrawal.id} já não está PROCESSING (${withdrawal.status}). Ignorando notificação de status ${efiStatus}.`);
               return;
           }
    
            let newStatus: WithdrawalStatus | undefined = undefined;
            let transaction: Transaction | undefined;
    
    
           if (efiStatus === 'REALIZADO') {
               newStatus = WithdrawalStatus.COMPLETED;
               await withdrawal.update({
                   status: newStatus,
                   e2eId: e2eId || withdrawal.e2eId,
               }); // Update simples sem transação (saldo já foi deduzido)
    
               this.logger.log(`_updateWithdrawalStatusFromWebhook: Saque local ${withdrawal.id} (idEnvio ${withdrawal.idEnvio}) marcado como COMPLETED via webhook.`);
    
           } else if (efiStatus === 'NAO_REALIZADO') {
                // Iniciar transação para atualizar status e reembolsar saldo atomicamente
               transaction = await this.sequelize.transaction();
               try {
                   newStatus = WithdrawalStatus.FAILED;
                   await withdrawal.update({ status: newStatus, e2eId: e2eId || withdrawal.e2eId }, { transaction });
    
                   await this.authService.updateUserBalance(withdrawal.userId, Number(withdrawal.amount), transaction);
                   this.logger.log(`_updateWithdrawalStatusFromWebhook: Saldo do usuário ${withdrawal.userId} creditado em ${withdrawal.amount} para saque falho ${withdrawal.id} via webhook.`);
    
                   await transaction.commit();
                   this.logger.log(`_updateWithdrawalStatusFromWebhook: Saque local ${withdrawal.id} (idEnvio ${withdrawal.idEnvio}) marcado as FAILED and saldo reembolsado via webhook.`); // Correção de typo 'as' -> 'as' em log
  
               } catch (dbError) {
                  if (transaction) await transaction.rollback();
                  const err = dbError as Error;
                  this.logger.error(`_updateWithdrawalStatusFromWebhook: Erro DB ao marcar saque ${withdrawal.id} como FAILED e reembolsar via webhook: ${err.message}`, err.stack);
                  throw new InternalServerErrorException('Erro interno ao processar falha de saque e reembolso via webhook. Verifique logs.');
               }
    
           } // Status 'EM_PROCESSAMENTO' da Efí não requer mudança no status PROCESSING local.
  
  
            // Opcional: Se o e2eId veio na notificação e ainda não está salvo localmente
            if (e2eId && e2eId !== withdrawal.e2eId && newStatus === undefined) {
                 await withdrawal.update({ e2eId: e2eId });
                 this.logger.debug(`_updateWithdrawalStatusFromWebhook: e2eId para saque local ${withdrawal.id} atualizado para ${e2eId} via webhook.`);
           }
       }
    
    
      // --- Métodos de Negócio Principais (Chamados pelo Controller) ---
       public async createDepositCharge(userId: number, amount: number): Promise<Deposit> { // CORRIGIDO: Método definido como public
           // ... código existente ...
            const user = await this.authService.findCurrentUser(userId);
            if (!user) {
            throw new NotFoundException(`Usuário com ID ${userId} não encontrado.`);
            }
    
            const transaction = await this.sequelize.transaction();
            let deposit: Deposit | undefined;
    
            try {
                deposit = await this.depositModel.create({
                userId: userId,
                amount: amount,
                status: DepositStatus.PENDING,
                provider: 'EFI_PIX',
                }, { transaction });
                this.logger.debug(`Registro de depósito local ${deposit.id} criado para userId ${userId}, valor ${amount}.`);
    
                // Chamar método privado generateEfiTxid
                const customTxid = this.generateEfiTxid('DEP', deposit.id);
                this.logger.debug(`Txid gerado para Efí: ${customTxid}`);
    
    
                const accessToken = await this.getAccessToken();
                const chargeUrl = `${this.efiBaseUrl}/v2/cob/${customTxid}`;
    
                const formattedCpf = user.cpf.replace(/\D/g, '');
                if (formattedCpf.length !== 11) {
                    this.logger.error(`CPF do usuário ${user.id} (${user.cpf}) não formatável para 11 dígitos numéricos.`);
                    throw new BadRequestException('CPF do usuário inválido para criação da cobrança Pix.');
                }
    
    
                const requestBody = {
                calendario: {
                    expiracao: 3600,
                },
                devedor: {
                    cpf: formattedCpf,
                    nome: user.name,
                },
                valor: {
                    original: Number(amount).toFixed(2),
                },
                chave: this.efiPixKey,
                solicitacaoPagador: `Deposito de saldo para ${user.name} (#${user.id}) - Ref: ${deposit.id}`,
                };
    
                this.logger.debug(`Chamando PUT para ${chargeUrl} na Efí. Body: ${JSON.stringify(requestBody)}`);
                if (!this.httpsAgent) {
                    throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
                }
    
                const response = await firstValueFrom(this.httpService.put(chargeUrl, requestBody, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                httpsAgent: this.httpsAgent,
                }));
                this.logger.debug(`Resposta recebida de ${chargeUrl}. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`);
    
                await deposit.update({
                txid: response.data.txid,
                locationId: response.data.loc?.id,
                pixCopiaECola: response.data.pixCopiaECola,
                }, { transaction });
    
                this.logger.debug(`Registro de depósito local ${deposit.id} atualizado com dados da Efí (txid, locationId).`);
    
                if (!response.data.loc?.id) {
                    this.logger.warn(`Cobrança ${deposit.id} criada na Efí, mas sem location ID na resposta. Não será possível obter imagem QR Code.`);
                } else {
                    try {
                        // Chamar método privado getQrCodeImage
                        const qrCodeData = await this.getQrCodeImage(response.data.loc.id);
                        await deposit.update({
                            qrCodeImage: qrCodeData.imagemQrcode,
                        }, { transaction });
                        this.logger.debug(`Imagem QR Code para depósito local ${deposit.id} obtida e salva.`);
                    } catch (qrError) {
                        const err = qrError as Error;
                        this.logger.error(`Falha ao obter imagem QR Code para location ${response.data.loc.id}: ${err.message}`, err.stack);
                    }
                }
    
                await transaction.commit();
    
                this.logger.log(`Processo inicial de depósito Pix ${deposit.id} para userId ${userId} concluído. Txid Efí: ${customTxid}.`);
                return deposit;
    
            } catch (error) {
                await transaction.rollback();
                const axiosError = error as AxiosError;
    
                const depositIdLog = deposit ? deposit.id : 'N/A';
                this.logger.error(`Erro crítico durante a criação da cobrança de depósito ${depositIdLog} na Efí para userId ${userId}: ${(error as Error).message}`, (error as Error).stack);
    
                if (axiosError.response) {
                    const errorData: any = axiosError.response.data;
                    this.logger.error(`Efí API Response Error (Create Charge): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                    this.logger.error(`Efí API Response Error (Create Charge) Headers: ${JSON.stringify(axiosError.response.headers)}`);
                    this.logger.error(`Efí API Response Error (Create Charge) Config: ${JSON.stringify(axiosError.config)}`);
                    if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                        throw new BadRequestException(`Erro da API Efí ao criar cobrança: ${errorData?.detail || errorData?.mensagem || 'Detalhe não disponível'}`);
                    }
                } else if (axiosError.request) {
                    this.logger.error(`Efí API Request Error (Create Charge): No response received.`, axiosError.request);
                    this.logger.error(`Efí API Request Error (Create Charge) Config: ${JSON.stringify(axiosError.config)}`);
                }
    
                throw new InternalServerErrorException('Erro interno ao solicitar depósito Pix. Tente novamente.');
            }
      }
    
      private async getQrCodeImage(locationId: number): Promise<{ qrcode: string, imagemQrcode: string }> { // CORRIGIDO: Método definido como private
            this.logger.debug(`Buscando imagem QR Code para locationId ${locationId} na Efí.`);
            const accessToken = await this.getAccessToken();
            const qrcodeUrl = `${this.efiBaseUrl}/v2/loc/${locationId}/qrcode`;
    
            try {
                if (!this.httpsAgent) {
                     throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
                }
                 this.logger.debug(`Fazendo GET para ${qrcodeUrl} para obter QR Code...`);
                 const response = await firstValueFrom(this.httpService.get(qrcodeUrl, {
                     headers: {
                         Authorization: `Bearer ${accessToken}`,
                     },
                     httpsAgent: this.httpsAgent,
                 }));
                 this.logger.debug(`Resposta recebida de ${qrcodeUrl}. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`);
    
                 this.logger.debug(`Imagem QR Code obtenida para locationId ${locationId}.`);
                 return response.data;
    
            } catch (error) {
                 const axiosError = error as AxiosError;
                 this.logger.error(`Erro ao obter imagem QR Code da Efí para locationId ${locationId}: ${(error as Error).message}`, (error as Error).stack);
    
                 if (axiosError.response) {
                     const errorData: any = axiosError.response.data;
                     this.logger.error(`Efí API Response Error (Get QR Code): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                      this.logger.error(`Efí API Response Error (Get QR Code) Headers: ${JSON.stringify(axiosError.response.headers)}`);
                      this.logger.error(`Efí API Request Error (Get QR Code) Config: ${JSON.stringify(axiosError.config)}`);
                      if (axiosError.response.status === 404) {
                           throw new NotFoundException(`Location ID ${locationId} não encontrado na Efí.`);
                      }
                      if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                          throw new BadRequestException(`Erro da API Efí ao obter QR Code: ${errorData?.detail || errorData?.mensagem || 'Detalhe não disponível'}`);
                      }
                 } else if (axiosError.request) {
                      this.logger.error(`Efí API Request Error (Get QR Code): No response received.`, axiosError.request);
                      this.logger.error(`Efí API Request Error (Get QR Code) Config: ${JSON.stringify(axiosError.config)}`);
                  }
    
                 throw new InternalServerErrorException('Falha ao obter imagem QR Code do Pix.');
            }
         }
    
      // Método público para consultar o status ATUAL de um depósito na Efí (chamado pelo Controller GET /status)
       public async checkDepositStatusEfí(depositId: number): Promise<{ status: string, e2eId?: string, valor: string }> { // CORRIGIDO: Método definido como public
            const deposit = await this.depositModel.findByPk(depositId);
    
            if (!deposit) {
                throw new NotFoundException(`Depósito com ID ${depositId} não encontrado.`);
            }
    
            if (!deposit.txid) {
               const statusLocal = deposit.status as string;
               this.logger.warn(`checkDepositStatusEfí: Depósito ${deposit.id} não possui txid para consulta na Efí. Status local: ${statusLocal}.`);
               return { status: statusLocal, e2eId: deposit.e2eId, valor: Number(deposit.amount).toFixed(2) };
            }
    
            this.logger.debug(`checkDepositStatusEfí: Consultando status da cobrança Pix na Efí para Deposit ID ${deposit.id}, txid ${deposit.txid}.`);
    
            const accessToken = await this.getAccessToken();
            const chargeUrl = `${this.efiBaseUrl}/v2/cob/${deposit.txid}`;
    
            try {
                if (!this.httpsAgent) {
                     throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
                }
                this.logger.debug(`checkDepositStatusEfí: Fazendo GET para ${chargeUrl} para consultar status...`);
                const response = await firstValueFrom(this.httpService.get(chargeUrl, {
                    headers: {
                    Authorization: `Bearer ${accessToken}`,
                    },
                    httpsAgent: this.httpsAgent,
                }));
                this.logger.debug(`checkDepositStatusEfí: Resposta recebida de ${chargeUrl}. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`);
    
                const efiStatus = response.data.status;
                const e2eId = response.data.pix && response.data.pix.length > 0 ? response.data.pix[0].endToEndId : undefined;
                 const valor = response.data.valor?.original || response.data.valor?.final;
    
                this.logger.debug(`checkDepositStatusEfí: Status retornado pela Efí para txid ${deposit.txid} (Deposit ID ${deposit.id}): ${efiStatus}`);
    
                 return { status: efiStatus, e2eId: e2eId, valor: valor };
    
    
            } catch (error) {
                const axiosError = error as AxiosError;
                this.logger.error(`checkDepositStatusEfí: Erro ao consultar status de depósito na Efí para Deposit ID ${deposit.id}, txid ${deposit.txid}: ${(error as Error).message}`, (error as Error).stack);
    
                 if (axiosError.response) {
                     const errorData: any = axiosError.response.data;
                     this.logger.error(`checkDepositStatusEfí: Efí API Response Error (Get Cob): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                     this.logger.error(`checkDepositStatusEfí: Efí API Response Error (Get Cob) Headers: ${JSON.stringify(axiosError.response.headers)}`);
                     this.logger.error(`checkDepositStatusEfí: Efí API Request Error (Get Cob) Config: ${JSON.stringify(axiosError.config)}`);
    
                     if (axiosError.response.status === 404) {
                          throw new NotFoundException(`Cobrança com txid ${deposit.txid} não encontrada na Efí.`);
                     }
                      if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                          throw new BadRequestException(`Erro 4xx da API Efí ao consultar cobrança: ${errorData?.detail || errorData?.mensagem || 'Detalhe não disponível'}`);
                      }
                 } else if (axiosError.request) {
                     this.logger.error(`checkDepositStatusEfí: Efí API Request Error (Get Cob): No response received.`, axiosError.request);
                     this.logger.error(`checkDepositStatusEfí: Efí API Request Error (Get Cob) Config: ${JSON.stringify(axiosError.config)}`);
                 }
    
                throw new InternalServerErrorException('Erro ao consultar status de depósito na API Pix Efí.');
            }
         }
    
      // Método público para requisitar um saque (chamado pelo Controller POST /pix/withdrawal/request)
      public async requestWithdrawal( // CORRIGIDO: Método definido como public
          userId: number,
          amount: number,
          pixKey: string,
          pixKeyType: string,
          favorecidoName?: string,
          favorecidoCpfCnpj?: string
      ): Promise<Withdrawal> {
         // Chamar método privado generateEfiTxid
         const idEnvio = this.generateEfiTxid('SAQ', userId); // CORRIGIDO: Chamar método privado
         this.logger.debug(`IdEnvio gerado para Efí: ${idEnvio}`);
    
    
         const transaction = await this.sequelize.transaction();
         let withdrawal: Withdrawal | undefined;
    
         try {
             this.logger.debug(`requestWithdrawal: Dedução de saldo ${amount} para userId ${userId} na transação DB.`);
             const user = await this.authService.updateUserBalance(userId, -Number(amount), transaction)
                 .catch(error => {
                     if ((error as any).isHandled && error instanceof Error && error.message === 'Insufficient balance during transaction') {
                         throw new BadRequestException('Saldo insuficiente para realizar o saque.');
                     }
                     throw error;
                 });
             this.logger.log(`requestWithdrawal: Saldo do usuário ${userId} deduzido em ${amount}. Saldo atual (transacional): ${user.balance}`);
    
    
             withdrawal = await this.withdrawalModel.create({
                 userId: userId,
                 idEnvio: idEnvio,
                 amount: amount,
                 pixKey: pixKey,
                 pixKeyType: pixKeyType,
                 favorecidoName: favorecidoName,
                 favorecidoCpfCnpj: favorecidoCpfCnpj,
                 status: WithdrawalStatus.PROCESSING,
                 provider: 'EFI_PIX',
             }, { transaction });
             this.logger.debug(`requestWithdrawal: Registro de saque local ${withdrawal.id} criado com idEnvio ${idEnvio} para userId ${userId}.`);
    
    
             const accessToken = await this.getAccessToken();
             const withdrawalUrl = `${this.efiBaseUrl}/v3/gn/pix/${idEnvio}`;
    
             let formattedFavorecidoCpfCnpj: string | undefined = undefined;
             if (pixKeyType === 'cpf' && favorecidoCpfCnpj) {
                 formattedFavorecidoCpfCnpj = favorecidoCpfCnpj.replace(/\D/g, '');
                 if (formattedFavorecidoCpfCnpj.length !== 11) {
                     this.logger.warn(`requestWithdrawal: CPF do favorecido ${formattedFavorecidoCpfCnpj} inválido para tipo CPF.`); // Logar formatado
                 }
             } else if (pixKeyType === 'cnpj' && favorecidoCpfCnpj) {
                 formattedFavorecidoCpfCnpj = favorecidoCpfCnpj.replace(/\D/g, '');
                 if (formattedFavorecidoCpfCnpj.length !== 14) {
                      this.logger.warn(`requestWithdrawal: CNPJ do favorecido ${formattedFavorecidoCpfCnpj} inválido para tipo CNPJ.`); // Logar formatado
                 }
             }
    
    
             const requestBody: any = {
                  valor: Number(amount).toFixed(2),
                  pagador: {
                       chave: this.efiPixKey,
                       infoPagador: `Saque #${withdrawal.id} solicitado por usuário ${user.id}`,
                  },
                  favorecido: {
                       chave: pixKey,
                       ...(pixKeyType === 'cpf' || pixKeyType === 'cnpj' ? {
                            identificacao: {
                                 nome: favorecidoName,
                                 cpf: pixKeyType === 'cpf' ? formattedFavorecidoCpfCnpj : undefined,
                                 cnpj: pixKeyType === 'cnpj' ? formattedFavorecidoCpfCnpj : undefined,
                            }
                       } : {}),
                  },
             };
    
             this.logger.debug(`requestWithdrawal: Chamando PUT para ${withdrawalUrl} na Efí. Body: ${JSON.stringify(requestBody)}`);
             if (!this.httpsAgent) {
                 throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
             }
    
             const response = await firstValueFrom(this.httpService.put(withdrawalUrl, requestBody, {
                 headers: {
                     Authorization: `Bearer ${accessToken}`,
                     'Content-Type': 'application/json',
                 },
                 httpsAgent: this.httpsAgent,
             }));
             this.logger.debug(`requestWithdrawal: Resposta recebida de ${withdrawalUrl}. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`);
    
    
             await withdrawal.update({
                 e2eId: response.data.e2eId,
             }, { transaction });
    
             this.logger.debug(`requestWithdrawal: Registro de saque local ${withdrawal.id} atualizado com e2eId Efí: ${response.data.e2eId}.`);
    
             await transaction.commit();
    
             this.logger.log(`requestWithdrawal: Solicitação de saque local ${withdrawal.id} (idEnvio ${withdrawal.idEnvio}) enviada para Efí com sucesso. Status local: PROCESSING.`);
             return withdrawal;
    
         } catch (error) {
             await transaction.rollback();
             const axiosError = error as AxiosError;
    
             const withdrawalIdLog = withdrawal ? withdrawal.id : 'N/A';
             this.logger.error(`requestWithdrawal: Erro crítico durante a solicitação de saque Pix para userId ${userId}, valor ${amount}, chave ${pixKey} (ID Local: ${withdrawalIdLog}): ${(error as Error).message}`, (error as Error).stack);
    
             if (error instanceof BadRequestException) {
                  throw error;
             }
    
              if (axiosError.response) {
                 const errorData: any = axiosError.response.data;
                 this.logger.error(`requestWithdrawal: Efí API Response Error (Request Pix Send): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                  this.logger.error(`requestWithdrawal: Efí API Response Error (Request Pix Send) Headers: ${JSON.stringify(axiosError.response.headers)}`);
                  this.logger.error(`requestWithdrawal: Efí API Request Error (Request Pix Send) Config: ${JSON.stringify(axiosError.config)}`);
                  if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                      const efierrordetail = errorData?.detail || errorData?.mensagem || 'Detalhe não disponível';
                       this.logger.error(`requestWithdrawal: Erro 4xx da API Efí ao solicitar envio Pix: ${efierrordetail}`);
                      throw new BadRequestException(`Erro da API Efí ao solicitar saque: ${efierrordetail}`);
                  }
             } else if (axiosError.request) {
                  this.logger.error(`requestWithdrawal: Efí API Request Error (Request Pix Send): No response received.`, axiosError.request);
                   this.logger.error(`requestWithdrawal: Efí API Request Error (Request Pix Send) Config: ${JSON.stringify(axiosError.config)}`);
              }
    
             throw new InternalServerErrorException('Erro interno ao solicitar saque Pix. Tente novamente.');
         }
      }
    
      // Método público para consultar o status ATUAL de um saque na Efí (chamado pelo Controller GET /status)
       public async checkWithdrawalStatusEfí(withdrawalId: number): Promise<{ status: string, e2eId?: string, valor: string }> { // CORRIGIDO: Método definido como public
           const withdrawal = await this.withdrawalModel.findByPk(withdrawalId);
    
           if (!withdrawal) {
               throw new NotFoundException(`Saque com ID ${withdrawalId} não encontrado.`);
           }
    
           if (!withdrawal.idEnvio) {
               const statusLocal = withdrawal.status as string;
               this.logger.warn(`checkWithdrawalStatusEfí: Saque local ${withdrawal.id} não possui idEnvio para consulta na Efí. Status local: ${statusLocal}.`);
               return { status: statusLocal, e2eId: withdrawal.e2eId, valor: Number(withdrawal.amount).toFixed(2) };
           }
    
    
           this.logger.debug(`checkWithdrawalStatusEfí: Consultando status de envio Pix na Efí para Withdrawal ID ${withdrawal.id}, idEnvio ${withdrawal.idEnvio}.`);
    
           const accessToken = await this.getAccessToken();
           const withdrawalStatusUrl = `${this.efiBaseUrl}/v2/gn/pix/enviados/id-envio/${withdrawal.idEnvio}`;
    
           try {
               if (!this.httpsAgent) {
                    throw new InternalServerErrorException('HTTPS Agent não inicializado. Serviço Pix não está pronto.');
               }
               this.logger.debug(`checkWithdrawalStatusEfí: Fazendo GET para ${withdrawalStatusUrl} para consultar status...`);
               const response = await firstValueFrom(this.httpService.get(withdrawalStatusUrl, {
                   headers: {
                       Authorization: `Bearer ${accessToken}`,
                   },
                   httpsAgent: this.httpsAgent,
               }));
                this.logger.debug(`checkWithdrawalStatusEfí: Resposta recebida de ${withdrawalStatusUrl}. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`);
    
    
               const efiStatus = response.data.status; // 'EM_PROCESSAMENTO', 'REALIZADO', 'NAO_REALIZADO'
               const e2eId = response.data.endToEndId;
                const valor = response.data.valor;
    
               this.logger.debug(`checkWithdrawalStatusEfí: Status retornado pela Efí para idEnvio ${withdrawal.idEnvio} (Withdrawal ID ${withdrawal.id}): ${efiStatus}`);
    
               return { status: efiStatus, e2eId: e2eId, valor: valor };
    
    
           } catch (error) {
                const axiosError = error as AxiosError;
                this.logger.error(`checkWithdrawalStatusEfí: Erro ao consultar status de saque na Efí para Withdrawal ID ${withdrawal.id}, idEnvio ${withdrawal.idEnvio}: ${(error as Error).message}`, (error as Error).stack);
    
                if (axiosError.response) {
                   const errorData: any = axiosError.response.data;
                   this.logger.error(`checkWithdrawalStatusEfí: Efí API Response Error (Get Pix Enviados): Status ${axiosError.response.status}, Data: ${JSON.stringify(errorData)}`);
                    this.logger.error(`checkWithdrawalStatusEfí: Efí API Response Error (Get Pix Enviados) Headers: ${JSON.stringify(axiosError.response.headers)}`);
                    this.logger.error(`checkWithdrawalStatusEfí: Efí API Request Error (Get Pix Enviados) Config: ${JSON.stringify(axiosError.config)}`);
                    if (axiosError.response.status === 404) {
                         throw new NotFoundException(`Envio de Pix com idEnvio ${withdrawal.idEnvio} não encontrado na Efí.`);
                    }
                   if (axiosError.response.status >= 400 && axiosError.response.status < 500) {
                       throw new BadRequestException(`Erro 4xx da API Efí ao consultar envio Pix: ${errorData?.detail || errorData?.mensagem || 'Detalhe não disponível'}`);
                   }
    
               } else if (axiosError.request) {
                   this.logger.error(`checkWithdrawalStatusEfí: Efí API Request Error (Get Pix Enviados): No response received.`, axiosError.request);
                    this.logger.error(`checkWithdrawalStatusEfí: Efí API Request Error (Get Pix Enviados) Config: ${JSON.stringify(axiosError.config)}`);
               }
    
                throw new InternalServerErrorException('Erro ao consultar status de saque na API Pix Efí.');
           }
       }
    
    
      // --- Métodos para Histórico ---
      public async getUserDeposits(userId: number): Promise<Deposit[]> { // CORRIGIDO: Método definido como public
           const user = await this.authService.findCurrentUser(userId);
           if (!user) {
               throw new NotFoundException(`Usuário com ID ${userId} não encontrado.`);
           }
           return this.depositModel.findAll({
               where: { userId: userId },
               order: [['createdAt', 'DESC']],
           });
       }
    
        public async getUserWithdrawals(userId: number): Promise<Withdrawal[]> { // CORRIGIDO: Método definido como public
            const user = await this.authService.findCurrentUser(userId);
            if (!user) {
                throw new NotFoundException(`Usuário com ID ${userId} não encontrado.`);
            }
           return this.withdrawalModel.findAll({
               where: { userId: userId },
               order: [['createdAt', 'DESC']],
           });
       }
    
        public async getUserDepositById(userId: number, depositId: number): Promise<Deposit> { // CORRIGIDO: Método definido como public
            const deposit = await this.depositModel.findOne({
                where: { id: depositId, userId: userId },
                 include: [User]
            });
            if (!deposit) {
                throw new NotFoundException(`Depósito com ID ${depositId} não encontrado.`);
            }
            return deposit;
        }
    
        public async getUserWithdrawalById(userId: number, withdrawalId: number): Promise<Withdrawal> { // CORRIGIDO: Método definido como public
             const withdrawal = await this.withdrawalModel.findOne({
                where: { id: withdrawalId, userId: userId },
                include: [User]
            });
            if (!withdrawal) {
                throw new NotFoundException(`Saque com ID ${withdrawalId} não encontrado.`);
            }
            return withdrawal;
        }
    
       // --- ENDPOINT DE TESTE DE SIMULAÇÃO ---
       public async simulateDepositCompletionTest(depositId: number, e2eId?: string): Promise<Deposit> { // CORRIGIDO: Método definido como public
            // Buscar o depósito pelo ID para verificar se ele existe
            const deposit = await this.depositModel.findByPk(depositId, { include: [User] }); // Incluir usuário para AuthService
    
            if (!deposit) {
                throw new NotFoundException(`Depósito com ID ${depositId} não encontrado para simulação.`);
            }
    
            // Se o depósito já está COMPLETED, não faz nada e retorna
            if (deposit.status === DepositStatus.COMPLETED) {
                 this.logger.warn(`simulateDepositCompletionTest: Depósito ID ${deposit.id} já está COMPLETED. Nenhuma ação necessária.`);
                  return deposit; // Retorna o objeto existente
            }
    
            // Iniciar uma transação manual para simular a lógica de checkDepositStatus
            const transaction = await this.sequelize.transaction();
            let updatedDeposit: Deposit;
    
            try {
                  // Simular a atualização do status para COMPLETED
                  updatedDeposit = await deposit.update({
                      status: DepositStatus.COMPLETED,
                      e2eId: e2eId || `TEST_E2EID_${uuidv4()}`, // Usa o e2eId fornecido ou gera um de teste
                  }, { transaction });
    
                  // Simular a adição do saldo
                  await this.authService.updateUserBalance(deposit.userId, Number(deposit.amount), transaction);
    
                  await transaction.commit();
    
                  this.logger.log(`simulateDepositCompletionTest: Depósito ID ${deposit.id} marcado como COMPLETED e saldo do usuário ${deposit.userId} creditado em ${deposit.amount}.`);
    
                 // Recarregar o objeto para garantir que todos os dados estão atualizados
                 await updatedDeposit.reload({ transaction: null }); // Recarrega fora da transação (já committada)
                 return updatedDeposit;
    
    
            } catch (dbError) {
                  await transaction.rollback();
                  const err = dbError as Error;
                  this.logger.error(`simulateDepositCompletionTest: Erro DB ao simular conclusão de depósito ${depositId} e atualizar saldo: ${err.message}`, err.stack);
                  throw new InternalServerErrorException('Erro interno ao simular conclusão de depósito.');
            }
         }
    
    }