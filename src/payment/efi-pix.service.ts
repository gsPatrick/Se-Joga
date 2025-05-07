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

// --- Imports para cliente HTTP ---
import axios, { AxiosInstance, AxiosRequestConfig, RawAxiosRequestHeaders } from 'axios'; // Adicionado RawAxiosRequestHeaders
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
      // Usando a URL de produção conforme sua última intenção
      const efiBaseUrl = this.configService.get<string>('EFI_BASE_URL') || 'https://pix.api.efipay.com.br';

      // Verifica se o certificado existe ANTES de criar o httpsAgent
      const resolvedCertPath = path.resolve(certPath || ''); // Resolve mesmo que certPath seja undefined/vazio
      const certExists = certPath && fs.existsSync(resolvedCertPath);


      if (!certPath) {
          this.logger.warn('Caminho do certificado EFI não configurado no .env (EFI_CERT_PATH). Requisições mTLS para a API da Efí NÃO funcionarão, exceto a de autenticação se não exigir cert.');
      } else if (!certExists) {
           this.logger.error(`Certificado EFI não encontrado no caminho configurado: ${resolvedCertPath}. Requisições mTLS para a API da Efí FALHARÃO.`);
            // Em um cenário real, você pode querer lançar um erro fatal na inicialização aqui
      }

      // Configura o agente HTTPS com certificado SE ele existir e for válido
      const certHttpsAgent = certExists ? new https.Agent({
          pfx: fs.readFileSync(resolvedCertPath),
          passphrase: certPassword,
          // Opcional: Adicionar outras configurações TLS aqui se necessário,
          // como ca, ciphers, secureOptions, rejectUnauthorized (false para pular validacao do CA da Efí - NAO RECOMENDADO!)
          // rejectUnauthorized: false // APENAS PARA TESTES DE DEBUG - PERIGOSO EM PROD!
      }) : undefined;


      this.efipayApi = axios.create({
          baseURL: efiBaseUrl,
          // REMOVENDO HEADERS PADRÃO DA INSTÂNCIA AQUI para definir explicitamente no makeEfiRequest
          // headers: { ... },
          // ATRIBUI O AGENTE HTTPS AQUI - ISTO AFETA TODAS AS REQUISIÇÕES FEITAS PELA INSTÂNCIA efipayApi
          httpsAgent: certHttpsAgent,
          maxRedirects: 0,
          // Opcional: aumentar timeout para requisições de API se a rede for lenta
          // timeout: 10000, // 10 segundos
      });

       // Interceptor de log
       this.efipayApi.interceptors.request.use(request => {
           const headers = { ...request.headers };
            if (headers['Authorization']) {
                headers['Authorization'] = '[Redacted]';
            }
           this.logger.debug(`Fazendo requisição para EFI: ${request.method?.toUpperCase()} ${request.url}. Headers: ${JSON.stringify(headers)}`);
           // Opcional: logar corpo da requisição, com cuidado para dados sensíveis/grandes
           // if (request.data) this.logger.debug(`Corpo da requisição: ${JSON.stringify(request.data)}`);
           return request;
       }, error => {
            this.logger.error(`Erro na requisição (Interceptor): ${error.message}`);
           return Promise.reject(error);
       });

        // Interceptor de resposta
       this.efipayApi.interceptors.response.use(response => {
           this.logger.debug(`Resposta da EFI: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
            // Opcional: logar corpo da resposta, com cuidado para dados sensíveis/grandes
            // if (response.data) this.logger.debug(`Corpo da resposta: ${JSON.stringify(response.data)}`);
           return response;
       }, error => {
            // O log detalhado já é feito pelo interceptor.
            // Mapear erros comuns da Efí para exceções NestJS claras para o controller.
             if (error.response) {
                 this.logger.error(`Erro da EFI (Resposta): ${error.response.status} ${error.response.config.method?.toUpperCase()} ${error.response.config.url} - ${JSON.stringify(error.response.data)}`);

                  // Mapear alguns erros comuns da Efí para exceções NestJS
                  if (error.response.status === 400) {
                      // Erros 400 da Efí geralmente indicam erro nos dados enviados (BadRequest)
                      throw new BadRequestException(error.response.data);
                  }
                   if (error.response.status === 401) {
                       // Erros 401 indicam problema de autenticação (Unauthorized)
                       throw new UnauthorizedException(error.response.data);
                   }
                   if (error.response.status === 404) {
                       // Erros 404 indicam recurso não encontrado (NotFound)
                       throw new NotFoundException(error.response.data);
                   }
                    if (error.response.status === 409) {
                       // Erros 409 indicam conflito (Conflict)
                       throw new ConflictException(error.response.data);
                   }
                   // Para outros 4xx ou 5xx, pode lançar InternalServerError ou re-lançar o error original
                   if (error.response.status >= 400) {
                        // Adiciona um flag para indicar que é um error da Efí
                         (error as any).isEfiError = true;
                         // Re-lança o error original com o flag
                         return Promise.reject(error); // Permite que o catcher capture e decida se lança NestJS exception
                   }

             } else if (error.request) {
                 this.logger.error(`Erro da EFI (Requisição): Sem resposta recebida - ${error.message} - ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
                  // Se o error for "socket hang up" ou outro error de rede/TLS sem resposta HTTP
                  // Adiciona uma flag para indicar error de rede/TLS
                  (error as any).isNetworkOrTlsError = true;
             } else {
                 this.logger.error(`Erro da EFI (Setup): Error ao configurar requisição - ${error.message}`);
             }
              // Re-lança o error original
             return Promise.reject(error);
       });
  }


    // --- Método para obter/gerenciar o token de acesso (FAZ A REQUISIÇÃO DIRETA) ---
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
            // FAZ A REQUISIÇÃO DIRETA COM AXIOS INSTANCE
            const response = await this.efipayApi.post('/oauth/token', {
                grant_type: 'client_credentials',
            }, {
                 // Define headers COMPLETAMENTE aqui para a requisição de token
                headers: {
                    'Authorization': `Basic ${basicAuth}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                // O httpsAgent da instância axios (configurado em configureAxiosInstance) será usado para a conexão TLS.
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
             // O interceptor já logou o error.
             // Se o interceptor marcou como error de rede/TLS:
             if ((error as any).isNetworkOrTlsError) {
                 this.logger.error(`Error de rede/TLS ao obter token da Efí. Verifique certificado, senha, caminho e firewall.`);
                 throw new InternalServerErrorException('Falha de conexão segura ao obter token da Efí. Verifique a configuração do certificado.');
             }
             // Se for error HTTP mapeado ou outro
            throw error; // Re-lança o error já tratado (ou não) pelo interceptor
        }
    }

    // --- Método auxiliar para fazer requisições autenticadas ---
    // Aceita extraConfig, incluindo headers. Define headers básicos (Content-Type, Accept)
    // e mescla com extraConfig.headers (incluindo Authorization Bearer).
    private async makeEfiRequest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, data?: any, extraConfig?: AxiosRequestConfig): Promise<any> {
         // NOTA: A autenticação Bearer DEVE SER PASSADA EXPLICITAMENTE ao chamar este método,
         // no extraConfig.headers.Authorization.
         // getAccessToken() é usado para garantir que o token está disponível e pode ser obtido
         // pelo chamador *antes* de chamar este método e passado no extraConfig.
         // Este método NÃO chama getAccessToken() internamente para obter o token.

        try {
             // Cria o objeto de headers para esta requisição
             // Define Content-Type e Accept explicitamente AQUI e mescla com extraConfig.headers
             const requestHeaders: RawAxiosRequestHeaders = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                 // Adiciona quaisquer headers passados no extraConfig, incluindo Authorization
                ...(extraConfig?.headers as RawAxiosRequestHeaders || {}),
             };

             // Remove headers do extraConfig para evitar duplicação/confusão
             const configWithoutHeaders = {...extraConfig, headers: undefined} as Omit<AxiosRequestConfig, 'headers'>;

             // Faz a requisição usando a instância axios configurada
            const response = await this.efipayApi({
                method,
                url,
                data,
                headers: requestHeaders, // Usa os headers definidos aqui (incluindo Authorization se foi passado no extraConfig)
                ...configWithoutHeaders // Mescla outras configs
            });
            return response.data; // Retorna apenas a parte 'data' da resposta
        } catch (error: any) {
             // O interceptor já logou o error e mapeou alguns para NestJS Exceptions.
             // Se o interceptor marcou como error de rede/TLS:
              if ((error as any).isNetworkOrTlsError) {
                 this.logger.error(`Error de rede/TLS durante makeEfiRequest para ${method} ${url}.`);
                 throw new InternalServerErrorException('Falha de conexão segura com a API da Efí.');
             }
             // Re-lança o error
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
              const errorMessage = 'Chave Pix de recebimento (EFI_PIX_KEY) não configurada no .env.';
              this.logger.error(errorMessage);
             throw new InternalServerErrorException(errorMessage);
         }
         this.logger.debug(`Usando chave Pix EFI: ${efiPixKey}`);

         // Obter o token de acesso para a requisição makeEfiRequest
         const token = await this.getAccessToken();

        const chargeData = {
            calendario: {
                expiracao: 3600 // 1 hora de validade
            },
            valor: {
                original: amount.toFixed(2)
            },
             chave: efiPixKey,
            solicitacaoPagador: `Depósito para usuário ${userId} na Loto Jack (ID Transacao: ${depositRecord.id})`,
             // Opcional: Incluir dados do devedor (usuário) se quiser e a API user.model tiver esses dados
             // Para isso, você precisaria carregar o usuário completo antes de criar o chargeData:
             // const user = await this.authService.findCurrentUser(userId); // OU findUserById? Melhor buscar na transação
             // const user = await this.userModel.findByPk(userId, { transaction }); // Se userModel for injetado aqui
             // devedor: {
             //     cpf: user.cpf.replace(/\D/g, ''), // Formato apenas números
             //     nome: user.name,
             // },
        };

        this.logger.debug(`Chamando EFI POST /v2/cob com dados: ${JSON.stringify(chargeData)}`);
        // Use makeEfiRequest para chamar a API da Efí, passando o token no header
        const efiResponse = await this.makeEfiRequest('post', '/v2/cob', chargeData, {
            headers: {
                'Authorization': `Bearer ${token}`, // <-- ADICIONA O TOKEN AQUI MANUALMENTE
            }
        });

         this.logger.debug(`Resposta da EFI para criação de cobrança: ${JSON.stringify(efiResponse)}`);

        if (!efiResponse || !efiResponse.txid || !efiResponse.pixCopiaECola || !efiResponse.loc?.location) {
            const errorMessage = 'Resposta inesperada da Efí ao criar cobrança: dados de retorno incompletos (txid, pixCopiaECola, location).';
             this.logger.error(`${errorMessage} Resposta completa: ${JSON.stringify(efiResponse)}`);
             // Lançar error mapeado no interceptor ou InternalServerError aqui
            throw new InternalServerErrorException(errorMessage);
        }

        // Atualizar o registro de depósito com os dados da resposta da Efí
         // Certifique-se que o campo efiCreateChargePayload existe no seu modelo Deposit (removido do update temporariamente)
        await depositRecord.update({
            efiTxid: efiResponse.txid,
            qrCodeImage: efiResponse.loc.location,
            pixCopiaECola: efiResponse.pixCopiaECola,
            status: DepositStatus.PENDING, // O status ATIVA da Efí mapeia para PENDING na nossa app até o PIX ser pago.
        }, { transaction });
        this.logger.log(`Registro de depósito ${depositRecord.id} atualizado com dados da Efí (txid ${depositRecord.efiTxid}, QR Code URL, Pix Copia e Cola). Status: PENDING.`);


        await transaction.commit();

        this.logger.log(`Cobrança de depósito ${depositRecord.id} criada com sucesso na Efí e registro local finalizado.`);

         // Recarregar o registro após o commit para garantir que a instância retornada esteja "limpa" e completa
        await depositRecord.reload();

        return depositRecord;

    } catch (error) {
        // Rollback da transação local em caso de error
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

         // Se o registro foi criado antes de falhar na chamada da API, marcá-lo como falho (se possível)
         // Isso é feito fora da transação original que falhou.
         if (depositRecord && depositRecord.id && depositRecord.status === DepositStatus.PENDING) {
            try {
               const updateTransaction = await this.sequelize.transaction(); // Nova transação
               await depositRecord.update({ status: DepositStatus.FAILED }, { transaction: updateTransaction });
               await updateTransaction.commit();
               this.logger.error(`Registro de depósito ${depositRecord.id} (txid: ${depositRecord.efiTxid ?? 'N/A'}) marcado como FAILED após falha na criação da cobrança na Efí.`);
            } catch (updateError) {
               this.logger.error(`Falha ao marcar registro de depósito ${depositRecord.id} como FAILED: ${(updateError as any).message}`);
            }
         }

        // Propagar o error. O interceptor já logou errors da Efí e mapeou alguns.
        // Se o error já é uma NestJS Exception mapeada pelo interceptor:
        if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
            throw error; // Relançar exceções NestJS mapeadas
        }
         // Se for o InternalServerErrorException que lançamos por falta da chave:
        if (error instanceof InternalServerErrorException && error.message.includes('EFI_PIX_KEY')) {
            throw error; // Relançar o error específico da configuração
        }
         // Se for um error de rede/TLS tratado pelo interceptor
        if ((error as any).isNetworkOrTlsError) {
            // O log e a mensagem já foram tratados no interceptor/getAccessToken/makeEfiRequest
            throw error; // Re-lança o error tratado
        }


        // Para quaisquer outros errors não mapeados (ex: error na criação do registro no DB antes do commit, error de rede não tratado pelo interceptor, etc.)
        this.logger.error(`Error inesperado ao criar cobrança de depósito para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
        throw new InternalServerErrorException('Error interno ao solicitar depósito.');
    }
}

  // --- Lógica de Saque ---
  async requestWithdrawal(userId: number, amount: number, pixKeyData: { keyType: string; keyValue: string; name?: string; cpfCnpj?: string }): Promise<Withdrawal> {
    // Validar formato do valor
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        this.logger.error(`requestWithdrawal: Valor do saque inválido recebido para usuário ${userId}: ${amount}`);
        throw new BadRequestException('Valor do saque inválido.');
    }
    // Limitar casas decimais
    const amountFixed = parseFloat(amount.toFixed(2));
     if (amountFixed !== amount) {
         this.logger.warn(`requestWithdrawal: Valor do saque para usuário ${userId} ajustado de ${amount} para ${amountFixed} para corresponder a 2 casas decimais.`);
          amount = amountFixed; // Usar o valor ajustado
     }

    if (!pixKeyData || !pixKeyData.keyType || !pixKeyData.keyValue) {
        this.logger.error(`requestWithdrawal: Dados da chave Pix incompletos para usuário ${userId}: ${JSON.stringify(pixKeyData)}`);
        throw new BadRequestException('Dados da chave Pix incompletos.');
    }

    // INICIAR TRANSAÇÃO LOCAL para garantir débito e criação do registro
    const transaction = await this.sequelize.transaction();
    let withdrawalRecord: Withdrawal | null = null; // Declare outside try

    try {
        // 1. Validar e debitar o saldo do usuário
         // Use updateUserBalance transacional
        const user = await this.authService.updateUserBalance(userId, -amount, transaction);
        this.logger.log(`Saldo do usuário ${userId} debitado em R$ ${amount.toFixed(2)} para saque.`);


        // 2. Crie o registro de saque inicialmente como PROCESSING
        const efiIdEnvio = uuidv4().replace(/-/g, ''); // Gerar um ID único para este envio
        this.logger.debug(`Generated efiIdEnvio (without hyphens): ${efiIdEnvio}`);

        withdrawalRecord = await this.withdrawalModel.create({
            userId: userId,
            amount: amount,
            status: WithdrawalStatus.PROCESSING,
            targetPixKeyType: pixKeyData.keyType,
            targetPixKey: pixKeyData.keyValue,
            targetName: pixKeyData.name, // Incluir dados adicionais se fornecidos
            targetCpfCnpj: pixKeyData.cpfCnpj,
            efiIdEnvio: efiIdEnvio, // Armazenar o ID gerado para a Efí
        }, { transaction });
        this.logger.log(`Registro de saque ${withdrawalRecord.id} criado para o usuário ${userId}, valor R$ ${amount.toFixed(2)}. Status: PROCESSING. efiIdEnvio: ${efiIdEnvio}`);


        // 3. Chamar a API da Efí para requisitar o envio de Pix PUT /v3/gn/pix/:idEnvio
         const efiPixKeyPagador = this.configService.get<string>('EFI_PIX_KEY'); // Chave da sua conta Efí
         if (!efiPixKeyPagador) {
             const errorMessage = 'Chave Pix da conta pagadora (EFI_PIX_KEY) não configurada no .env. Não é possível solicitar saque.';
             this.logger.error(errorMessage);
             // A transação ainda está ativa, o catch abaixo fará o rollback.
            throw new InternalServerErrorException(errorMessage);
         }

         // Obter o token de acesso para a requisição makeEfiRequest
         const token = await this.getAccessToken();


         const withdrawalData = {
            valor: amount.toFixed(2), // Formato string com 2 casas decimais
             pagador: {
                 chave: efiPixKeyPagador, // Chave da sua conta Efí
                 infoPagador: `Saque Loto Jack (ID: ${withdrawalRecord.id}, User: ${userId})`, // Exemplo de info
             },
             favorecido: {
                 chave: pixKeyData.keyValue, // Chave do usuário que está sacando
             }
         };

        this.logger.debug(`Chamando EFI PUT /v3/gn/pix/${efiIdEnvio} com dados: ${JSON.stringify(withdrawalData)}`);
        // Use makeEfiRequest para chamar a API da Efí, passando o token no header
        const efiResponse = await this.makeEfiRequest('put', `/v3/gn/pix/${efiIdEnvio}`, withdrawalData, {
             headers: {
                 'Authorization': `Bearer ${token}`, // <-- ADICIONA O TOKEN AQUI MANUALMENTE
             }
        });

        this.logger.debug(`Resposta inicial da EFI para requisição de saque (${efiIdEnvio}): ${JSON.stringify(efiResponse)}`);

         // A resposta inicial pode incluir um 'e2eId' provisório ou outros detalhes.
         // Atualizar o registro de saque com quaisquer dados relevantes retornados.
         // Certifique-se que o campo efiRequestPayload exista no seu modelo Withdrawal (removido do update temporariamente)
         await withdrawalRecord.update({
              efiE2eId: efiResponse.e2eId, // Se vier na resposta inicial (pode ser nulo/undefined)
         }, { transaction });


        // 4. Commit da transação local
        await transaction.commit();

        this.logger.log(`Saque ${withdrawalRecord.id} (efiIdEnvio: ${efiIdEnvio}) para R$ ${amount.toFixed(2)} solicitado para chave ${pixKeyData.keyValue} (tipo ${pixKeyData.keyType}). Status: PROCESSING.`);

         // Recarregar para garantir que os dados estejam completos para retorno após o commit (opcional)
        await withdrawalRecord.reload();

        return withdrawalRecord;

    } catch (error) {
        // Rollback da transação local em caso de error
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

         // Tratar errors específicos do updateUserBalance (saldo insuficiente)
         if (error instanceof Error && ((error as any).isHandled)) { // Verifica a flag .isHandled adicionada pelo AuthService
              // Se o registro de saque foi criado antes de falhar no débito de saldo (o que não deve acontecer com a ordem na transação,
              // mas como fallback) ou na chamada da Efí, marcar como FAILED.
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
              // Se o error for o de saldo insuficiente do AuthService, lança BadRequest
             if (error.message.includes('Saldo insuficiente')) {
                throw new BadRequestException('Saldo insuficiente para concluir o saque.');
             }
             // Se for outro error .isHandled, pode ser um error interno do AuthService
              throw new InternalServerErrorException(`Error na operação de saldo durante o saque: ${error.message}`);
         }

         // Tratar errors da chamada makeEfiRequest (que já foram logados e mapeados no interceptor)
         if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
              // Se o registro de saque foi criado antes de falhar na chamada da Efí, marcar como FAILED.
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
             throw error; // Re-lança o error mapeado pelo interceptor
         }
         // Se o error for o InternalServerErrorException que lançamos por falta da chave:
         if (error instanceof InternalServerErrorException && error.message.includes('Chave Pix da conta pagadora')) {
             throw error; // Re-lança o error específico da configuração
         }
         // Se for um error de rede/TLS tratado pelo interceptor
        if ((error as any).isNetworkOrTlsError) {
            // O log e a mensagem já foram tratados no interceptor/getAccessToken/makeEfiRequest
            throw error; // Re-lança o error tratado
        }


         // Para quaisquer outros errors não mapeados
         this.logger.error(`Error inesperado ao solicitar saque para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
         // Tentar marcar o registro de saque como FAILED se ele existe e está como PROCESSING
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


  // --- Lógica de Webhook ---
  // Nota: A validação de segurança (HMAC, Certificado) deve ser feita no controlador ANTES de chamar este método,
  // ou este método deve receber o rawBody e o segredo para fazer a validação internamente.
  // Por simplicidade, a validação básica do segredo na URL é feita no controller.
  async handleWebhook(efiPayload: any): Promise<void> {
      // TODO: Implementar validação de segurança do webhook MAIS ROBUSTA (mTLS ou skip-mTLS com HMAC/IP)
      // A validação básica do segredo na URL já é feita no controller antes de chamar este método.
      // Se a validação mais robusta falhar AQUI dentro, logar o alerta de segurança e NÃO processar o payload.
       const webhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET'); // Exemplo de como obter o segredo, mas ele já veio validado no controller
       // const rawBody = ... // Precisa ser obtido do Request no Controller e passado para cá
       // const hmac = ... // Precisa ser obtido do Request no Controller e passado para cá

        // TODO: Implementar validação de HMAC usando o rawBody e EFI_WEBHOOK_SECRET
        // Consulte a documentação exata da Efí para a validação de HMAC do webhook.
        // if (!this.isValidHmac(rawBody, hmac, webhookSecret)) {
        //    this.logger.warn('Validação de HMAC do webhook falhou. Payload pode ser malicioso. Ignorando.');
        //    return; // Ignora o payload inválido
        // }
        // TODO: Opcional: Validar IP de origem (req.ip) com lista de IPs da Efí.

      this.logger.log(`Webhook da Efí recebido. Processando payload...`);


      // Assumindo, com base na doc "Recebendo Callbacks", que o payload é um ARRAY de eventos.
      if (!Array.isArray(efiPayload)) {
          this.logger.error('Payload do webhook da Efí não é um array inesperado.');
           return; // Retorne sem lançar error HTTP, pois a Efí espera 200 OK
      }

      for (const event of efiPayload) {
           // Lógica para processar PIX RECEBIDO (DEPÓSITO)
           // Um webhook de PIX recebido (confirmando um depósito) deve ter e2eId, valor e txid no campo 'pix'.
           const eventPixRecebido = (event as any).pix; // Acessa o campo 'pix' para webhooks de recebimento

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
                    // Tentar encontrar o depósito correspondente pelo Txid ou E2EId
                    depositRecord = await this.depositModel.findOne({
                        where: {
                            [Op.or]: [
                                { efiTxid: txid },
                                { efiE2eId: e2eId }, // Pode ser que o registro já tenha sido atualizado parcialmente
                            ],
                            // Opcional: verificar se o valor bate para segurança. Cuidado com floats!
                            // amount: amountReceived,
                            // status: DepositStatus.PENDING // Apenas depósitos PENDING devem ser confirmados via PIX recebido
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE, // Bloqueia a linha do depósito
                    });

                    if (!depositRecord) {
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito correspondente NÃO encontrado ou já processado. Pode ser notificação duplicada ou PIX não iniciado pela app.`);
                        await transaction.commit(); // Commit transação read-only
                        continue;
                    }

                    // Se o depósito já estiver como PAID, é uma notificação duplicada
                    if (depositRecord.status === DepositStatus.PAID) {
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito ${depositRecord.id} já está no status PAID.`);
                         await transaction.commit();
                         continue;
                    }

                     // Validar o valor recebido com o valor do depósito
                     if (depositRecord.amount.toFixed(2) !== amountReceived.toFixed(2)) {
                         this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Discrepância de valor. Depósito ${depositRecord.id} esperado ${depositRecord.amount.toFixed(2)}, recebido ${amountReceived.toFixed(2)}. NÃO CREDITADO AUTOMATICAMENTE.`);
                         // Marcar para revisão manual ou logar como falha. NÃO creditar saldo automaticamente.
                         // Opcional: Atualizar status para algo como 'REVIEW_NEEDED'
                         // await depositRecord.update({ status: 'REVIEW_NEEDED', efiE2eId: e2eId, efiWebhookPayload: event }, { transaction });
                          await transaction.commit(); // Commit da atualização de status (se implementada)
                         continue;
                     }


                    // Atualizar status para PAID e registrar E2EId final
                     // Certifique-se que o campo efiWebhookPayload exista no seu modelo Deposit (removido do update temporariamente)
                    await depositRecord.update({
                        status: DepositStatus.PAID,
                        efiE2eId: e2eId, // Garante que o E2EId final esteja registrado
                    }, { transaction });
                    this.logger.log(`Registro de depósito ${depositRecord.id} atualizado para PAID. E2EId: ${e2eId}.`);


                    // Creditar o saldo do usuário
                    await this.authService.updateUserBalance(depositRecord.userId, depositRecord.amount, transaction);
                    this.logger.log(`Saldo de R$ ${depositRecord.amount.toFixed(2)} creditado para o usuário ${depositRecord.userId} (Depósito ${depositRecord.id}).`);


                    // Commit da transação local
                    await transaction.commit();
                    this.logger.log(`Processamento do webhook para depósito ${depositRecord.id} (E2EId ${e2eId}) concluído com sucesso.`);

                } catch (error) {
                    // Rollback da transação local em caso de error no processamento deste evento
                     if (transaction && !(transaction as any).finished) {
                         await transaction.rollback();
                         this.logger.warn(`Rollback executado para processamento de webhook (Depósito, E2EId ${e2eId}) devido a error.`);
                     }

                    // Logar o error e CONTINUAR processando outros eventos (se houver)
                    this.logger.error(
                        `Error ao processar webhook para depósito (E2EId ${e2eId}, Txid ${txid}): ${(error as any).message}`,
                        (error as any).stack
                    );
                    // Não lançar exceção HTTP aqui, pois a Efí espera 200 OK.
                    // Um sistema mais avançado poderia ter um mecanismo de retentativa interna ou notificação de falha.
                } // Fim do catch do evento de depósito
           }
           // Lógica para processar ENVIO DE PIX (SAQUE) - Notificações de status do Pix Enviado
           // Assumindo que o payload para ENVIO (Saque) venha com um campo diferente, como 'gnPix' ou similar
           // E que contenha o idEnvio (nosso ID) e o status final.
            const eventGnPixEnvio = (event as any).gnPix; // Ex: campo para eventos de envio

            if (eventGnPixEnvio && eventGnPixEnvio.idEnvio && eventGnPixEnvio.status) {
                 const idEnvio = eventGnPixEnvio.idEnvio; // Nosso efiIdEnvio (UUID sem hifens)
                 const statusEfí = eventGnPixEnvio.status; // Ex: 'CONCLUIDA', 'EM_PROCESSAMENTO', 'NEGADA', 'ERRO'
                 const e2eId = eventGnPixEnvio.e2eId; // E2EId final, se concluído

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
                         this.logger.warn(`Rollback executado para processamento de webhook (Saque, idEnvio ${idEnvio}) devido a error.`);
                     }
                     this.logger.error(
                         `Error ao processar webhook para saque (idEnvio ${idEnvio}): ${(error as any).message}`,
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

  // --- Métodos de Consulta ---
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

    // --- MÉTODO PARA CONFIGURAR O WEBHOOK NA EFÍ ---
    // Endpoint de TESTE SEM SEGURANÇA!
    async configureEfiWebhook(): Promise<any> {
         this.logger.log('Solicitando configuração do webhook na API da Efí...');

         const pixKey = this.configService.get<string>('EFI_PIX_KEY');
         const webhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');
         const publicHost = 'https://jackbear-lotoapi.r954jc.easypanel.host'; // HARDCODED - **Perigoso! Mova para .env se persistir**

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

         // Obter o token de acesso ANTES de chamar makeEfiRequest
         const token = await this.getAccessToken();

         // Monta a URL completa do seu webhook que a Efí vai chamar
         const webhookUrlToEfí = `${publicHost}/pix/webhook/${webhookSecret}`;

         this.logger.debug(`Configurando webhook para a chave Pix: ${pixKey} com URL: ${webhookUrlToEfí}`);

         const requestBody = {
             webhookUrl: webhookUrlToEfí
         };

          // Configuração extra para a requisição, incluindo o header para pular mTLS
          // E O HEADER DE AUTORIZAÇÃO BEARER explicitamente
         const extraConfig: AxiosRequestConfig = {
              headers: {
                   'x-skip-mtls-checking': 'true', // Indica à Efí para não validar mTLS no seu servidor
                   'Authorization': `Bearer ${token}`, // <--- ADICIONA O TOKEN AQUI MANUALMENTE
                   // Headers Content-Type e Accept não estão mais na instância, então os definimos no makeEfiRequest
              },
               // Timeout para a requisição de configuração do webhook, se necessário
              // timeout: 5000, // 5 segundos
         };


         try {
              // Chamar a API da Efí (PUT /v2/webhook/:chave) usando o makeEfiRequest
             const efiResponse = await this.makeEfiRequest('put', `/v2/webhook/${pixKey}`, requestBody, extraConfig);

             this.logger.log(`Configuração do webhook na Efí solicitada com sucesso. Resposta: ${JSON.stringify(efiResponse)}`);
             return efiResponse; // Retorna a resposta da Efí

         } catch (error: any) {
              // O interceptor já logou o error detalhado e mapeou alguns errors para NestJS Exceptions.
              // Se o error tiver a flag 'isEfiError', é um error da Efí já tratado no interceptor.
             if ((error as any).isEfiError) {
                  // Relança a NestJS Exception criada no interceptor
                  throw error;
             }
             // Se for um error de rede/TLS tratado pelo interceptor
            if ((error as any).isNetworkOrTlsError) {
                // O log e a mensagem já foram tratados no interceptor/getAccessToken/makeEfiRequest
                throw error; // Re-lança o error tratado
            }
             // Se for outro error inesperado, loga e lança um InternalServerError genérico
             this.logger.error(`Error inesperado ao configurar webhook na Efí para a chave ${pixKey}: ${error.message}`, error.stack);
             throw new InternalServerErrorException(`Falha ao configurar webhook na Efí: ${error.message}`);
         }
    }
    // --- Fim NOVO MÉTODO ---

}