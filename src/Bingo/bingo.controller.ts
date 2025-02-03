import { Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { BingoService } from './bingo.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('bingo')
export class BingoController {
    private readonly logger = new Logger(BingoController.name);

    constructor(private readonly bingoService: BingoService) { }

      @UseGuards(AuthGuard('jwt'))
      @Post('round/system')
    async createBingoGame(@Request() req, @Body('type') type: 'user' | 'machine' = 'user' ) {
         const userId = req.user.id;
          this.logger.log(`Criando partida de bingo para o usuário ${userId}...`);
        return await this.bingoService.createBingoGame(userId);
      }
  
    @UseGuards(AuthGuard('jwt'))
      @Post(':gameId/buy-cards')
      async buyBingoCards(
          @Param('gameId', ParseIntPipe) gameId: number,
            @Request() req,
          @Body('cardType') cardType: '3x3' | '5x5',
            @Body('numberOfCards', ParseIntPipe) numberOfCards: number,
             @Body('type') type:  'user'| 'machine' = 'user'
      ) {
        const userId = req.user.id;
         this.logger.log(`Usuário ${userId} comprando ${numberOfCards} cartelas do tipo ${cardType} na partida ${gameId}...`);
        return await this.bingoService.buyBingoCards(userId, gameId, { cardType, numberOfCards }, type);
      }
    
    @Post(':roundId/finalize')
    @HttpCode(HttpStatus.OK)
      async finalizeBingoRound(@Param('roundId', ParseIntPipe) roundId: number) {
        this.logger.log(`Finalizando partida de bingo ${roundId} (endpoint manual)...`);
        return await this.bingoService.finalizeBingoRound(roundId);
     }

    @UseGuards(AuthGuard('jwt'))
    @Get('my/rounds')
      async getBingoGamesPlayedByUser(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Buscando as rodadas de bingo jogadas pelo usuário ${userId}...`);
         return await this.bingoService.getBingoGamesPlayedByUser(userId);
      }
        
    @Get()
    async getBingoGamesWithDetails() {
      this.logger.log('Buscando detalhes de todas as partidas de bingo...');
      return await this.bingoService.getBingoGamesWithDetails();
    }
        
    @Get(':gameId')
        async getBingoGameByIdWithDetails(@Param('gameId', ParseIntPipe) gameId: number) {
           this.logger.log(`Buscando detalhes da partida ${gameId}...`);
          return await this.bingoService.getBingoGameByIdWithDetails(gameId);
        }
}