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
  BadRequestException,
  Request, // Import Request from @nestjs/common
} from '@nestjs/common';
import { RaffleService } from './raffle.service';
import { AuthGuard } from '@nestjs/passport'; // Ajuste o caminho se necessário
import { Raffle } from 'src/models/raffle/raffle.model'; // Ajuste o caminho
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model'; // Ajuste o caminho

@Controller('raffles')
export class RaffleController {
  private readonly logger = new Logger(RaffleController.name);

  constructor(private readonly raffleService: RaffleService) {}

  // --- Endpoints de Criação ---
  @Post('system/traditional') // Endpoint mais específico
  async createSystemTraditionalRaffle(@Body('ticketPrice', ParseIntPipe) ticketPrice: number): Promise<any> {
      this.logger.log(`Criando rifa TRADICIONAL do sistema com preço: R$ ${ticketPrice.toFixed(2)}...`);
      const raffle = await this.raffleService.createSystemRaffle(ticketPrice);
      return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado
  }

  @Post('system/team') // Endpoint mais específico
  async createSystemTeamRaffle(@Body('ticketPrice', ParseIntPipe) ticketPrice: number): Promise<any> {
      this.logger.log(`Criando rifa de EQUIPES do sistema com preço: R$ ${ticketPrice.toFixed(2)}...`);
      const raffle = await this.raffleService.createTeamRaffle(ticketPrice);
      return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado
  }

   // Endpoint manual para inicializar rifas (se necessário)
   @Post('initialize-fixed')
   async initializeFixedRafflesEndpoint() {
       this.logger.log('Endpoint para inicializar rifas fixas chamado manualmente...');
       await this.raffleService.initializeFixedRaffles();
       return { message: 'Rifas fixas inicializadas/verificadas com sucesso.' };
   }

  // --- Endpoints de Compra ---
  @UseGuards(AuthGuard('jwt'))
  @Post(':raffleId/buy-tickets') // Compra específica
  async buyRaffleTickets(
    @Param('raffleId', ParseIntPipe) raffleId: number,
    @Request() req, // Usa o Request injetado
    @Body('ticketNumbers') ticketNumbers: string[], // Espera array de strings "1" a "100"
    @Body('type') type: 'tradicional' | 'equipes', // Tipo obrigatório
  ): Promise<RaffleTicket[]> {
      if (!type) throw new BadRequestException('O campo "type" (\'tradicional\' ou \'equipes\') é obrigatório.');
      if (!Array.isArray(ticketNumbers) || ticketNumbers.length === 0) throw new BadRequestException('O campo "ticketNumbers" deve ser um array não vazio de strings.');

      const userId = req.user.id; // Obtém ID do usuário autenticado
      this.logger.log(
          `Usuário ${userId} tentando comprar bilhetes específicos [${ticketNumbers.join(', ')}] para a rifa ${raffleId} do tipo ${type}...`
      );
      // Passa os ticketNumbers como string[] para o service, que fará a conversão/validação
      return await this.raffleService.buyRaffleTickets(
          userId,
          raffleId,
          { type, quantityOrNumbers: ticketNumbers },
      );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':raffleId/buy-random') // Compra aleatória
  async buyRandomRaffleTickets(
    @Param('raffleId', ParseIntPipe) raffleId: number,
    @Request() req, // Usa o Request injetado
    @Body('quantity', ParseIntPipe) quantity: number,
    @Body('type') type: 'tradicional' | 'equipes', // Tipo obrigatório
  ) {
      if (!type) throw new BadRequestException('O campo "type" (\'tradicional\' ou \'equipes\') é obrigatório.');
      if (quantity <= 0) throw new BadRequestException('A quantidade deve ser maior que zero.');

      const userId = req.user.id;
      this.logger.log(
          `Usuário ${userId} tentando comprar ${quantity} bilhetes aleatórios para a rifa ${raffleId} do tipo ${type}...`
      );
      // Passa a quantidade para o service
      return await this.raffleService.buyRaffleTickets(userId, raffleId, { type, quantityOrNumbers: quantity });
  }

  // --- Endpoints de Consulta ---

  @Get('active-fixed') // Busca rifas ativas dos preços fixos
  async getActiveFixedRaffles(): Promise<any> {
    this.logger.log('Buscando rifas fixas ativas...');
    // O serviço já formata a resposta
    return await this.raffleService.getActiveFixedRaffles();
  }

