// src/payment/efi-pix.service.ts
import { Injectable, Logger, InternalServerErrorException, BadRequestException, NotFoundException, UnauthorizedException, ConflictException } from '@nestjs/common'; // Adicionado ConflictException
import { InjectModel } from '@nestjs/sequelize';
import { Deposit, DepositStatus } from '../models/payment/deposit.model';
import { Withdrawal, WithdrawalStatus } from '../models/payment/withdrawal.model';
import { AuthService } from '../Auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize-typescript'; // Para transações
import { Transaction, Op } from 'sequelize'; // Para tipagem de transação e Op
import { v4 as uuidv4 } from 'uuid';

// --- Adicionar imports para cliente HTTP ---
import axios, { AxiosInstance } from 'axios'; // Exemplo com axios
import * as fs from 'fs'; // Para ler o certificado
import * as path from 'path'; // Para resolver caminhos
import * as https from 'https'; // Para configurar o agente HTTPS
// --- Fim imports cliente HTTP ---

@Injectable()
export class EfiPixService {
  private readonly logger = new Logger(EfiPixService.name);
  private efipayApi!: AxiosInstance; // Cliente HTTP para a API da Efí
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    @InjectModel(Deposit) private depositModel: typeof Deposit,
    @InjectModel(Withdrawal) private withdrawalModel: typeof Withdrawal,
    private authService: AuthService,
    private configService: ConfigService,
    private sequelize: Sequelize, // Injetar Sequelize para transações
  ) {
    // Configurar o cliente HTTP Axiox na inicialização do serviço
    this.configureAxiosInstance();
  }

  private configureAxiosInstance() {
      const certPath = this.configService.get<string>('EFI_CERT_PATH');
      const certPassword = this.configService.get<string>('EFI_CERT_PASSWORD') || ''; // Senha pode ser vazia
      const efiBaseUrl = this.configService.get<string>('EFI_BASE_URL') || 'https://pix-h.api.efipay.com.br';

      if (!certPath) {
          this.logger.error('Caminho do certificado EFI não configurado no .env (EFI_CERT_PATH). A API da Efí não funcionará.');
           // Em produção, isso seria um erro grave. Considerar lançar um erro fatal na inicialização se EFI_CERT_PATH for obrigatório.
           // Por enquanto, apenas loga e configura Axios sem certificado (o que falhará nas requisições que exigem mTLS).
      }


      this.efipayApi = axios.create({
          baseURL: efiBaseUrl,
          headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              // Header Accept-Encoding conforme documentação (opcional)
              // 'Accept-Encoding': 'identity' // Ou 'gzip' dependendo da necessidade
          },
          httpsAgent: certPath ? new https.Agent({ // Configurar HTTPS com certificado SOMENTE se o caminho for fornecido
               pfx: fs.readFileSync(path.resolve(certPath)), // Carrega o certificado P12/PFX
               passphrase: certPassword, // Senha do certificado
              // Se estiver usando mTLS com o webhook, a Efí exige o certificado deles tbm.
              // Aqui na chamada da API deles, você só precisa do SEU certificado.
          }) : undefined, // Use undefined se não houver certPath
      });

      // Interceptor para logar requisições/respostas (útil para debug)
       this.efipayApi.interceptors.request.use(request => {
           // Remover dados sensíveis como Authorization header para o log
            const headers = { ...request.headers }; // Copiar headers para não modificar o original no log
            if (headers['Authorization']) {
                headers['Authorization'] = '[Redacted]';
            }
           this.logger.debug(`Fazendo requisição para EFI: ${request.method?.toUpperCase()} ${request.url}. Headers: ${JSON.stringify(headers)}`);
           // Opcional: logar corpo da requisição, com cuidado para dados sensíveis/grandes
           // this.logger.debug(`Corpo da requisição: ${JSON.stringify(request.data)}`);
           return request;
       }, error => {
            this.logger.error(`Erro na requisição (Interceptor): ${error.message}`);
           return Promise.reject(error); // Propaga o erro
       });

       this.efipayApi.interceptors.response.use(response => {
           this.logger.debug(`Resposta da EFI: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
            // Opcional: logar corpo da resposta, com cuidado para dados sensíveis/grandes
            // this.logger.debug(`Corpo da resposta: ${JSON.stringify(response.data)}`);
           return response;
       }, error => {
            // Logar erros de resposta da Efí
            if (error.response) {
                this.logger.error(`Erro da EFI (Resposta): ${error.response.status} ${error.response.config.method?.toUpperCase()} ${error.response.config.url} - ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                this.logger.error(`Erro da EFI (Requisição): Sem resposta recebida - ${error.message} - ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
            } else {
                this.logger.error(`Erro da EFI (Setup): Erro ao configurar requisição - ${error.message}`);
            }
            // Permite que o erro seja propagado para o código que chamou o service
           return Promise.reject(error);
       });
  }


  // --- Método para obter/gerenciar o token de acesso ---
  private async getAccessToken(): Promise<string> {
      // Verifica se o token existe e ainda é válido (com uma margem de segurança, ex: 5 minutos)
      // Adicionando '!' para afirmar ao compilador que accessToken não é null aqui
      if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 5 * 60 * 1000)) {
          this.logger.debug('Utilizando token da Efí em cache.');
          return this.accessToken!; // Afirma que é string aqui
      }

      // Token expirado ou inexistente, obter um novo
      this.logger.log('Obtendo novo token de acesso da Efí...');
      const clientId = this.configService.get<string>('EFI_CLIENT_ID');
      const clientSecret = this.configService.get<string>('EFI_CLIENT_SECRET');

      if (!clientId || !clientSecret) {
          // Não precisa lançar InternalServerErrorException se ConfigModule isGlobal=true e envFilePath está correto
          // O NestJS deve carregar isso na inicialização. Se não estiverem lá, o app deve falhar mais cedo ou os gets retornarão undefined.
          // No entanto, é bom ter uma verificação aqui para clareza.
          // Se o valor *for* undefined, lançar um erro claro.
          if (!clientId || !clientSecret) {
               const errorMessage = 'Credenciais da Efí (Client ID/Secret) não configuradas no .env.';
               this.logger.error(errorMessage);
               throw new InternalServerErrorException(errorMessage);
          }
      }


      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      try {
          const response = await this.efipayApi.post('/oauth/token', {
              grant_type: 'client_credentials',
          }, {
              headers: {
                  'Authorization': `Basic ${basicAuth}`,
              },
              // O certificado já está configurado na instância axios (via httpsAgent)
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
          return this.accessToken!; // Afirma que é string aqui após a atribuição
      } catch (error: any) {
           // O log detalhado já é feito pelo interceptor.
           // Lançar uma exceção genérica ou mapeada.
          if (error instanceof InternalServerErrorException || error instanceof UnauthorizedException) {
               throw error; // Relança erros já mapeados pelo interceptor (se makeEfiRequest usasse este método, o interceptor pegaria)
          }
          // Se for um erro direto aqui (ex: problema de rede antes do interceptor), logar e lançar
          this.logger.error(`Erro capturado em getAccessToken: ${error.message}`, error.stack);
          throw new InternalServerErrorException('Falha ao autenticar com a API da Efí.');
      }
  }

    // --- Método auxiliar para fazer requisições autenticadas ---
    private async makeEfiRequest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, data?: any): Promise<any> {
        const token = await this.getAccessToken(); // Awaiting a Promise<string> results in 'string'. This is fine.
        // O token agora é garantidamente string aqui, ou uma exceção foi lançada.
        try {
            const response = await this.efipayApi({
                method,
                url,
                data,
                headers: {
                    'Authorization': `Bearer ${token}`, // 'token' é string aqui. Não precisa de '!'.
                     // 'Accept-Encoding' pode ser adicionado aqui por requisição específica se necessário
                },
                 // O certificado já está configurado na instância axios
            });
            return response.data;
        } catch (error: any) {
             // O log já é feito pelo interceptor global.
             // O interceptor também já mapeia alguns erros comuns da Efí para exceções NestJS.
             // Se o erro propagou até aqui, é porque foi uma dessas exceções mapeadas
             // ou um erro de rede não tratado pelo interceptor de response (menos comum).
             // Apenas re-lançar a exceção.
             throw error;
        }
    }


  // --- Lógica de Depósito ---
  async createDepositCharge(userId: number, amount: number): Promise<Deposit> {
    // Validar formato do valor
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        this.logger.error(`createDepositCharge: Valor do depósito inválido recebido para usuário ${userId}: ${amount}`);
        throw new BadRequestException('Valor do depósito inválido.');
    }
     // Limitar casas decimais para evitar problemas com o DECIMAL do banco e a API da Efí
     const amountFixed = parseFloat(amount.toFixed(2));
     if (amountFixed !== amount) {
          // Opcional: avisar ou corrigir silenciosamente. Corrigir silenciosamente parece mais amigável.
         this.logger.warn(`createDepositCharge: Valor do depósito para usuário ${userId} ajustado de ${amount} para ${amountFixed} para corresponder a 2 casas decimais.`);
          amount = amountFixed; // Usar o valor ajustado
     }


    // Iniciar uma transação para garantir que o registro local seja criado
     // ANTES de chamar a API da Efí. Se a chamada falhar, podemos marcar o registro como falho.
    const transaction = await this.sequelize.transaction();
    let depositRecord: Deposit | null = null; // Declare outside try

    try {
         // Crie o registro de depósito inicialmente como PENDING
        depositRecord = await this.depositModel.create({
            userId: userId,
            amount: amount,
            status: DepositStatus.PENDING,
            // Outros campos serão preenchidos após a resposta da Efí
             // Opcional: armazenar o valor original antes de fixar casas decimais, se relevante para auditoria.
             // originalAmount: amount,
        }, { transaction });
        this.logger.log(`Registro de depósito ${depositRecord.id} criado para o usuário ${userId}, valor R$ ${amount.toFixed(2)}. Status: PENDING.`);


         // --- NOVO: Obter a chave Pix de recebimento da Efí ---
         const efiPixKey = this.configService.get<string>('EFI_PIX_KEY');
         if (!efiPixKey) {
             // Se a chave não estiver configurada, não podemos criar a cobrança.
             // Lançar erro e garantir rollback da transação local.
              const errorMessage = 'Chave Pix de recebimento (EFI_PIX_KEY) não configurada no .env. Não é possível criar cobrança.';
              this.logger.error(errorMessage);
              // A transação ainda está ativa, o catch abaixo fará o rollback.
             throw new InternalServerErrorException(errorMessage);
         }
         this.logger.debug(`Usando chave Pix EFI: ${efiPixKey}`);
         // --- Fim NOVO ---


        // Dados da cobrança para a API da Efí
        const chargeData = {
            calendario: {
                expiracao: 3600 // 1 hora de validade para o PIX (em segundos)
            },
            valor: {
                original: amount.toFixed(2) // Formato string com 2 casas decimais
            },
             // --- NOVO: Incluir a chave Pix de recebimento da Efí ---
             chave: efiPixKey, // <-- AGORA INCLUÍDO E USANDO A VAR ENV
             // --- Fim NOVO ---

            solicitacaoPagador: `Depósito para usuário ${userId} na Loto Jack (ID Transacao: ${depositRecord.id})`, // Mensagem opcional
             // Opcional: Incluir dados do devedor (usuário) se quiser e a API user.model tiver esses dados
             // Isso pode ser útil para a Efí identificar o pagador. Exemplo:
             // devedor: {
             //     cpf: user.cpf.replace(/\D/g, ''), // Formato apenas números
             //     nome: user.name,
             // },
             // Para isso, você precisaria carregar o usuário completo antes de criar o chargeData:
             // const user = await this.authService.findCurrentUser(userId); // OU findUserById? Melhor buscar na transação
             // const user = await this.userModel.findByPk(userId, { transaction }); // Se userModel for injetado aqui
        };

        // Chamar a API da Efí para criar a cobrança POST /v2/cob
        this.logger.debug(`Chamando EFI POST /v2/cob com dados: ${JSON.stringify(chargeData)}`);
        const efiResponse = await this.makeEfiRequest('post', '/v2/cob', chargeData);

         this.logger.debug(`Resposta da EFI para criação de cobrança: ${JSON.stringify(efiResponse)}`);

        // Validar a resposta mínima da Efí
        if (!efiResponse || !efiResponse.txid || !efiResponse.pixCopiaECola || !efiResponse.loc?.location) {
            const errorMessage = 'Resposta inesperada da Efí ao criar cobrança: dados de retorno incompletos (txid, pixCopiaECola, location).';
             this.logger.error(`${errorMessage} Resposta completa: ${JSON.stringify(efiResponse)}`);
             // A transação ainda está ativa, o catch abaixo fará o rollback.
            throw new InternalServerErrorException(errorMessage);
        }

        // Atualizar o registro de depósito com os dados da resposta da Efí
         // Certifique-se que o campo efiCreateChargePayload existe no seu modelo Deposit
        await depositRecord.update({
            efiTxid: efiResponse.txid,
            qrCodeImage: efiResponse.loc.location, // location é a URL do QR Code dinâmico na Efí
            pixCopiaECola: efiResponse.pixCopiaECola,
            efiCreateChargePayload: efiResponse, // Armazenar a resposta completa para auditoria/debug
            status: DepositStatus.PENDING, // O status ATIVA da Efí mapeia para PENDING na nossa app até o PIX ser pago.
        }, { transaction });
        this.logger.log(`Registro de depósito ${depositRecord.id} atualizado com dados da Efí (txid ${depositRecord.efiTxid}, QR Code URL, Pix Copia e Cola). Status: PENDING.`);


        // Commit da transação local
        await transaction.commit();

        this.logger.log(`Cobrança de depósito ${depositRecord.id} criada com sucesso na Efí e registro local finalizado.`);

         // Recarregar o registro após o commit para garantir que a instância retornada esteja "limpa" e completa
         // (especialmente se você usou `raw: true` em alguma busca ou o update não populou tudo).
         // Para este caso simples, reload pode não ser estritamente necessário se o update for suficiente,
         // mas é uma prática segura para garantir o estado.
        await depositRecord.reload(); // Recarrega a instância do DB

        return depositRecord;

    } catch (error) {
        // Rollback da transação local em caso de erro
         // Check if transaction exists AND is not completed ('commit' or 'rollback')
         if (transaction && !(transaction as any).finished) {
             try {
                 await transaction.rollback();
                 this.logger.warn(`Rollback executado para criação de depósito do usuário ${userId} devido a erro capturado.`);
             } catch (rollbackError: any) {
                  if (!rollbackError.message?.includes('already')) { // Ignorar erros comuns de rollback duplicado
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para criação de depósito do usuário ${userId}: ${rollbackError}`);
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

        // Propagar o erro original. O interceptor já logou erros da Efí.
        // Mapear erros comuns da Efí para exceções NestJS claras para o controller.
        // Se o erro veio do makeEfiRequest e é uma exceção NestJS mapeada (pelo interceptor):
        if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
            throw error; // Relançar exceções NestJS mapeadas
        }
         // Se for o InternalServerErrorException que lançamos por falta da chave:
        if (error instanceof InternalServerErrorException && error.message.includes('EFI_PIX_KEY')) {
            throw error; // Relançar o erro específico da configuração
        }


        // Para quaisquer outros erros não mapeados (ex: erro na criação do registro no DB antes do commit, erro de rede não tratado pelo interceptor, etc.)
        this.logger.error(`Erro inesperado ao criar cobrança de depósito para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
        throw new InternalServerErrorException('Erro interno ao solicitar depósito.');
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
        const user = await this.authService.updateUserBalance(userId, -amount, transaction);
        this.logger.log(`Saldo do usuário ${userId} debitado em R$ ${amount.toFixed(2)} para saque.`);


        // 2. Crie o registro de saque inicialmente como PROCESSING
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


        // 3. Chamar a API da Efí para requisitar o envio de Pix PUT /v3/gn/pix/:idEnvio
        // Ajustar o corpo da requisição para o formato esperado: { valor, pagador: { chave, infoPagador? }, favorecido: { chave } }
         const withdrawalData = {
            valor: amount.toFixed(2), // Formato string com 2 casas decimais
             pagador: {
                 // Aqui vai a chave Pix DA SUA CONTA EFI que está enviando o dinheiro.
                 // É a mesma chave que você usa para receber depósitos (EFI_PIX_KEY).
                 chave: this.configService.get<string>('EFI_PIX_KEY'),
                 // infoPagador: Opcional, talvez um identificador do saque? "Saque Usuario ID: userId"
                 infoPagador: `Saque Loto Jack (ID: ${withdrawalRecord.id}, User: ${userId})`, // Exemplo de info
             },
             favorecido: {
                 // Aqui vai a chave Pix DO USUÁRIO que está recebendo o dinheiro.
                 chave: pixKeyData.keyValue, // A chave que veio no payload da requisição do frontend
             }
             // Pelo exemplo, apenas a chave do favorecido é necessária no objeto favorecido.
             // Dados adicionais como nome, cpf/cnpj do favorecido NÃO parecem ser permitidos diretamente no payload.
             // A Efí provavelmente verifica esses dados usando a chave Pix fornecida.
         };
        // --- Fim Ajuste do Corpo da Requisição ---


        // Use PUT com nosso idEnvio na URL
        this.logger.debug(`Chamando EFI PUT /v3/gn/pix/${efiIdEnvio} com dados: ${JSON.stringify(withdrawalData)}`);
        const efiResponse = await this.makeEfiRequest('put', `/v3/gn/pix/${efiIdEnvio}`, withdrawalData);

        this.logger.debug(`Resposta inicial da EFI para requisição de saque (${efiIdEnvio}): ${JSON.stringify(efiResponse)}`);

         // A resposta inicial pode incluir um 'e2eId' provisório ou outros detalhes.
         // Atualizar o registro de saque com quaisquer dados relevantes retornados.
         await withdrawalRecord.update({
              efiE2eId: efiResponse.e2eId, // Se vier na resposta inicial
              // Opcional: Armazenar a resposta completa da Efí para auditoria/debug
              // efiRequestPayload: efiResponse, // Se este campo existir no modelo Withdrawal
         }, { transaction });


        // 4. Commit da transação local
        await transaction.commit();

        this.logger.log(`Saque ${withdrawalRecord.id} (efiIdEnvio: ${efiIdEnvio}) para R$ ${amount.toFixed(2)} solicitado para chave ${pixKeyData.keyValue} (tipo ${pixKeyData.keyType}). Status: PROCESSING.`);

         // Recarregar para garantir que os dados estejam completos para retorno após o commit (opcional)
        await withdrawalRecord.reload();

        return withdrawalRecord;

    } catch (error) {
        // Rollback da transação local em caso de erro
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

         // Handle specific errors from updateUserBalance (saldo insuficiente)
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

         // Handle errors from makeEfiRequest
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
  // Nota: A validação de segurança (HMAC, Certificado) deve ser feita no controlador ANTES de chamar este método,
  // ou este método deve receber o rawBody e o segredo para fazer a validação internamente.
  // Por simplicidade, a validação é comentada aqui, mas é CRUCIAL IMPLEMENTÁ-LA.
  async handleWebhook(efiPayload: any): Promise<void> {
      // TODO: Implementar validação de segurança do webhook (mTLS ou skip-mTLS com HMAC/IP)
      // Se a validação falhar, NÃO processe o payload e retorne 200 OK, MAS logue o alerta de segurança.
       const webhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');
       // const rawBody = ... // Precisa ser obtido do Request no Controller

       // Exemplo básico de validação de segredo na URL (menos seguro que HMAC)
       // if (urlSecret !== webhookSecret) {
       //      this.logger.warn(`Tentativa de acesso não autorizado ao webhook com segredo inválido: ${urlSecret}`);
       //      return; // Retorna sem processar, mas o controller ainda retorna 200 OK para a Efí
       // }

        // TODO: Implementar validação de HMAC usando o rawBody e EFI_WEBHOOK_SECRET
        // Consulte a documentação exata da Efí para a validação de HMAC do webhook.

      this.logger.log(`Webhook da Efí recebido. Payload: ${JSON.stringify(efiPayload)}`);


      // Assumindo, com base na doc "Recebendo Callbacks", que o payload é um ARRAY de eventos.
      // E que cada evento tem um campo 'pix' com detalhes (e2eId, valor, txid, etc).
      if (!Array.isArray(efiPayload)) {
          this.logger.error('Payload do webhook da Efí não é um array inesperado.');
           return; // Retorne sem lançar erro HTTP, pois a Efí espera 200 OK
      }

      for (const event of efiPayload) {
           // Assumindo que event.pix contém os detalhes da transação Pix.
           const eventPix = event.pix; // Pode ser undefined se o formato for diferente

           // Lógica para processar PIX RECEBIDO (DEPÓSITO)
           // Um webhook de PIX recebido (confirmando um depósito) deve ter e2eId, valor e txid.
           if (eventPix && eventPix.e2eId && eventPix.valor !== undefined && eventPix.txid) {
                const e2eId = eventPix.e2eId; // EndToEnd ID do Pix
                const amountReceived = parseFloat(eventPix.valor);
                const txid = eventPix.txid; // Txid associado à cobrança

                if (isNaN(amountReceived)) {
                    this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}): Valor (${eventPix.valor}) inválido.`);
                    continue; // Pular para o próximo evento
                }

                this.logger.log(`Webhook PIX recebido: E2EId ${e2eId}, Txid ${txid}, Valor R$ ${amountReceived.toFixed(2)}.`);

                // Iniciar transação para garantir atomicidade do crédito de saldo e atualização do registro
                const transaction = await this.sequelize.transaction();
                let depositRecord: Deposit | null = null; // Declare inside try

                try {
                    // Tentar encontrar o depósito correspondente pelo Txid ou E2EId
                    depositRecord = await this.depositModel.findOne({
                        where: {
                            [Op.or]: [
                                { efiTxid: txid },
                                { efiE2eId: e2eId }, // Pode ser que o registro já tenha sido atualizado parcialmente
                            ],
                            // Opcional: verificar se o valor bate para segurança
                            // amount: amountReceived, // Cuidado com comparações float, usar toFixed(2) ou BigInt se DB suportar
                            // status: DepositStatus.PENDING // Apenas depósitos PENDING devem ser confirmados via PIX recebido
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE, // Bloqueia a linha do depósito
                    });

                    if (!depositRecord) {
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito correspondente NÃO encontrado ou já processado.`);
                        // Pode ser uma notificação duplicada, um PIX pago sem cobrança prévia na nossa app, etc.
                        // Logar o evento inesperado.
                        await transaction.commit(); // Commit transação read-only
                        continue; // Pular para o próximo evento no array
                    }

                    // Se o depósito já estiver como PAID, é uma notificação duplicada
                    if (depositRecord.status === DepositStatus.PAID) {
                        this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito ${depositRecord.id} já está no status PAID.`);
                         await transaction.commit();
                         continue; // Pular para o próximo evento
                    }

                     // Validar o valor recebido com o valor do depósito
                     if (depositRecord.amount.toFixed(2) !== amountReceived.toFixed(2)) {
                         this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Discrepância de valor. Depósito ${depositRecord.id} esperado ${depositRecord.amount.toFixed(2)}, recebido ${amountReceived.toFixed(2)}. NÃO CREDITADO AUTOMATICAMENTE.`);
                         // Marcar para revisão manual ou logar como falha. NÃO creditar saldo automaticamente.
                         // Opcional: Atualizar status para algo como 'REVIEW_NEEDED'
                         // await depositRecord.update({ status: 'REVIEW_NEEDED', efiE2eId: e2eId, efiWebhookPayload: event }, { transaction });
                          await transaction.commit(); // Commit da atualização de status (se implementada)
                         continue; // Pular para o próximo evento
                     }


                    // Atualizar status para PAID e registrar E2EId final
                    await depositRecord.update({
                        status: DepositStatus.PAID,
                        efiE2eId: e2eId, // Garante que o E2EId final esteja registrado
                         // Opcional: Armazenar o payload completo do evento do webhook para este depósito
                         efiWebhookPayload: event,
                    }, { transaction });
                    this.logger.log(`Registro de depósito ${depositRecord.id} atualizado para PAID. E2EId: ${e2eId}.`);


                    // Creditar o saldo do usuário
                    await this.authService.updateUserBalance(depositRecord.userId, depositRecord.amount, transaction);
                    this.logger.log(`Saldo de R$ ${depositRecord.amount.toFixed(2)} creditado para o usuário ${depositRecord.userId} (Depósito ${depositRecord.id}).`);


                    // Commit da transação local
                    await transaction.commit();
                    this.logger.log(`Processamento do webhook para depósito ${depositRecord.id} (E2EId ${e2eId}) concluído com sucesso.`);

                } catch (error) {
                    // Rollback da transação local em caso de erro no processamento deste evento
                     if (transaction && !(transaction as any).finished) {
                         await transaction.rollback();
                         this.logger.warn(`Rollback executado para processamento de webhook (Depósito, E2EId ${e2eId}) devido a erro.`);
                     }

                    // Logar o erro e CONTINUAR processando outros eventos (se houver)
                    this.logger.error(
                        `Erro ao processar webhook para depósito (E2EId ${e2eId}, Txid ${txid}): ${(error as any).message}`,
                        (error as any).stack
                    );
                    // Não lançar exceção HTTP aqui, pois a Efí espera 200 OK.
                    // Um sistema mais avançado poderia ter um mecanismo de retentativa interna ou notificação de falha.
                } // Fim do catch do evento de depósito
           }
           // --- Lógica para processar ENVIO DE PIX (SAQUE) ---
           // O webhook de SAQUE (confirmação de um envio de Pix) provavelmente
           // terá um formato diferente no payload e/ou será enviado para outro endpoint.
           // A doc "Envio e Pagamento Pix" menciona que o status final virá VIA WEBHOOK.
           // A doc "Gestão de Pix" menciona "Consultar Pix enviado" e "Consultar lista de Pix enviados",
           // mas não mostra explicitamente o formato do webhook de ENVIO.
           // Se webhooks de saque vêm para este mesmo endpoint (/pix), eles terão um formato de payload diferente.
           // Precisamos identificar no payload se é um webhook de Pix Recebido (Depósito) ou Pix Enviado (Saque).

           // Exemplo ESPECULATIVO de como pode vir um webhook de saque:
           // if (event && event.type === 'envio_pix_status' && event.data?.idEnvio && event.data?.status) {
           //      const idEnvio = event.data.idEnvio; // Nosso efiIdEnvio
           //      const statusEfí = event.data.status; // Ex: 'CONCLUIDA', 'FALHA'
           //      const e2eId = event.data.e2eId; // E2EId final, se concluído

           //      this.logger.log(`Webhook ENVIO PIX: idEnvio ${idEnvio}, Status EFI: ${statusEfí}`);

           //      const transaction = await this.sequelize.transaction();
           //      let withdrawalRecord: Withdrawal | null = null;
           //      try {
           //          withdrawalRecord = await this.withdrawalModel.findOne({
           //              where: { efiIdEnvio: idEnvio, status: WithdrawalStatus.PROCESSING },
           //              transaction,
           //              lock: transaction.LOCK.UPDATE,
           //          });

           //          if (!withdrawalRecord) {
           //              this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Saque PROCESSING NÃO encontrado ou já finalizado.`);
           //              await transaction.commit();
           //              continue;
           //          }

           //          if (statusEfí === 'CONCLUIDA') {
           //              await withdrawalRecord.update({ status: WithdrawalStatus.COMPLETED, efiE2eId: e2eId, efiWebhookPayload: event }, { transaction });
           //              this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para COMPLETED. E2EId: ${e2eId}.`);
           //              // Saldo já foi debitado ao solicitar, nada mais a fazer com o saldo.
           //          } else if (statusEfí === 'FALHA') { // Verificar status exato de falha na doc Efí
           //              await withdrawalRecord.update({ status: WithdrawalStatus.FAILED, efiE2eId: e2eId, efiWebhookPayload: event }, { transaction });
           //              this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para FAILED.`);

           //              // ESTORNAR SALDO! Creditar o valor de volta para o usuário.
           //              await this.authService.updateUserBalance(withdrawalRecord.userId, withdrawalRecord.amount, transaction);
           //              this.logger.log(`Saldo de R$ ${withdrawalRecord.amount.toFixed(2)} estornado para o usuário ${withdrawalRecord.userId} (Saque ${withdrawalRecord.id}).`);

           //          } else {
           //               this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Status EFI desconhecido "${statusEfí}". Ignorando evento.`);
           //               // Manter como PROCESSING e aguardar outro webhook ou sync manual.
           //          }

           //          await transaction.commit();
           //          this.logger.log(`Processamento do webhook para saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) concluído com sucesso.`);

           //      } catch (error) {
           //          if (transaction && !(transaction as any).finished) {
           //              await transaction.rollback();
           //              this.logger.warn(`Rollback executado para processamento de webhook (Saque, idEnvio ${idEnvio}) devido a erro.`);
           //          }
           //          this.logger.error(
           //              `Erro ao processar webhook para saque (idEnvio ${idEnvio}): ${(error as any).message}`,
           //              (error as any).stack
           //          );
           //      } // Fim do catch do evento de saque
           // } else {
               // Se não é um Pix Recebido nem um Pix Enviado (no formato esperado), logar o payload completo
               // this.logger.warn(`Webhook com formato inesperado. Evento: ${JSON.stringify(event)}`);
           // }
      } // Fim do loop pelos eventos do payload


       this.logger.log('Processamento de webhook(s) da Efí finalizado.');
       // O controlador que chamar este método DEVE retornar 200 OK para a Efí.
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
    // Opcional: Método para sincronizar status de saque/depósito consultando a Efí
    // async syncWithdrawalStatus(withdrawalId: number): Promise<Withdrawal> { ... }

}