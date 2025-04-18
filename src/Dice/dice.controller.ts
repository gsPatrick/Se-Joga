import { BadRequestException, Controller, Post, Get, Logger, Body, Param, ParseIntPipe, UseGuards, Request, HttpCode, HttpStatus, ParseFloatPipe } from '@nestjs/common';
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
        // Permitir que betNumber seja opcional no Body, mas ParseIntPipe ainda pode causar erro se enviado como string vazia
        // Uma abordagem mais robusta seria usar um DTO com validação opcional ou um Pipe customizado
        @Body('betNumber') rawBetNumber: number | string | null | undefined, // Recebe como raw
        @Body('betAmount', ParseFloatPipe) betAmount: number, // Usar ParseFloatPipe para valores decimais
        // --- MODIFICAÇÃO NO TIPO DE 'type' ---
        @Body('type') type: 'par_escolhido' | 'tripla_escolhida' | 'soma_dupla' | 'soma_tripla' | 'aleatorio_dupla' | 'aleatorio_tripla'
        // --- FIM DA MODIFICAÇÃO ---
    ) {
        const userId = req.user.id;

        // Validação e tratamento do betNumber
        let betNumber: number | null = null;
        const needsBetNumber = ['par_escolhido', 'tripla_escolhida', 'soma_dupla', 'soma_tripla'].includes(type);

        if (needsBetNumber) {
            if (rawBetNumber === null || rawBetNumber === undefined || rawBetNumber === '') {
                 throw new BadRequestException(`O campo 'betNumber' é obrigatório e não pode ser vazio para o tipo de aposta '${type}'.`);
            }
            // Tenta converter para número, tratando NaN
            betNumber = parseInt(String(rawBetNumber), 10);
            if (isNaN(betNumber)) {
                 throw new BadRequestException(`O valor de 'betNumber' (${rawBetNumber}) deve ser um número válido.`);
            }
        } else {
             if (rawBetNumber !== null && rawBetNumber !== undefined) {
                 this.logger.warn(`Campo 'betNumber' (${rawBetNumber}) recebido para o tipo ${type}, mas será ignorado.`);
             }
            betNumber = null; // Garante que é null para tipos aleatórios
        }

        // Validação do betAmount
        if (betAmount <= 0) {
            throw new BadRequestException('O valor da aposta (betAmount) deve ser maior que zero.');
        }

       // -- Removido o check específico para 'aleatorio_dupla', pois a lógica acima já trata --
       // if (betNumber === null && type !== 'aleatorio_dupla' && type !== 'aleatorio_tripla') {
       //  throw new BadRequestException('Você precisa escolher um numero para este tipo de jogada')
       // }

        this.logger.log(`Usuário ${userId} tentando comprar bilhetes para a rodada ${roundId} (Tipo: ${type}, Número: ${betNumber ?? 'N/A'}, Valor: ${betAmount})...`);

        // Passa o betNumber já validado e convertido (ou null)
        return await this.diceService.buyDiceTickets(userId, roundId, { betNumber: betNumber, betAmount, type });
    }

    @Post(':roundId/finalize')
    @HttpCode(HttpStatus.OK) // Retorna 200 OK em vez de 201 Created
        async finalizeDiceRound(@Param('roundId', ParseIntPipe) roundId: number) {
           this.logger.log(`Finalizando rodada ${roundId} (endpoint manual)...`);
           return await this.diceService.finalizeDiceRound(roundId);
      }

      @UseGuards(AuthGuard('jwt'))
    @Get('my/rounds')
    async getRoundsPlayedByUser(@Request() req) { // Nome da função corrigido
      const userId = req.user.id;
      this.logger.log(`Buscando rodadas de dados jogadas pelo usuário ${userId}...`); // Log corrigido
        return await this.diceService.getDiceRoundsPlayedByUser(userId);
    }

        @Get()
        async getRoundsWithDetails() { // Nome da função corrigido
            this.logger.log('Buscando detalhes de todas as rodadas de dados...'); // Log corrigido
            return await this.diceService.getDiceRoundsWithDetails();
        }

        @Get(':roundId')
        async getRoundByIdWithDetails(@Param('roundId', ParseIntPipe) roundId: number) { // Nome da função corrigido
            this.logger.log(`Buscando detalhes da rodada de dado ${roundId}...`); // Log corrigido
          return await this.diceService.getDiceRoundByIdWithDetails(roundId);
        }

        @Get('test-endpoint')
        async testEndpoint(): Promise<null> { // Modifique o tipo de retorno para null
            this.logger.log('Endpoint de teste chamado...');
            return null; // Retorne null
        }

}