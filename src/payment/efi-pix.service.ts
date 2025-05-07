// src/payment/efi-pix.service.ts
import { Injectable, Logger, InternalServerErrorException, BadRequestException, NotFoundException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Deposit, DepositStatus } from '../models/payment/deposit.model';
import { Withdrawal, WithdrawalStatus } from '../models/payment/withdrawal.model';
import { AuthService } from '../Auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize-typescript';
import { Transaction, Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

import axios, { AxiosInstance, AxiosRequestConfig, RawAxiosRequestHeaders } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

@Injectable()
export class EfiPixService {
  private readonly logger = new Logger(EfiPixService.name);
  private efipayApi!: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private readonly allowedWebhookIps: string[];

  constructor(
    @InjectModel(Deposit) private depositModel: typeof Deposit,
    @InjectModel(Withdrawal) private withdrawalModel: typeof Withdrawal,
    private authService: AuthService,
    private configService: ConfigService,
    private sequelize: Sequelize,
  ) {
    this.configureAxiosInstance();
    const webhookIps = this.configService.get<string>('EFI_WEBHOOK_ALLOWED_IPS');
    this.allowedWebhookIps = webhookIps ? webhookIps.split(',').map(ip => ip.trim()) : [];
    if (this.allowedWebhookIps.length === 0) {
        this.logger.warn('Nenhum IP permitido configurado para webhook da Efí (EFI_WEBHOOK_ALLOWED_IPS no .env). A validação por IP será desativada. Isso reduz a segurança em Produção.');
    } else {
        this.logger.log(`IPs permitidos para webhook da Efí: ${this.allowedWebhookIps.join(', ')}`);
    }
  }

  private configureAxiosInstance() {
      const certPath = this.configService.get<string>('EFI_CERT_PATH');
      const certPassword = this.configService.get<string>('EFI_CERT_PASSWORD') || '';
      const efiBaseUrl = this.configService.get<string>('EFI_BASE_URL') || 'https://pix.api.efipay.com.br';

      const resolvedCertPath = path.resolve(certPath || '');
      const certExists = certPath && fs.existsSync(resolvedCertPath);


      if (!certPath) {
          this.logger.warn('Caminho do certificado EFI não configurado no .env (EFI_CERT_PATH). Requisições mTLS para a API da Efí NÃO funcionarão, exceto a de autenticação se não exigir cert.');
      } else if (!certExists) {
           this.logger.error(`Certificado EFI não encontrado no caminho configurado: ${resolvedCertPath}. Requisições mTLS para a API da Efí FALHARÃO.`);
      }

      const certHttpsAgent = certExists ? new https.Agent({
          pfx: fs.readFileSync(resolvedCertPath),
          passphrase: certPassword,
      }) : undefined;


      this.efipayApi = axios.create({
          baseURL: efiBaseUrl,
          httpsAgent: certHttpsAgent,
          maxRedirects: 0,
      });

       this.efipayApi.interceptors.request.use(request => {
           const headers = { ...request.headers };
            if (headers['Authorization']) {
                headers['Authorization'] = '[Redacted]';
            }
           this.logger.debug(`Fazendo requisição para EFI: ${request.method?.toUpperCase()} ${request.url}. Headers: ${JSON.stringify(headers)}`);
           return request;
       }, error => {
            this.logger.error(`Erro na requisição (Interceptor): ${error.message}`);
           return Promise.reject(error);
       });

       this.efipayApi.interceptors.response.use(response => {
           this.logger.debug(`Resposta da EFI: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
           return response;
       }, error => {
             if (error.response) {
                 this.logger.error(`Erro da EFI (Resposta): ${error.response.status} ${error.response.config.method?.toUpperCase()} ${error.response.config.url} - ${JSON.stringify(error.response.data)}`);

                  if (error.response.status === 400) { throw new BadRequestException(error.response.data); }
                   if (error.response.status === 401) { throw new UnauthorizedException(error.response.data); }
                   if (error.response.status === 404) { throw new NotFoundException(error.response.data); }
                    if (error.response.status === 409) { throw new ConflictException(error.response.data); }
                   if (error.response.status >= 400) {
                         (error as any).isEfiError = true;
                         return Promise.reject(error);
                   }

             } else if (error.request) {
                 this.logger.error(`Erro da EFI (Requisição): Sem resposta recebida - ${error.message} - ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
                  (error as any).isNetworkOrTlsError = true;
             } else {
                 this.logger.error(`Erro da EFI (Setup): Erro ao configurar requisição - ${error.message}`);
             }
             return Promise.reject(error);
       });
  }


    private async getAccessToken(): Promise<string> {
        if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 5 * 60 * 1000)) {
            this.logger.debug('Utilizando token da Efí em cache.');
            return this.accessToken!;
        }

        this.logger.log('Obtendo novo token de acesso da Efí...');
        const clientId = this.configService.get<string>('EFI_CLIENT_ID');
        const clientSecret = this.configService.get<string>('EFI_CLIENT_SECRET');

        if (!clientId || !clientSecret) {
            const errorMessage = 'Credenciais da Efí (Client ID/Secret) não configuradas no .env.';
            this.logger.error(errorMessage);
            throw new InternalServerErrorException(errorMessage);
        }

        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        try {
            const response = await this.efipayApi.post('/oauth/token', {
                grant_type: 'client_credentials',
            }, {
                headers: {
                    'Authorization': `Basic ${basicAuth}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            });

            const { access_token, expires_in } = response.data;
            if (!access_token || expires_in === undefined) {
                const errorMessage = 'Resposta inesperada da Efí ao obter token.';
                this.logger.error(`${errorMessage} Resposta: ${JSON.stringify(response.data)}`);
                throw new InternalServerErrorException(errorMessage);
            }

            this.accessToken = access_token;
            this.tokenExpiry = new Date(Date.now() + expires_in * 1000); // expires_in é em segundos

            this.logger.log('Novo token da Efí obtido com sucesso.');
            return this.accessToken!;
        } catch (error: any) {
             if ((error as any).isNetworkOrTlsError) {
                 this.logger.error(`Erro de rede/TLS ao obter token da Efí. Verifique certificado, senha, caminho e firewall.`);
                 throw new InternalServerErrorException('Falha de conexão segura ao obter token da Efí. Verifique a configuração do certificado.');
             }
            throw error;
        }
    }

    private async makeEfiRequest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, data?: any, extraConfig?: AxiosRequestConfig): Promise<any> {
        try {
             const requestHeaders: RawAxiosRequestHeaders = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...(extraConfig?.headers as RawAxiosRequestHeaders || {}),
             };

             const configWithoutHeaders = {...extraConfig, headers: undefined} as Omit<AxiosRequestConfig, 'headers'>;

            const response = await this.efipayApi({
                method,
                url,
                data,
                headers: requestHeaders,
                ...configWithoutHeaders
            });
            return response.data;
        } catch (error: any) {
              if ((error as any).isNetworkOrTlsError) {
                 this.logger.error(`Erro de rede/TLS durante makeEfiRequest para ${method} ${url}.`);
                 throw new InternalServerErrorException('Falha de conexão segura com a API da Efí.');
             }
            throw error;
        }
    }


  async createDepositCharge(userId: number, amount: number): Promise<Deposit> {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        this.logger.error(`createDepositCharge: Valor do depósito inválido recebido para usuário ${userId}: ${amount}`);
        throw new BadRequestException('Valor do depósito inválido.');
    }
     const amountFixed = parseFloat(amount.toFixed(2));
     if (amountFixed !== amount) {
          this.logger.warn(`createDepositCharge: Valor do depósito para usuário ${userId} ajustado de ${amount} para ${amountFixed} para corresponder a 2 casas decimais.`);
          amount = amountFixed;
     }

    const transaction = await this.sequelize.transaction();
    let depositRecord: Deposit | null = null;

    try {
        depositRecord = await this.depositModel.create({
            userId: userId,
            amount: amount,
            status: DepositStatus.PENDING,
        }, { transaction });
        this.logger.log(`Registro de depósito ${depositRecord.id} criado para o usuário ${userId}, valor R$ ${amount.toFixed(2)}. Status: PENDING.`);


         const efiPixKey = this.configService.get<string>('EFI_PIX_KEY');
         if (!efiPixKey) {
              const msg = 'Chave Pix de recebimento (EFI_PIX_KEY) não configurada no .env.';
              this.logger.error(msg);
             throw new InternalServerErrorException(msg);
         }
         this.logger.debug(`Usando chave Pix EFI: ${efiPixKey}`);

         const token = await this.getAccessToken();

        const chargeData = {
            calendario: {
                expiracao: 3600
            },
            valor: {
                original: amount.toFixed(2)
            },
             chave: efiPixKey,
            solicitacaoPagador: `Depósito para usuário ${userId} na Loto Jack (ID Transacao: ${depositRecord.id})`,
        };

        this.logger.debug(`Chamando EFI POST /v2/cob com dados: ${JSON.stringify(chargeData)}`);
        const efiResponse = await this.makeEfiRequest('post', '/v2/cob', chargeData, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

         this.logger.debug(`Resposta da EFI para criação de cobrança: ${JSON.stringify(efiResponse)}`);

        if (!efiResponse || !efiResponse.txid || !efiResponse.pixCopiaECola || !efiResponse.loc?.location) {
            const errorMessage = 'Resposta inesperada da Efí ao criar cobrança: dados de retorno incompletos (txid, pixCopiaECola, location).';
             this.logger.error(`${errorMessage} Resposta completa: ${JSON.stringify(efiResponse)}`);
            throw new InternalServerErrorException(errorMessage);
        }

        await depositRecord.update({
            efiTxid: efiResponse.txid,
            qrCodeImage: efiResponse.loc.location,
            pixCopiaECola: efiResponse.pixCopiaECola,
            status: DepositStatus.PENDING,
        }, { transaction });
        this.logger.log(`Registro de depósito ${depositRecord.id} atualizado com dados da Efí (txid ${depositRecord.efiTxid}, QR Code URL, Pix Copia e Cola). Status: PENDING.`);


        await transaction.commit();

        this.logger.log(`Cobrança de depósito ${depositRecord.id} criada com sucesso na Efí e registro local finalizado.`);

        await depositRecord.reload();

        return depositRecord;

    } catch (error) {
         if (transaction && !(transaction as any).finished) {
             try {
                 await transaction.rollback();
                 this.logger.warn(`Rollback executado para criação de depósito do usuário ${userId} devido a error capturado.`);
             } catch (rollbackError: any) {
                  if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Error ao tentar executar rollback no CATCH para criação de depósito do usuário ${userId}: ${rollbackError}`);
                 }
             }
         }

         if (depositRecord && depositRecord.id && depositRecord.status === DepositStatus.PENDING) {
            try {
               const updateTransaction = await this.sequelize.transaction();
               await depositRecord.update({ status: DepositStatus.FAILED }, { transaction: updateTransaction });
               await updateTransaction.commit();
               this.logger.error(`Registro de depósito ${depositRecord.id} (txid: ${depositRecord.efiTxid ?? 'N/A'}) marcado como FAILED após falha na criação da cobrança na Efí.`);
            } catch (updateError) {
               this.logger.error(`Falha ao marcar registro de depósito ${depositRecord.id} como FAILED: ${(updateError as any).message}`);
            }
         }

        if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
            throw error;
        }
         if (error instanceof InternalServerErrorException && error.message.includes('EFI_PIX_KEY')) {
            throw error;
        }
        if ((error as any).isNetworkOrTlsError) {
            throw error;
        }

        this.logger.error(`Error inesperado ao criar cobrança de depósito para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
        throw new InternalServerErrorException('Error interno ao solicitar depósito.');
    }
}

  async requestWithdrawal(userId: number, amount: number, pixKeyData: { keyType: string; keyValue: string; name?: string; cpfCnpj?: string }): Promise<Withdrawal> {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        this.logger.error(`requestWithdrawal: Valor do saque inválido recebido para usuário ${userId}: ${amount}`);
        throw new BadRequestException('Valor do saque inválido.');
    }
    const amountFixed = parseFloat(amount.toFixed(2));
     if (amountFixed !== amount) {
         this.logger.warn(`requestWithdrawal: Valor do saque para usuário ${userId} ajustado de ${amount} para ${amountFixed} para corresponder a 2 casas decimais.`);
          amount = amountFixed;
     }

    if (!pixKeyData || !pixKeyData.keyType || !pixKeyData.keyValue) {
        this.logger.error(`requestWithdrawal: Dados da chave Pix incompletos para usuário ${userId}: ${JSON.stringify(pixKeyData)}`);
        throw new BadRequestException('Dados da chave Pix incompletos.');
    }

    const transaction = await this.sequelize.transaction();
    let withdrawalRecord: Withdrawal | null = null;

    try {
        const user = await this.authService.updateUserBalance(userId, -amount, transaction);
        this.logger.log(`Saldo do usuário ${userId} debitado em R$ ${amount.toFixed(2)} para saque.`);

        const efiIdEnvio = uuidv4().replace(/-/g, '');
        this.logger.debug(`Generated efiIdEnvio (without hyphens): ${efiIdEnvio}`);

        withdrawalRecord = await this.withdrawalModel.create({
            userId: userId,
            amount: amount,
            status: WithdrawalStatus.PROCESSING,
            targetPixKeyType: pixKeyData.keyType,
            targetPixKey: pixKeyData.keyValue,
            targetName: pixKeyData.name,
            targetCpfCnpj: pixKeyData.cpfCnpj,
            efiIdEnvio: efiIdEnvio,
        }, { transaction });
        this.logger.log(`Registro de saque ${withdrawalRecord.id} criado para o usuário ${userId}, valor R$ ${amount.toFixed(2)}. Status: PROCESSING. efiIdEnvio: ${efiIdEnvio}`);


         const efiPixKeyPagador = this.configService.get<string>('EFI_PIX_KEY');
         if (!efiPixKeyPagador) {
             const msg = 'Chave Pix da conta pagadora (EFI_PIX_KEY) não configurada no .env.';
             this.logger.error(msg);
            throw new InternalServerErrorException(msg);
         }

         const token = await this.getAccessToken();


         const withdrawalData = {
            valor: amount.toFixed(2),
             pagador: {
                 chave: efiPixKeyPagador,
                 infoPagador: `Saque Loto Jack (ID: ${withdrawalRecord.id}, User: ${userId})`,
             },
             favorecido: {
                 chave: pixKeyData.keyValue,
             }
         };

        this.logger.debug(`Chamando EFI PUT /v3/gn/pix/${efiIdEnvio} com dados: ${JSON.stringify(withdrawalData)}`);
        const efiResponse = await this.makeEfiRequest('put', `/v3/gn/pix/${efiIdEnvio}`, withdrawalData, {
             headers: {
                 'Authorization': `Bearer ${token}`,
             }
        });

        this.logger.debug(`Resposta inicial da EFI para requisição de saque (${efiIdEnvio}): ${JSON.stringify(efiResponse)}`);

         await withdrawalRecord.update({
              efiE2eId: efiResponse.e2eId,
         }, { transaction });


        await transaction.commit();

        this.logger.log(`Saque ${withdrawalRecord.id} (efiIdEnvio: ${efiIdEnvio}) para R$ ${amount.toFixed(2)} solicitado para chave ${pixKeyData.keyValue} (tipo ${pixKeyData.keyType}). Status: PROCESSING.`);

        await withdrawalRecord.reload();

        return withdrawalRecord;

    } catch (error) {
         if (transaction && !(transaction as any).finished) {
             try {
                 await transaction.rollback();
                 this.logger.warn(`Rollback executado para solicitação de saque do usuário ${userId} devido a error capturado.`);
             } catch (rollbackError: any) {
                  if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Error ao tentar executar rollback no CATCH para solicitação de saque do usuário ${userId}: ${rollbackError}`);
                 }
             }
         }

         if (error instanceof Error && ((error as any).isHandled)) {
              if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
                 try {
                    const updateTransaction = await this.sequelize.transaction();
                    await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
                    await updateTransaction.commit();
                     this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback) devido a error de saldo.`);
                 } catch (updateError) {
                    this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED após error de saldo: ${(updateError as any).message}`);
                 }
             }
             if (error.message.includes('Saldo insuficiente')) {
                throw new BadRequestException('Saldo insuficiente para concluir o saque.');
             }
              throw new InternalServerErrorException(`Error na operação de saldo durante o saque: ${error.message}`);
         }

         if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
              if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
                 try {
                    const updateTransaction = await this.sequelize.transaction();
                    await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
                    await updateTransaction.commit();
                     this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback) devido a error na requisição Efí.`);
                 } catch (updateError) {
                    this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED após error na requisição Efí: ${(updateError as any).message}`);
                 }
             }
             throw error;
         }
         if (error instanceof InternalServerErrorException && error.message.includes('Chave Pix da conta pagadora')) {
             throw error;
         }
        if ((error as any).isNetworkOrTlsError) {
            throw error;
        }

        this.logger.error(`Error inesperado ao solicitar saque para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
        if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
            try {
               const updateTransaction = await this.sequelize.transaction();
               await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
               await updateTransaction.commit();
                this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback) devido a error inesperado.`);
            } catch (updateError) {
               this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED após error inesperado: ${(updateError as any).message}`);
            }
        }
        throw new InternalServerErrorException('Error interno ao solicitar saque.');
    }
}

  async handleWebhook(efiPayload: any, rawBody: Buffer, clientIp: string | undefined): Promise<void> { // Assinatura corrigida
      this.logger.log(`Webhook da Efí recebido. Validando segurança e processando payload...`);
      const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');

      // --- VALIDAÇÃO DE SEGURANÇA (Produção) ---

      // 1. Validação por IP de Origem (Recomendado pela Efí com skip-mTLS)
      if (this.allowedWebhookIps.length > 0) {
          // Verifica se clientIp é undefined ou não está na lista
          if (clientIp === undefined || !this.allowedWebhookIps.includes(clientIp)) {
              this.logger.warn(`Tentativa de acesso não autorizado ao webhook. IP de Origem "${clientIp}" (ou undefined) NÃO está na lista de IPs permitidos: [${this.allowedWebhookIps.join(', ')}]. Ignorando payload.`);
              return;
          }
          this.logger.debug(`IP de Origem "${clientIp}" validado com sucesso.`);
      } else {
          this.logger.warn('Validação por IP de webhook desativada (EFI_WEBHOOK_ALLOWED_IPS não configurado). Considere configurá-la para aumentar a segurança.');
      }

      // 2. Validação de HMAC (Altamente Recomendado pela Efí com skip-mTLS)
      const receivedHmac = "PLACEHOLDER_HMAC_RECEBIDO"; // <-- SUBSTITUA ISTO pelo valor real recebido da Efí (do header, query, etc.)
      const webhookSecretKey = this.configService.get<string>('EFI_WEBHOOK_SECRET');

      if (webhookSecretKey && receivedHmac !== "PLACEHOLDER_HMAC_RECEBIDO") {
          try {
              // TODO: Validar o HMAC. A forma exata depende de como a Efí gera e envia o HMAC.
              // Exemplo comum: hmac-sha256 do rawBody, usando webhookSecretKey.
              // const expectedHmac = crypto.createHmac('sha256', webhookSecretKey).update(rawBody).digest('hex');
              // TODO: Compare expectedHmac com receivedHmac (use crypto.timingSafeEqual se strings tiverem o mesmo tamanho)
              // if (expectedHmac !== receivedHmac) {
              //    this.logger.warn(`Validação de HMAC do webhook falhou para IP "${clientIp}". Assinaturas não batem. Payload pode ser malicioso. Ignorando.`);
              //    return;
              // }
             this.logger.debug('Validação de HMAC pendente de implementação completa com o formato correto do HMAC enviado pela Efí.');

          } catch (hmacError) {
              this.logger.error(`Erro durante a validação de HMAC do webhook para IP "${clientIp}": ${(hmacError as any).message}. Ignorando payload.`);
              return;
          }
      } else if (webhookSecretKey && receivedHmac === "PLACEHOLDER_HMAC_RECEBIDO") {
           this.logger.warn('Validação de HMAC do webhook desativada (HMAC recebido é placeholder). Considere implementá-la para aumentar a segurança.');
      } else if (!webhookSecretKey) {
           this.logger.warn('Validação de HMAC do webhook desativada (EFI_WEBHOOK_SECRET não configurado). Considere configurá-la para aumentar a segurança.');
      }

      // --- Fim Validação de Segurança ---
      this.logger.debug('Validação de segurança inicial do webhook concluída. Processando payload...');


      if (!Array.isArray(efiPayload)) {
          this.logger.error('Payload do webhook da Efí não é um array inesperado.');
           return;
      }

      for (const event of efiPayload) {
           const eventPixRecebido = (event as any).pix;

           if (eventPixRecebido && eventPixRecebido.e2eId && eventPixRecebido.valor !== undefined && eventPixRecebido.txid) {
                const e2eId = eventPixRecebido.e2eId;
                const amountReceived = parseFloat(eventPixRecebido.valor);
                const txid = eventPixRecebido.txid;

                if (isNaN(amountReceived)) {
                    this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}): Valor (${eventPixRecebido.valor}) inválido.`);
                    continue;
                }

                this.logger.log(`Processando Webhook PIX recebido: E2EId ${e2eId}, Txid ${txid}, Valor R$ ${amountReceived.toFixed(2)}.`);

                const transaction = await this.sequelize.transaction();
                let depositRecord: Deposit | null = null;

                try {
                    depositRecord = await this.depositModel.findOne({
                        where: {
                            [Op.or]: [
                                { efiTxid: txid },
                                { efiE2eId: e2eId },
                            ],
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });

                    if (!depositRecord) {
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito correspondente NÃO encontrado ou já processado. Pode ser notificação duplicada ou PIX não iniciado pela app.`);
                        await transaction.commit();
                        continue;
                    }

                    if (depositRecord.status === DepositStatus.PAID) {
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito ${depositRecord.id} já está no status PAID.`);
                         await transaction.commit();
                         continue;
                    }

                     if (depositRecord.amount.toFixed(2) !== amountReceived.toFixed(2)) {
                         this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Discrepância de valor. Depósito ${depositRecord.id} esperado ${depositRecord.amount.toFixed(2)}, recebido ${amountReceived.toFixed(2)}. NÃO CREDITADO AUTOMATICAMENTE.`);
                          await transaction.commit();
                         continue;
                     }

                    await depositRecord.update({
                        status: DepositStatus.PAID,
                        efiE2eId: e2eId,
                    }, { transaction });
                    this.logger.log(`Registro de depósito ${depositRecord.id} atualizado para PAID. E2EId: ${e2eId}.`);

                    await this.authService.updateUserBalance(depositRecord.userId, depositRecord.amount, transaction);
                    this.logger.log(`Saldo de R$ ${depositRecord.amount.toFixed(2)} creditado para o usuário ${depositRecord.userId} (Depósito ${depositRecord.id}).`);

                    await transaction.commit();
                    this.logger.log(`Processamento do webhook para depósito ${depositRecord.id} (E2EId ${e2eId}) concluído com sucesso.`);

                } catch (error) {
                     if (transaction && !(transaction as any).finished) {
                         await transaction.rollback();
                         this.logger.warn(`Rollback executado para processamento de webhook (Depósito, E2EId ${e2eId}) devido a error.`);
                     }
                    this.logger.error(
                        `Error ao processar webhook para depósito (E2EId ${e2eId}, Txid ${txid}): ${(error as any).message}`,
                        (error as any).stack
                    );
                }
           }

            const eventGnPixEnvio = (event as any).gnPix;

            if (eventGnPixEnvio && eventGnPixEnvio.idEnvio && eventGnPixEnvio.status) {
                 const idEnvio = eventGnPixEnvio.idEnvio;
                 const statusEfí = eventGnPixEnvio.status;
                 const e2eId = eventGnPixEnvio.e2eId;

                 this.logger.log(`Processando Webhook ENVIO PIX: idEnvio ${idEnvio}, Status EFI: ${statusEfí}, E2EId: ${e2eId ?? 'N/A'}.`);

                 const transaction = await this.sequelize.transaction();
                 let withdrawalRecord: Withdrawal | null = null;
                 try {
                     withdrawalRecord = await this.withdrawalModel.findOne({
                         where: {
                            efiIdEnvio: idEnvio,
                            status: { [Op.in]: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] }
                         },
                         transaction,
                         lock: transaction.LOCK.UPDATE,
                     });

                     if (!withdrawalRecord) {
                         this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Saque PENDING/PROCESSING NÃO encontrado ou já finalizado.`);
                         await transaction.commit();
                         continue;
                     }

                     let newStatus: WithdrawalStatus | undefined = undefined;
                     let estornarSaldo = false;

                     switch (statusEfí) {
                         case 'CONCLUIDA':
                             newStatus = WithdrawalStatus.COMPLETED;
                             break;
                         case 'NEGADA':
                         case 'ERRO':
                         case 'DEVOLVIDA':
                             newStatus = WithdrawalStatus.FAILED;
                             estornarSaldo = true;
                             break;
                         case 'EM_PROCESSAMENTO':
                             if (withdrawalRecord.status !== WithdrawalStatus.PROCESSING) {
                                 await withdrawalRecord.update({ status: WithdrawalStatus.PROCESSING }, { transaction });
                                 this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para EM_PROCESSAMENTO.`);
                             }
                             break;
                         default:
                             this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Status EFI desconhecido "${statusEfí}". Ignorando atualização de status para evitar inconsistência.`);
                             break;
                     }

                     if (newStatus !== undefined) {
                         await withdrawalRecord.update({
                             status: newStatus,
                             efiE2eId: e2eId ?? withdrawalRecord.efiE2eId,
                         }, { transaction });
                         this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para status local: ${newStatus}.`);

                         if (estornarSaldo) {
                             await this.authService.updateUserBalance(withdrawalRecord.userId, withdrawalRecord.amount, transaction);
                             this.logger.log(`Saldo de R$ ${withdrawalRecord.amount.toFixed(2)} estornado para o usuário ${withdrawalRecord.userId} (Saque ${withdrawalRecord.id}).`);
                         }
                     }


                     await transaction.commit();
                     this.logger.log(`Processamento do webhook para saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) concluído com sucesso.`);

                 } catch (error) {
                     if (transaction && !(transaction as any).finished) {
                         await transaction.rollback();
                         this.logger.warn(`Rollback executado para processamento de webhook (Saque, idEnvio ${idEnvio}) devido a error.`);
                     }
                     this.logger.error(
                         `Error ao processar webhook para saque (idEnvio ${idEnvio}): ${(error as any).message}`,
                         (error as any).stack
                     );
                 }
             } else {
               this.logger.warn(`Webhook da Efí recebido com formato de evento inesperado. Evento: ${JSON.stringify(event)}. Payload completo: ${JSON.stringify(efiPayload)}`);
            }

      }

       this.logger.log('Processamento de webhook(s) da Efí finalizado.');
  }

   async getUserDeposits(userId: number): Promise<Deposit[]> {
       return this.depositModel.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
   }

   async getUserWithdrawals(userId: number): Promise<Withdrawal[]> {
        return this.withdrawalModel.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
    }

    async getDepositDetails(id: number): Promise<Deposit> {
        const deposit = await this.depositModel.findByPk(id);
        if (!deposit) {
            throw new NotFoundException('Depósito não encontrado.');
        }
        return deposit;
    }

    async getWithdrawalDetails(id: number): Promise<Withdrawal> {
        const withdrawal = await this.withdrawalModel.findByPk(id);
         if (!withdrawal) {
             throw new NotFoundException('Saque não encontrado.');
         }
        return withdrawal;
    }

    async configureEfiWebhook(): Promise<any> {
         this.logger.log('Solicitando configuração do webhook na API da Efí...');

         const pixKey = this.configService.get<string>('EFI_PIX_KEY');
         const webhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');
         const publicHost = 'https://jackbear-lotoapi.r954jc.easypanel.host';

         if (!pixKey) {
              const msg = 'Chave Pix da Efí (EFI_PIX_KEY) não configurada no .env.';
              this.logger.error(msg);
              throw new InternalServerErrorException(msg);
         }
         if (!webhookSecret) {
             const msg = 'Segredo do Webhook da Efí (EFI_WEBHOOK_SECRET) não configurado no .env.';
             this.logger.error(msg);
             throw new InternalServerErrorException(msg);
         }

         const token = await this.getAccessToken();

         const webhookUrlToEfí = `${publicHost}/pix/webhook/${webhookSecret}`;

         this.logger.debug(`Configurando webhook para a chave Pix: ${pixKey} com URL: ${webhookUrlToEfí}`);

         const requestBody = {
             webhookUrl: webhookUrlToEfí
         };

         const extraConfig: AxiosRequestConfig = {
              headers: {
                   'x-skip-mtls-checking': 'true',
                   'Authorization': `Bearer ${token}`,
              },
         };


         try {
             const efiResponse = await this.makeEfiRequest('put', `/v2/webhook/${pixKey}`, requestBody, extraConfig);

             this.logger.log(`Configuração do webhook na Efí solicitada com sucesso. Resposta: ${JSON.stringify(efiResponse)}`);
             return efiResponse;

         } catch (error: any) {
             if ((error as any).isEfiError) {
                  throw error;
             }
             if ((error as any).isNetworkOrTlsError) {
                throw error;
            }
             this.logger.error(`Error inesperado ao configurar webhook na Efí para a chave ${pixKey}: ${error.message}`, error.stack);
             throw new InternalServerErrorException(`Falha ao configurar webhook na Efí: ${error.message}`);
         }
    }

}