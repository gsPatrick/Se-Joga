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

// --- Adicionar imports para cliente HTTP ---
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'; // Adicionado AxiosRequestConfig
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
// --- Fim imports cliente HTTP ---

@Injectable()
export class EfiPixService {
  private readonly logger = new Logger(EfiPixService.name);
  private efipayApi!: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    @InjectModel(Deposit) private depositModel: typeof Deposit,
    @InjectModel(Withdrawal) private withdrawalModel: typeof Withdrawal,
    private authService: AuthService,
    private configService: ConfigService,
    private sequelize: Sequelize,
  ) {
    this.configureAxiosInstance();
  }

  private configureAxiosInstance() {
      const certPath = this.configService.get<string>('EFI_CERT_PATH');
      const certPassword = this.configService.get<string>('EFI_CERT_PASSWORD') || '';
      const efiBaseUrl = this.configService.get<string>('EFI_BASE_URL') || 'https://pix-h.api.efipay.com.br';

      if (!certPath) {
          this.logger.error('Caminho do certificado EFI não configurado no .env (EFI_CERT_PATH). A API da Efí não funcionará.');
      }


      this.efipayApi = axios.create({
          baseURL: efiBaseUrl,
          headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
          },
          httpsAgent: certPath ? new https.Agent({
               pfx: fs.readFileSync(path.resolve(certPath)),
               passphrase: certPassword,
          }) : undefined,
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
            } else if (error.request) {
                this.logger.error(`Erro da EFI (Requisição): Sem resposta recebida - ${error.message} - ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
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
              },
          });

          const { access_token, expires_in } = response.data;
          if (!access_token || expires_in === undefined) {
               const errorMessage = 'Resposta inesperada da Efí ao obter token.';
               this.logger.error(`${errorMessage} Resposta: ${JSON.stringify(response.data)}`);
               throw new InternalServerErrorException(errorMessage);
          }

          this.accessToken = access_token;
          this.tokenExpiry = new Date(Date.now() + expires_in * 1000);

          this.logger.log('Novo token da Efí obtido com sucesso.');
          return this.accessToken!;
      } catch (error: any) {
          throw error;
      }
  }

    // --- Método auxiliar para fazer requisições autenticadas ---
    // Adicionado parametro opcional extraConfig para passar headers específicos, etc.
    private async makeEfiRequest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, data?: any, extraConfig?: AxiosRequestConfig): Promise<any> {
        const token = await this.getAccessToken();
        try {
            const response = await this.efipayApi({
                method,
                url,
                data,
                headers: {
                    'Authorization': `Bearer ${token}`,
                     ...extraConfig?.headers // Mescla headers extras
                },
                 ...extraConfig // Mescla outras configurações como httpsAgent (já configurado na instância, mas pode ser sobrescrito se necessário)
            });
            return response.data;
        } catch (error: any) {
             throw error;
        }
    }


  // --- Lógica de Depósito ---
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
              const errorMessage = 'Chave Pix de recebimento (EFI_PIX_KEY) não configurada no .env. Não é possível criar cobrança.';
              this.logger.error(errorMessage);
             throw new InternalServerErrorException(errorMessage);
         }
         this.logger.debug(`Usando chave Pix EFI: ${efiPixKey}`);


        const chargeData = {
            calendario: {
                expiracao: 3600 // 1 hora de validade
            },
            valor: {
                original: amount.toFixed(2)
            },
             chave: efiPixKey,
            solicitacaoPagador: `Depósito para usuário ${userId} na Loto Jack (ID Transacao: ${depositRecord.id})`,
        };

        this.logger.debug(`Chamando EFI POST /v2/cob com dados: ${JSON.stringify(chargeData)}`);
        const efiResponse = await this.makeEfiRequest('post', '/v2/cob', chargeData);

         this.logger.debug(`Resposta da EFI para criação de cobrança: ${JSON.stringify(efiResponse)}`);

        if (!efiResponse || !efiResponse.txid || !efiResponse.pixCopiaECola || !efiResponse.loc?.location) {
            const errorMessage = 'Resposta inesperada da Efí ao criar cobrança: dados de retorno incompletos (txid, pixCopiaECola, location).';
             this.logger.error(`${errorMessage} Resposta completa: ${JSON.stringify(efiResponse)}`);
            throw new InternalServerErrorException(errorMessage);
        }

         // Certifique-se que o campo efiCreateChargePayload existe no seu modelo Deposit
        await depositRecord.update({
            efiTxid: efiResponse.txid,
            qrCodeImage: efiResponse.loc.location,
            pixCopiaECola: efiResponse.pixCopiaECola,
             // efiCreateChargePayload: efiResponse, // Descomentar se o campo existir
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
                 this.logger.warn(`Rollback executado para criação de depósito do usuário ${userId} devido a erro capturado.`);
             } catch (rollbackError: any) {
                  if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para criação de depósito do usuário ${userId}: ${rollbackError}`);
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

        this.logger.error(`Erro inesperado ao criar cobrança de depósito para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
        throw new InternalServerErrorException('Erro interno ao solicitar depósito.');
    }
}

  // --- Lógica de Saque ---
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


         const withdrawalData = {
            valor: amount.toFixed(2),
             pagador: {
                 chave: this.configService.get<string>('EFI_PIX_KEY'),
                 infoPagador: `Saque Loto Jack (ID: ${withdrawalRecord.id}, User: ${userId})`,
             },
             favorecido: {
                 chave: pixKeyData.keyValue,
             }
         };

        this.logger.debug(`Chamando EFI PUT /v3/gn/pix/${efiIdEnvio} com dados: ${JSON.stringify(withdrawalData)}`);
        const efiResponse = await this.makeEfiRequest('put', `/v3/gn/pix/${efiIdEnvio}`, withdrawalData);

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
                 this.logger.warn(`Rollback executado para solicitação de saque do usuário ${userId} devido a erro capturado.`);
             } catch (rollbackError: any) {
                  if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para solicitação de saque do usuário ${userId}: ${rollbackError}`);
                 }
             }
         }

         if (error instanceof Error && ((error as any).isHandled)) {
              if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
                 try {
                    const updateTransaction = await this.sequelize.transaction();
                    await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
                    await updateTransaction.commit();
                     this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback) devido a erro de saldo.`);
                 } catch (updateError) {
                    this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED após erro de saldo: ${(updateError as any).message}`);
                 }
             }
             throw new BadRequestException('Saldo insuficiente para concluir o saque.');
         }

         if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
              if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
                 try {
                    const updateTransaction = await this.sequelize.transaction();
                    await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
                    await updateTransaction.commit();
                     this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback) devido a erro na requisição Efí.`);
                 } catch (updateError) {
                    this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED após erro na requisição Efí: ${(updateError as any).message}`);
                 }
             }
             throw error;
         }


         this.logger.error(`Erro inesperado ao solicitar saque para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
         if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
            try {
               const updateTransaction = await this.sequelize.transaction();
               await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
               await updateTransaction.commit();
                this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback) devido a erro inesperado.`);
            } catch (updateError) {
               this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED após erro inesperado: ${(updateError as any).message}`);
            }
        }
        throw new InternalServerErrorException('Erro interno ao solicitar saque.');
    }
}


  // --- Lógica de Webhook ---
  async handleWebhook(efiPayload: any): Promise<void> {
      const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');
      // NOTA: A validação real do segredo é feita no controller antes de chamar este método.
      // Este método assume que a validação básica (segredo na URL) já passou.
      // A validação mais robusta (HMAC) DEVE ser implementada.


      this.logger.log(`Webhook da Efí recebido. Processando payload...`);


      if (!Array.isArray(efiPayload)) {
          this.logger.error('Payload do webhook da Efí não é um array inesperado.');
           return;
      }

      for (const event of efiPayload) {
           const eventPix = event.pix;

           // Lógica para processar PIX RECEBIDO (DEPÓSITO) - Identificado por ter e2eId e txid no 'pix'
           if (eventPix && eventPix.e2eId && eventPix.valor !== undefined && eventPix.txid) {
                const e2eId = eventPix.e2eId;
                const amountReceived = parseFloat(eventPix.valor);
                const txid = eventPix.txid;

                if (isNaN(amountReceived)) {
                    this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}): Valor (${eventPix.valor}) inválido.`);
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
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito correspondente NÃO encontrado ou já processado.`);
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
                         // efiWebhookPayload: event, // Descomentar se o campo existir
                    }, { transaction });
                    this.logger.log(`Registro de depósito ${depositRecord.id} atualizado para PAID. E2EId: ${e2eId}.`);

                    await this.authService.updateUserBalance(depositRecord.userId, depositRecord.amount, transaction);
                    this.logger.log(`Saldo de R$ ${depositRecord.amount.toFixed(2)} creditado para o usuário ${depositRecord.userId} (Depósito ${depositRecord.id}).`);

                    await transaction.commit();
                    this.logger.log(`Processamento do webhook para depósito ${depositRecord.id} (E2EId ${e2eId}) concluído com sucesso.`);

                } catch (error) {
                     if (transaction && !(transaction as any).finished) {
                         await transaction.rollback();
                         this.logger.warn(`Rollback executado para processamento de webhook (Depósito, E2EId ${e2eId}) devido a erro.`);
                     }
                    this.logger.error(
                        `Erro ao processar webhook para depósito (E2EId ${e2eId}, Txid ${txid}): ${(error as any).message}`,
                        (error as any).stack
                    );
                }
           }
           // Lógica para processar ENVIO DE PIX (SAQUE) - Precisa confirmar o formato do webhook para saque.
           // Pelo erro, a Efí notifica o status final do ENVIO de Pix pela chave do PAGADOR.
           // O payload pode ser diferente do webhook de PIX RECEBIDO.
           // PRECISAMOS DO FORMATO DO PAYLOAD DE WEBHOOK PARA ENVIO DE PIX DA EFÍ.
           // Assumindo que pode vir um array de eventos, e cada evento de saque tenha algo como event.pixEnvio ou event.envioPixStatus
           // E que contenha o idEnvio (nosso ID) e o status final.

            // EX: Se o payload de webhook de ENVIO for parecido com a consulta de ENVIO (/v2/gn/pix/enviados/id-envio/:idEnvio):
            // efiPayload = [{ gnPix: { idEnvio: 'seu_id', status: 'CONCLUIDA', e2eId: 'e2e_final', ... } }]
            const eventGnPix = (event as any).gnPix; // Tentativa de acessar o campo 'gnPix'

            if (eventGnPix && eventGnPix.idEnvio && eventGnPix.status) {
                 const idEnvio = eventGnPix.idEnvio; // Nosso efiIdEnvio (UUID sem hifens)
                 const statusEfí = eventGnPix.status; // Ex: 'CONCLUIDA', 'EM_PROCESSAMENTO', 'NEGADA', 'ERRO'
                 const e2eId = eventGnPix.e2eId; // E2EId final, se concluído

                 this.logger.log(`Processando Webhook ENVIO PIX: idEnvio ${idEnvio}, Status EFI: ${statusEfí}, E2EId: ${e2eId ?? 'N/A'}.`);

                 const transaction = await this.sequelize.transaction();
                 let withdrawalRecord: Withdrawal | null = null;
                 try {
                     // Buscar o saque pelo nosso idEnvio e status PENDING/PROCESSING
                     withdrawalRecord = await this.withdrawalModel.findOne({
                         where: {
                            efiIdEnvio: idEnvio,
                            status: { [Op.in]: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] } // Pode estar PENDING ou PROCESSING
                         },
                         transaction,
                         lock: transaction.LOCK.UPDATE,
                     });

                     if (!withdrawalRecord) {
                         this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Saque PENDING/PROCESSING NÃO encontrado ou já finalizado.`);
                         await transaction.commit();
                         continue;
                     }

                     // Lógica de status da Efí -> Status local
                     let newStatus: WithdrawalStatus | undefined = undefined;
                     let estornarSaldo = false;

                     switch (statusEfí) {
                         case 'CONCLUIDA':
                             newStatus = WithdrawalStatus.COMPLETED;
                             // Saldo já foi debitado ao solicitar, nada mais a fazer com o saldo.
                             break;
                         case 'NEGADA': // Ex: chave inválida, conta favorecido bloqueada, etc.
                         case 'ERRO':   // Erro interno na Efí
                         case 'DEVOLVIDA': // Se o banco do favorecido devolver o Pix
                            // Pode haver outros status de falha, verificar doc
                             newStatus = WithdrawalStatus.FAILED;
                             estornarSaldo = true; // O saque falhou, estornar o saldo.
                             break;
                         case 'EM_PROCESSAMENTO':
                             // Manter status como PROCESSING (se já não for)
                             // Não faz nada com o saldo ainda.
                             if (withdrawalRecord.status !== WithdrawalStatus.PROCESSING) {
                                 await withdrawalRecord.update({ status: WithdrawalStatus.PROCESSING }, { transaction });
                                 this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para EM_PROCESSAMENTO.`);
                             }
                             break; // Não atualizar newStatus, não estornar
                          // TODO: Lidar com outros status se existirem (ex: CANCELADA)
                         default:
                             this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Status EFI desconhecido "${statusEfí}". Ignorando atualização de status para evitar inconsistência.`);
                             // Não faz nada, mantém o status atual, pode precisar de revisão manual.
                             break; // Não atualizar newStatus, não estornar
                     }

                     // Se um novo status foi definido (CONCLUIDA, NEGADA, ERRO, DEVOLVIDA)
                     if (newStatus !== undefined) {
                          // Atualizar o status e o E2EId final (se disponível)
                         await withdrawalRecord.update({
                             status: newStatus,
                             efiE2eId: e2eId ?? withdrawalRecord.efiE2eId, // Atualiza se e2eId final for fornecido
                             // efiWebhookPayload: event, // Descomentar se o campo existir
                         }, { transaction });
                         this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para status local: ${newStatus}.`);

                         // Se for necessário estornar o saldo (saque falhou)
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
                         this.logger.warn(`Rollback executado para processamento de webhook (Saque, idEnvio ${idEnvio}) devido a erro.`);
                     }
                     this.logger.error(
                         `Erro ao processar webhook para saque (idEnvio ${idEnvio}): ${(error as any).message}`,
                         (error as any).stack
                     );
                 }
             } // Fim da lógica para webhook ENVIO PIX (Saque)
             else {
               // Se não é um Pix Recebido (Depósito) nem um evento GnPix (Saque) no formato esperado
               this.logger.warn(`Webhook da Efí recebido com formato de evento inesperado. Evento: ${JSON.stringify(event)}. Payload completo: ${JSON.stringify(efiPayload)}`);
            }

      } // Fim do loop pelos eventos do payload

       this.logger.log('Processamento de webhook(s) da Efí finalizado.');
  }

  // --- Métodos de Consulta (Opcional, para o Controller) ---
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

    // --- NOVO MÉTODO PARA CONFIGURAR O WEBHOOK NA EFÍ ---
    async configureEfiWebhook(): Promise<any> {
         this.logger.log('Solicitando configuração do webhook na API da Efí...');

         const pixKey = this.configService.get<string>('EFI_PIX_KEY');
         const webhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');
         const publicHost = 'https://jackbear-lotoapi.r954jc.easypanel.host'; // HARDCODED - **Perigoso!**

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


         // Monta a URL completa do seu webhook (aquela que a Efí vai chamar)
         // Inclui o segredo na URL.
         // NOTA: A Efí adiciona '/pix' ao final do URL configurado. Sua rota no controller já lida com isso.
         // Se você quiser usar HMAC na query param (mais seguro com skip-mTLS), a URL seria:
         // const webhookUrl = `${publicHost}/pix/webhook/${webhookSecret}?hmac=placeholder`; // 'placeholder' é apenas para o formato da URL
         // Mas para a maneira mais simples, sem HMAC na URL:
         const webhookUrlToEfí = `${publicHost}/pix/webhook/${webhookSecret}`;


         this.logger.debug(`Configurando webhook para a chave Pix: ${pixKey} com URL: ${webhookUrlToEfí}`);

         const requestBody = {
             webhookUrl: webhookUrlToEfí
         };

          // Configuração extra para a requisição, incluindo o header para pular mTLS
         const extraConfig: AxiosRequestConfig = {
              headers: {
                   'x-skip-mtls-checking': 'true' // Indica à Efí para não validar mTLS no seu servidor
              }
         };


         try {
              // Chamar a API da Efí (PUT /v2/webhook/:chave)
             const efiResponse = await this.makeEfiRequest('put', `/v2/webhook/${pixKey}`, requestBody, extraConfig);

             this.logger.log(`Configuração do webhook na Efí solicitada com sucesso. Resposta: ${JSON.stringify(efiResponse)}`);
             return efiResponse; // Retorna a resposta da Efí

         } catch (error) {
              this.logger.error(`Falha ao configurar webhook na Efí para a chave ${pixKey}: ${(error as any).message}`, (error as any).stack);
              // Propaga o erro, o controller que chamar lidará com a resposta para o usuário
              throw new InternalServerErrorException(`Falha ao configurar webhook na Efí: ${((error as any).response?.data?.mensagem || (error as any).message)}`);
         }
    }
    // --- Fim NOVO MÉTODO ---

}