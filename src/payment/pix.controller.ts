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
            return await this.efiPixService.createDepositCharge(userId, createDepositDto.amount);
        } catch (error) {
            this.logger.error(`Error no controller ao solicitar depósito para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
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
            return await this.efiPixService.requestWithdrawal(userId, requestWithdrawalDto.amount, {
                keyType: requestWithdrawalDto.pixKeyType,
                keyValue: requestWithdrawalDto.pixKeyValue,
                name: requestWithdrawalDto.name,
                cpfCnpj: requestWithdrawalDto.cpfCnpj,
            });
        } catch (error) {
            this.logger.error(`Error no controller ao solicitar saque para usuário ${userId}: ${(error as any).message}`, (error as any).stack);
            throw error;
        }
    }

    @Post('webhook/:webhookSecret/pix')
    @HttpCode(HttpStatus.OK)
    async handleEfiWebhook(
        @Param('webhookSecret') webhookSecret: string,
        @Body() efiPayload: any,
        @Req() req: Request,
        // @Headers('X-Gerencianet-Signature') signatureHeader?: string,
        // @Query('hmac') hmac?: string
    ): Promise<string> {
        this.logger.log(`Webhook da Efí recebido na rota /pix/webhook/${webhookSecret}/pix`);

        const expectedWebhookSecret = this.configService.get<string>('EFI_WEBHOOK_SECRET');

        if (!expectedWebhookSecret || webhookSecret !== expectedWebhookSecret) {
            this.logger.warn(`Tentativa de acesso não autorizado ao webhook. Segredo na URL: "${webhookSecret}", Segredo esperado: "${expectedWebhookSecret}". IP Origem: ${req.ip}. Ignorando payload.`);
            return 'OK - Invalid Secret';
        }
        this.logger.debug('Webhook Secret validado com sucesso.');

        const rawBody = (req as any).rawBody;
        const clientIp = req.ip;

        try {
            await this.efiPixService.handleWebhook(efiPayload, rawBody, clientIp);

            return 'OK';
        } catch (error) {
            this.logger.error(`Error no controlador ao processar webhook da Efí APÓS validação de segredo: ${(error as any).message}`, (error as any).stack);
            return 'OK - Internal Error';
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
            this.logger.error(`Error no controller ao buscar depósito ${id}: ${(error as any).message}`, (error as any).stack);
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
            this.logger.error(`Error no controller ao buscar saque ${id}: ${(error as any).message}`, (error as any).stack);
            throw error;
        }
    }

    @Post('configure-webhook')
    @HttpCode(HttpStatus.OK)
    async configureWebhookEfí(): Promise<any> {
        this.logger.warn('ATENÇÃO: Endpoint configure-webhook chamado (endpoint de TESTE sem segurança)!');
        try {
            const result = await this.efiPixService.configureEfiWebhook();
            return {
                message: 'Solicitação de configuração de webhook enviada para a Efí.',
                efiResponse: result
            };
        } catch (error) {
            if (error instanceof InternalServerErrorException || error instanceof BadRequestException ||
                error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof ConflictException) {
                throw error;
            }
            if ((error as any).isNetworkOrTlsError) {
                throw error;
            }
            this.logger.error(`Error inesperado no controller ao configurar webhook via endpoint: ${(error as any).message}`, (error as any).stack);
            throw new InternalServerErrorException(`Error interno ao configurar webhook: ${(error as any).message}`);
        }
    }
}