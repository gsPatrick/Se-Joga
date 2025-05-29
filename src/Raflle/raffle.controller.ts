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
  InternalServerErrorException, // <-- Já estava aqui, mas garante que está na lista
  Query,
  BadRequestException, // <-- Adicione
  Request,
  Patch, // <-- Adicione
  Delete, // <-- Adicione
  NotFoundException, // <-- Adicione
} from '@nestjs/common'; // <-- Verifique se está importando de @nestjs/common
import { RaffleService } from './raffle.service';
import { AuthGuard } from '@nestjs/passport'; // Ajuste o caminho se necessário
import { Raffle } from 'src/models/raffle/raffle.model'; // Ajuste o caminho
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model'; // Ajuste o caminho

@Controller('raffles')
export class RaffleController {
  private readonly logger = new Logger(RaffleController.name);

  constructor(private readonly raffleService: RaffleService) {}

  // --- Endpoints de Criação (Manuais) ---

  // Endpoint manual para criar uma rifa Tradicional (fixa original por padrão)
  @Post('system/traditional')
  async createSystemTraditionalRaffle(@Body('ticketPrice', ParseIntPipe) ticketPrice: number): Promise<any> {
      this.logger.log(`Criando rifa TRADICIONAL (FIXA ORIGINAL) do sistema com preço: R$ ${ticketPrice.toFixed(2)}...`);
      // Passa 'false' para indicar que NÃO é uma rifa extra criada manualmente
      const raffle = await this.raffleService.createSystemRaffle(ticketPrice, false);
      return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado
  }

  // Endpoint manual para criar uma rifa de Equipes (fixa original por padrão)
  @Post('system/team')
  async createSystemTeamRaffle(@Body('ticketPrice', ParseIntPipe) ticketPrice: number): Promise<any> {
      this.logger.log(`Criando rifa de EQUIPES (FIXA ORIGINAL) do sistema com preço: R$ ${ticketPrice.toFixed(2)}...`);
       // Passa 'false' para indicar que NÃO é uma rifa extra criada manualmente
      const raffle = await this.raffleService.createTeamRaffle(ticketPrice, false);
      return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado
  }

   // Endpoint manual para inicializar rifas (se necessário) - Garante FIXAS ORIGINAIS
   @Post('initialize-fixed')
   @HttpCode(HttpStatus.OK) // Retorna 200 OK por padrão
   async initializeFixedRafflesEndpoint() {
       this.logger.log('Endpoint para inicializar rifas fixas chamado manualmente...');
       // Este método no Service garante que uma rifa 'isExtra: false' exista para cada preço/tipo
       await this.raffleService.initializeFixedRaffles();
       return { message: 'Verificação e criação (se necessário) das rifas fixas originais concluída.' };
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

  // --- Endpoints de Consulta Atualizados conforme a necessidade ---

  @Get('active/traditional') // NOVO ENDPOINT para rifas TRADICIONAIS ativas (fixas e extras)
  async getActiveTraditionalRaffles(): Promise<any> {
       this.logger.log('Buscando rifas TRADICIONAIS ativas (fixas e extras), agrupadas por preço...');
       // O serviço já retorna no formato agrupado por preço, incluindo rifas extras ativas
       return await this.raffleService.getActiveTraditionalRafflesGroupedByPrice();
  }

   @Get('active/team') // NOVO ENDPOINT para rifas DE EQUIPES ativas (fixas e extras)
   async getActiveTeamRaffles(): Promise<any> {
        this.logger.log('Buscando rifas DE EQUIPES ativas (fixas e extras), agrupadas por preço...');
        // O serviço já retorna no formato agrupado por preço, incluindo rifas extras ativas
        return await this.raffleService.getActiveTeamRafflesGroupedByPrice();
   }


  @Get('filtered') // Busca rifas com filtros (agora incluindo isExtra)
  async getFilteredRaffles(
    @Query('type') type?: 'tradicional' | 'equipes',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('finished') finished?: string, // Receber como string
    @Query('isExtra') isExtra?: string, // Receber como string
  ): Promise<any[]> {
      const finishedBool = finished === 'true' ? true : (finished === 'false' ? false : undefined);
      const isExtraBool = isExtra === 'true' ? true : (isExtra === 'false' ? false : undefined); // Converter isExtra
      this.logger.log(`Buscando rifas filtradas. Filtros: type=${type}, startDate=${startDate}, endDate=${endDate}, finished=${finishedBool}, isExtra=${isExtraBool}`);
      // Passa o novo filtro isExtra para o service
      return await this.raffleService.getRafflesWithDetails({ type, startDate, endDate, finished: finishedBool, isExtra: isExtraBool });
  }

  @Get(':raffleId') // Busca detalhes de uma rifa específica (agora inclui isExtra nos detalhes)
  async getRaffleByIdWithDetails(
    @Param('raffleId', ParseIntPipe) raffleId: number,
  ): Promise<any> {
    this.logger.log(`Buscando detalhes da rifa com ID: ${raffleId}...`);
     // O serviço já formata a resposta (incluindo isExtra)
    return await this.raffleService.getRaffleByIdWithDetails(raffleId);
  }

  // Endpoint para buscar tickets de uma rifa
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
      return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado (inclui isExtra)
  }

