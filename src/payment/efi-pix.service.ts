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

// --- IMPORTAR child_process para executar script Python ---
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { AxiosRequestConfig } from 'axios';

const execPromise = promisify(exec);
// --- Fim import child_process ---

// --- Remover imports do Axios, http, https, fs, path (exceto path/fs se usados para verificar certificado) ---
// import axios, { AxiosInstance, AxiosRequestConfig, RawAxiosRequestHeaders } from 'axios';
// import * as fs from 'fs'; // Já importado acima
// import * as path from 'path'; // Já importado acima
// import * as https from 'https'; // Não necessário para Node.js chamar Python
// --- Fim da remoção ---


@Injectable()
export class EfiPixService {
  private readonly logger = new Logger(EfiPixService.name);
  // private efipayApi!: AxiosInstance; // Remover instância Axios
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
    // this.configureAxiosInstance(); // Remover configuração Axios
    const webhookIps = this.configService.get<string>('EFI_WEBHOOK_ALLOWED_IPS');
    this.allowedWebhookIps = webhookIps ? webhookIps.split(',').map(ip => ip.trim()) : [];
    if (this.allowedWebhookIps.length === 0) {
        this.logger.warn('Nenhum IP permitido configurado para webhook da Efí (EFI_WEBHOOK_ALLOWED_IPS no .env). A validação por IP será desativada. Isso reduz a segurança em Produção.');
    } else {
        this.logger.log(`IPs permitidos para webhook da Efí: ${this.allowedWebhookIps.join(', ')}`);
    }

