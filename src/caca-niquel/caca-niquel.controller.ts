// src/caca-niquel/caca-niquel.controller.ts
import { Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { CacaNiquelService } from './caca-niquel.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('caca-niquel')
export class CacaNiquelController {
    private readonly logger = new Logger(CacaNiquelController.name);

    constructor(private readonly cacaNiquelService: CacaNiquelService) { }

    @UseGuards(AuthGuard('jwt'))
    @Post('round')
    async createCacaNiquelRound(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Criando rodada de caça-níquel para o usuário ${userId}...`);
        return await this.cacaNiquelService.createCacaNiquelRound(userId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post(':roundId/buy-bet')
    async buyBet(
        @Param('roundId', ParseIntPipe) roundId: number,
        @Request() req,
        @Body('betAmount', ParseIntPipe) betAmount: number,
        @Body('principalSymbol') principalSymbol: string,
        @Body('secondarySymbol') secondarySymbol: string,
    ) {
        const userId = req.user.id;
        this.logger.log(`Usuário ${userId} comprando aposta para rodada ${roundId} com valor ${betAmount}...`);
        return await this.cacaNiquelService.buyBet(userId, roundId, { betAmount, principalSymbol, secondarySymbol });
    }

    @Post(':roundId/finalize') // Endpoint manual para testes/admin - Remova @UseGuards(AuthGuard('jwt')) se for para uso interno
    @HttpCode(HttpStatus.OK)
    async finalizeCacaNiquelRound(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.log(`Finalizando rodada de caça-níquel ${roundId} (endpoint manual)...`);
        return await this.cacaNiquelService.finalizeCacaNiquelRound(roundId);
    }

    @Get('pay-table')
    getPayTable() {
        this.logger.log('Buscando a tabela de pagamentos do caça-níquel...');
        return this.cacaNiquelService.getPayTable();
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('my/rounds')
    async getCacaNiquelRoundsPlayedByUser(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Buscando rodadas de caça-níquel jogadas pelo usuário ${userId}...`);
        return await this.cacaNiquelService.getCacaNiquelRoundsPlayedByUser(userId);
    }

    @Get()
    async getCacaNiquelRoundsWithDetails() {
        this.logger.log('Buscando detalhes de todas as rodadas de caça-níquel...');
        return await this.cacaNiquelService.getCacaNiquelRoundsWithDetails();
    }

    @Get(':roundId')
    async getCacaNiquelRoundByIdWithDetails(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.log(`Buscando detalhes da rodada ${roundId} de caça-níquel...`);
        return await this.cacaNiquelService.getCacaNiquelRoundByIdWithDetails(roundId);
    }
}