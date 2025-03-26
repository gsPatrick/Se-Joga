// src/poker/poker.controller.ts
import { Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { PokerService } from './poker.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('poker')
export class PokerController {
    private readonly logger = new Logger(PokerController.name);

    constructor(private readonly pokerService: PokerService) { }

    @UseGuards(AuthGuard('jwt'))
    @Post('round/system')
    async createPokerRound(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Criando rodada de poker para o usuário ${userId}...`);
        return await this.pokerService.createPokerRound(userId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post(':roundId/setup-players')
    async setupPlayersAndDealCards(
        @Param('roundId', ParseIntPipe) roundId: number,
        @Request() req,
    ) {
        const userId = req.user.id;
        this.logger.log(`Configurando jogadores e distribuindo cartas para a rodada ${roundId} pelo usuário ${userId}...`);
        return await this.pokerService.setupPlayersAndDealCards(roundId, userId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post(':roundId/player/:playerId/bet')
    async playerBet(
        @Param('roundId', ParseIntPipe) roundId: number,
        @Param('playerId', ParseIntPipe) playerId: number,
        @Body('betType') betType: string, // 'CALL_1X', 'CALL_2X', 'CALL_3X', 'FOLD', 'ALL_WIN'
        @Request() req,
    ) {
        this.logger.log(`Jogador ${playerId} fazendo aposta do tipo ${betType} na rodada ${roundId}...`);
        return await this.pokerService.playerBet(roundId, playerId, betType);
    }

    @UseGuards(AuthGuard('jwt'))
    @Post(':roundId/player/:playerId/fold')
    async playerFold(
        @Param('roundId', ParseIntPipe) roundId: number,
        @Param('playerId', ParseIntPipe) playerId: number,
        @Request() req,
    ) {
        this.logger.log(`Jogador ${playerId} desistindo (fold) da rodada ${roundId}...`);
        return await this.pokerService.playerFold(roundId, playerId);
    }

    @Post(':roundId/finalize')
    @HttpCode(HttpStatus.OK)
    async finalizeRound(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.log(`Finalizando rodada de poker ${roundId} (endpoint manual)...`);
        return await this.pokerService.finalizeRound(roundId);
    }

    @Get(':roundId/details')
    async getPokerRoundDetails(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.log(`Buscando detalhes da rodada de poker ${roundId}...`);
        return await this.pokerService.getPokerRoundDetails(roundId);
    }
}