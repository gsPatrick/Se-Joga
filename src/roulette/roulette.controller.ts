// src/roulette/roulette.controller.ts
import {
    Controller,
    Post,
    UseGuards,
    Request,
    Logger,
    HttpStatus,
    HttpCode,
    Body,
    Param,
    ParseIntPipe,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { RouletteService } from './roulette.service';
  import { CreateRouletteBetDto } from './dto/create-roulette-bet.dto';
  
  @Controller('roulette')
  @UseGuards(AuthGuard('jwt'))
  export class RouletteController {
    private readonly logger = new Logger(RouletteController.name);
  
    constructor(private readonly rouletteService: RouletteService) {}
  
    @Post('round/start')
    @HttpCode(HttpStatus.CREATED)
    async createRouletteRound(@Request() req) {
      const userId = req.user.id;
      this.logger.log(
        `Usuário ${userId} iniciando nova rodada de roleta (contra a banca)...`,
      );
      const round = await this.rouletteService.createRouletteRound(userId);
      return { message: 'Rodada de roleta iniciada com sucesso.', round };
    }
  
    @Post('round/:roundId/bet')
    async placeBet(
      @Param('roundId', ParseIntPipe) roundId: number,
      @Request() req,
      @Body() betData: CreateRouletteBetDto,
    ) {
      const userId = req.user.id;
      this.logger.log(
        `Usuário ${userId} tentando fazer aposta na rodada ${roundId}...`,
      );
      const bet = await this.rouletteService.placeBet(userId, roundId, betData);
      return { message: 'Aposta feita com sucesso.', bet };
    }
  }