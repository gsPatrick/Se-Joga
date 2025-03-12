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
  InternalServerErrorException,
  Query,
  BadRequestException, // Importe Query
  Request,
} from '@nestjs/common';
import { RaffleService } from './raffle.service';
import { AuthGuard } from '@nestjs/passport';
import { Raffle } from 'src/models/raffle/raffle.model';
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model'

@Controller('raffles')
export class RaffleController {
  private readonly logger = new Logger(RaffleController.name);

  constructor(private readonly raffleService: RaffleService) {}

  @Post('system')
  async createSystemRaffle(@Body('ticketPrice') ticketPrice: number): Promise<Raffle> {
    this.logger.log(`Criando rifa do sistema com preço: R$ ${ticketPrice.toFixed(2)}...`);
    return await this.raffleService.createSystemRaffle(ticketPrice);
  }

  @Post('team')
  @UseGuards(AuthGuard('jwt'))
  async createTeamRaffle(@Request() req: any, @Body('ticketPrice') ticketPrice: number): Promise<Raffle> {
    try {
      const userId = req.user.id; // Obtém o ID do usuário autenticado
      const newRaffle = await this.raffleService.createTeamRaffle(ticketPrice);
      return newRaffle;
    } catch (error) {
      // Trate o erro adequadamente (ex: retorne um erro 500)
      console.error(error);
      throw new InternalServerErrorException(
        'Erro ao criar a rifa de equipe.',
      );
    }
  }

  @Get('filtered') // Novo endpoint: /raffles/filtered
  async getFilteredRafflesByType(
    @Query('type') type?: 'tradicional' | 'equipes',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('finished') finished?: boolean, // Extraindo finished da query
  ): Promise<any[]> {
    this.logger.log(`Buscando rifas filtradas por tipo: ${type}, data de início: ${startDate}, data de fim: ${endDate}, finalizadas: ${finished}`); // Log atualizado
    return await this.raffleService.getRafflesWithDetails({ type, startDate, endDate, finished }); // Passando finished para o service
  }

  @Get(':raffleId')
  async getRaffleByIdWithDetails(
    @Param('raffleId', ParseIntPipe) raffleId: number,
  ): Promise<any> {
    this.logger.log(`Buscando detalhes da rifa com ID: ${raffleId}...`);
    return await this.raffleService.getRaffleByIdWithDetails(raffleId);
  }


  @UseGuards(AuthGuard('jwt'))
  @Post(':raffleId/buy-tickets')
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
  async getRafflesWithDetails(): Promise<any[]> {
    this.logger.log('Buscando detalhes de todas as rifas...');
    return await this.raffleService.getRafflesWithDetails();
  }

  @Post(':raffleId/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeRaffle(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<Raffle> {
    this.logger.log(`Finalizando rifa ${raffleId} (endpoint manual)...`);
    return await this.raffleService.finalizeRaffle(raffleId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles')
  async getRafflesPlayedByUser(@Request() req): Promise<any[]> { // Correto: @Request() sem o 'new'
    const userId = req.user.id;
    this.logger.log(`Buscando rifas jogadas pelo usuário ${userId}...`);
    return await this.raffleService.getRafflesPlayedByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/won')
  async getWonRafflesByUser(@Request() req): Promise<any[]> { // Correto: @Request() sem o 'new'
    const userId = req.user.id;
    this.logger.log(`Buscando rifas ganhas pelo usuário ${userId}...`);
    return await this.raffleService.getWonRafflesByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/lost')
  async getLostRafflesByUser(@Request() req): Promise<any[]> { // Correto: @Request() sem o 'new'
    const userId = req.user.id;
    this.logger.log(`Buscando rifas perdidas pelo usuário ${userId}...`);
    return await this.raffleService.getLostRafflesByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/data')
  async getUserRaffleData(@Request() req) {
    const userId = req.user.id;
    this.logger.log(`Buscando todos os dados do usuário ${userId} relacionados à rifas...`);
    return await this.raffleService.getUserRaffleData(userId);
  }

  @Post('team/system')
  async createSystemTeamRaffle(@Body('ticketPrice') ticketPrice: number): Promise<Raffle> {
    this.logger.log(`Criando rifa de equipes do sistema com preço: R$ ${ticketPrice.toFixed(2)}...`);
    return await this.raffleService.createTeamRaffle(ticketPrice);
  }

  @Post(':raffleId/finalize-team')
  @HttpCode(HttpStatus.OK)
  async finalizeTeamRaffle(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<Raffle> {
    this.logger.log(`Finalizando rifa de equipes ${raffleId} (endpoint manual)...`);
    return await this.raffleService.finalizeTeamRaffle(raffleId);
  }

  @Get(':raffleId/teams')
  async getRaffleTeams(@Param('raffleId', ParseIntPipe) raffleId: number) {
    this.logger.log(`Buscando equipes da rifa ${raffleId}...`);
    return await this.raffleService.getRaffleTeams(raffleId);
  }

  @Get(':raffleId/teams-with-availability')
  async getRaffleTeamsWithAvailability(@Param('raffleId', ParseIntPipe) raffleId: number) {
    this.logger.log(`Buscando equipes da rifa ${raffleId} com disponibilidade...`);
    return await this.raffleService.getRaffleTeamsWithAvailability(raffleId);
  }

    @Post('initialize')
    async initializeFixedRafflesEndpoint() {
        this.logger.log('Endpoint para inicializar rifas fixas chamado manualmente...');
        await this.raffleService.initializeFixedRaffles();
        return { message: 'Rifas fixas inicializadas com sucesso.' };
    }

    @Get('active-fixed')
    async getActiveFixedRaffles(): Promise<any> {
      this.logger.log('Buscando rifas fixas ativas...');
      return await this.raffleService.getActiveFixedRaffles();
    }

}