  @Post(':raffleId/finalize-team') // Endpoint específico
  @HttpCode(HttpStatus.OK)
  async finalizeTeamRaffle(@Param('raffleId', ParseIntPipe) raffleId: number): Promise<any> {
      this.logger.log(`Finalizando rifa de EQUIPES ${raffleId} (endpoint manual)...`);
      const raffle = await this.raffleService.finalizeTeamRaffle(raffleId);
       return this.raffleService.formatRaffleDetails(raffle); // Retorna formatado (inclui isExtra)
  }

  // --- Endpoints do Usuário Autenticado ('/my/...') ---

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles') // Rifas jogadas pelo usuário
  async getRafflesPlayedByUser(@Request() req): Promise<any[]> {
    const userId = req.user.id;
    this.logger.log(`Buscando rifas jogadas pelo usuário ${userId}...`);
    // O serviço já formata a resposta (incluindo isExtra)
    return await this.raffleService.getRafflesPlayedByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/won') // Rifas ganhas pelo usuário
  async getWonRafflesByUser(@Request() req): Promise<any[]> {
    const userId = req.user.id;
    this.logger.log(`Buscando rifas GANHAS pelo usuário ${userId}...`);
     // O serviço já formata a resposta (incluindo isExtra)
    return await this.raffleService.getWonRafflesByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/raffles/lost') // Rifas perdidas pelo usuário
  async getLostRafflesByUser(@Request() req): Promise<any[]> {
    const userId = req.user.id;
    this.logger.log(`Buscando rifas PERDIDAS pelo usuário ${userId}...`);
     // O serviço já formata a resposta (incluindo isExtra)
    return await this.raffleService.getLostRafflesByUser(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('my/data') // Dados completos de rifas do usuário
  async getUserRaffleData(@Request() req) {
    const userId = req.user.id;
    this.logger.log(`Buscando dados de rifas do usuário ${userId}...`);
     // O serviço já formata a resposta (incluindo isExtra)
    return await this.raffleService.getUserRaffleData(userId);
  }

  Patch(':raffleId/reopen') // Usando PATCH por ser uma atualização parcial do estado
  @HttpCode(HttpStatus.OK) // Retorna 200 OK
  async reopenRaffleByIdEndpoint(
      @Param('raffleId', ParseIntPipe) raffleId: number,
      // @Request() req, // Se precisar do usuário para logs ou contexto
  ): Promise<any> {
      this.logger.log(`Endpoint para reabrir rifa ID ${raffleId} chamado...`);
      try {
          await this.raffleService.reopenRaffleById(raffleId);
          return { message: `Rifa com ID ${raffleId} reaberta com sucesso.` };
      } catch (error) {
          // Re-throw exceptions handled by NestJS (NotFound, BadRequest, InternalServerError)
          if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof InternalServerErrorException) {
             throw error;
          }
          // Handle any other unexpected errors
          this.logger.error(`Erro no endpoint ao reabrir rifa ${raffleId}: ${(error as Error).message}`, (error as Error).stack);
          throw new InternalServerErrorException(`Erro interno ao tentar reabrir a rifa com ID ${raffleId}.`);
      }
  }

   @Delete(':raffleId') // Usando DELETE com o ID na URL
  @HttpCode(HttpStatus.OK) // Retorna 200 OK em caso de sucesso
  async deleteRaffleByIdEndpoint(
      @Param('raffleId', ParseIntPipe) raffleId: number,
      // @Request() req, // Se precisar do usuário para logs ou contexto
  ): Promise<any> {
      this.logger.warn(`Endpoint para apagar a rifa ID ${raffleId} chamado. Verificando permissões...`);
       // Adicione verificações de permissão aqui (Ex: req.user.role === UserRole.ADMIN)
       // if (req.user.role !== UserRole.ADMIN) {
       //    throw new ForbiddenException('Apenas administradores podem executar esta operação.');
       // }

      try {
          await this.raffleService.deleteRaffleById(raffleId);
          return {
              message: `Rifa com ID ${raffleId} e seus registros associados foram excluídos com sucesso.`,
          };
      } catch (error) {
           // Re-throw exceptions handled by NestJS (NotFound, BadRequest, InternalServerError)
           if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof InternalServerErrorException) {
              throw error;
           }
           // Para qualquer outro erro inesperado
          this.logger.error(`Erro inesperado no endpoint deleteRaffleById: ${(error as Error).message}`, (error as Error).stack);
          throw new InternalServerErrorException(`Erro interno ao tentar apagar a rifa com ID ${raffleId}.`);
      }
  }

}