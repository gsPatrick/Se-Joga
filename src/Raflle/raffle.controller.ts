// raffle.controller.ts
import {
    Controller,
    Post,
    Logger,
    Body,
    Param,
    ParseIntPipe,
    Get,
    HttpCode,
    HttpStatus,
    UseGuards,
  } from '@nestjs/common';
  import { Request } from '@nestjs/common'; // Correto
  import { RaffleService } from './raffle.service';
import { AuthGuard } from '@nestjs/passport';


  
@Controller('raffles')
export class RaffleController {
  private readonly logger = new Logger(RaffleController.name);

  constructor(private readonly raffleService: RaffleService) {}
  
    @Post('system')
    async createSystemRaffle() {
      this.logger.log('Criando rifa do sistema...');
      return await this.raffleService.createSystemRaffle();
    }
  
    // Endpoint para comprar bilhetes (SEM PROTEÇÃO)
    @UseGuards(AuthGuard('jwt'))
    @Post(':raffleId/buy-tickets')
    async buyRaffleTickets(
        @Param('raffleId', ParseIntPipe) raffleId: number,
        @Request() req,
        @Body('ticketNumbers') ticketNumbers: string[],
        @Body('type') type: 'tradicional' | 'equipes' = 'tradicional'
    ) {
        const userId = req.user.id;
        this.logger.log(
        `Usuário ${userId} tentando comprar os bilhetes ${ticketNumbers.join(
            ', ',
        )} para a rifa ${raffleId} do tipo ${type}...`,
        );
        return await this.raffleService.buyRaffleTickets(
        userId,
        raffleId,
        { type, quantityOrNumbers: ticketNumbers },
        );
    }

    @UseGuards(AuthGuard('jwt'))
    @Post(':raffleId/buy-random')
    async buyRandomRaffleTickets(
        @Param('raffleId', ParseIntPipe) raffleId: number,
        @Request() req,
        @Body('quantity', ParseIntPipe) quantity: number,
        @Body('type') type: 'tradicional' | 'equipes' = 'tradicional',
    ) {
        const userId = req.user.id;
        this.logger.log(
        `Usuário ${userId} tentando comprar ${quantity} bilhetes aleatórios para a rifa ${raffleId} do tipo ${type}...`,
        );
        return await this.raffleService.buyRaffleTickets(userId, raffleId, { type, quantityOrNumbers: quantity });
    }


    @Get()
    async getRafflesWithDetails() {
      this.logger.log('Buscando detalhes de todas as rifas...');
      return await this.raffleService.getRafflesWithDetails();
    }

    @Post(':raffleId/finalize')
    @HttpCode(HttpStatus.OK) // Retorna 200 OK em vez de 201 Created
    async finalizeRaffle(@Param('raffleId', ParseIntPipe) raffleId: number) {
      this.logger.log(`Finalizando rifa ${raffleId} (endpoint manual)...`);
      return await this.raffleService.finalizeRaffle(raffleId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('my/raffles')
    async getRafflesPlayedByUser(@Request() req) { // Correto: @Request() sem o 'new'
      const userId = req.user.id;
      this.logger.log(`Buscando rifas jogadas pelo usuário ${userId}...`);
      const raffles = await this.raffleService.getRafflesPlayedByUser(userId);
      return this.formatRafflesResponse(raffles);
    }
  
    @UseGuards(AuthGuard('jwt'))
    @Get('my/raffles/won')
    async getWonRafflesByUser(@Request() req) { // Correto: @Request() sem o 'new'
      const userId = req.user.id;
      this.logger.log(`Buscando rifas ganhas pelo usuário ${userId}...`);
      const raffles = await this.raffleService.getWonRafflesByUser(userId);
      return this.formatRafflesResponse(raffles);
    }
  
    @UseGuards(AuthGuard('jwt'))
    @Get('my/raffles/lost')
    async getLostRafflesByUser(@Request() req) { // Correto: @Request() sem o 'new'
      const userId = req.user.id;
      this.logger.log(`Buscando rifas perdidas pelo usuário ${userId}...`);
      const raffles = await this.raffleService.getLostRafflesByUser(userId);
      return this.formatRafflesResponse(raffles);
    }
  
    // Função auxiliar para formatar a resposta (igual ao getRafflesWithDetails)
    private formatRafflesResponse(raffles: any[]): any[] {
      return raffles.map((raffle) => {
        let winningTicketInfo = null;
        if (raffle.raffleNumbers && raffle.raffleNumbers.length > 0) {
          const generatedNumber = raffle.raffleNumbers[0].generatedNumber;
          const seed = generatedNumber ? generatedNumber.seed : null;
          const blockchainHash = seed ? seed.blockchainHash : null;
    
          winningTicketInfo = {
            ticketNumber: raffle.winningTicket,
            numberId: generatedNumber ? generatedNumber.id : null,
            dezena: generatedNumber
              ? generatedNumber.number.toString().slice(-2)
              : null,
            generatedNumber: generatedNumber ? generatedNumber.number : null,
            sequence: generatedNumber ? generatedNumber.sequence : null,
            seed: seed ? seed.seed : null,
            hash: blockchainHash ? blockchainHash.hash : null,
            hashTimestamp: blockchainHash ? blockchainHash.timestamp : null,
          };
        }
    
        return {
          id: raffle.id,
          raffleIdentifier: raffle.raffleIdentifier,
          createdBy: raffle.createdByUser
            ? {
                id: raffle.createdByUser.id,
                name: raffle.createdByUser.name,
                email: raffle.createdByUser.email,
              }
            : null,
          winner: raffle.winnerUser
            ? {
                id: raffle.winnerUser.id,
                name: raffle.winnerUser.name,
                email: raffle.winnerUser.email,
              }
            : null,
          title: raffle.title,
          description: raffle.description,
          ticketPrice: raffle.ticketPrice,
          totalTickets: raffle.totalTickets,
          soldTickets: raffle.soldTickets,
          startDate: raffle.startDate,
          endDate: raffle.endDate,
          drawDate: raffle.drawDate,
          finished: raffle.finished,
          winningTicket: winningTicketInfo,
          tickets: raffle.tickets.map((ticket) => ({
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            createdAt: ticket.createdAt,
          })),
          createdAt: raffle.createdAt,
          updatedAt: raffle.updatedAt,
        };
      });
      }

      @UseGuards(AuthGuard('jwt'))
      @Get('my/data')
      async getUserRaffleData(@Request() req) {
        const userId = req.user.id;
        this.logger.log(`Buscando todos os dados do usuário ${userId} relacionados à rifas...`);
        return await this.raffleService.getUserRaffleData(userId);
      }

      @Post('team/system')
      async createSystemTeamRaffle() {
          this.logger.log('Criando rifa de equipes do sistema...');
          return await this.raffleService.createTeamRaffle();
      }
  
      @Post(':raffleId/finalize-team')
      @HttpCode(HttpStatus.OK)
      async finalizeTeamRaffle(@Param('raffleId', ParseIntPipe) raffleId: number) {
          this.logger.log(`Finalizando rifa de equipes ${raffleId} (endpoint manual)...`);
          return await this.raffleService.finalizeTeamRaffle(raffleId);
      }

      @Get(':raffleId/teams')
      async getRaffleTeams(@Param('raffleId', ParseIntPipe) raffleId: number) {
          this.logger.log(`Buscando equipes da rifa ${raffleId}...`);
          return await this.raffleService.getRaffleTeams(raffleId);
      }  

}