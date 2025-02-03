import { BadRequestException, Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { DiceService } from './dice.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('dice')
export class DiceController {
    private readonly logger = new Logger(DiceController.name);

    constructor(private readonly diceService: DiceService) { }

    @UseGuards(AuthGuard('jwt'))
    @Post('round')
    async createDiceRound(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Criando rodada de dado para o usuário ${userId}...`);
        return await this.diceService.createDiceRound(userId);
    }
    
     @UseGuards(AuthGuard('jwt'))
    @Post(':roundId/buy-tickets')
    async buyDiceTickets(
        @Param('roundId', ParseIntPipe) roundId: number,
        @Request() req,
        @Body('betNumber', ParseIntPipe) betNumber: number | null,
        @Body('betAmount', ParseIntPipe) betAmount: number,
        @Body('type') type: 'dupla' | 'tripla'
    ) {
        const userId = req.user.id;
       if (betNumber === null && type !== 'dupla') {
        throw new BadRequestException('Para a jogada tripla você precisa escolher um numero')
       }
        this.logger.log(`Usuário ${userId} tentando comprar bilhetes para a rodada ${roundId}...`);
        return await this.diceService.buyDiceTickets(userId, roundId, { betNumber: betNumber || 0, betAmount, type });
    }

    @Post(':roundId/finalize')
    @HttpCode(HttpStatus.OK) // Retorna 200 OK em vez de 201 Created
        async finalizeDiceRound(@Param('roundId', ParseIntPipe) roundId: number) {
           this.logger.log(`Finalizando rodada ${roundId} (endpoint manual)...`);
           return await this.diceService.finalizeDiceRound(roundId);
      }

      @UseGuards(AuthGuard('jwt'))
    @Get('my/rounds')
    async getRafflesPlayedByUser(@Request() req) { // Correto: @Request() sem o 'new'
      const userId = req.user.id;
      this.logger.log(`Buscando rifas jogadas pelo usuário ${userId}...`);
        return await this.diceService.getDiceRoundsPlayedByUser(userId);
    }

        @Get()
        async getRafflesWithDetails() {
            this.logger.log('Buscando detalhes de todas as rodadas...');
            return await this.diceService.getDiceRoundsWithDetails();
        }
    
        @Get(':roundId')
        async getRaffleByIdWithDetails(@Param('roundId', ParseIntPipe) roundId: number) {
            this.logger.log(`Buscando detalhes da rodada ${roundId}...`);
          return await this.diceService.getDiceRoundByIdWithDetails(roundId);
        }
}