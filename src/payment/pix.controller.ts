// src/payment/pix.controller.ts
import { Controller, Post, Get, Body, Param, ParseIntPipe, Req, UseGuards, HttpCode, HttpStatus, Logger, InternalServerErrorException, BadRequestException, NotFoundException, UnauthorizedException, ConflictException, Headers, Query } from '@nestjs/common';
import { EfiPixService } from './efi-pix.service';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Deposit } from '../models/payment/deposit.model';
import { Withdrawal } from '../models/payment/withdrawal.model';
import { ConfigService } from '@nestjs/config';

class CreateDepositDto {
    amount!: number;
}

class RequestWithdrawalDto {
    amount!: number;
    pixKeyType!: string;
    pixKeyValue!: string;
    name?: string;
    cpfCnpj?: string; // Corrigido para cpfCnpj, se for esse o nome no DTO
}

// DTO para o novo endpoint de reenvio de webhook
class ResendWebhookDto {
     e2eId!: string;
}


@Controller('pix')
export class PixController {
    private readonly logger = new Logger(PixController.name);

    constructor(
        private readonly efiPixService: EfiPixService,
        private readonly configService: ConfigService,
    ) {}

    @UseGuards(AuthGuard('jwt'))
    @Post('deposit')
    @HttpCode(HttpStatus.CREATED)
    async createDeposit(@Req() req: Request, @Body() createDepositDto: CreateDepositDto): Promise<Deposit> {
        const userId = (req.user as any).id;
        this.logger.log(`Usuário ${userId} solicitando depósito de R$ ${createDepositDto.amount}...`);
        try {
            return await this.efiPixService.createDepositCharge(userId, createDepositDto.amount);
        } catch (error: unknown) { // Catch explicitly typed as unknown
            // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
            let errorMessage = 'Unknown error';
            // --- CORREÇÃO: Definir errorStack como string | undefined ---
            let errorStack: string | undefined = undefined;


            if (error instanceof Error) {
                 errorMessage = error.message;
                 errorStack = error.stack;
            } else if (typeof error === 'object' && error !== null && 'message' in error) {
                 // Tenta acessar 'message' se for um objeto com essa propriedade (pode ser uma exceção NestJS)
                errorMessage = (error as any).message;
                 errorStack = (error as any).stack; // NestJS exceptions often have stack
            } else {
                 errorMessage = String(error);
            }

            this.logger.error(`Error no controller ao solicitar depósito para usuário ${userId}: ${errorMessage}`, errorStack);
             // Relança o erro original
            throw error;
        }
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('withdrawal')
    @HttpCode(HttpStatus.CREATED)
    async requestWithdrawal(@Req() req: Request, @Body() requestWithdrawalDto: RequestWithdrawalDto): Promise<Withdrawal> {
        const userId = (req.user as any).id;
        this.logger.log(`Usuário ${userId} solicitando saque de R$ ${requestWithdrawalDto.amount} para chave ${requestWithdrawalDto.pixKeyValue} (${requestWithdrawalDto.pixKeyType})...`);
        try {
            // O erro de saldo insuficiente acontece DENTRO do requestWithdrawal service method
            return await this.efiPixService.requestWithdrawal(userId, requestWithdrawalDto.amount, {
                keyType: requestWithdrawalDto.pixKeyType,
                keyValue: requestWithdrawalDto.pixKeyValue,
                name: requestWithdrawalDto.name,
                cpfCnpj: requestWithdrawalDto.cpfCnpj, // Assumindo que o nome da prop no DTO é cpfCnpj
            });
        } catch (error: unknown) { // Catch explicitly typed as unknown
            // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
            let errorMessage = 'Unknown error';
             // --- CORREÇÃO: Definir errorStack como string | undefined ---
            let errorStack: string | undefined = undefined;


            if (error instanceof Error) {
                 errorMessage = error.message;
                 errorStack = error.stack;
            } else if (typeof error === 'object' && error !== null && 'message' in error) {
                 // Tenta acessar 'message' se for um objeto com essa propriedade (pode ser uma exceção NestJS)
                errorMessage = (error as any).message;
                 errorStack = (error as any).stack; // NestJS exceptions often have stack
            } else {
                 errorMessage = String(error);
            }

            this.logger.error(`Error no controller ao solicitar saque para usuário ${userId}: ${errorMessage}`, errorStack);
            throw error; // Relança a exceção (que pode ser InternalServerError, BadRequest, etc.)
        }
    }

    // --- NOVA ROTA: Endpoint para a Efí testar a CONFIGURAÇÃO do webhook ---
    // A Efí chama ESTA URL EXATA após um PUT /v2/webhook/:chave.
    // Deve vir ANTES da rota /pix para que a Efí a encontre primeiro.
    @Post('webhook/:webhookSecret') // <-- URL sem o /pix final
    @HttpCode(HttpStatus.OK) // Responde com 200 OK para indicar sucesso no teste
    handleEfiWebhookConfigurationTest(
         @Param('webhookSecret') webhookSecret: string,
         @Req() req: Request,
         @Body() payload: any, // Pode ou não ter payload, dependendo do teste da Efí.
    ): string {
        // Captura o IP do cliente (Efí)
        const clientIp = req.ip; // Configuração para obter IP pode variar dependendo de proxies

        this.logger.log(`Requisição de TESTE de CONFIGURAÇÃO de Webhook da Efí recebida na rota /pix/webhook/${webhookSecret}. IP Origem: ${clientIp}.`);
         // O payload do teste de configuração pode ser diferente do payload real,
         // e pode até não ser um array ou ser vazio. Não tente processar payload aqui.
        this.logger.debug(`Payload recebido na rota de teste: ${JSON.stringify(payload)}`);


        const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');

        if (!expectedWebhookSecret) {
            this.logger.error('Segredo do Webhook da Efí (EFI_WEBHOOK_SECRET) não configurado. A rota de teste de webhook não pode validar o segredo.');
             // Mesmo em caso de erro interno na validação (configuração local),
             // a Efí precisa receber 200 OK para que a configuração seja aceita.
             // Logamos o problema internamente, mas respondemos OK para a Efí.
             return 'OK - Webhook Secret Not Configured Internally';
        }

        if (webhookSecret !== expectedWebhookSecret) {
             this.logger.warn(`Tentativa de acesso não autorizado à rota de TESTE de webhook. Segredo na URL: "${webhookSecret}", Segredo esperado: "${expectedWebhookSecret}". Ignorando.`);
            // Se o segredo na URL não bater, também respondemos OK para a Efí (para aceitar a configuração)
            // mas logamos a tentativa não autorizada e o service NÃO processará o payload real (que tem /pix)
            return 'OK - Invalid Secret (Test Route)';
        }

        this.logger.log(`Teste de CONFIGURAÇÃO de Webhook da Efí validado (segredo correto). Respondendo 200 OK.`);
        // Responde "OK" conforme a documentação sugere responder 200.
        return 'OK';
    }
    // --- FIM NOVA ROTA DE TESTE ---


    // --- ROTA EXISTENTE: Endpoint para RECEBER NOTIFICAÇÕES REAIS DE PIX ---
    // A Efí chama ESTA URL após a configuração ser bem sucedida E um Pix ser recebido (adicionando /pix ao final da URL registrada).
    @Post('webhook/:webhookSecret/pix') // <-- URL COM o /pix final
    @HttpCode(HttpStatus.OK) // Responde 200 OK para ACK a notificação
    async handleEfiWebhook(
        @Param('webhookSecret') webhookSecret: string,
        @Body() efiPayload: any,
        @Req() req: Request,
        // @Headers('X-Gerencianet-Signature') signatureHeader?: string,
        // @Query('hmac') hmac?: string // Descomente e use se a Efí enviar HMAC na query string
    ): Promise<string> {
        // Captura o IP do cliente (Efí)
        const clientIp = req.ip; // Configuração para obter IP pode variar dependendo de proxies

        this.logger.log(`Webhook de NOTIFICAÇÃO REAL da Efí recebido na rota /pix/webhook/${webhookSecret}/pix. IP Origem: ${clientIp}.`);
        this.logger.debug(`Payload recebido na rota de notificação: ${JSON.stringify(efiPayload)}`);


        const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');

        if (!expectedWebhookSecret) {
             this.logger.error('Segredo do Webhook da Efí (EFI_WEBHOOK_SECRET) não configurado. A rota de notificação real de webhook não pode validar o segredo.');
             // Mesmo em caso de erro interno, responda 200 para evitar reenvios da Efí.
             return 'OK - Internal Error: Webhook Secret Not Configured';
        }

        if (webhookSecret !== expectedWebhookSecret) {
             this.logger.warn(`Tentativa de acesso não autorizado ao webhook de NOTIFICAÇÃO. Segredo na URL: "${webhookSecret}", Segredo esperado: "${expectedWebhookSecret}". Ignorando processamento do payload.`);
            // Responda 200 mesmo para segredo inválido (evita reenvios), mas NÃO processe o payload
            return 'OK - Invalid Secret (Notification Route)';
        }
        this.logger.debug('Webhook Secret validado com sucesso para NOTIFICAÇÃO REAL.');

        // A validação de IP e HMAC é feita no service handleWebhook
        const rawBody = (req as any).rawBody; // Assuma que rawBody está disponível via middleware

        try {
            // Chama o service para processar o payload (valida IP, HMAC se implementado, encontra depósito, credita, etc.)
            await this.efiPixService.handleWebhook(efiPayload, rawBody, clientIp);

            // Resposta de sucesso conforme documentação para ACK a notificação
            return 'OK';
        } catch (error: unknown) { // Catch explicitly typed as unknown
             // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
             let errorMessage = 'Unknown error';
              // --- CORREÇÃO: Definir errorStack como string | undefined ---
             let errorStack: string | undefined = undefined;


             if (error instanceof Error) {
                  errorMessage = error.message;
                  errorStack = error.stack;
             } else if (typeof error === 'object' && error !== null && 'message' in error) {
                  // Tenta acessar 'message' se for um objeto com essa propriedade (pode ser uma exceção NestJS)
                 errorMessage = (error as any).message;
                  errorStack = (error as any).stack; // NestJS exceptions often have stack
             } else {
                  errorMessage = String(error);
             }
            this.logger.error(`Error no controlador ao processar webhook de NOTIFICAÇÃO da Efí APÓS validação de segredo: ${errorMessage}`, errorStack);
            // Em caso de qualquer erro durante o processamento (mesmo após validações iniciais),
            // a Efí ainda precisa receber 200 OK para não tentar reenviar o webhook.
            // A lógica de re-processamento ou alerta deve ser interna à sua aplicação.
            return 'OK - Internal Error';
        }
    }
    // --- FIM ROTA EXISTENTE DE NOTIFICAÇÃO ---


    @UseGuards(AuthGuard('jwt'))
    @Get('my/deposits')
    async getUserDeposits(@Req() req: Request): Promise<Deposit[]> {
        const userId = (req.user as any).id;
        this.logger.log(`Buscando depósitos para o usuário ${userId}...`);
        return this.efiPixService.getUserDeposits(userId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('my/withdrawals')
    async getUserWithdrawals(@Req() req: Request): Promise<Withdrawal[]> {
        const userId = (req.user as any).id;
        this.logger.log(`Buscando saques para o usuário ${userId}...`);
        return this.efiPixService.getUserWithdrawals(userId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('deposit/:id')
    async getDepositDetails(@Param('id', ParseIntPipe) id: number): Promise<Deposit> {
        this.logger.log(`Buscando detalhes do depósito ${id}...`);
        try {
            return await this.efiPixService.getDepositDetails(id);
        } catch (error: unknown) { // Catch explicitly typed as unknown
             // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
             let errorMessage = 'Unknown error';
              // --- CORREÇÃO: Definir errorStack como string | undefined ---
             let errorStack: string | undefined = undefined;


             if (error instanceof Error) {
                  errorMessage = error.message;
                  errorStack = error.stack;
             } else if (typeof error === 'object' && error !== null && 'message' in error) {
                 errorMessage = (error as any).message;
                  errorStack = (error as any).stack;
             } else {
                  errorMessage = String(error);
             }
            this.logger.error(`Error no controller ao buscar depósito ${id}: ${errorMessage}`, errorStack);
            throw error; // Relança o erro
        }
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('withdrawal/:id')
    async getWithdrawalDetails(@Param('id', ParseIntPipe) id: number): Promise<Withdrawal> {
        this.logger.log(`Buscando detalhes do saque ${id}...`);
        try {
            return await this.efiPixService.getWithdrawalDetails(id);
        } catch (error: unknown) { // Catch explicitly typed as unknown
             // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
             let errorMessage = 'Unknown error';
              // --- CORREÇÃO: Definir errorStack como string | undefined ---
             let errorStack: string | undefined = undefined;


             if (error instanceof Error) {
                  errorMessage = error.message;
                  errorStack = error.stack;
             } else if (typeof error === 'object' && error !== null && 'message' in error) {
                 errorMessage = (error as any).message;
                  errorStack = (error as any).stack;
             } else {
                  errorMessage = String(error);
             }
            this.logger.error(`Error no controller ao buscar saque ${id}: ${errorMessage}`, errorStack);
            throw error; // Relança o erro
        }
    }

    @Post('configure-webhook')
    @HttpCode(HttpStatus.OK) // Efí API responde 201 Created, mas o controller responde 200 OK para a chamada local
    async configureWebhookEfí(): Promise<any> {
        this.logger.warn('ATENÇÃO: Endpoint configure-webhook chamado (endpoint de TESTE sem segurança)!');
        try {
            const result = await this.efiPixService.configureEfiWebhook();
             // O service já lança exceções NestJS para erros da Efí
            return {
                message: 'Solicitação de configuração de webhook enviada para a Efí.',
                efiResponse: result // Deve conter a resposta 201 da Efí via Python
            };
        } catch (error: unknown) { // Catch explicitly typed as unknown
             // makeEfiRequest lança exceções NestJS apropriadas. Relançamos no controller.
              // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
              let errorMessage = 'Unknown error';
               // --- CORREÇÃO: Definir errorStack como string | undefined ---
              let errorStack: string | undefined = undefined;


              if (error instanceof Error) {
                   errorMessage = error.message;
                   errorStack = error.stack;
              } else if (typeof error === 'object' && error !== null && 'message' in error) {
                  errorMessage = (error as any).message;
                   errorStack = (error as any).stack;
              } else {
                   errorMessage = String(error);
              }
             this.logger.error(`Error no controller ao configurar webhook via endpoint: ${errorMessage}`, errorStack);
            throw error; // Re-lança a exceção
        }
    }

     // --- NOVO ENDPOINT: Consultar Webhook Configurardo ---
    @Get('configured-webhook-url')
    @HttpCode(HttpStatus.OK)
    async getConfiguredWebhookUrl(): Promise<any> {
        this.logger.warn('ATENÇÃO: Endpoint configured-webhook-url chamado (endpoint de TESTE sem segurança)!');
        const pixKey = this.configService.get<string>('EFI_PIX_KEY');
         if (!pixKey) {
              throw new InternalServerErrorException('Chave Pix da Efí (EFI_PIX_KEY) não configurada.');
         }
        try {
            // Chama o novo método do service para consultar na Efí
            const webhookData = await this.efiPixService.getRegisteredWebhookUrl(pixKey);
             if (!webhookData) {
                 return {
                      pixKey: pixKey,
                     message: 'Nenhuma URL de webhook encontrada na Efí para esta chave Pix.',
                      registeredWebhookUrl: null,
                 };
             }
            return {
                pixKey: pixKey,
                registeredWebhookUrl: webhookData.webhookUrl, // Retorna apenas a URL registrada
                efiResponse: webhookData, // Retorna a resposta completa da Efí para inspeção
            };
        } catch (error: unknown) { // Catch explicitly typed as unknown
             // makeEfiRequest lança exceções NestJS apropriadas. Relançamos no controller.
              // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
              let errorMessage = 'Unknown error';
               // --- CORREÇÃO: Definir errorStack como string | undefined ---
              let errorStack: string | undefined = undefined;


              if (error instanceof Error) {
                   errorMessage = error.message;
                   errorStack = error.stack;
              } else if (typeof error === 'object' && error !== null && 'message' in error) {
                  errorMessage = (error as any).message;
                   errorStack = (error as any).stack;
              } else {
                   errorMessage = String(error);
              }
              this.logger.error(`Error no controller ao consultar webhook configurado: ${errorMessage}`, errorStack);
             throw error; // Re-lança a exceção
        }
    }
     // --- FIM NOVO ENDPOINT ---

     // --- NOVO ENDPOINT: Reenviar Webhook ---
     @Post('resend-webhook')
     @HttpCode(HttpStatus.ACCEPTED) // 202 Accepted é a resposta esperada da Efí para reenvio aceito
     async resendWebhook(@Body() resendWebhookDto: ResendWebhookDto): Promise<any> {
          this.logger.warn('ATENÇÃO: Endpoint resend-webhook chamado (endpoint de TESTE sem segurança)!');
          if (!resendWebhookDto.e2eId) {
               throw new BadRequestException('O E2EId é obrigatório para reenviar o webhook.');
          }
         try {
             // Chama o novo método do service para solicitar o reenvio na Efí
             const result = await this.efiPixService.resendWebhook(resendWebhookDto.e2eId);
              // makeEfiRequest já lança exceções NestJS para erros da Efí
             return {
                 message: `Solicitação de reenvio de webhook para E2EId ${resendWebhookDto.e2eId} enviada para a Efí.`,
                 efiResponse: result // Deve conter a resposta 202 da Efí via Python
             };
         } catch (error: unknown) { // Catch explicitly typed as unknown
              // makeEfiRequest lança exceções NestJS apropriadas. Relançamos no controller.
              // --- CORREÇÃO: Acessar message e stack APENAS se for instância de Error ou objeto com message ---
              let errorMessage = 'Unknown error';
               // --- CORREÇÃO: Definir errorStack como string | undefined ---
              let errorStack: string | undefined = undefined;


              if (error instanceof Error) {
                   errorMessage = error.message;
                   errorStack = error.stack;
              } else if (typeof error === 'object' && error !== null && 'message' in error) {
                   errorMessage = (error as any).message;
                   errorStack = (error as any).stack;
              } else {
                   errorMessage = String(error);
              }
              this.logger.error(`Error no controller ao solicitar reenvio de webhook: ${errorMessage}`, errorStack);
             throw error; // Re-lança a exceção
         }
     }
     // --- FIM NOVO ENDPOINT ---

}