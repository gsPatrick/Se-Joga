// raffle.service.ts
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { Seed } from '../models/seed.model';
import { RaffleNumber } from '../models/raffle/raffle-number.model';
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../models/user/user.model';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Op } from 'sequelize';

@Injectable()
export class RaffleService {
  private readonly logger = new Logger(RaffleService.name);

  public readonly teamNames = [
    'Brasil', 'Alemanha', 'Itália', 'Argentina', 'França',
    'Espanha', 'Inglaterra', 'Uruguai', 'Holanda', 'Portugal',
    'Bélgica', 'Croácia', 'México', 'Colômbia', 'Chile',
    'Paraguai', 'Estados Unidos', 'Rússia', 'Suécia', 'Dinamarca',
    'Servia', 'Japão', 'Coreia do Sul', 'Camarões', 'Nigéria'
  ];

  public readonly fixedRafflePrices = [5, 10, 20, 30, 50, 100];


  constructor(
    @InjectModel(Raffle) private raffleModel: typeof Raffle,
    @InjectModel(BlockchainHash)
    private blockchainHashModel: typeof BlockchainHash,
    @InjectModel(GeneratedNumber)
    private generatedNumberModel: typeof GeneratedNumber,
    @InjectModel(RaffleNumber)
    private raffleNumberModel: typeof RaffleNumber,
    @InjectModel(Seed) private seedModel: typeof Seed,
    @InjectModel(User) private userModel: typeof User,
    @InjectModel(RaffleTicket) private raffleTicketModel: typeof RaffleTicket,
    private sequelize: Sequelize,
  ) { }


  async initializeFixedRaffles() {
    this.logger.log('Inicializando rifas fixas...');
    for (const price of this.fixedRafflePrices) {
      try {
        // Garante que só cria se não houver 6 ativas daquele preço/tipo
        const traditionalCount = await this.raffleModel.count({ where: { ticketPrice: price, type: 'tradicional', finished: false } });
        if (traditionalCount < 6) {
            await this.createSystemRaffle(price);
            this.logger.log(`Rifa tradicional de R$ ${price.toFixed(2)} inicializada.`);
        } else {
            this.logger.log(`Já existem ${traditionalCount} rifas tradicionais ativas de R$ ${price.toFixed(2)}. Nenhuma nova foi criada.`);
        }
      } catch (error) {
        this.logger.error(`Erro ao inicializar rifa tradicional de R$ ${price.toFixed(2)}: ${(error as any).message}`);
      }
      try {
        // Garante que só cria se não houver 6 ativas daquele preço/tipo
        const teamCount = await this.raffleModel.count({ where: { ticketPrice: price, type: 'equipes', finished: false } });
         if (teamCount < 6) {
            await this.createTeamRaffle(price);
            this.logger.log(`Rifa de equipes de R$ ${price.toFixed(2)} inicializada.`);
        } else {
            this.logger.log(`Já existem ${teamCount} rifas de equipes ativas de R$ ${price.toFixed(2)}. Nenhuma nova foi criada.`);
        }
      } catch (error) {
        this.logger.error(`Erro ao inicializar rifa de equipes de R$ ${price.toFixed(2)}: ${(error as any).message}`);
      }
    }
    this.logger.log('Inicialização de rifas fixas concluída.');
  }


