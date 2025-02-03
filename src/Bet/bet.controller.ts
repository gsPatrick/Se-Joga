import { Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { BetService } from './bet.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('bet')
export class BetController {
    private readonly logger = new Logger(BetController.name);

    constructor(private readonly betService: BetService) { }

      @UseGuards(AuthGuard('jwt'))
      @Post('round/system')
    async createBetGameRound(@Request() req) {
         const userId = req.user.id;
      this.logger.log(`Criando rodada de bet do sistema para o usuário ${userId}...`);
      return await this.betService.createBetGameRound(userId);
    }

     @UseGuards(AuthGuard('jwt'))
        @Post(':roundId/buy-bet')
        async buyBet(
            @Param('roundId', ParseIntPipe) roundId: number,
            @Request() req,
            @Body('market') market: string,
             @Body('chosenNumber') chosenNumber: string,
             @Body('betAmount', ParseIntPipe) betAmount: number,
              @Body('odd', ParseIntPipe) odd: number,
        ) {
            const userId = req.user.id;
            this.logger.log(`Usuário ${userId} comprando bilhetes para a rodada ${roundId}...`);
            return await this.betService.buyBet(userId, roundId, { market,chosenNumber, betAmount, odd });
        }

  @Post(':roundId/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeBetGameRound(@Param('roundId', ParseIntPipe) roundId: number) {
      this.logger.log(`Finalizando rodada de bet ${roundId} (endpoint manual)...`);
      return await this.betService.finalizeBetGameRound(roundId);
  }
   
    @UseGuards(AuthGuard('jwt'))
    @Get('my/rounds')
    async getBetRoundsPlayedByUser(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Buscando rodadas de bet do usuário ${userId}...`);
        return await this.betService.getBetRoundsPlayedByUser(userId);
    }

    @Get()
    async getBetRoundsWithDetails() {
      this.logger.log('Buscando detalhes de todas as rodadas de bet...');
      return await this.betService.getBetRoundsWithDetails();
    }

    @Get(':roundId')
    async getBetRoundByIdWithDetails(@Param('roundId', ParseIntPipe) roundId: number) {
      this.logger.log(`Buscando detalhes da rodada ${roundId}...`);
      return await this.betService.getBetRoundByIdWithDetails(roundId);
    }

}