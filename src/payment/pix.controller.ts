// src/payment/pix.controller.ts
import { Controller, Post, Get, Body, Param, ParseIntPipe, Req, UseGuards, HttpCode, HttpStatus, Logger, InternalServerErrorException, Headers, Query } from '@nestjs/common';
import { EfiPixService } from './efi-pix.service';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Deposit } from '../models/payment/deposit.model'; // Importar modelos para tipagem de retorno
import { Withdrawal } from '../models/payment/withdrawal.model'; // Importar modelos para tipagem de retorno
import { ConfigService } from '@nestjs/config';

// Definir DTOs de requisição (exemplo, idealmente em arquivos separados)
class CreateDepositDto {
    amount!: number;
}

class RequestWithdrawalDto {
    amount!: number;
    pixKeyType!: string; // e.g., 'cpf', 'email', 'phone', 'evp', 'cnpj'
    pixKeyValue!: string;
    name?: string;
    cpfCnpj?: string;
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
            // Chamar o service para criar a cobrança na Efí e o registro local
            return await this.efiPixService.createDepositCharge(userId, createDepositDto.amount);
        } catch (error) {
             // O service já mapeou alguns erros comuns da Efí para NestJS Exceptions.
             // Propagar esses erros para que o NestJS os trate (ex: 400 Bad Request, 401 Unauthorized, etc.)
            this.logger.error(`Erro no controller ao solicitar depósito para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
             throw error; // Re-lança o erro original (que pode ser uma NestJS Exception)
        }
    }

    @UseGuards(AuthGuard('jwt'))
    @Post('withdrawal')
    @HttpCode(HttpStatus.CREATED)
    async requestWithdrawal(@Req() req: Request, @Body() requestWithdrawalDto: RequestWithdrawalDto): Promise<Withdrawal> {
        const userId = (req.user as any).id;
        this.logger.log(`Usuário ${userId} solicitando saque de R$ ${requestWithdrawalDto.amount} para chave ${requestWithdrawalDto.pixKeyValue} (${requestWithdrawalDto.pixKeyType})...`);
        try {
             // Chamar o service para debitar saldo e requisitar saque na Efí
            return await this.efiPixService.requestWithdrawal(userId, requestWithdrawalDto.amount, {
                keyType: requestWithdrawalDto.pixKeyType,
                keyValue: requestWithdrawalDto.pixKeyValue,
                 name: requestWithdrawalDto.name, // Passar dados adicionais se fornecidos
                 cpfCnpj: requestWithdrawalDto.cpfCnpj,
            });
        } catch (error) {
            // O service já mapeou alguns erros (saldo insuficiente, erros da Efí) para NestJS Exceptions.
            // Propagar esses erros.
             this.logger.error(`Erro no controller ao solicitar saque para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
             throw error; // Re-lança o erro original (que pode ser uma NestJS Exception)
        }
    }

    // Endpoint para o Webhook da Efí
    // Este endpoint NÃO deve usar AuthGuard('jwt') pois é chamado pela Efí.
    // A validação de segurança básica (segredo na URL) é feita aqui.
    // A validação MAIS ROBUSTA (HMAC/IP) DEVE ser implementada no service.
    @Post('webhook/:webhookSecret/pix')
    @HttpCode(HttpStatus.OK) // A Efí espera uma resposta 200 OK, mesmo em caso de erro no processamento local
    async handleEfiWebhook(
        @Param('webhookSecret') webhookSecret: string,
        @Body() efiPayload: any,
        @Req() req: Request,
        // @Headers('X-Gerencianet-Signature') signatureHeader?: string, // Se a Efí usar este cabeçalho para HMAC/assinatura
        // @Query('hmac') hmac?: string // Se a Efí adicionar o HMAC na query string
    ): Promise<string> {
        this.logger.log(`Webhook da Efí recebido na rota /pix/webhook/${webhookSecret}/pix`);

        // --- VALIDAÇÃO DE SEGURANÇA SIMPLES (APENAS SEGREDO NA URL) ---
        const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');

        if (!expectedWebhookSecret || webhookSecret !== expectedWebhookSecret) {
            this.logger.warn(`Tentativa de acesso não autorizado ao webhook. Segredo na URL: "${webhookSecret}", Segredo esperado: "${expectedWebhookSecret}". IP Origem: ${req.ip}. Ignorando payload.`);
            // Retorna 200 OK mesmo assim, mas NÃO processa o payload
            return 'OK - Invalid Secret';
        }
        this.logger.debug('Webhook Secret validado com sucesso.');
        // --- FIM VALIDAÇÃO SIMPLES ---

        // TODO: Para MAIOR segurança (recomendado pela Efí com skip-mTLS):
        // 1. Validar IP de origem da requisição (comparar req.ip com IPs da Efí). Logar e retornar Invalid IP se falhar.
        // 2. **Validar HMAC** usando req.rawBody (obtido via middleware), EFI_WEBHOOK_SECRET e o valor HMAC recebido (no header ou query param). Logar erro de segurança e retornar Invalid HMAC se falhar.
        //    Consulte a documentação exata da Efí sobre como calcular e validar o HMAC.
        //    Se qualquer validação de segurança falhar, NÃO chame o service.


        try {
            // Chamar o service para processar o payload SOMENTE se a validação passar
            // Passar rawBody e hmac/signatureHeader para o service se a validação HMAC for feita lá
            await this.efiPixService.handleWebhook(efiPayload /*, rawBody, signatureHeader, hmac */);

            // Sempre retornar 200 OK para a Efí para indicar recebimento da notificação
            return 'OK';
        } catch (error) {
             // Capturar erros que ocorreram DENTRO do handleWebhook, apesar do service já tentar capturar e logar internamente.
             // Em um webhook, é CRUCIAL não lançar exceções HTTP que a Efí não entenda.
             // A Efí espera 200 OK para indicar que você recebeu a notificação.
             // Se houver um erro fatal aqui, logamos e ainda retornamos 200 OK.
             this.logger.error(`Erro no controlador ao processar webhook da Efí APÓS validação de segredo: ${(error as any).message}`, (error as any).stack);
             // Retornar 200 OK mesmo assim, para seguir a especificação da Efí para webhooks.
             return 'OK - Internal Error'; // Adicionar uma mensagem indicativa no corpo, opcional
        }
    }

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
         } catch (error) {
             // Propagar erros como NotFoundException
              this.logger.error(`Erro no controller ao buscar depósito ${id}: ${(error as any).message}`, (error as any).stack);
             throw error;
         }
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('withdrawal/:id')
    async getWithdrawalDetails(@Param('id', ParseIntPipe) id: number): Promise<Withdrawal> {
        this.logger.log(`Buscando detalhes do saque ${id}...`);
        try {
             return await this.efiPixService.getWithdrawalDetails(id);
         } catch (error) {
             // Propagar erros como NotFoundException
              this.logger.error(`Erro no controller ao buscar saque ${id}: ${(error as any).message}`, (error as any).stack);
             throw error;
         }
    }

    // --- NOVO ENDPOINT PARA CONFIGURAR O WEBHOOK NA EFÍ ---
    // ATENÇÃO: Endpoint público e sem segurança para facilitar testes conforme solicitado!
    // NUNCA USE ASSIM EM PRODUÇÃO! Remova ou proteja rigidamente.
    @Post('configure-webhook') // Exemplo de rota para chamar UNICAMENTE para configurar o webhook
    @HttpCode(HttpStatus.OK)
    async configureWebhookEfí(): Promise<any> {
         this.logger.warn('ATENÇÃO: Endpoint configure-webhook chamado (endpoint de TESTE sem segurança)!');
         try {
             const result = await this.efiPixService.configureEfiWebhook();
              return {
                  message: 'Solicitação de configuração de webhook enviada para a Efí.',
                  efiResponse: result // Inclui a resposta da Efí para debug
              };
         } catch (error) {
              // Capturar erros mapeados pelo service (NestJS Exceptions)
              if (error instanceof InternalServerErrorException) {
                   // Se o service lançou um InternalServerError, propaga
                   throw error;
              }
               // Para outros erros não mapeados, loga e lança um InternalServerError genérico
              this.logger.error(`Erro inesperado no controller ao configurar webhook via endpoint: ${(error as any).message}`, (error as any).stack);
              throw new InternalServerErrorException(`Erro interno ao configurar webhook: ${(error as any).message}`);
         }
    }
    // --- Fim NOVO ENDPOINT ---
}