  async getActiveFixedRaffles(): Promise<any> {
    this.logger.log('Buscando rifas fixas ativas...');
    const activeFixedRaffles = {};

    for (const price of this.fixedRafflePrices) {
        // Busca rifas Tradicionais
        const traditionalRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'tradicional', finished: false },
            include: [ /* Includes necessários */ ], // Adicione includes se precisar de detalhes
            order: [['createdAt', 'DESC']],
            limit: 6,
        });

        // Busca rifas de Equipes
        const teamRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'equipes', finished: false },
            include: [ /* Includes necessários */ ], // Adicione includes se precisar de detalhes
            order: [['createdAt', 'DESC']],
            limit: 6,
        });

        activeFixedRaffles[price] = {
            tradicional: traditionalRaffles.map(raffle => this.formatRaffleSummary(raffle)), // Usar função de formatação
            equipes: teamRaffles.map(raffle => this.formatRaffleSummary(raffle)), // Usar função de formatação
        };
    }

    return activeFixedRaffles;
  }

  // Função auxiliar para formatar resumo da rifa (pode ser expandida)
  private formatRaffleSummary(raffle: Raffle): any {
      return {
          id: raffle.id,
          raffleIdentifier: raffle.raffleIdentifier,
          type: raffle.type,
          title: raffle.title,
          ticketPrice: raffle.ticketPrice, // Manter como número para possíveis cálculos no front
          totalTickets: raffle.totalTickets,
          soldTickets: raffle.soldTickets,
          finished: raffle.finished,
          // Adicionar mais campos se necessário para o resumo
          expectedDrawTime: this.calculateExpectedDrawTime(raffle), // Calcula horário esperado
          createdAt: raffle.createdAt,
      };
  }

  // Função auxiliar para calcular o horário esperado do sorteio
  private calculateExpectedDrawTime(raffle: Raffle): Date | null {
    if (raffle.finished) {
      return raffle.drawDate || raffle.updatedAt; // Se finalizada, retorna a data do sorteio ou atualização
    }

    const now = new Date();

    // Condição 1: Esgotada ou Data de Fim passada
    if (raffle.soldTickets >= raffle.totalTickets || (raffle.endDate && raffle.endDate <= now)) {
        const nextHour = new Date(now);
        nextHour.setHours(now.getHours() + 1, 0, 0, 0); // Próxima hora cheia
        return nextHour;
    }

    // Condição 2: Data de Fim futura definida
    if (raffle.endDate) {
      return raffle.endDate;
    }

    // Condição 3: Indeterminada (não esgotada, sem data de fim)
    return null;
  }


  // Função auxiliar para calcular detalhes do prêmio
  private calculatePrizeDetails(raffle: Raffle): any {
    if (!raffle.finished) {
      return null; // Sem prêmio definido ainda
    }

    const totalCollected = raffle.ticketPrice * raffle.soldTickets; // Baseado nos vendidos para ser mais justo? Ou usar totalTickets? Usando totalTickets como no código de finalização original.
    const totalPotentialPrize = raffle.ticketPrice * raffle.totalTickets; // Prêmio total se todos vendidos

    if (raffle.type === 'tradicional') {
      const prizeAmount = totalPotentialPrize * 0.7;
      return {
        totalPrize: prizeAmount,
        winnerPrize: prizeAmount,
        details: `Prêmio total: R$ ${prizeAmount.toFixed(2)} (70% do total arrecadado com ${raffle.totalTickets} bilhetes)`
      };
    } else if (raffle.type === 'equipes') {
      const mainPrize = totalPotentialPrize * 0.5;
      const teamPrizePool = totalPotentialPrize * 0.3;
      const banca = totalPotentialPrize * 0.2; // 20% para a banca

      if (!raffle.winningTicket || !raffle.tickets || raffle.tickets.length === 0) {
          return { // Retorna estrutura mesmo sem detalhes se algo faltar
            totalPrize: mainPrize + teamPrizePool,
            mainWinnerPrize: mainPrize,
            teamPrizePool: teamPrizePool,
            teamMemberPrize: 0,
            winningTeamName: 'N/A',
            details: `Rifa finalizada, mas dados insuficientes para calcular divisão do prêmio da equipe. Prêmio principal (50%): R$ ${mainPrize.toFixed(2)}. Pool da Equipe (30%): R$ ${teamPrizePool.toFixed(2)}. Banca (20%): R$ ${banca.toFixed(2)}.`
          };
      }

      const winningTeamName = this.getTeamNameByTicketNumber(raffle, raffle.winningTicket);
      // Encontrar todos os tickets da equipe vencedora E que foram comprados
      const winningTeamTickets = raffle.tickets.filter(
        (ticket) => this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName
      );

       // Identificar usuários únicos na equipe vencedora (excluindo o vencedor principal se ele estiver na equipe)
      const mainWinnerUserId = raffle.winnerUserId;
      const teamMemberUserIds = new Set<number>();
      winningTeamTickets.forEach(ticket => {
          if (ticket.userId !== mainWinnerUserId) {
              teamMemberUserIds.add(ticket.userId);
          }
      });

      const numberOfTeamMembers = teamMemberUserIds.size;
      const teamMemberPrize = numberOfTeamMembers > 0 ? teamPrizePool / numberOfTeamMembers : 0;

      return {
        totalPrize: mainPrize + teamPrizePool,
        mainWinnerPrize: mainPrize, // Prêmio do bilhete sorteado exato
        teamPrizePool: teamPrizePool, // Total para dividir entre outros membros da equipe
        teamMemberPrize: teamMemberPrize, // Valor por membro (excluindo vencedor principal)
        winningTeamName: winningTeamName,
        details: `Prêmio Principal (50%): R$ ${mainPrize.toFixed(2)}. Prêmio Equipe (30%): R$ ${teamPrizePool.toFixed(2)} dividido entre ${numberOfTeamMembers} membro(s) (R$ ${teamMemberPrize.toFixed(2)} cada). Banca (20%): R$ ${banca.toFixed(2)}.`
      };
    }

    return null;
  }

  // Função auxiliar para formatar bilhete (0-99 para 1-100)
  private formatTicketNumberDisplay(ticketNumber: string): string {
      if (!ticketNumber) return 'N/A';
      try {
          const num = parseInt(ticketNumber, 10);
          if (isNaN(num)) return ticketNumber; // Retorna original se não for número
          return (num + 1).toString(); // Soma 1 e converte para string
      } catch (e) {
          return ticketNumber; // Retorna original em caso de erro
      }
  }

  async getAllFixedAndExtraRaffles(): Promise<any> {
    // ... (lógica existente)
    // APLICAR formatRaffleSummary nos retornos
    // ...
    this.logger.log('Buscando todas as rifas fixas e extras...');
    const allFixedRaffles = {
        tradicional: {},
        equipes: {}
    };

    for (const price of this.fixedRafflePrices) {
        const traditionalRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'tradicional' },
            include: [ /* Includes */ ], order: [['createdAt', 'DESC']],
        });
        const teamRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'equipes' },
             include: [ /* Includes */ ], order: [['createdAt', 'DESC']],
        });

        allFixedRaffles.tradicional[price] = traditionalRaffles.map(raffle => this.formatRaffleSummary(raffle));
        allFixedRaffles.equipes[price] = teamRaffles.map(raffle => this.formatRaffleSummary(raffle));
    }
    return allFixedRaffles;
  }

  async createSystemRaffle(ticketPrice: number): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });

    if (!latestHash) {
      throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
    }

    const correspondingSeed = await this.seedModel.findOne({
      where: { hashId: latestHash.id },
      include: [
        {
          model: GeneratedNumber,
          order: [['createdAt', 'DESC']],
          limit: 1,
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
      // Tentar gerar número se não existir? Por agora, lança erro.
      throw new NotFoundException(
        `Nenhuma seed ou generatedNumber correspondente encontrado para a hash ${latestHash.id}. Execute a geração de números.`,
      );
    }

    const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(latestGeneratedNumber.number) % 100n; // 0 a 99
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0'); // Formato '00' a '99'

    const startDate = new Date();

    // Define endDate como 7 dias a partir de agora, por exemplo
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7); // Adiciona 7 dias

    const newRaffle = await this.raffleModel.create({
      raffleIdentifier: `RIFA-${Date.now()}`,
      type: 'tradicional', // Definindo o tipo
      title: `Rifa Tradicional - R$ ${ticketPrice.toFixed(2)}`,
      description: `Rifa gerada automaticamente com base na hash ${latestHash.hash}. Prêmio: 70% do total.`,
      ticketPrice: ticketPrice,
      totalTickets: 100, // 00 a 99
      soldTickets: 0,
      startDate: startDate,
      endDate: endDate, // Adiciona a data de fim
      finished: false,
      winningTicket: winningTicketNumber, // Armazena 00-99 internamente
      drawDate: null, // Será preenchido na finalização
    });

    // Associa o número gerado à rifa
    await this.raffleNumberModel.create({
      raffleId: newRaffle.id,
      numberId: latestGeneratedNumber.id,
    });

    this.logger.log(
      `Rifa Tradicional ${newRaffle.raffleIdentifier} criada. Preço: R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`,
    );

    return newRaffle;
  }

  @Cron(CronExpression.EVERY_HOUR) // Roda a cada hora
  async createRafflesCronJob() {
    this.logger.log('CRON: Verificando necessidade de criar rifas fixas...');
    for (const price of this.fixedRafflePrices) {
        // Tradicional
        const activeTraditionalCount = await this.raffleModel.count({
            where: { ticketPrice: price, type: 'tradicional', finished: false },
        });
        if (activeTraditionalCount < 6) {
            const needed = 6 - activeTraditionalCount;
            this.logger.log(`CRON: Necessário criar ${needed} rifa(s) tradicional(is) de R$ ${price.toFixed(2)}.`);
            for (let i = 0; i < needed; i++) {
                try {
                    await this.createSystemRaffle(price);
                } catch (error) {
                    this.logger.error(`CRON: Erro ao criar rifa tradicional de R$ ${price.toFixed(2)}: ${(error as any).message}`);
                }
            }
        }

        // Equipes
        const activeTeamCount = await this.raffleModel.count({
            where: { ticketPrice: price, type: 'equipes', finished: false },
        });
        if (activeTeamCount < 6) {
            const needed = 6 - activeTeamCount;
             this.logger.log(`CRON: Necessário criar ${needed} rifa(s) de equipes de R$ ${price.toFixed(2)}.`);
            for (let i = 0; i < needed; i++) {
                try {
                    await this.createTeamRaffle(price);
                } catch (error) {
                    this.logger.error(`CRON: Erro ao criar rifa de equipes de R$ ${price.toFixed(2)}: ${(error as any).message}`);
                }
            }
        }
    }
    this.logger.log('CRON: Verificação para criar rifas concluída.');
  }

  async buyRaffleTickets(
    userId: number,
    raffleId: number,
    ticketData: { type: 'tradicional' | 'equipes'; quantityOrNumbers: number | string[] },
  ): Promise<RaffleTicket[]> {
    // Start transaction
    const transaction = await this.sequelize.transaction();
    try {
      // Fetch user within transaction
      const user = await this.userModel.findByPk(userId, { transaction });
      if (!user) {
        // No rollback needed here, transaction just started, no lock acquired yet
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Step 1: Find and lock the Raffle row ONLY
      const raffle = await this.raffleModel.findByPk(raffleId, {
        transaction,
        lock: transaction.LOCK.UPDATE, // Lock only the raffle row
        // NO INCLUDE during lock acquisition!
      });

      // Basic checks on the raffle itself (after acquiring lock)
      if (!raffle) {
        // Lock might have been acquired, attempt rollback before throwing
        await transaction.rollback(); // Rollback since lock might be held
        throw new NotFoundException('Rifa não encontrada.');
      }
      if (raffle.finished) {
        await transaction.rollback(); // Rollback since lock might be held
        throw new BadRequestException('Esta rifa já foi finalizada.');
      }
       if (raffle.type !== ticketData.type) {
          await transaction.rollback(); // Rollback since lock might be held
          throw new BadRequestException(`Tipo de compra (${ticketData.type}) incompatível com o tipo da rifa (${raffle.type}).`);
      }

      // Step 2: Fetch existing ticket numbers separately *within the same transaction*
      // This does NOT need a lock, as the raffle row itself is locked.
      const existingTicketsData = await this.raffleTicketModel.findAll({
          where: { raffleId: raffle.id },
          attributes: ['ticketNumber'], // Only need the numbers
          transaction, // Use the same transaction
          raw: true, // Get plain objects for efficiency
      });
      // Create a Set of existing ticket numbers ('00'-'99') for quick lookup
      const existingTicketNumbers = new Set(existingTicketsData.map(t => t.ticketNumber));

      // --- Logic for determining tickets to buy ('00'-'99' format) ---
      let quantity: number;
      let ticketNumbersToBuy: string[]; // Internal format '00'-'99'

      // Calculate available slots based on the accurately fetched existing numbers
      const availableSlots = raffle.totalTickets - existingTicketNumbers.size;

      if (typeof ticketData.quantityOrNumbers === 'number') { // Random purchase requested
        quantity = ticketData.quantityOrNumbers;
        // Validate quantity input (no rollback needed for basic input validation)
        if (quantity <= 0) {
             throw new BadRequestException('A quantidade de bilhetes deve ser maior que zero.');
        }
        // Check if enough tickets are available (condition check after lock)
        if (quantity > availableSlots) {
           await transaction.rollback(); // Rollback as condition failed after lock
          throw new BadRequestException(
            `Não há ${quantity} bilhetes disponíveis. Apenas ${availableSlots} restantes.`,
          );
        }
        // Generate unique available numbers in '00'-'99' format
        ticketNumbersToBuy = this.generateUniqueAvailableTicketNumbers(raffle.totalTickets, existingTicketNumbers, quantity);

      } else { // Specific purchase requested
        const requestedNumbersFront = ticketData.quantityOrNumbers; // Array of "1"-"100" strings from frontend
        // Convert and validate frontend numbers ('1'-'100') to internal ('00'-'99')
        ticketNumbersToBuy = requestedNumbersFront.map(numStr => {
            const num = parseInt(numStr, 10);
            // Input validation (no rollback needed yet)
            if (isNaN(num) || num < 1 || num > raffle.totalTickets) {
                throw new BadRequestException(`Número de bilhete inválido: ${numStr}. Deve ser entre 1 e ${raffle.totalTickets}.`);
            }
            return (num - 1).toString().padStart(2, '0'); // Convert '1'->'00', '100'->'99'
        });

        quantity = ticketNumbersToBuy.length;
         // Input validation (no rollback needed yet)
         if (quantity <= 0) {
             throw new BadRequestException('Nenhum número de bilhete fornecido.');
        }

        // Check availability against the fetched Set (condition check after lock)
        const alreadySold = ticketNumbersToBuy.filter(num => existingTicketNumbers.has(num));
        if (alreadySold.length > 0) {
             await transaction.rollback(); // Rollback as condition failed after lock
             throw new BadRequestException(
              `Os seguintes bilhetes (formato 1-100) já foram comprados: ${alreadySold.map(this.formatTicketNumberDisplay).join(', ')}`,
            );
        }
        // Check duplicates in the user's request (condition check after lock)
        const duplicatesInRequest = ticketNumbersToBuy.filter((item, index) => ticketNumbersToBuy.indexOf(item) !== index);
        if (duplicatesInRequest.length > 0) {
             // Although technically input validation, it's checked after lock, so rollback is safer.
             await transaction.rollback();
             throw new BadRequestException(
              `Os seguintes bilhetes (formato 1-100) estão duplicados na sua requisição: ${duplicatesInRequest.map(this.formatTicketNumberDisplay).join(', ')}`,
            );
        }
        // Check if requesting more than available (condition check after lock)
        if (quantity > availableSlots) {
            await transaction.rollback(); // Rollback as condition failed after lock
           throw new BadRequestException(
             `Você tentou comprar ${quantity} bilhetes, mas apenas ${availableSlots} estão disponíveis.`
           );
        }
      }

      // Check user balance (condition check after lock)
      const totalCost = raffle.ticketPrice * quantity;
      if (user.balance < totalCost) {
         await transaction.rollback(); // Rollback as condition failed after lock
        throw new BadRequestException(`Saldo insuficiente. Necessário: R$ ${totalCost.toFixed(2)}, Disponível: R$ ${user.balance.toFixed(2)}.`);
      }

      // --- Perform Database Updates ---

      // Create the new raffle tickets ('00'-'99' format)
      const createdTickets = await this.raffleTicketModel.bulkCreate(
        ticketNumbersToBuy.map((ticketNumberInternal) => ({
          userId,
          raffleId,
          ticketNumber: ticketNumberInternal, // Save internal format
        })),
        { transaction }, // Use the transaction
      );

      // Update user's balance
      await user.update(
        { balance: user.balance - totalCost },
        { transaction }, // Use the transaction
      );

      // Update the raffle's sold tickets count accurately
      const newSoldCount = existingTicketNumbers.size + quantity;
      await raffle.update(
        { soldTickets: newSoldCount },
        { transaction }, // Use the transaction
      );

      // --- Post-Update Actions (still within try, before commit) ---

      // Check if the raffle sold out with this purchase
      if (newSoldCount >= raffle.totalTickets) {
          this.logger.log(`Rifa ${raffleId} (tipo: ${raffle.type}) esgotou com esta compra. Verificando necessidade de criar nova...`);
          // Trigger async creation of the next raffle if needed (don't await, don't block the purchase)
          this.createNextRaffleIfNeeded(raffle.type, raffle.ticketPrice).catch(err => {
              // Log error but don't fail the current purchase because of this background task
              this.logger.error(`Erro (não bloqueante) ao tentar criar próxima rifa após esgotamento da ${raffleId}: ${err.message}`);
          });
      }

      // --- Commit Transaction ---
      // If all operations succeed, commit the transaction
      await transaction.commit();

      // --- Log Success ---
      this.logger.log(
        `Usuário ${userId} comprou ${quantity} bilhete(s) para a rifa ${raffleId}. Bilhetes (formato 1-100): ${ticketNumbersToBuy.map(this.formatTicketNumberDisplay).join(', ')}`
      );

      // --- Return Result ---
      // Return the created ticket objects (they contain the internal '00'-'99' number)
      return createdTickets;

    } catch (error) {
      // --- Error Handling & Rollback ---
      // Attempt to rollback the transaction if an error occurred and it's still active
      if (transaction && typeof transaction.rollback === 'function') { // Check if it's a valid transaction object
            try {
                // Sequelize's rollback should handle not rolling back already committed/rolled back transactions
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação de compra da rifa ${raffleId} por usuário ${userId} devido a erro no catch.`);
            } catch (rollbackError: any) {
                 // Log only unexpected rollback errors
                 if (!rollbackError.message?.includes('already')) { // Ignore "Transaction already committed/rolled back" errors
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para compra da rifa ${raffleId} por ${userId}: ${rollbackError}`);
                 }
            }
       }

      // --- Re-throw or Handle Error ---
      // Re-throw specific known exceptions (NotFound, BadRequest)
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      // Log the captured error for debugging
      this.logger.error(
        `Erro capturado no CATCH ao comprar bilhetes para rifa ${raffleId} por usuário ${userId}: ${(error as any).message}`, (error as any).stack
      );

      // Handle the specific "FOR UPDATE cannot be applied" error gracefully for the user
      if (error instanceof Error && error.message?.includes('FOR UPDATE cannot be applied')) {
           throw new InternalServerErrorException('Erro temporário ao processar compra devido a concorrência. Por favor, tente novamente.');
      }

      // Throw a generic internal server error for other unexpected issues
      throw new InternalServerErrorException('Erro interno ao processar a compra de bilhetes.');
    }
  }

    // Função auxiliar para criar a próxima rifa se necessário
    private async createNextRaffleIfNeeded(type: 'tradicional' | 'equipes', price: number): Promise<void> {
        const activeCount = await this.raffleModel.count({
            where: { ticketPrice: price, type: type, finished: false }
        });

        if (activeCount < 6) {
             this.logger.log(`Detectado que há menos de 6 rifas ativas (${activeCount}) do tipo ${type} e preço ${price}. Criando nova...`);
             try {
                 if (type === 'tradicional') {
                     await this.createSystemRaffle(price);
                 } else {
                     await this.createTeamRaffle(price);
                 }
                 this.logger.log(`Nova rifa do tipo ${type} e preço ${price} criada com sucesso.`);
             } catch (err) {
                  this.logger.error(`Falha ao criar rifa extra do tipo ${type} e preço ${price}: ${(err as Error).message}`);
             }
        } else {
             this.logger.log(`Já existem ${activeCount} rifas ativas do tipo ${type} e preço ${price}. Nenhuma nova rifa necessária no momento.`);
        }
    }

  private generateUniqueAvailableTicketNumbers(totalTickets: number, existingNumbers: Set<string>, quantity: number): string[] {
    const availableNumbers: string[] = [];
    for (let i = 0; i < totalTickets; i++) {
        const numStr = i.toString().padStart(2, '0');
        if (!existingNumbers.has(numStr)) {
            availableNumbers.push(numStr);
        }
    }

    // Embaralha os disponíveis para aleatoriedade
    for (let i = availableNumbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableNumbers[i], availableNumbers[j]] = [availableNumbers[j], availableNumbers[i]];
    }

    return availableNumbers.slice(0, quantity);
  }

  // Atualizar getRafflesWithDetails e getRaffleByIdWithDetails para usar as novas funções
  async getRafflesWithDetails(filters: any = {}): Promise<any[]> {
    const where: any = {};
    // ... (lógica de filtros existente) ...
     if (filters.finished !== undefined) {
          where.finished = filters.finished === 'true' || filters.finished === true; // Tratar string/boolean
      }
      if (filters.type) {
          where.type = filters.type;
      }
      // Adicionar outros filtros conforme necessário

    const raffles = await this.raffleModel.findAll({
      include: [
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email'] }] },
        { model: User, as: 'winnerUser', attributes: ['id', 'name', 'email'] },
        { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
      ],
      where,
      order: [['createdAt', 'DESC']], // Ou outra ordenação desejada
    });

    // Mapear para o formato de resposta detalhado
    return raffles.map((raffle) => this.formatRaffleDetails(raffle));
  }

  async getRaffleByIdWithDetails(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      include: [
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email'] }] },
        { model: User, as: 'winnerUser', attributes: ['id', 'name', 'email'] },
        { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
      ],
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    // Formatar para a resposta detalhada
    return this.formatRaffleDetails(raffle);
  }

  // Função centralizada para formatar detalhes da rifa
  public formatRaffleDetails(raffle: Raffle): any {
    const formattedTickets = this.formatRaffleTickets(raffle); // Formata os tickets 1-100
    const winningTicketInfo = this.formatWinningTicketInfo(raffle); // Formata info do bilhete vencedor 1-100
    const prizeDetails = this.calculatePrizeDetails(raffle); // Calcula detalhes do prêmio
    const expectedDrawTime = this.calculateExpectedDrawTime(raffle); // Calcula horário esperado

    let winningTeamDetails: { tickets: string[]; members: { tickets: string[] }[] } | null = null;
    if (raffle.type === 'equipes' && raffle.finished && winningTicketInfo?.ticketNumber && prizeDetails?.winningTeamName) {
        const formattedTeams = this.getFormattedTeams(raffle); // Pega times formatados
        winningTeamDetails = formattedTeams[prizeDetails.winningTeamName] || null; // Acessa dados do time vencedor
         if (winningTeamDetails) {
            // Formata números dos tickets dentro dos detalhes da equipe vencedora
            winningTeamDetails.tickets = winningTeamDetails.tickets.map(this.formatTicketNumberDisplay);
            winningTeamDetails.members.forEach(member => {
                member.tickets = member.tickets.map(this.formatTicketNumberDisplay);
            });
         }
    }


    return {
      id: raffle.id,
      raffleIdentifier: raffle.raffleIdentifier,
      type: raffle.type,
      winner: raffle.winnerUser ? { id: raffle.winnerUser.id, name: raffle.winnerUser.name } : null,
      title: raffle.title,
      description: raffle.description,
      ticketPrice: raffle.ticketPrice, // Manter número
      totalTickets: raffle.totalTickets,
      soldTickets: raffle.soldTickets,
      startDate: raffle.startDate,
      endDate: raffle.endDate,
      drawDate: raffle.drawDate, // Data real do sorteio (quando ocorreu)
      expectedDrawTime: expectedDrawTime, // Data/hora esperada
      finished: raffle.finished,
      winningTicket: winningTicketInfo, // Objeto com detalhes e número formatado 1-100
      prizeDetails: prizeDetails, // Objeto com detalhes do prêmio
      winningTeamDetails: winningTeamDetails, // Detalhes da equipe vencedora (para rifa de equipes)
      // tickets: formattedTickets, // Opcional: incluir lista completa de tickets aqui? Pode ser grande. Melhor endpoint separado.
      createdAt: raffle.createdAt,
      updatedAt: raffle.updatedAt,
      // Adicionar mais campos se necessário
    };
  }


  private formatWinningTicketInfo(raffle: Raffle): any {
    if (!raffle.finished || !raffle.winningTicket) { // Verifica se finalizou E tem winningTicket
      return null;
    }
    // winningTicket está armazenado como 00-99
    const displayTicketNumber = this.formatTicketNumberDisplay(raffle.winningTicket);

    // Tenta buscar info do número gerado associado
    const raffleNumber = raffle.raffleNumbers?.[0];
    const generatedNumber = raffleNumber?.generatedNumber;
    const seed = generatedNumber?.seed;
    const blockchainHash = seed?.blockchainHash;

    return {
      ticketNumber: displayTicketNumber, // Número formatado 1-100
      internalTicketNumber: raffle.winningTicket, // Número interno 00-99 (para referência/debug)
      generatedNumberId: generatedNumber?.id,
      generatedNumberValue: generatedNumber?.number?.toString(), // Valor completo gerado
      sequence: generatedNumber?.sequence,
      seedId: seed?.id,
      // seedValue: seed?.seed, // Opcional: Expor seed? Talvez não seja seguro.
      hashId: blockchainHash?.id,
      hashValue: blockchainHash?.hash,
      hashTimestamp: blockchainHash?.timestamp,
    };
  }

  // Função para formatar a lista de tickets (usada no novo endpoint e talvez internamente)
  public formatRaffleTickets(raffle: Raffle): any[] {
    if (!raffle.tickets) {
      return [];
    }

    const formattedTeamsData = raffle.type === 'equipes' ? this.getFormattedTeams(raffle) : null;

    return raffle.tickets.map(ticket => {
      const displayTicketNumber = this.formatTicketNumberDisplay(ticket.ticketNumber); // Formata 00-99 para 1-100
      let teamInfo: { teamName: string } | null = null;

      if (formattedTeamsData) {
          const teamName = this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber);
          const team = formattedTeamsData[teamName];
           if (team) {
              teamInfo = {
                 teamName: team.teamName,
                 // Não incluir a lista completa de tickets e membros aqui para evitar redundância massiva
              };
           }
      }

      return {
        id: ticket.id,
        ticketNumber: displayTicketNumber, // Exibe 1-100
        internalTicketNumber: ticket.ticketNumber, // Mantém 00-99 internamente se precisar
        user: ticket.user ? {
          id: ticket.user.id,
          name: ticket.user.name,
          // email: ticket.user.email // Opcional: expor email?
        } : null,
        team: teamInfo, // Adiciona info da equipe se aplicável
        purchaseDate: ticket.createdAt, // Data da compra do bilhete
      };
    });
  }

  // NOVO MÉTODO para buscar tickets de uma rifa
  async getRaffleTickets(raffleId: number): Promise<any[]> {
      this.logger.log(`Buscando tickets para a rifa ${raffleId}...`);
      const raffle = await this.raffleModel.findByPk(raffleId, {
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name'], // Buscar apenas ID e nome do usuário
                      },
                  ],
                  order: [['createdAt', 'ASC']], // Ordenar por data de compra, por exemplo
              },
          ],
      });

      if (!raffle) {
          throw new NotFoundException(`Rifa com ID ${raffleId} não encontrada.`);
      }

      // Usa a função de formatação padronizada
      return this.formatRaffleTickets(raffle);
  }


  async finalizeRaffle(raffleId: number, transactionHost?: any): Promise<Raffle> {
    const transaction = transactionHost ? transactionHost : await this.sequelize.transaction();
    try {
      // Step 1: Find and lock the Raffle row ONLY
      const raffle = await this.raffleModel.findByPk(raffleId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
        // NO includes here for locking!
      });

      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }
      if (raffle.finished) {
        this.logger.warn(`Tentativa de finalizar rifa ${raffleId} que já está finalizada.`);
        if (!transactionHost) await transaction.commit(); // Commit if local transaction
        // Fetch relations if needed for return value even if already finished
         await raffle.reload({ include: [{ model: User, as: 'winnerUser' }, { model: RaffleTicket, include: [User]}] });
        return raffle;
      }
      if (raffle.type !== 'tradicional') {
         // Rollback before throwing if local transaction
         if (!transactionHost) await transaction.rollback();
         throw new BadRequestException(`A Rifa ${raffleId} é do tipo ${raffle.type} e não pode ser finalizada por este método.`);
      }

      const now = new Date();
      const isSoldOut = raffle.soldTickets >= raffle.totalTickets;
      const isEndDateReached = raffle.endDate && raffle.endDate <= now;

      if (!isSoldOut && !isEndDateReached) {
        // Rollback immediately if condition not met, as lock was acquired
        if (!transactionHost) await transaction.rollback();
        throw new BadRequestException(
          `A rifa ${raffleId} ainda não pode ser finalizada. Bilhetes vendidos: ${raffle.soldTickets}/${raffle.totalTickets}. Data de fim: ${raffle.endDate?.toISOString() ?? 'N/A'}.`
        );
      }

      const winningTicketNumberInternal = raffle.winningTicket;
      if (!winningTicketNumberInternal) {
           if (!transactionHost) await transaction.rollback(); // Rollback before throwing
          throw new InternalServerErrorException(`Rifa ${raffleId} não possui um bilhete sorteado definido (winningTicket).`);
      }
      this.logger.log(`Finalizando Rifa Tradicional ${raffleId}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}`);

      // Step 2: Fetch associated tickets *within the same transaction*
      const winningTicket = await this.raffleTicketModel.findOne({
           where: { raffleId: raffle.id, ticketNumber: winningTicketNumberInternal },
           include: [User], // Include the user who bought it
           transaction // Use the same transaction
       });

      let winnerUserId: number | null = null;
      let prizeAmount = 0;

      if (winningTicket && winningTicket.user) {
        winnerUserId = winningTicket.userId;
        const winnerUser = winningTicket.user; // Use the fetched user instance
        this.logger.log(`Bilhete ${winningTicketNumberInternal} (usuário ${winnerUserId} - ${winnerUser.name}) é o vencedor.`);
        prizeAmount = raffle.ticketPrice * raffle.totalTickets * 0.7;
        // Increment on the fetched user instance
        await winnerUser.increment('balance', { by: prizeAmount, transaction });
        this.logger.log(`Prêmio de R$ ${prizeAmount.toFixed(2)} creditado ao usuário ${winnerUserId}.`);
      } else {
        this.logger.log(`Nenhum bilhete vendido corresponde ao número sorteado ${winningTicketNumberInternal}. Prêmio não distribuído.`);
      }

      // Step 3: Update the raffle status
      await raffle.update({
        finished: true,
        drawDate: now,
        winnerUserId: winnerUserId,
      }, { transaction });

      // Step 4: Commit transaction if it's local
      if (!transactionHost) await transaction.commit();

      this.logger.log(`Rifa Tradicional ${raffleId} finalizada com sucesso.`);

      // Step 5: Reload to get updated relations for the return value
      // Reload outside the lock/transaction logic is safer here
      await raffle.reload({ include: [{ model: User, as: 'winnerUser' }] }); // Reload with winner user
      return raffle;

    } catch (error) {
       // Ensure rollback if transaction was local and error occurred
       if (!transactionHost && transaction && !transaction.finished) {
            try {
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação da rifa ${raffleId} devido a erro.`);
            } catch (rollbackError) {
                this.logger.error(`Erro ao tentar executar rollback para rifa ${raffleId}: ${rollbackError}`);
            }
       }
      // Re-throw specific errors or log and throw generic
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Erro ao finalizar a rifa tradicional ${raffleId}: ${(error as any).message}`, (error as any).stack);
      throw new InternalServerErrorException('Erro interno ao finalizar a rifa.');
    }
  }





  @Cron('*/5 * * * *') // Roda a cada 5 minutos para verificar rifas a finalizar
  async finalizeRafflesCronJob() {
      const now = new Date();
      this.logger.log(`CRON [${now.toISOString()}]: Verificando rifas para finalizar...`);

      const rafflesToFinalize = await this.raffleModel.findAll({
          where: {
              finished: false,
              [Op.or]: [
                  { soldTickets: { [Op.gte]: Sequelize.col('totalTickets') } }, // Esgotadas
                  { endDate: { [Op.lte]: now } } // Data de fim atingida
              ]
          },
           lock: true, // Tenta bloquear as linhas encontradas
           skipLocked: true // Pula as que já estão bloqueadas por outra instância/processo
      });

      if (rafflesToFinalize.length === 0) {
          this.logger.log('CRON: Nenhuma rifa encontrada para finalizar nesta execução.');
          return;
      }

      this.logger.log(`CRON: Encontradas ${rafflesToFinalize.length} rifas para processar finalização.`);

      for (const raffle of rafflesToFinalize) {
          const transaction = await this.sequelize.transaction(); // Transação por rifa
          this.logger.log(`CRON: Processando Rifa ID: ${raffle.id}, Tipo: ${raffle.type}, Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}, EndDate: ${raffle.endDate?.toISOString()}`);
          try {
              if (raffle.type === 'tradicional') {
                  await this.finalizeRaffle(raffle.id, transaction); // Passa a transação
              } else if (raffle.type === 'equipes') {
                  await this.finalizeTeamRaffle(raffle.id, transaction); // Passa a transação
              }
              await transaction.commit();
              this.logger.log(`CRON: Rifa ${raffle.id} finalizada com sucesso.`);
          } catch (error) {
              await transaction.rollback();
              // Não lançar erro aqui para não parar o cron, apenas logar
              this.logger.error(`CRON: Erro ao finalizar rifa ${raffle.id}: ${(error as any).message}`);
              // Se o erro for BadRequest (ex: ainda não pode finalizar), pode ser normal
              if (!(error instanceof BadRequestException)) {
                 // Logar stack para outros tipos de erro
                 this.logger.error(`CRON: Stacktrace: ${(error as any).stack}`);
              }
          }
      }
      this.logger.log('CRON: Processamento de finalização de rifas concluído.');
  }


  async getRaffleTeams(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      attributes: ['id', 'type', 'totalTickets'], // Campos básicos da rifa
      include: [
        {
          model: RaffleTicket,
          attributes: ['ticketNumber', 'userId'], // Bilhetes comprados
          include: [
            { model: User, attributes: ['id', 'name'] }, // Dono do bilhete
          ],
        },
      ],
    });

    if (!raffle) throw new NotFoundException('Rifa não encontrada.');
    if (raffle.type !== 'equipes') throw new BadRequestException('Esta rota é válida apenas para rifas de equipes.');

    const formattedTeams = this.getFormattedTeams(raffle);

    // Formatar números de tickets para exibição 1-100 dentro da estrutura
    Object.values(formattedTeams).forEach((team: any) => {
        team.tickets = team.tickets.map(this.formatTicketNumberDisplay);
        team.members.forEach((member: any) => {
             member.tickets = member.tickets.map(this.formatTicketNumberDisplay);
        });
    });


    return formattedTeams;
  }


  async getRafflesPlayedByUser(userId: number): Promise<any[]> { // Alterado retorno para any[]
    const raffles = await this.raffleModel.findAll({
        include: [
            { model: RaffleTicket, where: { userId: userId }, required: true, include: [User] }, // Inclui User aqui se precisar
            { model: User, as: 'winnerUser', attributes: ['id', 'name'] },
            { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
        ],
        order: [['createdAt', 'DESC']],
    });
    // Formata cada rifa usando a função detalhada
    return raffles.map(raffle => this.formatRaffleDetails(raffle));
  }

  async getWonRafflesByUser(userId: number): Promise<any[]> { // Alterado retorno para any[]
    const raffles = await this.raffleModel.findAll({
      where: {
        winnerUserId: userId,
        finished: true,
      },
      include: [
          // Incluir tickets do usuário para contexto, mas não é estritamente necessário para filtro
          { model: RaffleTicket, where: { userId: userId }, required: true, include: [User]},
          { model: User, as: 'winnerUser', attributes: ['id', 'name'] }, // Já filtrado por winnerUserId, mas inclui para dados
          { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
      ],
      order: [['drawDate', 'DESC']], // Ordenar pelas mais recentes ganhas
    });
     // Formata cada rifa usando a função detalhada
     return raffles.map(raffle => this.formatRaffleDetails(raffle));
  }

  async getLostRafflesByUser(userId: number): Promise<any[]> { // Alterado retorno para any[]
    const raffles = await this.raffleModel.findAll({
      where: {
        finished: true,
        winnerUserId: { [Op.ne]: userId }, // Onde o vencedor NÃO é o usuário
        [Op.and]: [ // Garante que o usuário participou
            Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`)
        ]
      },
      include: [
          // Incluir winnerUser para saber quem ganhou
          { model: User, as: 'winnerUser', attributes: ['id', 'name'] },
          { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
          // Opcional: incluir os tickets do usuário para mostrar quais ele tinha
          { model: RaffleTicket, as: 'tickets', required: false, include: [User] } // Traz todos os tickets, filtrar no format se necessário
      ],
      order: [['drawDate', 'DESC']], // Ordenar pelas mais recentes perdidas
    });
     // Formata cada rifa usando a função detalhada
     return raffles.map(raffle => this.formatRaffleDetails(raffle));
  }

  async getUserRaffleData(userId: number): Promise<any> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'cpf', 'phone', 'balance'], // Dados do usuário
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // Busca todas as rifas que o usuário participou
    const playedRaffles = await this.raffleModel.findAll({
        include: [
            {
                model: RaffleTicket,
                as: 'tickets',
                where: { userId: userId }, // Filtra pelos tickets DO usuário
                required: true, // Garante que só venham rifas que ele jogou
                include: [{ model: User }] // Usuário do ticket (será ele mesmo)
            },
            { model: User, as: 'winnerUser', attributes: ['id', 'name'] }, // Quem ganhou a rifa
            { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
            { model: User, as: 'createdByUser', attributes: ['id', 'name']} // Quem criou (se aplicável)
        ],
        order: [['createdAt', 'DESC']] // Ordena as rifas
    });

    // Mapeia e formata os detalhes de cada rifa jogada
    const formattedPlayedRaffles = playedRaffles.map(raffle => {
         const details = this.formatRaffleDetails(raffle);
         // Adiciona os tickets específicos do usuário a esta rifa formatada
         details.userTickets = this.formatRaffleTickets(raffle) // Formata TODOS os tickets da rifa
                               .filter(ticket => ticket.user?.id === userId); // Filtra apenas os do usuário logado
         return details;
     });

    return {
      userData: {
            userId: user.id,
            name: user.name,
            email: user.email,
            cpf: user.cpf,
            phone: user.phone,
            balance: user.balance,
      },
      playedRaffles: formattedPlayedRaffles, // Lista de rifas jogadas formatadas
    };
  }

  async createTeamRaffle(ticketPrice: number): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({ order: [['timestamp', 'DESC']] });
    if (!latestHash) throw new NotFoundException('Nenhuma hash de blockchain encontrada.');

    const correspondingSeed = await this.seedModel.findOne({
        where: { hashId: latestHash.id },
        include: [{ model: GeneratedNumber, order: [['createdAt', 'DESC']], limit: 1 }],
        order: [['createdAt', 'DESC']],
    });
    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
        throw new NotFoundException(`Nenhuma seed/generatedNumber encontrado para a hash ${latestHash.id}. Execute a geração de números.`);
    }

    const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(latestGeneratedNumber.number) % 100n;
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0'); // 00-99

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7); // 7 dias para finalizar, por exemplo

    const newRaffle = await this.raffleModel.create({
        raffleIdentifier: `RIFA-EQUIPES-${Date.now()}`,
        type: 'equipes', // Define o tipo
        title: `Rifa de Equipes - R$ ${ticketPrice.toFixed(2)}`,
        description: `Rifa de equipes gerada automaticamente. Prêmio: 50% (bilhete exato) + 30% (outros membros da equipe). Hash: ${latestHash.hash}`,
        ticketPrice: ticketPrice,
        totalTickets: 100, // 00-99
        soldTickets: 0,
        startDate: startDate,
        endDate: endDate, // Data de fim
        finished: false,
        winningTicket: winningTicketNumber, // Armazena 00-99
        drawDate: null,
    });

    await this.raffleNumberModel.create({
        raffleId: newRaffle.id,
        numberId: latestGeneratedNumber.id,
    });

    this.logger.log(
        `Rifa de Equipes ${newRaffle.raffleIdentifier} criada. Preço: R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );
    return newRaffle;
  }

  private getTeamNameByTicketNumber(raffle: Raffle, ticketNumber: string): string {
    if (!ticketNumber || raffle.type !== 'equipes') return 'N/A'; // Ajuste para retornar N/A
    try {
        const ticketNumberInt = parseInt(ticketNumber, 10); // ticketNumber é 00-99
        if (isNaN(ticketNumberInt) || ticketNumberInt < 0 || ticketNumberInt >= raffle.totalTickets) {
            return 'Inválido';
        }
        const teamIndex = Math.floor(ticketNumberInt / 4); // 0-24 para 100 tickets
        return this.teamNames[teamIndex] || 'Desconhecido'; // Retorna nome ou 'Desconhecido'
     } catch (e) {
         return 'Erro';
     }
  }

  private getFormattedTeams(raffle: Raffle): any {
    if (raffle.type !== 'equipes') return {}; // Retorna objeto vazio se não for de equipes

    const totalTickets = raffle.totalTickets; // Geralmente 100
    const ticketsPerTeam = 4; // Fixo em 4
    const totalTeams = Math.min(this.teamNames.length, Math.floor(totalTickets / ticketsPerTeam)); // Usa o menor entre nomes disponíveis e times possíveis
    const teams = {};

    const ticketsMap = new Map(raffle.tickets?.map(t => [t.ticketNumber, t]) || []); // Mapa para busca rápida de tickets comprados

    for (let i = 0; i < totalTeams; i++) {
      const teamName = this.teamNames[i];
      const teamTicketsInternal: string[] = []; // Armazena 00-99 internamente
      const membersMap = new Map<number, { id: number; name: string; tickets: string[] }>(); // Mapa de membros por ID

      for (let j = 0; j < ticketsPerTeam; j++) {
        const ticketNumberInternal = (i * ticketsPerTeam + j).toString().padStart(2, '0'); // 00-99
        teamTicketsInternal.push(ticketNumberInternal);

        const purchasedTicket = ticketsMap.get(ticketNumberInternal);
        if (purchasedTicket && purchasedTicket.user) {
          const userId = purchasedTicket.user.id;
          if (!membersMap.has(userId)) {
            membersMap.set(userId, {
              id: userId,
              name: purchasedTicket.user.name,
              tickets: [], // Armazenará números internos 00-99
            });
          }
          membersMap.get(userId)?.tickets.push(ticketNumberInternal);
        }
      }

      teams[teamName] = {
        teamName: teamName,
        tickets: teamTicketsInternal, // Lista de números internos 00-99 do time
        members: Array.from(membersMap.values()), // Lista de membros com seus tickets internos
      };
    }

    return teams;
  }

  getTeamNames() {
    return this.teamNames;
  }

    @Cron(CronExpression.EVERY_HOUR) // Roda junto com a criação de rifas tradicionais
    async createTeamRafflesCronJob() {
        // Esta lógica foi integrada em `createRafflesCronJob`
         // Este método pode ser removido ou mantido vazio se `createRafflesCronJob` já cobre
        // this.logger.log('CRON: createTeamRafflesCronJob chamado (lógica agora em createRafflesCronJob)');
    }

    async finalizeTeamRaffle(raffleId: number, transactionHost?: any): Promise<Raffle> {
      const transaction = transactionHost ? transactionHost : await this.sequelize.transaction();
      try {
        // Step 1: Find and lock the Raffle row ONLY
        const raffle = await this.raffleModel.findByPk(raffleId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
          // NO includes here for locking!
        });
  
        if (!raffle) {
           if (!transactionHost) await transaction.rollback();
           throw new NotFoundException('Rifa não encontrada.');
        }
        if (raffle.finished) {
             this.logger.warn(`Tentativa de finalizar rifa de equipes ${raffleId} que já está finalizada.`);
             if (!transactionHost) await transaction.commit();
             // Reload before returning
              await raffle.reload({ include: [{ model: User, as: 'winnerUser' }, { model: RaffleTicket, include: [User]}] });
             return raffle;
        }
         if (raffle.type !== 'equipes') {
           if (!transactionHost) await transaction.rollback();
           throw new BadRequestException(`A Rifa ${raffleId} é do tipo ${raffle.type} e não pode ser finalizada por este método.`);
         }
  
        const now = new Date();
        const isSoldOut = raffle.soldTickets >= raffle.totalTickets;
        const isEndDateReached = raffle.endDate && raffle.endDate <= now;
  
        if (!isSoldOut && !isEndDateReached) {
             if (!transactionHost) await transaction.rollback(); // Rollback before throwing
           throw new BadRequestException(
             `A rifa de equipes ${raffleId} ainda não pode ser finalizada. Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}. Fim: ${raffle.endDate?.toISOString() ?? 'N/A'}.`
           );
        }
  
        const winningTicketNumberInternal = raffle.winningTicket;
         if (!winningTicketNumberInternal) {
              if (!transactionHost) await transaction.rollback(); // Rollback before throwing
             throw new InternalServerErrorException(`Rifa de equipes ${raffleId} não possui um bilhete sorteado definido.`);
         }
        this.logger.log(`Finalizando Rifa de Equipes ${raffleId}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}`);
  
        // Step 2: Fetch associated tickets *within the same transaction*
        const tickets = await this.raffleTicketModel.findAll({
            where: { raffleId: raffle.id },
            include: [{ model: User }], // Include user data for prize calculation
            transaction, // Ensure it uses the same transaction
        });
        // Optional: Attach fetched tickets to the raffle instance if needed by helper functions directly
        // raffle.tickets = tickets; // Or pass 'tickets' explicitly to helpers
  
        // --- Calculation and Distribution Logic (using the fetched 'tickets') ---
        const totalPotentialPrize = raffle.ticketPrice * raffle.totalTickets;
        const mainPrize = totalPotentialPrize * 0.5;
        const teamPrizePool = totalPotentialPrize * 0.3;
        let mainWinnerUserId: number | null = null;
  
        // 1. Pagar Prêmio Principal (50%)
        const mainWinningTicket = tickets.find(t => t.ticketNumber === winningTicketNumberInternal);
        if (mainWinningTicket && mainWinningTicket.user) {
            mainWinnerUserId = mainWinningTicket.userId;
            const mainWinner = mainWinningTicket.user; // Use user from fetched ticket
             this.logger.log(`Prêmio Principal (50% = R$ ${mainPrize.toFixed(2)}) para usuário ${mainWinnerUserId} (${mainWinner.name}) - Bilhete ${winningTicketNumberInternal}`);
            // IMPORTANT: Use the user instance fetched with the ticket
            await mainWinner.increment('balance', { by: mainPrize, transaction });
        } else {
             this.logger.log(`Ninguém comprou o bilhete principal ${winningTicketNumberInternal}. Prêmio principal não distribuído.`);
        }
  
        // 2. Pagar Prêmio da Equipe (30%)
         // Pass the fetched tickets to the helper function if it needs them,
         // otherwise use the tickets variable directly here.
        const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal); // Pass raffle, ticket number
        if (winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
            // Filter from the fetched 'tickets' array
            const winningTeamTickets = tickets.filter(
                (ticket) => this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName
            );
  
            const teamMemberUserIds = new Set<number>();
            const userMap = new Map<number, User>(); // Use users fetched with tickets
  
            winningTeamTickets.forEach(ticket => {
                if (ticket.user && ticket.userId !== mainWinnerUserId) { // Exclude main winner
                    teamMemberUserIds.add(ticket.userId);
                     if (!userMap.has(ticket.userId)) {
                         userMap.set(ticket.userId, ticket.user); // Store user from ticket
                     }
                }
            });
  
            const numberOfTeamMembers = teamMemberUserIds.size;
            if (numberOfTeamMembers > 0) {
                const individualTeamPrize = teamPrizePool / numberOfTeamMembers;
                this.logger.log(`Prêmio da Equipe ${winningTeamName} (30% = R$ ${teamPrizePool.toFixed(2)}) dividido entre ${numberOfTeamMembers} membro(s). Cada um recebe R$ ${individualTeamPrize.toFixed(2)}.`);
  
                for (const userId of teamMemberUserIds) {
                    const user = userMap.get(userId); // Get user from the map
                     if (user) {
                         // Use the user instance from the map for increment
                        await user.increment('balance', { by: individualTeamPrize, transaction });
                         this.logger.log(` - Creditado R$ ${individualTeamPrize.toFixed(2)} para usuário ${userId} (${user.name})`);
                     } else {
                          // This case should ideally not happen if tickets include users correctly
                          this.logger.error(`Usuário ${userId} da equipe vencedora não encontrado no mapa! Prêmio não creditado.`);
                     }
                }
            } else {
                this.logger.log(`Equipe Vencedora ${winningTeamName}: Nenhum outro membro (além do vencedor principal, se houver) comprou bilhetes. Prêmio da equipe (R$ ${teamPrizePool.toFixed(2)}) não distribuído.`);
            }
        } else {
            this.logger.log(`Não foi possível determinar a equipe vencedora (ticket: ${winningTicketNumberInternal}, nome: ${winningTeamName}). Prêmio da equipe não distribuído.`);
        }
  
        // --- Update Raffle Status ---
        await raffle.update({
          finished: true,
          drawDate: now,
          winnerUserId: mainWinnerUserId, // Set the main winner (exact ticket holder)
        }, { transaction });
  
         // --- Commit ---
        if (!transactionHost) await transaction.commit();
        this.logger.log(`Rifa de equipe ${raffleId} finalizada com sucesso.`);
  
         // --- Reload and Return ---
         // Reload outside the lock/transaction logic to get fresh data with relations
         await raffle.reload({ include: [{ model: User, as: 'winnerUser' }, { model: RaffleTicket, include: [User]}] }); // Include necessary relations
        return raffle;
  
      } catch (error) {
          // Ensure rollback if transaction was local and error occurred
         if (!transactionHost && transaction && !transaction.finished) {
              try {
                  await transaction.rollback();
                  this.logger.warn(`Rollback executado para transação da rifa ${raffleId} devido a erro.`);
              } catch (rollbackError) {
                   this.logger.error(`Erro ao tentar executar rollback para rifa ${raffleId}: ${rollbackError}`);
              }
         }
         // Re-throw specific errors or log and throw generic
        if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException || error instanceof InternalServerErrorException) {
           throw error;
        }
        this.logger.error(`Erro ao finalizar a rifa de equipe ${raffleId}: ${(error as any).message}`, (error as any).stack);
        throw new InternalServerErrorException('Erro interno ao finalizar a rifa de equipe.');
      }
    }
  


  async getRaffleTeamsWithAvailability(raffleId: number): Promise<any> {
      const raffle = await this.raffleModel.findByPk(raffleId, {
          attributes: ['id', 'type', 'totalTickets', 'finished'], // Inclui 'finished'
          include: [
              { model: RaffleTicket, attributes: ['ticketNumber', 'userId'], include: [{ model: User, attributes: ['id', 'name'] }] },
          ],
      });

      if (!raffle) throw new NotFoundException('Rifa não encontrada.');
      if (raffle.type !== 'equipes') throw new BadRequestException('Esta rota é válida apenas para rifas de equipes.');
       if (raffle.finished) throw new BadRequestException('Esta rifa já foi finalizada, não há disponibilidade.');


      const formattedTeams = this.getFormattedTeams(raffle); // Usa a função que retorna números internos 00-99

      const allInternalTickets = Array.from({ length: raffle.totalTickets }, (_, i) => i.toString().padStart(2, '0'));
      const purchasedInternalTickets = new Set(raffle.tickets.map(t => t.ticketNumber));

      const availableTicketsByTeam: { [key: string]: string[] } = {}; // Armazenará números formatados 1-100

      for (const teamName of Object.keys(formattedTeams)) {
          const teamData = formattedTeams[teamName];
          availableTicketsByTeam[teamName] = teamData.tickets // Pega os tickets INTERNOS do time (00-99)
              .filter(internalTicket => !purchasedInternalTickets.has(internalTicket)) // Filtra os que NÃO foram comprados
              .map(this.formatTicketNumberDisplay); // Formata os disponíveis para 1-100
      }

       // Formata os números dos tickets dentro dos times e membros para exibição 1-100
       Object.values(formattedTeams).forEach((team: any) => {
            team.tickets = team.tickets.map(this.formatTicketNumberDisplay); // Números totais do time
            team.members.forEach((member: any) => {
                member.tickets = member.tickets.map(this.formatTicketNumberDisplay); // Números comprados pelo membro
            });
        });


      return {
          raffleId: raffle.id,
          teams: Object.values(formattedTeams), // Dados dos times com tickets formatados 1-100
          availableTicketsByTeam: availableTicketsByTeam, // Tickets disponíveis por time, formatados 1-100
      };
  }


  // Método obsoleto ou não implementado, remover ou implementar se necessário
  // sendNotification(userId: number, arg1: string) {
  //   throw new Error('Method not implemented.');
  // }
}