import { Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { RouletteService } from './roulette.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('roulette')
export class RouletteController {
    private readonly logger = new Logger(RouletteController.name);

    constructor(private readonly rouletteService: RouletteService) { }

     @UseGuards(AuthGuard('jwt'))
      @Post('round/system')
    async createRouletteRound(@Request() req, @Body('type') type: 'banca' | 'sala' = 'banca') {
         const userId = req.user.id;
        this.logger.log(`Criando rodada de roleta para o usuário ${userId}...`);
      return await this.rouletteService.createRouletteRound(userId,type);
  }

     @UseGuards(AuthGuard('jwt'))
        @Post(':roundId/buy-bet')
        async buyBet(
            @Param('roundId', ParseIntPipe) roundId: number,
            @Request() req,
           @Body('betType') betType: string,
            @Body('betChoice') betChoice: string,
             @Body('betAmount', ParseIntPipe) betAmount: number,
            @Body('betNumber') betNumber: number,
           @Body('betColor') betColor: string,
           @Body('betColumn') betColumn: number,
        ) {
            const userId = req.user.id;
           this.logger.log(`Usuário ${userId} fazendo uma aposta para a rodada ${roundId} no mercado ${betType} com o valor ${betAmount}...`);
           return await this.rouletteService.buyBet(userId, roundId, { betType, betChoice, betAmount, betNumber, betColor, betColumn });
        }
    @Post(':roundId/finalize')
    @HttpCode(HttpStatus.OK)
    async finalizeRouletteRound(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.log(`Finalizando rodada da roleta ${roundId} (endpoint manual)...`);
      return await this.rouletteService.finalizeBetGameRound(roundId);
  }

     @UseGuards(AuthGuard('jwt'))
     @Get('my/rounds')
        async getRouletteRoundsPlayedByUser(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Buscando as rodadas da roleta jogadas pelo usuário ${userId}...`);
      return await this.rouletteService.getRouletteRoundsPlayedByUser(userId);
   }
    @Get()
    async getBetRoundsWithDetails() {
      this.logger.log('Buscando detalhes de todas as rodadas de bet...');
      return await this.rouletteService.getBetRoundsWithDetails();
    }
    
     @Get(':roundId')
        async getBetRoundByIdWithDetails(@Param('roundId', ParseIntPipe) roundId: number) {
          this.logger.log(`Buscando detalhes da rodada ${roundId}...`);
            return await this.rouletteService.getBetRoundByIdWithDetails(roundId);
        }
}