    // NOTE: A configuração do HTTPS Agent e certificado agora é responsabilidade do script Python.
    // No entanto, a lógica de verificação do certificado ao iniciar o service pode ser mantida para logs.
    const certPath = this.configService.get<string>('EFI_CERT_PATH');
    const resolvedCertPath = path.resolve(certPath || '');
    if (certPath && !fs.existsSync(resolvedCertPath)) {
        this.logger.error(`Certificado EFI NÃO ENCONTRADO no caminho configurado: ${resolvedCertPath}. O script Python FALHARÁ ao tentar usá-lo.`);
    } else if (certPath) {
         this.logger.log(`Certificado EFI encontrado em: ${resolvedCertPath}.`);
    } else {
        this.logger.warn('Caminho do certificado EFI não configurado. O script Python FALHARÁ se a API exigir certificado.');
    }

  }

  // private configureAxiosInstance() { /* Removido */ }


    // --- Método para obter/gerenciar o token de acesso (AGORA VIA SCRIPT PYTHON) ---
    private async getAccessToken(): Promise<string> {
        // Se o token está em cache e válido, retorna o cache
        if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date(Date.now() + 5 * 60 * 1000)) {
            this.logger.debug('Utilizando token da Efí em cache.');
            return this.accessToken!;
        }

        this.logger.log('Obtendo novo token de acesso da Efí via script Python...');

        // --- CONFIGURAÇÃO PARA PASSAR PARA O SCRIPT PYTHON VIA STDIN ---
        const efiBaseUrl = this.configService.get<string>('EFI_BASE_URL') || 'https://pix.api.efipay.com.br';
        const clientId = this.configService.get<string>('EFI_CLIENT_ID');
        const clientSecret = this.configService.get<string>('EFI_CLIENT_SECRET');

        // Calcula o Basic Auth para o script Python usar
        if (!clientId || !clientSecret) {
             const errorMessage = 'Credenciais da Efí (Client ID/Secret) não configuradas no .env.';
             this.logger.error(errorMessage);
             throw new InternalServerErrorException(errorMessage);
        }
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');


        const requestConfig = {
            method: 'POST',
            url_path: '/oauth/token', // Endpoint para obter token
            base_url: efiBaseUrl,
            data: { "grant_type": "client_credentials" },
            headers: {
                'Authorization': `Basic ${basicAuth}`, // Passa o Basic Auth aqui
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
             // Não passa token Bearer aqui, pois esta é a requisição para obtê-lo
        };
        // --- Fim Configuração para passar ---


        // --- OBTENDO CAMINHOS E EXECUTÁVEL ---
        const pythonScriptPath = this.configService.get<string>('EFI_PYTHON_SCRIPT_PATH') || './efi_api_request.py';
        const pythonExecutable = this.configService.get<string>('PYTHON_PATH') || 'python';

         // Verifica se o caminho do script parece absoluto ou relativo
        const isAbsolutePath = path.isAbsolute(pythonScriptPath);

        // Resolve o caminho absoluto se for relativo, ou mantém o absoluto.
        // Esta resolução é feita no lado Node.js ANTES de passar para o child_process.
        // Em Windows, path.resolve() lida com barras \ e /.
        const finalScriptPath = isAbsolutePath ? path.resolve(pythonScriptPath) : path.resolve(process.cwd(), pythonScriptPath);

        // --- CONSTRUÇÃO CORRETA DO COMANDO PARA WINDOWS/CHILD_PROCESS ---
        // Envolve o caminho FINAL do script em aspas duplas para lidar com espaços
        // Garante que o executável Python seja o primeiro elemento do comando
        const command = `${pythonExecutable} "${finalScriptPath}"`;


        this.logger.debug(`Executing python command: ${command}`);


        try {
             // Executa o script Python, passando configs e dados via STDIN
             // As variáveis de ambiente para o certificado são passadas para o PROCESSO Python.
             const envVarsForPython = {
                  ...process.env, // Mantém variáveis de ambiente existentes
                 EFI_CERT_PATH: this.configService.get<string>('EFI_CERT_PATH'), // Passa caminho do certificado como ENV VAR
                 EFI_CERT_PASSWORD: this.configService.get<string>('EFI_CERT_PASSWORD') || '', // Passa senha como ENV VAR
                 // Incluir outras ENV VARs relevantes para o script Python se necessário
             };

            // Cria o child process e escreve a config JSON no STDIN
            const child = execPromise(command, {
                env: envVarsForPython, // Passa as variáveis de ambiente
                timeout: 30000, // Timeout para a execução do script (30 segundos)
                // shell: true, // Opcional: Usar shell (cmd.exe no Windows) pode ajudar a resolver caminhos, mas pode ser menos seguro
            });


            this.logger.debug(`Passing request config to python via STDIN: ${JSON.stringify(requestConfig)}`);
            child.child.stdin?.write(JSON.stringify(requestConfig) + '\n');
            child.child.stdin?.end(); // Fecha o STDIN

            const { stdout, stderr } = await child;

            // O script Python imprime logs de debug para STDERR e o resultado/erro final para STDOUT
            if (stderr) {
                // Este log já vem do stderr do Python, então não precisa adicionar file=sys.stderr
                this.logger.error(`Erro no script Python (STDERR): ${stderr}`);
            }

             // O script Python DEVE imprimir um JSON para STDOUT com {"success": Bool, "data": ...} ou {"success": Bool, "error": {...}}
            try {
                const pythonResponse = JSON.parse(stdout);
                this.logger.debug(`Python script STDOUT: ${stdout}`);

                if (pythonResponse.success) {
                    const tokenData = pythonResponse.data;
                    const access_token = tokenData?.access_token;
                    const expires_in = tokenData?.expires_in;

                    if (!access_token || expires_in === undefined) {
                         const errorMessage = `Resposta inesperada do script Python ao obter token: ${JSON.stringify(tokenData)}`;
                         this.logger.error(errorMessage);
                         throw new InternalServerErrorException(errorMessage);
                    }

                    this.accessToken = access_token;
                    this.tokenExpiry = new Date(Date.now() + expires_in * 1000); // expires_in é em segundos

                    this.logger.log('Novo token da Efí obtido com sucesso via script Python.');
                    return this.accessToken!;

                } else {
                    // Script Python retornou um erro formatado
                    const error = pythonResponse.error;
                    this.logger.error(`Script Python reportou erro ao obter token: ${JSON.stringify(error)}`);
                     // Tenta mapear o erro do script Python para uma NestJS Exception
                     if (error?.status === 401) throw new UnauthorizedException(error.data || error.message);
                     if (error?.status === 400) throw new BadRequestException(error.data || error.message);
                     if (error?.status === 404) throw new NotFoundException(error.data || error.message);
                     if (error?.status === 409) throw new ConflictException(error.data || error.message);
                     // Lançar InternalServerError para outros erros ou erros sem status
                     throw new InternalServerErrorException(`Script Python falhou ao chamar API Efí (/oauth/token): ${error?.message || 'Erro desconhecido'}`);
                }

            } catch (parseError: any) { // Explicitamente any para simplificar o tratamento de parseError
                this.logger.error(`Error ao parsear saída JSON do script Python: ${stdout}`, parseError);
                 // Se a saída não for um JSON válido, é um error na execução do script ou na saída dele
                 throw new InternalServerErrorException(`Error ao processar resposta do script Python. Saída: "${stdout.substring(0, 200)}..."`);
            }


        } catch (execError: any) { // Explicitamente any para simplificar o tratamento de execError
             // Erros de execução do comando (Python não encontrado, timeout, etc.)
             this.logger.error(`Falha na execução do script Python para API Efí: ${execError.message}`, execError.stack);
             // Adicione uma flag ou informação para saber que foi um erro de execução/rede, não da API Efí
             const internalError = new InternalServerErrorException(`Falha na execução do script Python para API Efí: ${execError.message}`);
             // (internalError as any).isNetworkOrTlsError = true; // Opcional: adicionar flag customizada se necessário no catch superior
             throw internalError;
        }
    }

    // --- Método auxiliar para fazer requisições autenticadas (AGORA VIA SCRIPT PYTHON) ---
    // Não usa mais Axios diretamente para a chamada API.
    private async makeEfiRequest(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url_path: string, data?: any, extraConfig?: any): Promise<any> { // extraConfig pode ser qualquer coisa que o script Python entenda
         this.logger.debug(`Preparing to call EFI API via Python: ${method} ${url_path}`);

         // Obter o token de acesso para passar para o script Python
         // A requisição para obter o token (url_path '/oauth/token') não precisa de token Bearer
         const token = url_path === '/oauth/token' ? undefined : await this.getAccessToken();


         // --- CONFIGURAÇÃO PARA PASSAR PARA O SCRIPT PYTHON VIA STDIN ---
         const efiBaseUrl = this.configService.get<string>('EFI_BASE_URL') || 'https://pix.api.efipay.com.br';
         const certPath = this.configService.get<string>('EFI_CERT_PATH');
         const certPassword = this.configService.get<string>('EFI_CERT_PASSWORD') || '';

         const requestConfig = {
             method: method.toUpperCase(),
             url_path: url_path,
             base_url: efiBaseUrl,
             data: data, // Passa o corpo da requisição
             // Passa o token Bearer apenas se ele foi obtido (i.e., não é a requisição /oauth/token)
             token: token,
             headers: {
                  // Adiciona cabeçalho Authorization Bearer SE o token foi obtido
                  ...(token ? {'Authorization': `Bearer ${token}`} : {}),
                  // Adiciona quaisquer headers passados no extraConfig (ex: x-skip-mtls-checking)
                  ...(extraConfig?.headers || {}),
             },
         };
         this.logger.debug(`Request config being sent to python: ${JSON.stringify(requestConfig)}`); // Log config sent


         // --- OBTENDO CAMINHOS E EXECUTÁVEL ---
         const pythonScriptPath = this.configService.get<string>('EFI_PYTHON_SCRIPT_PATH') || './efi_api_request.py';
         const pythonExecutable = this.configService.get<string>('PYTHON_PATH') || 'python';

         const isAbsolutePath = path.isAbsolute(pythonScriptPath);
         const finalScriptPath = isAbsolutePath ? path.resolve(pythonScriptPath) : path.resolve(process.cwd(), pythonScriptPath);

         // --- CONSTRUÇÃO CORRETA DO COMANDO PARA WINDOWS/CHILD_PROCESS ---
         // Envolve o caminho FINAL do script em aspas duplas para lidar com espaços
         const command = `${pythonExecutable} "${finalScriptPath}"`;


         this.logger.debug(`Executing python command: ${command}`);


         try {
              // Executa o script Python, passando configs e dados via STDIN
              const envVarsForPython = {
                   ...process.env,
                  EFI_CERT_PATH: certPath,
                  EFI_CERT_PASSWORD: certPassword,
              };
              const child = execPromise(command, {
                  env: envVarsForPython,
                  timeout: 60000, // Timeout maior para requisições de API (60 segundos)
              });

               this.logger.debug(`Passing request config to python via STDIN: ${JSON.stringify(requestConfig)}`);
               child.child.stdin?.write(JSON.stringify(requestConfig) + '\n');
               child.child.stdin?.end();


               const { stdout, stderr } = await child;


               if (stderr) {
                   this.logger.error(`Erro no script Python (STDERR): ${stderr}`);
               }

              // O script Python DEVE imprimir um JSON para STDOUT com {"success": Bool, "data": ...} ou {"success": Bool, "error": {...}}
             try {
                  const pythonResponse = JSON.parse(stdout);
                  this.logger.debug(`Python script STDOUT: ${stdout}`);

                  if (pythonResponse.success) {
                      return pythonResponse.data; // Retorna os dados da API da Efí
                  } else {
                      // O script Python reportou um erro da API Efí ou um erro interno
                      const error = pythonResponse.error;
                      this.logger.error(`Script Python reportou error para ${method} ${url_path}: ${JSON.stringify(error)}`);

                       // Tenta mapear erros comuns da API Efí para NestJS Exceptions
                      if (error?.status === 401) throw new UnauthorizedException(error.data || error.message);
                      if (error?.status === 404) throw new NotFoundException(error.data || error.message);
                      if (error?.status === 409) throw new ConflictException(error.data || error.message);

                       // Adicionar tratamento específico para erros 400 BadRequest com base no "nome" ou "mensagem" da Efí
                       if (error?.status === 400) {
                           // Exemplo específico para erro de webhook inválido
                           if (error?.data?.nome === 'webhook_invalido' || error?.data?.mensagem?.includes('respondeu com o código HTTP')) {
                               this.logger.error(`Erro específico da Efí: webhook_invalido. Mensagem: ${error.data.mensagem}`);
                               // Lança BadRequest com a mensagem específica da Efí
                               throw new BadRequestException(`Erro ao configurar webhook na Efí: ${error.data.mensagem}`);
                           }
                           // Outros erros 400 genéricos
                           throw new BadRequestException(error.data || error.message);
                       }

                       // Para outros erros ou erros sem status específico
                      throw new InternalServerErrorException(`Script Python falhou ao chamar API Efí (${method} ${url_path}): ${error?.message || 'Error desconhecido'}`);
                  }

              } catch (parseError: any) { // Explicitamente any para simplificar o tratamento de parseError
                  this.logger.error(`Error ao parsear saída JSON do script Python: ${stdout}`, parseError);
                   throw new InternalServerErrorException(`Error ao processar resposta do script Python. Saída: "${stdout.substring(0, 200)}..."`);
              }


           } catch (execError: any) { // Explicitamente any para simplificar o tratamento de execError
                this.logger.error(`Falha na execução do script Python para API Efí: ${execError.message}`, execError.stack);
                // Adicione uma flag ou informação para saber que foi um erro de execução/rede, não da API Efí
                const internalError = new InternalServerErrorException(`Falha na execução do script Python para API Efí: ${execError.message}`);
                // (internalError as any).isNetworkOrTlsError = true; // Opcional: adicionar flag customizada se necessário no catch superior
                throw internalError;
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

        this.logger.debug(`Delegando POST /v2/cob to Python script with data: ${JSON.stringify(chargeData)}`);
        // Use makeEfiRequest para chamar a API da Efí via script Python
        const efiResponse = await this.makeEfiRequest('post', '/v2/cob', chargeData);


         this.logger.debug(`Resposta do Script Python para criação de cobrança: ${JSON.stringify(efiResponse)}`);

        if (!efiResponse || !efiResponse.txid || !efiResponse.pixCopiaECola || !efiResponse.loc?.location) {
            const errorMessage = 'Resposta inesperada da Efí (via Python) ao criar cobrança: dados de retorno incompletos (txid, pixCopiaECola, location).';
             this.logger.error(`${errorMessage} Resposta completa: ${JSON.stringify(efiResponse)}`);
            throw new InternalServerErrorException(errorMessage);
        }

        await depositRecord.update({
            efiTxid: efiResponse.txid,
            qrCodeImage: efiResponse.loc.location,
            pixCopiaECola: efiResponse.pixCopiaECola,
            status: DepositStatus.PENDING, // Mantém PENDING, será atualizado pelo webhook
             efiCreateChargePayload: JSON.stringify(chargeData), // Opcional: Salvar payload enviado
             efiCreateChargeResponse: JSON.stringify(efiResponse), // Opcional: Salvar resposta recebida
        }, { transaction });
        this.logger.log(`Registro de depósito ${depositRecord.id} atualizado com dados da Efí (via Python) (txid ${depositRecord.efiTxid}, QR Code URL, Pix Copia e Cola). Status: PENDING.`);


        await transaction.commit();

        this.logger.log(`Cobrança de depósito ${depositRecord.id} criada com sucesso na Efí (via Python) e registro local finalizado.`);

        await depositRecord.reload();

        return depositRecord;

    } catch (error: unknown) { // Catch variable explicitly typed as unknown
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

         // Se a transação de criação falhou antes do commit, o registro inicial pode nem existir ou estar em estado inconsistente.
         // A lógica de marcar como FAILED aqui pode precisar de ajuste dependendo de quando o erro ocorreu.
         // Se o erro for de makeEfiRequest (após a criação inicial do registro PENDING), essa lógica faz sentido.
         if (depositRecord && depositRecord.id && depositRecord.status === DepositStatus.PENDING) {
            try {
               const updateTransaction = await this.sequelize.transaction();
               await depositRecord.update({ status: DepositStatus.FAILED }, { transaction: updateTransaction });
               await updateTransaction.commit();
               this.logger.error(`Registro de depósito ${depositRecord.id} (txid: ${depositRecord.efiTxid ?? 'N/A'}) marcado como FAILED após falha na criação da cobrança na Efí (via Python).`);
            } catch (updateError: any) { // Explicitly any for rollbackError
               this.logger.error(`Falha ao marcar registro de depósito ${depositRecord.id} como FAILED: ${(updateError as any).message}`);
            }
         }

        // Relança exceções NestJS conhecidas (de makeEfiRequest ou validações iniciais)
        if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
            throw error;
        }
         // Relança erro específico de configuração local
         if (error instanceof InternalServerErrorException && (error as any).message.includes('EFI_PIX_KEY')) {
            throw error;
        }

        // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
        let errorMessage = 'Unknown error';
        // --- CORREÇÃO: Definir errorStack como string | undefined ---
        let errorStack: string | undefined = undefined;

        if (error instanceof Error) {
             errorMessage = error.message;
             errorStack = error.stack;
        } else {
             // Se não for instância de Error, tente converter para string
             errorMessage = String(error);
        }

        // Captura qualquer outro erro não tratado e lança como InternalServerError
        this.logger.error(`Error inesperado ao criar cobrança de depósito para usuário ${userId}: ${errorMessage}`, errorStack);
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
        // AQUI está a chamada para o updateUserBalance.
        // O erro de "Saldo insuficiente" ocorre DENTRO deste método.
        // Sem o erro customizado 'InsufficientBalanceError', ele cairá no 'catch' abaixo.
        const user = await this.authService.updateUserBalance(userId, -amount, transaction);
        this.logger.log(`Saldo do usuário ${userId} debitado em R$ ${amount.toFixed(2)} para saque.`);

        const efiIdEnvio = uuidv4().replace(/-/g, '');
        this.logger.debug(`Generated efiIdEnvio (without hyphens): ${efiIdEnvio}`);

        withdrawalRecord = await this.withdrawalModel.create({
            userId: userId,
            amount: amount,
            status: WithdrawalStatus.PROCESSING, // Status inicial para saques processados pela API
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

         // O token é obtido dentro do makeEfiRequest, não precisa obter aqui separadamente

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

        this.logger.debug(`Delegando PUT /v3/gn/pix/${efiIdEnvio} to Python script with data: ${JSON.stringify(withdrawalData)}`);
        // Use makeEfiRequest para chamar a API da Efí via script Python
        const efiResponse = await this.makeEfiRequest('put', `/v3/gn/pix/${efiIdEnvio}`, withdrawalData);


        this.logger.debug(`Resposta do Script Python para requisição de saque (${efiIdEnvio}): ${JSON.stringify(efiResponse)}`);

         // A API de envio retorna dados sobre a transação, incluindo o E2EId final se sucesso
         if (efiResponse && efiResponse.e2eId) {
             await withdrawalRecord.update({
                  efiE2eId: efiResponse.e2eId,
                  // O status será atualizado pelo webhook (CONCLUIDA, NEGADA, etc.)
             }, { transaction });
              this.logger.log(`Registro de saque ${withdrawalRecord.id} atualizado com E2EId ${withdrawalRecord.efiE2eId}.`);
         } else {
              // Tratar caso a API de envio não retorne os dados esperados, embora sucesso (status 200)
              this.logger.warn(`Resposta da Efí para saque ${efiIdEnvio} não contém E2EId esperado. Resposta: ${JSON.stringify(efiResponse)}`);
             // O registro fica em PROCESSING até o webhook chegar
         }


        await transaction.commit();

        this.logger.log(`Saque ${withdrawalRecord.id} (efiIdEnvio: ${efiIdEnvio}) para R$ ${amount.toFixed(2)} solicitado para chave ${pixKeyData.keyValue} (tipo ${pixKeyData.keyType}). Status local inicial: PROCESSING.`);

        await withdrawalRecord.reload();

        return withdrawalRecord;

    } catch (error: unknown) { // Catch variable explicitly typed as unknown
         if (transaction && !(transaction as any).finished) {
             try {
                 await transaction.rollback();
                 this.logger.warn(`Rollback executado para solicitação de saque do usuário ${userId} devido a error capturado.`);
             } catch (rollbackError: any) { // Explicitly any for rollbackError
                  if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Error ao tentar executar rollback no CATCH para solicitação de saque do usuário ${userId}: ${rollbackError}`);
                 }
             }
         }

         // Lógica para marcar o saque como FAILED em caso de erro durante o processo.
         // Se o registro de saque já foi criado (antes do erro), marca como FAILED.
         if (withdrawalRecord && withdrawalRecord.id && withdrawalRecord.status === WithdrawalStatus.PROCESSING) {
             try {
                const updateTransaction = await this.sequelize.transaction();
                await withdrawalRecord.update({ status: WithdrawalStatus.FAILED }, { transaction: updateTransaction });
                await updateTransaction.commit();
                 this.logger.error(`Registro de saque ${withdrawalRecord.id} marcado como FAILED (após rollback).`);
             } catch (updateError: any) { // Explicitly any for updateError
                this.logger.error(`Falha ao marcar registro de saque ${withdrawalRecord.id} como FAILED: ${(updateError as any).message}`);
             }
         }

         // Se o erro veio do updateUserBalance (saldo insuficiente) e ele lançou um Error com mensagem específica
         // Note: Sem InsufficientBalanceError customizado, a verificação é baseada na mensagem.
         // Isto é menos robusto. Ideal seria um erro customizado.
         // O erro que você viu foi "Insufficient balance during transaction"
         if (error instanceof Error && error.message.includes('Insufficient balance')) { // Adapte a mensagem conforme o erro real do seu updateUserBalance
             this.logger.error(`requestWithdrawal: Saldo insuficiente detectado para usuário ${userId}. Mensagem: ${error.message}`);
              // Se o registro de saque foi criado, marca como FAILED antes de lançar BadRequest
              // (Já fizemos isso na lógica acima, mas pode ser repetido aqui se necessário)
             throw new BadRequestException('Saldo insuficiente para concluir o saque.');
         }


         // Relança exceções NestJS conhecidas (de makeEfiRequest ou validações iniciais)
         if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
             throw error;
         }
         // Relança erro específico de configuração local
         if (error instanceof InternalServerErrorException && (error as any).message.includes('Chave Pix da conta pagadora')) {
             throw error;
         }
         // Note: makeEfiRequest já trata erros de rede/TLS do Python e os lança como InternalServerErrorException
         /*
         if ((error as any).isNetworkOrTlsError) { // Assumindo que makeEfiRequest adiciona esta flag
              this.logger.error(`Error de rede/TLS (via Python) ao solicitar saque para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
              throw new InternalServerErrorException('Falha de comunicação segura (via Python) com a API da Efí ao solicitar saque.');
         }
         */

         // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
         let errorMessage = 'Unknown error';
         // --- CORREÇÃO: Definir errorStack como string | undefined ---
         let errorStack: string | undefined = undefined;

         if (error instanceof Error) {
              errorMessage = error.message;
              errorStack = error.stack;
         } else {
              // Se não for instância de Error, tente converter para string
              errorMessage = String(error);
         }

         // Captura qualquer outro erro não tratado e lança como InternalServerError
         this.logger.error(`Error inesperado ao solicitar saque para usuário ${userId}: ${errorMessage}`, errorStack);
         throw new InternalServerErrorException('Error interno ao solicitar saque.');
    }
}

  async handleWebhook(efiPayload: any, rawBody: Buffer, clientIp: string | undefined): Promise<void> {
      this.logger.log(`Webhook da Efí recebido. Validando segurança e processando payload...`);
      const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');

      // --- VALIDAÇÃO DE SEGURANÇA (Produção) ---

      // 1. Validação por IP de Origem (Recomendado pela Efí com skip-mTLS)
      // Adicione o IP 34.193.116.226 (e outros se a documentação ou logs mostrarem) no seu .env em EFI_WEBHOOK_ALLOWED_IPS
      if (this.allowedWebhookIps.length > 0) {
          if (clientIp === undefined || !this.allowedWebhookIps.includes(clientIp)) {
              this.logger.warn(`Tentativa de acesso não autorizado ao webhook. IP de Origem "${clientIp}" (ou undefined) NÃO está na lista de IPs permitidos: [${this.allowedWebhookIps.join(', ')}]. Ignorando payload.`);
              return; // Retorna sem processar se o IP não está na lista permitida
          }
          this.logger.debug(`IP de Origem "${clientIp}" validado com sucesso.`);
      } else {
          this.logger.warn('Validação por IP de webhook desativada (EFI_WEBHOOK_ALLOWED_IPS não configurado). Considere configurá-la para aumentar a segurança.');
      }

      // 2. Validação de HMAC (Altamente Recomendado pela Efí com skip-mTLS)
      // A documentação fala sobre HMAC na URL, não em header.
      // Seu controller atual não extrai HMAC de query params.
      // Se a Efí enviar HMAC na query string (ex: /webhook/SECREDO/pix?hmac=...), você precisará:
      // a) Capturar o 'hmac' no @Query() no controller.
      // b) Implementar a lógica de cálculo e comparação de HMAC aqui no service.
      // c) O segredo para o HMAC pode ser o mesmo do webhookSecret ou outro.
      const receivedHmac = "PLACEHOLDER_HMAC_RECEBIDO"; // <-- AINDA PRECISA OBTER ESTE VALOR REAL
      const webhookSecretKey = this.configService.get<string>('EFI_WEBHOOK_SECRET'); // Ou um segredo diferente para HMAC

      // Esta validação de HMAC está comentada porque ainda não sabemos onde a Efí envia o HMAC e qual algoritmo usa
      /*
      if (webhookSecretKey && receivedHmac !== "PLACEHOLDER_HMAC_RECEBIDO") { // Verifique se o HMAC recebido é real e se há um segredo configurado
          try {
              // Exemplo comum: const expectedHmac = crypto.createHmac('sha256', webhookSecretKey).update(rawBody).digest('hex');
              // TODO: Implementar cálculo e comparação do HMAC baseado na documentação exata da Efí
              this.logger.debug('Validação de HMAC pendente de implementação completa.');
              // TODO: if (expectedHmac !== receivedHmac) { this.logger.warn(...); return; }

          } catch (hmacError: unknown) { // Catch explicitly typed as unknown
               // --- CORREÇÃO: Acessar message APENAS se for instância de Error ---
               let hmacErrorMessage = 'Unknown error during HMAC validation';
               if (hmacError instanceof Error) {
                   hmacErrorMessage = hmacError.message;
               } else {
                   hmacErrorMessage = String(hmacError);
               }
              this.logger.error(`Erro durante a validação de HMAC do webhook para IP "${clientIp}": ${hmmacErrorMessage}. Ignorando payload.`);
              return; // Retorna em caso de erro na validação de HMAC
          }
      } else if (webhookSecretKey) {
           this.logger.warn('Validação de HMAC do webhook desativada (HMAC recebido é placeholder ou não configurado para receber).');
      } else if (!webhookSecretKey) {
           this.logger.warn('Validação de HMAC do webhook desativada (EFI_WEBHOOK_SECRET não configurado). Considere configurá-la para aumentar a segurança.');
      }
      */

      // --- Fim Validação de Segurança ---
      this.logger.debug('Validação de segurança inicial do webhook concluída. Processando payload...');


      if (!Array.isArray(efiPayload)) {
          this.logger.error(`Payload do webhook da Efí não é um array inesperado. Recebido: ${JSON.stringify(efiPayload)}`);
           return; // Retorna se o payload não for um array como esperado
      }

      for (const event of efiPayload) {
           // Processa eventos de PIX Recebido
           const eventPixRecebido = (event as any).pix;

           // O payload do webhook para PIX Recebido tem a estrutura { pix: [...] }
           // Dentro do array 'pix', cada item representa um PIX recebido
           if (eventPixRecebido && Array.isArray(eventPixRecebido)) {
               for (const pixEventDetails of eventPixRecebido) {
                    // Verifica se os campos necessários existem no detalhe do evento Pix
                    if (pixEventDetails.e2eId && pixEventDetails.valor !== undefined && pixEventDetails.txid) {
                         const e2eId = pixEventDetails.e2eId;
                         const amountReceived = parseFloat(pixEventDetails.valor);
                         const txid = pixEventDetails.txid;

                         if (isNaN(amountReceived)) {
                             this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}): Valor (${pixEventDetails.valor}) inválido no detalhe do evento.`);
                             continue; // Pula para o próximo item no array 'pix'
                         }

                         this.logger.log(`Processando Detalhe de Webhook PIX recebido: E2EId ${e2eId}, Txid ${txid}, Valor R$ ${amountReceived.toFixed(2)}.`);

                         const transaction = await this.sequelize.transaction();
                         let depositRecord: Deposit | null = null;

                         try {
                             // Tenta encontrar o depósito pelo txid (usado na criação da cobrança)
                             // ou pelo e2eId (identificador da transação PIX recebida)
                             depositRecord = await this.depositModel.findOne({
                                 where: {
                                     [Op.or]: [
                                         { efiTxid: txid },
                                         { efiE2eId: e2eId }, // Pode ser que o e2eId chegue antes para depósitos manuais não iniciados pela app
                                     ],
                                 },
                                 transaction,
                                 lock: transaction.LOCK.UPDATE, // Bloqueia o registro para evitar processamento duplicado por webhooks múltiplos
                             });

                             if (!depositRecord) {
                                 this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito correspondente NON found or already processed. Could be duplicate notification or PIX not initiated by the app.`);
                                 await transaction.commit(); // Commit transaction even if no record found to release lock (if any)
                                 continue; // Pula para o próximo item no array 'pix'
                             }

                             if (depositRecord.status === DepositStatus.PAID) {
                                 this.logger.warn(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Depósito ${depositRecord.id} já está no status PAID.`);
                                  await transaction.commit(); // Commit transaction even if already paid
                                  continue; // Pula para o próximo item no array 'pix'
                             }

                              // Opcional: Validar se o valor recebido no webhook corresponde ao valor da cobrança
                              // Útil para detectar fraudes ou erros
                              if (depositRecord.amount.toFixed(2) !== amountReceived.toFixed(2)) {
                                  this.logger.error(`Webhook PIX recebido (E2EId ${e2eId}, Txid ${txid}): Discrepancy in value. Deposit ${depositRecord.id} expected ${depositRecord.amount.toFixed(2)}, received ${amountReceived.toFixed(2)}. NOT AUTOMATICALLY CREDITED.`);
                                   // Você pode querer logar isso para revisão manual ou ter outra lógica de tratamento
                                   await transaction.commit();
                                  continue; // Não credita o saldo e pula para o próximo
                              }

                             // --- Ações para PIX Recebido (Depósito) ---
                             await depositRecord.update({
                                 status: DepositStatus.PAID,
                                 efiE2eId: e2eId, // Atualiza o e2eId final se não o tínhamos (txid é da cobrança, e2eId da transação de pagamento)
                             }, { transaction });
                             this.logger.log(`Registro de depósito ${depositRecord.id} atualizado para PAID. E2EId: ${e2eId}.`);

                             // Crédita o saldo do usuário
                             // Se updateUserBalance lançar um erro (ex: usuário não encontrado - menos provável aqui), a transação fará rollback
                             await this.authService.updateUserBalance(depositRecord.userId, depositRecord.amount, transaction);
                             this.logger.log(`Saldo de R$ ${depositRecord.amount.toFixed(2)} creditado para o usuário ${depositRecord.userId} (Depósito ${depositRecord.id}).`);

                             await transaction.commit();
                             this.logger.log(`Processamento do webhook para depósito ${depositRecord.id} (E2EId ${e2eId}) concluído com sucesso.`);

                         } catch (error: unknown) { // Catch explicitly typed as unknown
                              if (transaction && !(transaction as any).finished) {
                                  await transaction.rollback();
                                  this.logger.warn(`Rollback executado para processamento de webhook (Depósito, E2EId ${e2eId}) devido a error.`);
                              }
                             // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
                             let errorMessage = 'Unknown error';
                              // --- CORREÇÃO: Definir errorStack como string | undefined ---
                             let errorStack: string | undefined = undefined;


                             if (error instanceof Error) {
                                  errorMessage = error.message;
                                  errorStack = error.stack;
                             } else {
                                  errorMessage = String(error);
                             }
                             this.logger.error(
                                 `Error ao processar webhook para depósito (E2EId ${e2eId}, Txid ${txid}): ${errorMessage}`,
                                 errorStack
                             );
                             // Continua para o próximo item mesmo em caso de erro no processamento de um item específico
                         }
                    } else {
                        this.logger.warn(`Webhook da Efí recebeu um evento 'pix' com formato inesperado no detalhe: ${JSON.stringify(pixEventDetails)}`);
                    }
               } // Fim do loop sobre detalhes do array 'pix'

           } // Fim if (eventPixRecebido && Array.isArray(eventPixRecebido))

            // Processa eventos de ENVIO PIX (gnPix) - Saques
            const eventGnPixEnvio = (event as any).gnPix;

            // O payload do webhook para ENVIO PIX tem a estrutura { gnPix: [...] }
            // Dentro do array 'gnPix', cada item representa um saque
            if (eventGnPixEnvio && Array.isArray(eventGnPixEnvio)) {
                for (const gnPixEventDetails of eventGnPixEnvio) {
                    // Verifica se os campos necessários existem no detalhe do evento GnPix
                     if (gnPixEventDetails.idEnvio && gnPixEventDetails.status) {
                          const idEnvio = gnPixEventDetails.idEnvio; // O efiIdEnvio que você criou
                          const statusEfí = gnPixEventDetails.status;
                          const e2eId = gnPixEventDetails.e2eId; // O e2eId da transação de envio, se CONCLUIDA

                          this.logger.log(`Processando Detalhe de Webhook ENVIO PIX: idEnvio ${idEnvio}, Status EFI: ${statusEfí}, E2EId: ${e2eId ?? 'N/A'}.`);

                          const transaction = await this.sequelize.transaction();
                          let withdrawalRecord: Withdrawal | null = null;
                          try {
                              // Encontra o saque local pelo efiIdEnvio e status que ainda não foram finalizados
                              withdrawalRecord = await this.withdrawalModel.findOne({
                                  where: {
                                     efiIdEnvio: idEnvio,
                                     status: { [Op.in]: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] }
                                  },
                                  transaction,
                                  lock: transaction.LOCK.UPDATE, // Bloqueia o registro
                              });

                              if (!withdrawalRecord) {
                                  this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Saque PENDING/PROCESSING NÃO encontrado ou já finalizado.`);
                                  await transaction.commit();
                                  continue; // Pula para o próximo item no array 'gnPix'
                              }

                              let newStatus: WithdrawalStatus | undefined = undefined;
                              let estornarSaldo = false; // Indica se o saldo deve ser estornado (saque falhou)

                              switch (statusEfí) {
                                  case 'CONCLUIDA':
                                      newStatus = WithdrawalStatus.COMPLETED;
                                      // Não estorna saldo, pois o débito inicial já ocorreu na solicitação
                                      break;
                                  case 'NEGADA': // Saque negado pela Efí ou PSP destino
                                  case 'ERRO': // Erro no processamento do saque pela Efí
                                  case 'DEVOLVIDA': // Valor devolvido após a conclusão
                                      newStatus = WithdrawalStatus.FAILED;
                                      estornarSaldo = true; // Estorna o saldo que foi debitado na solicitação inicial
                                      break;
                                  case 'EM_PROCESSAMENTO':
                                      // Se já está em PROCESSING, não precisa fazer nada no status local
                                      if (withdrawalRecord.status !== WithdrawalStatus.PROCESSING) {
                                          await withdrawalRecord.update({ status: WithdrawalStatus.PROCESSING }, { transaction });
                                           this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para EM_PROCESSAMENTO.`);
                                      }
                                      break;
                                  default:
                                      this.logger.warn(`Webhook ENVIO PIX (idEnvio ${idEnvio}): Status EFI desconhecido "${statusEfí}". Ignorando atualização de status para evitar inconsistência.`);
                                      break; // Não atualiza status local
                              }

                              if (newStatus !== undefined) {
                                  await withdrawalRecord.update({
                                      status: newStatus,
                                      efiE2eId: e2eId ?? withdrawalRecord.efiE2eId, // Atualiza e2eId se veio no webhook e não tínhamos
                                  }, { transaction });
                                  this.logger.log(`Saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) atualizado para status local: ${newStatus}.`);

                                  if (estornarSaldo) {
                                      // Crédita o saldo de volta para o usuário
                                      await this.authService.updateUserBalance(withdrawalRecord.userId, withdrawalRecord.amount, transaction);
                                      this.logger.log(`Saldo de R$ ${withdrawalRecord.amount.toFixed(2)} estornado para o usuário ${withdrawalRecord.userId} (Saque ${withdrawalRecord.id}).`);
                                  }
                              }


                              await transaction.commit();
                              this.logger.log(`Processamento do webhook para saque ${withdrawalRecord.id} (idEnvio ${idEnvio}) concluído com sucesso.`);

                          } catch (error: unknown) { // Catch explicitly typed as unknown
                              if (transaction && !(transaction as any).finished) {
                                  await transaction.rollback();
                                  this.logger.warn(`Rollback executado para processamento de webhook (Saque, idEnvio ${idEnvio}) devido a error.`);
                              }
                              // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
                              let errorMessage = 'Unknown error';
                               // --- CORREÇÃO: Definir errorStack como string | undefined ---
                              let errorStack: string | undefined = undefined;

                              if (error instanceof Error) {
                                   errorMessage = error.message;
                                   errorStack = error.stack;
                              } else {
                                   errorMessage = String(error);
                              }
                              this.logger.error(
                                  `Error ao processar webhook para saque (idEnvio ${idEnvio}): ${errorMessage}`,
                                  errorStack
                              );
                              // Continua para o próximo item mesmo em caso de erro no processamento de um item específico
                          }
                     } else {
                        this.logger.warn(`Webhook da Efí recebeu um evento 'gnPix' com formato inesperado no detalhe: ${JSON.stringify(gnPixEventDetails)}`);
                     }
                } // Fim do loop sobre detalhes do array 'gnPix'
            } // Fim if (eventGnPixEnvio && Array.isArray(eventGnPixEnvio))

             // Se houver outros tipos de eventos no payload...
            // ...adicione lógica aqui para processá-los com base na documentação da Efí
             const otherEvents = Object.keys(event).filter(key => key !== 'pix' && key !== 'gnPix');
             if (otherEvents.length > 0) {
                 this.logger.warn(`Webhook da Efí recebeu tipos de evento não processados: ${otherEvents.join(', ')}. Evento completo: ${JSON.stringify(event)}`);
             }


      } // Fim do loop sobre o array principal de eventos

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

    // --- NOVO MÉTODO: CONSULTAR URL DO WEBHOOK REGISTRADO NA EFÍ ---
    async getRegisteredWebhookUrl(pixKey: string): Promise<any | null> {
        this.logger.log(`Consultando URL do webhook registrado na Efí para a chave: ${pixKey}`);
        try {
             // makeEfiRequest cuidará da obtenção do token e da chamada via Python
            const efiResponse = await this.makeEfiRequest('get', `/v2/webhook/${pixKey}`);
            this.logger.debug(`Resposta da Efí (via Python) ao consultar webhook: ${JSON.stringify(efiResponse)}`);

            // A resposta de sucesso 200 para GET /v2/webhook/:chave é um JSON com {"webhookUrl": "...", "chave": "...", "criacao": "..."}, conforme documentação
            if (efiResponse && efiResponse.webhookUrl) {
                this.logger.log(`URL do webhook registrada na Efí para a chave ${pixKey}: ${efiResponse.webhookUrl}`);
                return efiResponse; // Retorna o objeto completo, não apenas a URL
            } else {
                 this.logger.warn(`Nenhuma URL de webhook encontrada na Efí para a chave ${pixKey} ou resposta incompleta.`);
                return null;
            }

        } catch (error: unknown) { // Catch explicitly typed as unknown
             // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
             let errorMessage = 'Unknown error';
             // --- CORREÇÃO: Definir errorStack como string | undefined ---
             let errorStack: string | undefined = undefined;

             if (error instanceof Error) {
                  errorMessage = error.message;
                  errorStack = error.stack;
             } else {
                  errorMessage = String(error);
             }
             this.logger.error(`Error ao consultar URL do webhook na Efí para a chave ${pixKey}: ${errorMessage}`, errorStack);

             // makeEfiRequest já lança exceções NestJS para 4xx/5xx da API Efí
             // Se for uma dessas, makeEfiRequest já as lança.
             // Se for outro tipo de erro (execução do Python, parse), makeEfiRequest lança InternalServerError.
             // Simplesmente re-lançamos a exceção que veio de makeEfiRequest.
             throw error;
        }
    }
     // --- FIM NOVO MÉTODO ---

     // --- NOVO MÉTODO: SOLICITAR REENVIO DE WEBHOOK ---
     async resendWebhook(e2eId: string): Promise<any> {
         this.logger.log(`Solicitando reenvio de webhook para E2EId: ${e2eId}`);
         const requestBody = {
             tipo: "PIX_RECEBIDO", // Tipo de evento a ser reenviado (conforme documentação)
             e2eids: [e2eId] // Array de E2E IDs para reenviar
         };
         try {
              // makeEfiRequest cuidará da obtenção do token e da chamada via Python
              // O endpoint responde 202 Accepted em caso de sucesso na solicitação
              const efiResponse = await this.makeEfiRequest('post', '/v2/gn/webhook/reenviar', requestBody);
              this.logger.log(`Solicitação de reenvio de webhook para ${e2eId} enviada. Resposta: ${JSON.stringify(efiResponse)}`);
             return efiResponse; // A resposta da Efí para 202 é vazia ou simples, makeEfiRequest retorna o que vier
         } catch (error: unknown) { // Catch explicitly typed as unknown
              // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
              let errorMessage = 'Unknown error';
               // --- CORREÇÃO: Definir errorStack como string | undefined ---
              let errorStack: string | undefined = undefined;

              if (error instanceof Error) {
                   errorMessage = error.message;
                   errorStack = error.stack;
              } else {
                   errorMessage = String(error);
              }
              this.logger.error(`Error ao solicitar reenvio de webhook para ${e2eId}: ${errorMessage}`, errorStack);

              // makeEfiRequest já lança exceções NestJS para 4xx/5xx da API Efí
              // Simplesmente re-lançamos a exceção que veio de makeEfiRequest.
              throw error;
         }
     }
     // --- FIM NOVO MÉTODO ---


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

         // O token é obtido dentro do makeEfiRequest

         // IMPORTANTE: Esta é a URL que a Efí CHAMA para o TESTE de configuração e que você REGISTRA.
         // A Efí adicionará '/pix' para as notificações REAIS depois da configuração.
         // Sua aplicação precisa ter uma rota POST que responda a ESTA URL EXATA para o teste.
         const webhookUrlToEfí = `${publicHost}/pix/webhook/${webhookSecret}`;

         this.logger.debug(`Configurando webhook para a chave Pix: ${pixKey} com URL: ${webhookUrlToEfí}`);

         const requestBody = {
             webhookUrl: webhookUrlToEfí
         };

         // Headers específicos para a requisição PUT /v2/webhook/:chave
         const extraConfig: AxiosRequestConfig = {
              headers: {
                   'x-skip-mtls-checking': 'true', // Usando skip-mTLS conforme sua necessidade
                   // O header Authorization Bearer será adicionado pelo makeEfiRequest
              },
         };


         try {
              // makeEfiRequest cuidará da obtenção do token e da chamada via Python
              // Este endpoint responde 201 Created em caso de sucesso na configuração
             const efiResponse = await this.makeEfiRequest('put', `/v2/webhook/${pixKey}`, requestBody, extraConfig);

             this.logger.log(`Configuração do webhook na Efí solicitada com sucesso. Resposta: ${JSON.stringify(efiResponse)}`);
             return efiResponse;

         } catch (error: unknown) { // Catch explicitly typed as unknown
              // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ---
              let errorMessage = 'Unknown error';
               // --- CORREÇÃO: Definir errorStack como string | undefined ---
              let errorStack: string | undefined = undefined;

              if (error instanceof Error) {
                   errorMessage = error.message;
                   errorStack = error.stack;
              } else {
                   errorMessage = String(error);
              }

              this.logger.error(`Error inesperado ao configurar webhook na Efí para a chave ${pixKey}: ${errorMessage}`, errorStack);

             // makeEfiRequest já lança exceções NestJS para 4xx/5xx da API Efí (incluindo BadRequest por 'webhook_invalido')
             // Simplesmente re-lançamos a exceção que veio de makeEfiRequest.
             throw error;
         }
    }

}