  @Get('filtered') // Busca rifas com filtros
  async getFilteredRaffles( // Removido 'ByType' do nome para clareza
    @Query('type') type?: 'tradicional' | 'equipes',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('finished') finished?: string, // Receber como string
  ): Promise<any[]> {
      const finishedBool = finished === 'true' ? true : (finished === 'false' ? false : undefined);
      this.logger.log(`Buscando rifas filtradas. Filtros: type=${type}, startDate=${startDate}, endDate=${endDate}, finished=${finishedBool}`);
      // O serviço já formata a resposta
      return await this.raffleService.getRafflesWithDetails({ type, startDate, endDate, finished: finishedBool });
  }

  @Get(':raffleId') // Busca detalhes de uma rifa específica
  async getRaffleByIdWithDetails(
    @Param('raffleId', ParseIntPipe) raffleId: number,
  ): Promise<any> {
    this.logger.log(`Buscando detalhes da rifa com ID: ${raffleId}...`);
     // O serviço já formata a resposta
    return await this.raffleService.getRaffleByIdWithDetails(raffleId);
  }

  // NOVO ENDPOINT para buscar tickets de uma rifa
  @Get(':raffleId/tickets')
  async getRaffleTickets(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<any[]> {
      this.logger.log(`Buscando tickets da rifa ${raffleId}...`);
      // O serviço já formata a resposta (incluindo formatação 1-100)
      return await this.raffleService.getRaffleTickets(raffleId);
  }


  @Get(':raffleId/teams') // Busca times e membros (formatado 1-100)
  async getRaffleTeams(@Param('raffleId', ParseIntPipe) raffleId: number) {
    this.logger.log(`Buscando equipes da rifa ${raffleId}...`);
     // O serviço já formata a resposta (incluindo formatação 1-100)
    return await this.raffleService.getRaffleTeams(raffleId);
  }

  @Get(':raffleId/teams-with-availability') // Busca times e disponibilidade (formatado 1-100)
  async getRaffleTeamsWithAvailability(@Param('raffleId', ParseIntPipe) raffleId: number) {
    this.logger.log(`Buscando equipes da rifa ${raffleId} com disponibilidade...`);
     // O serviço já formata a resposta (incluindo formatação 1-100)
    return await this.raffleService.getRaffleTeamsWithAvailability(raffleId);
  }


  // --- Endpoints de Finalização (Manuais - usar com cautela) ---

  @Post(':raffleId/finalize-traditional') // Endpoint específico
  @HttpCode(HttpStatus.OK)
  async finalizeTraditionalRaffle(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<any> {
      this.logger.log(`Finalizando rifa TRADICIONAL ${raffleId} (endpoint manual)...`);
      const raffle = await this.raffleService.finalizeRaffle(raffleId);
      return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado
  }

  @Post(':raffleId/finalize-team') // Endpoint específico
  @HttpCode(HttpStatus.OK)
  async finalizeTeamRaffle(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<any> {
      this.logger.log(`Finalizando rifa de EQUIPES ${raffleId} (endpoint manual)...`);
      const raffle = await this.raffleService.finalizeTeamRaffle(raffleId);
       return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado
  }

  // --- Endpoints do Usuário Autenticado ('/my/...') ---

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles') // Rifas jogadas pelo usuário
  async getRafflesPlayedByUser(@Request() req): Promise<any[]> {
    const userId = req.user.id;
    this.logger.log(`Buscando rifas jogadas pelo usuário ${userId}...`);
    // O serviço já formata a resposta
    return await this.raffleService.getRafflesPlayedByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/won') // Rifas ganhas pelo usuário
  async getWonRafflesByUser(@Request() req): Promise<any[]> {
    const userId = req.user.id;
    this.logger.log(`Buscando rifas GANHAS pelo usuário ${userId}...`);
     // O serviço já formata a resposta
    return await this.raffleService.getWonRafflesByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/lost') // Rifas perdidas pelo usuário
  async getLostRafflesByUser(@Request() req): Promise<any[]> {
    const userId = req.user.id;
    this.logger.log(`Buscando rifas PERDIDAS pelo usuário ${userId}...`);
     // O serviço já formata a resposta
    return await this.raffleService.getLostRafflesByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/data') // Dados completos de rifas do usuário
  async getUserRaffleData(@Request() req) {
    const userId = req.user.id;
    this.logger.log(`Buscando dados de rifas do usuário ${userId}...`);
     // O serviço já formata a resposta
    return await this.raffleService.getUserRaffleData(userId);
  }

}