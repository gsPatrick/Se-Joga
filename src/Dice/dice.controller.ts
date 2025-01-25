// src/dice/dice.controller.ts
import {
    Controller,
    Post,
    UseGuards,
    Request,
    Body,
    Logger,
    BadRequestException,
    ParseIntPipe,
    Get,
    Query,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { DiceService } from './dice.service';
  
  @Controller('dice')
  @UseGuards(AuthGuard('jwt'))
  export class DiceController {
    private readonly logger = new Logger(DiceController.name);
  
    constructor(private readonly diceService: DiceService) {}
  
    @Post('play')
  async playDice(
    @Request() req,
    @Body('bet', ParseIntPipe) bet: number, // Use ParseIntPipe
    @Body('chosenNumber', ParseIntPipe) chosenNumber: number, // Use ParseIntPipe
  ) {
    const userId = req.user.id;
    this.logger.log(
      `Usuário ${userId} está jogando o dado. Aposta: ${bet}, Número escolhido: ${chosenNumber}`,
    );

    // Validações adicionais (já estão sendo feitas no service, mas é bom ter uma validação extra no controller)
    if (bet <= 0) {
        throw new BadRequestException('A aposta deve ser maior que zero.');
    }
    if (chosenNumber < 1 || chosenNumber > 6) {
        throw new BadRequestException('O número escolhido deve ser um inteiro entre 1 e 6.');
    }

    try {
      const result = await this.diceService.playDice(
        userId,
        bet,
        chosenNumber,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Erro ao jogar dado para o usuário ${userId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

    @Get('my-games')
    async getDiceGamesByUser(
      @Request() req,
      @Query('filter') filter: 'all' | 'won' | 'lost' = 'all',
    ) {
      const userId = req.user.id;
      this.logger.log(`Buscando jogos de dado do usuário ${userId}...`);
      const games = await this.diceService.getDiceGamesByUser(userId, filter);
      return games;
    }
    
  }