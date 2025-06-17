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
        // --- ADIÇÃO IMPORTANTE AQUI ---
        // Campo opcional para o palpite do Jackpot, conforme a documentação.
        @Body('palpiteJackpot', new ParseIntPipe({ optional: true })) palpiteJackpot?: number,
    ) {
        const userId = req.user.id;
        this.logger.log(`Usuário ${userId} comprando aposta para rodada ${roundId} com valor ${betAmount} e palpite de jackpot ${palpiteJackpot || 'N/A'}...`);
        
        // Passa o objeto completo para o serviço, incluindo o novo palpite.
        return await this.cacaNiquelService.buyBet(userId, roundId, { 
            betAmount, 
            principalSymbol, 
            secondarySymbol,
            palpiteJackpot // palpiteJackpot será undefined se não for enviado, o que é ok.
        });
    }

    @Post(':roundId/finalize') // Endpoint manual para testes/admin
    @HttpCode(HttpStatus.OK)
    async finalizeCacaNiquelRound(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.warn(`Endpoint de finalização manual chamado para a rodada ${roundId}. Isso não é mais necessário no fluxo normal do jogo.`);
        // Este método foi mantido para fins de teste, mas a lógica de finalização agora está no `buyBet`.
        // A implementação no service para este método pode ser removida ou adaptada no futuro.
        // return await this.cacaNiquelService.finalizeCacaNiquelRound(roundId);
        return { message: "Endpoint de finalização manual. A finalização agora é automática no 'buy-bet'." };
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