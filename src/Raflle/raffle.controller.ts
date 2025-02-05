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
import { Request } from '@nestjs/common';
import { RaffleService } from './raffle.service';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Raffle } from 'src/models/raffle/raffle.model';
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model';

@ApiTags('raffles')
@Controller('raffles')
export class RaffleController {
private readonly logger = new Logger(RaffleController.name);

constructor(private readonly raffleService: RaffleService) {}

@Post('system')
  @ApiOperation({ summary: 'Cria uma rifa tradicional do sistema' })
  @ApiResponse({ status: 201, description: 'Rifa tradicional criada com sucesso', type: Raffle})
  async createSystemRaffle(): Promise<Raffle> {
    this.logger.log('Criando rifa do sistema...');
    return await this.raffleService.createSystemRaffle();
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':raffleId/buy-tickets')
      @ApiOperation({ summary: 'Comprar bilhetes específicos para uma rifa' })
     @ApiBearerAuth()
      @ApiBody({
          schema:{
              type: 'object',
              properties:{
                  ticketNumbers: {
                    type: 'array',
                      items: {
                          type: 'string'
                      }
                  },
                  type: {
                      type: 'string',
                      enum: ['tradicional', 'equipes']
                  }
              }
          }
      })
      @ApiResponse({ status: 201, description: 'Bilhetes comprados com sucesso', type: [RaffleTicket] })
      @ApiResponse({ status: 400, description: 'Dados inválidos' })
      @ApiResponse({ status: 404, description: 'Rifa não encontrada' })
  async buyRaffleTickets(
      @Param('raffleId', ParseIntPipe) raffleId: number,
      @Request() req,
      @Body('ticketNumbers') ticketNumbers: string[],
      @Body('type') type: 'tradicional' | 'equipes' = 'tradicional',
  ): Promise<RaffleTicket[]> {
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
  @ApiOperation({ summary: 'Comprar bilhetes aleatórios para uma rifa' })
     @ApiBearerAuth()
       @ApiBody({
          schema:{
              type: 'object',
              properties:{
                quantity: {
                   type: 'number'
                },
                type: {
                      type: 'string',
                      enum: ['tradicional', 'equipes']
                  }
              }
          }
      })
  @ApiResponse({ status: 201, description: 'Bilhetes comprados com sucesso', type: [RaffleTicket]})
   @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 404, description: 'Rifa não encontrada' })
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
  @ApiOperation({ summary: 'Lista todas as rifas com seus detalhes' })
  @ApiResponse({ status: 200, description: 'Retorna todas as rifas.', type: [Raffle] })
  async getRafflesWithDetails(): Promise<Raffle[]> {
    this.logger.log('Buscando detalhes de todas as rifas...');
    return await this.raffleService.getRafflesWithDetails();
  }
  
   @Post(':raffleId/finalize')
      @ApiOperation({ summary: 'Finaliza manualmente uma rifa tradicional' })
   @ApiResponse({ status: 200, description: 'Rifa finalizada com sucesso.', type: Raffle})
   @ApiResponse({ status: 404, description: 'Rifa não encontrada'})
      @HttpCode(HttpStatus.OK)
  async finalizeRaffle(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<Raffle> {
    this.logger.log(`Finalizando rifa ${raffleId} (endpoint manual)...`);
    return await this.raffleService.finalizeRaffle(raffleId);
  }
   @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles')
    @ApiOperation({ summary: 'Lista todas as rifas jogadas pelo usuário'})
      @ApiResponse({ status: 200, description: 'Lista das rifas jogadas.', type: [Object]})
   @ApiBearerAuth()
  async getRafflesPlayedByUser(@Request() req): Promise<any[]> { // Correto: @Request() sem o 'new'
    const userId = req.user.id;
    this.logger.log(`Buscando rifas jogadas pelo usuário ${userId}...`);
    const raffles = await this.raffleService.getRafflesPlayedByUser(userId);
    return  raffles;
  }

   @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/won')
    @ApiOperation({ summary: 'Lista todas as rifas ganhas pelo usuário'})
      @ApiResponse({ status: 200, description: 'Lista das rifas ganhas.', type: [Object]})
   @ApiBearerAuth()
  async getWonRafflesByUser(@Request() req): Promise<any[]> { // Correto: @Request() sem o 'new'
    const userId = req.user.id;
    this.logger.log(`Buscando rifas ganhas pelo usuário ${userId}...`);
    const raffles = await this.raffleService.getWonRafflesByUser(userId);
       return  raffles;
  }

   @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/lost')
      @ApiOperation({ summary: 'Lista todas as rifas perdidas pelo usuário'})
     @ApiResponse({ status: 200, description: 'Lista das rifas perdidas.', type: [Object]})
  @ApiBearerAuth()
  async getLostRafflesByUser(@Request() req): Promise<any[]> { // Correto: @Request() sem o 'new'
    const userId = req.user.id;
    this.logger.log(`Buscando rifas perdidas pelo usuário ${userId}...`);
    const raffles = await this.raffleService.getLostRafflesByUser(userId);
    return this.formatRafflesResponse(raffles);
  }

  // Função auxiliar para formatar a resposta (igual ao getRafflesWithDetails)
  private formatRafflesResponse(raffles: Raffle[]): any[] {
    return raffles.map((raffle) => {
      let winningTicketInfo: {
        ticketNumber: any;
        numberId: any;
        dezena: any;
        generatedNumber: any;
        sequence: any;
        seed: any;
        hash: any;
        hashTimestamp: any;
      } | null = null;
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
        tickets: this.raffleService.formatRaffleTickets(raffle),
        createdAt: raffle.createdAt,
        updatedAt: raffle.updatedAt,
      };
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/data')
  @ApiOperation({ summary: 'Lista todos os dados relacionados a rifas do usuário' })
   @ApiResponse({ status: 200, description: 'Retorna todos os dados do usuário', type: Object })
  @ApiBearerAuth()
  async getUserRaffleData(@Request() req) {
    const userId = req.user.id;
    this.logger.log(`Buscando todos os dados do usuário ${userId} relacionados à rifas...`);
    return await this.raffleService.getUserRaffleData(userId);
  }

    @Post('team/system')
  @ApiOperation({ summary: 'Cria uma rifa de equipes do sistema' })
   @ApiResponse({ status: 201, description: 'Rifa de equipes criada com sucesso', type: Raffle })
    async createSystemTeamRaffle(): Promise<Raffle> {
        this.logger.log('Criando rifa de equipes do sistema...');
        return await this.raffleService.createTeamRaffle();
    }

   @Post(':raffleId/finalize-team')
      @ApiOperation({ summary: 'Finaliza manualmente uma rifa de equipes' })
    @ApiResponse({ status: 200, description: 'Rifa de equipe finalizada com sucesso', type: Raffle })
       @ApiResponse({ status: 404, description: 'Rifa não encontrada' })
    @HttpCode(HttpStatus.OK)
    async finalizeTeamRaffle(@Param('raffleId', ParseIntPipe) raffleId: number) : Promise<Raffle> {
        this.logger.log(`Finalizando rifa de equipes ${raffleId} (endpoint manual)...`);
        return await this.raffleService.finalizeTeamRaffle(raffleId);
    }

  @Get(':raffleId/teams')
    @ApiOperation({ summary: 'Lista as equipes de uma rifa específica' })
    @ApiResponse({ status: 200, description: 'Retorna os times da rifa.' })
    async getRaffleTeams(@Param('raffleId', ParseIntPipe) raffleId: number) {
        this.logger.log(`Buscando equipes da rifa ${raffleId}...`);
        return await this.raffleService.getRaffleTeams(raffleId);
    }
      
@Get(':raffleId/teams-with-availability')
  @ApiOperation({ summary: 'Busca as equipes com os bilhetes disponíveis e seus compradores.' })
  @ApiResponse({ status: 200, description: 'Lista de equipes e bilhetes disponíveis.' })
    async getRaffleTeamsWithAvailability(@Param('raffleId', ParseIntPipe) raffleId: number) {
        this.logger.log(`Buscando equipes da rifa ${raffleId} com disponibilidade...`);
        return await this.raffleService.getRaffleTeamsWithAvailability(raffleId);
    }  
}