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
) {}


  async initializeFixedRaffles() {
    this.logger.log('Inicializando rifas fixas...');
    for (const price of this.fixedRafflePrices) {
        try {
            await this.createSystemRaffle(price);
            this.logger.log(`Rifa tradicional de R$ ${price.toFixed(2)} inicializada.`);
        } catch (error) {
            this.logger.error(`Erro ao inicializar rifa tradicional de R$ ${price.toFixed(2)}: ${(error as any).message}`);
        }
        try {
            await this.createTeamRaffle(price);
            this.logger.log(`Rifa de equipes de R$ ${price.toFixed(2)} inicializada.`);
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
      this.logger.log(`Buscando rifas tradicionais ativas para o preço: ${price}`);
      const traditionalRaffles = await this.raffleModel.findAll({
          where: {
              ticketPrice: price,
              type: 'tradicional',
              finished: false,
          },
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name', 'email'],
                      },
                  ],
              },
              {
                  model: User,
                  as: 'winnerUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: RaffleNumber,
                  include: [
                      {
                          model: GeneratedNumber,
                          include: [
                              {
                                  model: Seed,
                                  include: [
                                      {
                                          model: BlockchainHash,
                                      },
                                  ],
                              },
                          ],
                      },
                  ],
              },
          ],
          order: [['createdAt', 'DESC']],
          limit: 6,
      });
      this.logger.log(`Rifas tradicionais encontradas para o preço ${price}:`, traditionalRaffles);

      const teamRaffles = await this.raffleModel.findAll({
          where: {
              ticketPrice: price,
              type: 'equipes',
              finished: false,
          },
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name', 'email'],
                      },
                  ],
              },
              {
                  model: User,
                  as: 'winnerUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: RaffleNumber,
                  include: [
                      {
                          model: GeneratedNumber,
                          include: [
                              {
                                  model: Seed,
                                  include: [
                                      {
                                          model: BlockchainHash,
                                      },
                                  ],
                              },
                          ],
                      },
                  ],
              },
          ],
          order: [['createdAt', 'DESC']],
          limit: 6,
      });
      this.logger.log(`Rifas de equipes encontradas para o preço ${price}:`, teamRaffles);

      activeFixedRaffles[price] = {
          tradicional: traditionalRaffles.map(raffle => ({
              id: raffle.id,
              raffleIdentifier: raffle.raffleIdentifier,
              type: raffle.type,
              winner: raffle.winnerUser ? { id: raffle.winnerUser.id, name: raffle.winnerUser.name, email: raffle.winnerUser.email } : null,
              winningTeam: null,
              title: raffle.title,
              description: raffle.description,
              ticketPrice: String(raffle.ticketPrice),
              totalTickets: raffle.totalTickets,
              soldTickets: raffle.soldTickets,
              startDate: raffle.startDate,
              endDate: raffle.endDate,
              drawDate: raffle.drawDate,
              finished: raffle.finished,
              winningTicket: raffle.winningTicket,
              createdAt: raffle.createdAt,
              updatedAt: raffle.updatedAt,
          })),
          equipes: teamRaffles.map(raffle => ({
              id: raffle.id,
              raffleIdentifier: raffle.raffleIdentifier,
              type: raffle.type,
              winner: raffle.winnerUser ? { id: raffle.winnerUser.id, name: raffle.winnerUser.name, email: raffle.winnerUser.email } : null,
              winningTeam: null,
              title: raffle.title,
              description: raffle.description,
              ticketPrice: String(raffle.ticketPrice),
              totalTickets: raffle.totalTickets,
              soldTickets: raffle.soldTickets,
              startDate: raffle.startDate,
              endDate: raffle.endDate,
              drawDate: raffle.drawDate,
              finished: raffle.finished,
              winningTicket: raffle.winningTicket,
              createdAt: raffle.createdAt,
              updatedAt: raffle.updatedAt,
          })),
      };
  }

  return activeFixedRaffles;
}

async getAllFixedAndExtraRaffles(): Promise<any> {
  this.logger.log('Buscando todas as rifas fixas e extras...');
  const allFixedRaffles = {
      tradicional: {},
      equipes: {}
  };

  for (const price of this.fixedRafflePrices) {
      this.logger.log(`Buscando rifas tradicionais para o preço: ${price}`);
      const traditionalRaffles = await this.raffleModel.findAll({
          where: {
              ticketPrice: price,
              type: 'tradicional',
          },
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name', 'email'],
                      },
                  ],
              },
              {
                  model: User,
                  as: 'winnerUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: RaffleNumber,
                  include: [
                      {
                          model: GeneratedNumber,
                          include: [
                              {
                                  model: Seed,
                                  include: [
                                      {
                                          model: BlockchainHash,
                                      },
                                  ],
                              },
                          ],
                      },
                  ],
              },
          ],
          order: [['createdAt', 'DESC']],
      });
      this.logger.log(`Rifas tradicionais encontradas para o preço ${price}:`, traditionalRaffles);

      const teamRaffles = await this.raffleModel.findAll({
          where: {
              ticketPrice: price,
              type: 'equipes',
          },
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name', 'email'],
                      },
                  ],
              },
              {
                  model: User,
                  as: 'winnerUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: RaffleNumber,
                  include: [
                      {
                          model: GeneratedNumber,
                          include: [
                              {
                                  model: Seed,
                                  include: [
                                      {
                                          model: BlockchainHash,
                                      },
                                  ],
                              },
                          ],
                      },
                  ],
              },
          ],
          order: [['createdAt', 'DESC']],
      });
      this.logger.log(`Rifas de equipes encontradas para o preço ${price}:`, teamRaffles);

      allFixedRaffles.tradicional[price] = traditionalRaffles.map(raffle => ({
          id: raffle.id,
          raffleIdentifier: raffle.raffleIdentifier,
          type: raffle.type,
          winner: raffle.winnerUser ? { id: raffle.winnerUser.id, name: raffle.winnerUser.name, email: raffle.winnerUser.email } : null,
          winningTeam: null,
          title: raffle.title,
          description: raffle.description,
          ticketPrice: String(raffle.ticketPrice),
          totalTickets: raffle.totalTickets,
          soldTickets: raffle.soldTickets,
          startDate: raffle.startDate,
          endDate: raffle.endDate,
          drawDate: raffle.drawDate,
          finished: raffle.finished,
          winningTicket: raffle.winningTicket,
          createdAt: raffle.createdAt,
          updatedAt: raffle.updatedAt,
      }));
      allFixedRaffles.equipes[price] = teamRaffles.map(raffle => ({
          id: raffle.id,
          raffleIdentifier: raffle.raffleIdentifier,
          type: raffle.type,
          winner: raffle.winnerUser ? { id: raffle.winnerUser.id, name: raffle.winnerUser.name, email: raffle.winnerUser.email } : null,
          winningTeam: null,
          title: raffle.title,
          description: raffle.description,
          ticketPrice: String(raffle.ticketPrice),
          totalTickets: raffle.totalTickets,
          soldTickets: raffle.soldTickets,
          startDate: raffle.startDate,
          endDate: raffle.endDate,
          drawDate: raffle.drawDate,
          finished: raffle.finished,
          winningTicket: raffle.winningTicket,
          createdAt: raffle.createdAt,
          updatedAt: raffle.updatedAt,
      }));
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
        throw new NotFoundException(
            'Nenhuma seed ou generatedNumber correspondente encontrado para a hash mais recente.',
        );
    }

    const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(latestGeneratedNumber.number) % 100n;
    const startDate = new Date();

    const newRaffle = await this.raffleModel.create({
        raffleIdentifier: `RIFA-${Date.now()}`,
        createdBy: null,
        title: `Rifa Automática - R$ ${ticketPrice.toFixed(2)}`,
        description: `Rifa gerada automaticamente com base na hash ${latestHash.hash} - R$ ${ticketPrice.toFixed(2)}`,
        ticketPrice: ticketPrice,
        totalTickets: 100,
        soldTickets: 0,
        startDate: startDate,
        endDate: null,
        finished: false,
        winningTicket: lastTwoDigits.toString().padStart(2, '0'),
    }, {
        transaction: null,
    });

    await this.raffleNumberModel.create({
        raffleId: newRaffle.id,
        numberId: latestGeneratedNumber.id,
    }, {
        transaction: null,
    });

    this.logger.log(
        `Rifa criada com sucesso: ${newRaffle.raffleIdentifier}, winningTicket(temp): ${lastTwoDigits
            .toString()
            .padStart(2, '0')}, generatedNumberId: ${latestGeneratedNumber.id}, Preço: R$ ${ticketPrice.toFixed(2)}`,
    );

    return newRaffle;
}
    async createRafflesCronJob() {
      this.logger.log('Iniciando cron job para criar rifas fixas e extras tradicionais...');
      for (const price of this.fixedRafflePrices) {
          const activeRaffles = await this.raffleModel.findAll({
              where: {
                  ticketPrice: price,
                  type: 'tradicional',
                  finished: false,
              },
          });

          if (activeRaffles.length < 6) {
              try {
                  const newRaffle = await this.createSystemRaffle(price);
                  this.logger.log(`Rifa tradicional de R$ ${price.toFixed(2)} criada pelo cron job (extra/reposição) com id: ${newRaffle.id}`);
              } catch (error) {
                  this.logger.error(
                      `Erro ao criar rifa tradicional de R$ ${price.toFixed(2)} pelo cron job (extra/reposição): ${(error as any).message}`,
                  );
              }
          }
      }
      this.logger.log('Cron job para criar rifas fixas e extras tradicionais concluído.');
  }

  async buyRaffleTickets(
    userId: number,
    raffleId: number,
    ticketData: { type: 'tradicional' | 'equipes'; quantityOrNumbers: number | string[] },
  ): Promise<RaffleTicket[]> {
    const transaction = await this.sequelize.transaction();
    try {
      const user = await this.userModel.findByPk(userId, { transaction });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      const raffle = await this.raffleModel.findByPk(raffleId, {
        transaction,
        include: [
          {
            model: RaffleTicket,
            attributes: ['ticketNumber'],
          },
        ],
      });
      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }

      if (raffle.finished) {
        throw new BadRequestException('Esta rifa já foi finalizada.');
      }

      let quantity: number;
      let ticketNumbers: string[];

      if (ticketData.type === 'tradicional') {
        if (typeof ticketData.quantityOrNumbers === 'number') {
          quantity = ticketData.quantityOrNumbers;
          if (raffle.soldTickets + quantity > raffle.totalTickets) {
            throw new BadRequestException(
              'Não há bilhetes suficientes disponíveis.',
            );
          }
          ticketNumbers = this.generateUniqueTicketNumbers(raffle, quantity);
        } else {
          ticketNumbers = ticketData.quantityOrNumbers;
          quantity = ticketNumbers.length;

          const validTicketNumbers = ticketNumbers.every((ticketNumber) => {
            const num = parseInt(ticketNumber, 10);
            return (
              num >= 0 &&
              num < raffle.totalTickets &&
              !raffle.tickets.some(
                (ticket) => ticket.ticketNumber === ticketNumber,
              )
            );
          });

          if (!validTicketNumbers) {
            throw new BadRequestException(
              'Números de bilhetes inválidos ou já comprados.',
            );
          }
        }
      } else {
        if (typeof ticketData.quantityOrNumbers === 'number') {
          quantity = ticketData.quantityOrNumbers;
          if (raffle.soldTickets + quantity > raffle.totalTickets) {
            throw new BadRequestException(
              'Não há bilhetes suficientes disponíveis.',
            );
          }
          ticketNumbers = this.generateUniqueTicketNumbers(raffle, quantity);
        } else {
          ticketNumbers = ticketData.quantityOrNumbers;
          quantity = ticketNumbers.length;

          const validTeamTicketNumbers = ticketNumbers.every((ticketNumber) => {
            const num = parseInt(ticketNumber, 10);
            return num >= 0 && num < raffle.totalTickets;
          });

          if (!validTeamTicketNumbers) {
            throw new BadRequestException(
              'Números de bilhetes inválidos para a rifa de equipes.',
            );
          }

          const existingTickets = raffle.tickets.filter((ticket) =>
            ticketNumbers.includes(ticket.ticketNumber),
          );
          if (existingTickets.length > 0) {
            throw new BadRequestException(
              `Os seguintes bilhetes já foram comprados: ${existingTickets
                .map((ticket) => ticket.ticketNumber)
                .join(', ')}`,
            );
          }
        }
      }

      if (user.balance < raffle.ticketPrice * quantity) {
        throw new BadRequestException('Saldo insuficiente.');
      }

      const createdTickets = await this.raffleTicketModel.bulkCreate(
        ticketNumbers.map((ticketNumber) => ({
          userId,
          raffleId,
          ticketNumber,
        })),
        { transaction },
      );

      this.logger.log(
        `Registros RaffleTicket criados: ${createdTickets.map((t) => t.id).join(', ')}`,
      );

      await user.update(
        { balance: user.balance - raffle.ticketPrice * quantity },
        { transaction },
      );

      await raffle.update(
        { soldTickets: raffle.soldTickets + quantity },
        { transaction },
      );

      if (raffle.soldTickets >= raffle.totalTickets) {
        this.logger.log(`Rifa ${raffleId} (tipo: ${raffle.type}) esgotou os bilhetes. Criando nova rifa temporária...`);

        const ticketPriceNumber = Number(raffle.ticketPrice);

        if (raffle.type === 'tradicional') {
          await this.createSystemRaffle(ticketPriceNumber);
        } else if (raffle.type === 'equipes') {
          await this.createTeamRaffle(ticketPriceNumber);
        }
        this.logger.log(`Rifa temporária criada após esgotamento da rifa ${raffleId}.`);
      }


      await transaction.commit();
      await new Promise(resolve => setTimeout(resolve, 2000));

      this.logger.log(
        `Usuário ${userId} comprou ${quantity} bilhete(s) para a rifa ${raffleId}. Bilhetes: ${ticketNumbers.join(
          ', ',
        )}`,
      );

      return createdTickets;
    } catch (error) {
      await transaction.rollback();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `Erro ao comprar bilhetes para a rifa ${raffleId} pelo usuário ${userId}: ${(error as any).message}`,
        (error as any).stack,
      );
      throw new InternalServerErrorException(
        'Erro ao comprar bilhetes. Por favor, tente novamente.',
      );
    }
  }

    private generateUniqueTicketNumber(raffle: Raffle): string {
        let ticketNumber: string
        do {
            ticketNumber = Math.floor(Math.random() * raffle.totalTickets).toString().padStart(raffle.totalTickets.toString().length, '0');
        } while (raffle.tickets && raffle.tickets.some(ticket => ticket.ticketNumber === ticketNumber));

        return ticketNumber;
    }

    private generateUniqueTicketNumbers(raffle: Raffle, quantity: number): string[] {
      const ticketNumbers = new Set<string>();
      while (ticketNumbers.size < quantity) {
        let ticketNumber = Math.floor(Math.random() * raffle.totalTickets).toString();
        if (parseInt(ticketNumber, 10) < 10) {
          ticketNumber = ticketNumber.padStart(2, '0');
        }

        if (
          !raffle.tickets.some((ticket) => ticket.ticketNumber === ticketNumber)
        ) {
          ticketNumbers.add(ticketNumber);
        }
      }
      return Array.from(ticketNumbers);
    }

    async getRafflesWithDetails(filters: any = {}): Promise<any[]> {
      const where: any = {};

      if (filters.finished !== undefined) {
          where.finished = filters.finished;
      }
      if (filters.winnerUserId) {
          where.winnerUserId = filters.winnerUserId;
      }
      if (filters.userId) {
          where['$tickets.userId$'] = filters.userId;
      }
      if (filters.type) {
          where.type = filters.type;
      }
      if (filters.startDate) {
          where.startDate = {
              [Op.gte]: new Date(filters.startDate),
          };
      }
      if (filters.endDate) {
          where.endDate = {
              [Op.lte]: new Date(filters.endDate),
          };
      }

      const raffles = await this.raffleModel.findAll({
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name', 'email'],
                      },
                  ],
              },
              {
                  model: User,
                  as: 'winnerUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: RaffleNumber,
                  include: [
                      {
                          model: GeneratedNumber,
                          include: [
                              {
                                  model: Seed,
                                  include: [
                                      {
                                          model: BlockchainHash,
                                      },
                                  ],
                              },
                          ],
                      },
                  ],
              },
          ],
          where,
          order: [['createdAt', 'DESC']],
      });

      return raffles.map((raffle) => {
          let winningTeam = null;
          if (raffle.type === 'equipes' && raffle.finished) {
              const winningDezena = raffle.winningTicket;
              const formattedTeams = this.getFormattedTeams(raffle);
              const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningDezena);
              winningTeam = formattedTeams[winningTeamName];
          }

          return {
              id: raffle.id,
              raffleIdentifier: raffle.raffleIdentifier,
              type: raffle.type,
              winner: raffle.winnerUser
                  ? {
                      id: raffle.winnerUser.id,
                      name: raffle.winnerUser.name,
                      email: raffle.winnerUser.email,
                  }
                  : null,
              winningTeam: winningTeam,
              title: raffle.title,
              description: raffle.description,
              ticketPrice: raffle.ticketPrice,
              totalTickets: raffle.totalTickets,
              soldTickets: raffle.soldTickets,
              startDate: raffle.startDate,
              endDate: raffle.endDate,
              drawDate: raffle.drawDate,
              finished: raffle.finished,
              winningTicket: raffle.winningTicket,
              winningTicketInfo: this.formatWinningTicketInfo(raffle),
              tickets: this.formatRaffleTickets(raffle),
              createdAt: raffle.createdAt,
              updatedAt: raffle.updatedAt,
          };
      });
  }

    private formatWinningTicketInfo(raffle: Raffle): any {
      if (!raffle.finished) {
        return null;
      }
      if (!raffle.raffleNumbers || raffle.raffleNumbers.length === 0) {
        return null;
      }

      const generatedNumber = raffle.raffleNumbers[0].generatedNumber;
      const seed = generatedNumber ? generatedNumber.seed : null;
      const blockchainHash = seed ? seed.blockchainHash : null;

      return {
        ticketNumber: raffle.winningTicket,
        numberId: generatedNumber ? generatedNumber.id : null,
        dezena: generatedNumber ? generatedNumber.number.toString().slice(-2) : null,
        generatedNumber: generatedNumber ? generatedNumber.number : null,
        sequence: generatedNumber ? generatedNumber.sequence : null,
        hash: blockchainHash ? blockchainHash.hash : null,
        hashTimestamp: blockchainHash ? blockchainHash.timestamp : null,
      };
    }

    public formatRaffleTickets(raffle: Raffle): any[] {
      if (!raffle.tickets) {
        return [];
      }

      if (raffle.type === 'equipes') {
        const formattedTeams = this.getFormattedTeams(raffle);

        return raffle.tickets.map(ticket => {
          const teamName = this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber);
          const team = formattedTeams[teamName];

          return {
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            user: ticket.user ? {
              id: ticket.user.id,
              name: ticket.user.name,
              email: ticket.user.email,
            } : null,
            team: team ? {
              teamName: team.teamName,
              tickets: team.tickets,
              members: team.members,
            } : null,
            createdAt: ticket.createdAt,
          };
        });
      } else {
        return raffle.tickets.map(ticket => ({
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          user: ticket.user ? {
            id: ticket.user.id,
            name: ticket.user.name,
            email: ticket.user.email,
          } : null,
          createdAt: ticket.createdAt,
        }));
      }
    }

async getRaffleByIdWithDetails(raffleId: number): Promise<any> {
  const raffle = await this.raffleModel.findByPk(raffleId, {
    include: [
      {
        model: RaffleTicket,
        as: 'tickets',
        include: [
          {
            model: User,
            attributes: ['id', 'name', 'email'],
          },
        ],
      },
      {
        model: User,
        as: 'winnerUser',
        attributes: ['id', 'name', 'email'],
      },
      {
        model: RaffleNumber,
        include: [
          {
            model: GeneratedNumber,
            include: [
              {
                model: Seed,
                include: [
                  {
                    model: BlockchainHash,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  if (!raffle) {
    throw new NotFoundException('Rifa não encontrada.');
  }

  let winningTeam = null;
    if (raffle.type === 'equipes' && raffle.finished) {
      const winningDezena = raffle.winningTicket;
      const formattedTeams = this.getFormattedTeams(raffle);
      const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningDezena);
      winningTeam = formattedTeams[winningTeamName];
    }
  return {
    id: raffle.id,
    raffleIdentifier: raffle.raffleIdentifier,
    type: raffle.type,
    winner: raffle.winnerUser
      ? {
          id: raffle.winnerUser.id,
          name: raffle.winnerUser.name,
          email: raffle.winnerUser.email,
        }
      : null,
    winningTeam: winningTeam,
    title: raffle.title,
    description: raffle.description,
    ticketPrice: raffle.ticketPrice,
    totalTickets: raffle.totalTickets,
    soldTickets: raffle.soldTickets,
    startDate: raffle.startDate,
    endDate: raffle.endDate,
    drawDate: raffle.drawDate,
    finished: raffle.finished,
    winningTicket: this.formatWinningTicketInfo(raffle),
    tickets: this.formatRaffleTickets(raffle),
    createdAt: raffle.createdAt,
    updatedAt: raffle.updatedAt,
  };
}

async finalizeRaffle(raffleId: number, transactionHost?: any): Promise<Raffle> {
  const transaction = transactionHost
    ? transactionHost
    : await this.sequelize.transaction();
  try {
    let raffle = await this.raffleModel.findByPk(raffleId, {
      include: [
        {
          model: RaffleTicket,
        },
        {
          model: User,
          as: 'winnerUser',
          attributes: ['id', 'name', 'email'],
        },
      ],
      transaction,
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    if (raffle.finished) {
      throw new ConflictException('Rifa já finalizada.');
    }

    const now = new Date();
    if (
      (!raffle.endDate || raffle.endDate > now) &&
      raffle.soldTickets < raffle.totalTickets
    ) {
      throw new BadRequestException(
        'A rifa ainda não atingiu a data de sorteio ou todos os bilhetes não foram vendidos.',
      );
    }

    const winningDezena = raffle.winningTicket;
    this.logger.log(`Dezena vencedora: ${winningDezena}`);

    const tickets = await RaffleTicket.findAll({
      where: { raffleId: raffle.id },
      transaction,
    });
    let winningTicket: RaffleTicket | null = null;
      for (const ticket of tickets) {
        if (String(ticket.ticketNumber).trim() === String(winningDezena).trim()) {
          winningTicket = ticket;
          break;
        }
      }

    if (winningTicket) {
      raffle.winnerUserId = winningTicket.userId;
      const winnerUser = await this.userModel.findByPk(
        winningTicket.userId,
        {
          attributes: ['id', 'name', 'email'],
          transaction,
        },
      );

      if (!winnerUser) {
        throw new NotFoundException('Usuário vencedor não encontrado.');
      }

      raffle.winnerUser = winnerUser;
      const prizeAmount = raffle.ticketPrice * raffle.totalTickets * 0.7;
      await winnerUser.update(
        { balance: winnerUser.balance + prizeAmount },
        { transaction },
      );
          await this.raffleModel.update({ winnerUserId: raffle.winnerUserId, finished: true, winningTicket: winningDezena }, { where: { id: raffleId }, transaction });
    } else {
          this.logger.log(`Bilhete vencedor NÃO encontrado para a dezena ${winningDezena}`);
    }

    raffle.winningTicket = winningDezena;
    raffle.finished = true;
    await raffle.save({ transaction });

    if (!transactionHost) await transaction.commit();

    this.logger.log(`Rifa ${raffleId} finalizada com sucesso.`);

    return raffle;
  } catch (error) {
    if (!transactionHost) await transaction.rollback();

    if (
      error instanceof NotFoundException ||
      error instanceof BadRequestException ||
      error instanceof ConflictException
    ) {
      throw error;
    }

    this.logger.error(
      `Erro ao finalizar a rifa de equipe ${raffleId}: ${(error as any).message}`,
      (error as any).stack,
    );
    throw new InternalServerErrorException(
      'Erro ao finalizar a rifa de equipe. Por favor, tente novamente.',
    );
  }
}

@Cron('0 * * * *') // Configuração do Cron Job para rodar a cada 5 minutos
async finalizeRafflesCronJob() {
    this.logger.log('Iniciando cron job para finalizar rifas (horário fechado)...');

    const now = new Date();
    const rafflesToFinalize = await this.raffleModel.findAll({
    where: {
        finished: false,
        [Op.or]: [
        {
            endDate: {
            [Op.lte]: now,
            },
        },
        {
            soldTickets: {
            [Op.gte]: Sequelize.col('totalTickets'),
            },
        },
        ],
    },
    include: [
        {
        model: RaffleTicket,
        include: [
            {
            model: User,
            attributes: ['id', 'name', 'email'],
            },
        ],
        },
        {
        model: RaffleNumber,
        include: [
            {
            model: GeneratedNumber,
            include: [
                {
                model: Seed,
                include: [
                    {
                    model: BlockchainHash,
                    },
                ],
                },
            ],
            },
        ],
        },
    ],
    });
    const transaction = await this.sequelize.transaction();
    try {
    for (const raffle of rafflesToFinalize) {
        this.logger.log(`Cron Job - Processando Rifa ID: ${raffle.id}, Tipo: ${raffle.type}, Finalizada: ${raffle.finished}, Bilhetes Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}`);
        try {
            if (raffle.type === 'tradicional') {
                await this.finalizeRaffle(raffle.id, transaction);
                this.logger.log(`Rifa tradicional ${raffle.id} finalizada pelo cron job (horário fechado).`);
            } else if (raffle.type === 'equipes') {
                await this.finalizeTeamRaffle(raffle.id, transaction);
                this.logger.log(`Rifa de equipes ${raffle.id} finalizada pelo cron job (horário fechado).`);
            }
        } catch (error) {
        this.logger.error(
            `Erro ao finalizar rifa ${raffle.id} pelo cron job (horário fechado): ${(error as any).message}`,
        );
        }
    }
    await transaction.commit();
    } catch (error) {
    await transaction.rollback();
    this.logger.error(
        `Erro ao finalizar rifas pelo cron job (horário fechado): ${(error as any).message}`,
    );
    }

    this.logger.log('Cron job para finalizar rifas (horário fechado) concluído.');
}


  async getRaffleTeams(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      attributes: ['id', 'type', 'totalTickets'],
      include: [
        {
          model: RaffleTicket,
          attributes: ['ticketNumber', 'userId'],
          include: [
            {
              model: User,
              attributes: ['id', 'name'],
            },
          ],
        },
      ],
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    if (raffle.type !== 'equipes') {
      throw new BadRequestException(
        'Esta rota é válida apenas para rifas de equipes.',
      );
    }
    return this.getFormattedTeams(raffle)
}

async getRafflesPlayedByUser(userId: number): Promise<Raffle[]> {
    return this.raffleModel.findAll({
      include: [
        {
          model: RaffleTicket,
          where: { userId: userId },
          required: true,
        },
        {
          model: RaffleNumber,
          include: [
            {
              model: GeneratedNumber,
              include: [{ model: Seed, include: [BlockchainHash] }],
            },
          ],
        },
        {
          model: User,
          as: 'winnerUser',
          attributes: ['id', 'name', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  async getWonRafflesByUser(userId: number): Promise<Raffle[]> {
    return this.raffleModel.findAll({
      where: {
        winnerUserId: userId,
        finished: true,
      },
      include: [
        {
          model: RaffleTicket,
          where: { userId: userId },
          required: true,
        },
        {
          model: RaffleNumber,
          include: [
            {
              model: GeneratedNumber,
              include: [{ model: Seed, include: [BlockchainHash] }],
            },
          ],
        },
        {
          model: User,
          as: 'winnerUser',
          attributes: ['id', 'name', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  async getLostRafflesByUser(userId: number): Promise<Raffle[]> {
    return this.raffleModel.findAll({
      include: [
        {
          model: RaffleTicket,
          where: { userId: userId },
          required: true,
        },
        {
          model: RaffleNumber,
          include: [
            {
              model: GeneratedNumber,
              include: [{ model: Seed, include: [BlockchainHash] }],
            },
          ],
        },
        {
          model: User,
          as: 'winnerUser',
          attributes: ['id', 'name', 'email'],
        },
      ],
      where: {
        finished: true,
        winnerUserId: {
          [Op.ne]: userId,
        },
      },
      order: [['createdAt', 'DESC']],
    });
  }

  async getUserRaffleData(userId: number): Promise<any> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'cpf', 'phone', 'balance'],
      include: [
        {
          model: RaffleTicket,
          as: 'raffleTickets',
          include: [
            {
              model: Raffle,
              include: [
                {
                  model: RaffleNumber,
                  include: [
                    {
                      model: GeneratedNumber,
                      include: [
                        {
                          model: Seed,
                          include: [
                            {
                              model: BlockchainHash,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  model: User,
                  as: 'winnerUser',
                  attributes: ['id', 'name', 'email'],
                },
                {
                  model: User,
                  as: 'createdByUser',
                  attributes: ['id', 'name', 'email'],
                }
              ],
            },
          ],
        },
      ],
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const formattedRaffles = user.raffleTickets.map(ticket => {
      const raffle = ticket.raffle;
      let winningTicketInfo: any = null;

      if (raffle.raffleNumbers && raffle.raffleNumbers.length > 0) {
        const generatedNumber = raffle.raffleNumbers[0].generatedNumber;
        const seed = generatedNumber?.seed;
        const blockchainHash = seed?.blockchainHash;

        winningTicketInfo = {
          ticketNumber: raffle.winningTicket,
          numberId: generatedNumber?.id,
          dezena: generatedNumber?.number.toString().slice(-2),
          generatedNumber: generatedNumber?.number,
          sequence: generatedNumber?.sequence,
          seed: seed?.seed,
          hash: blockchainHash?.hash,
          hashTimestamp: blockchainHash?.timestamp,
        };
      }

      return {
        raffleId: raffle.id,
        raffleIdentifier: raffle.raffleIdentifier,
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
        winner: raffle.winnerUser ? {
          id: raffle.winnerUser.id,
          name: raffle.winnerUser.name,
          email: raffle.winnerUser.email
        } : null,
        createdBy: raffle.createdByUser ? {
          id: raffle.createdByUser.id,
          name: raffle.createdByUser.name,
          email: raffle.createdByUser.email
        } : null,
        createdAt: raffle.createdAt,
        updatedAt: raffle.updatedAt,
        ticket: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
        },
      };
    });

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      cpf: user.cpf,
      phone: user.phone,
      balance: user.balance,
      raffles: formattedRaffles,
    };
  }


  async createTeamRaffle(ticketPrice: number): Promise<Raffle> {
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
        throw new NotFoundException(
            'Nenhuma seed ou generatedNumber correspondente encontrado para a hash mais recente.',
        );
    }

    const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(latestGeneratedNumber.number) % 100n;
    const startDate = new Date();
    const newRaffle = await this.raffleModel.create({
        raffleIdentifier: `RIFA-EQUIPES-${Date.now()}`,
        createdBy: null,
        title: `Rifa de Equipes Automática - R$ ${ticketPrice.toFixed(2)}`,
        description: `Rifa de equipes gerada automaticamente com base na hash ${latestHash.hash} - R$ ${ticketPrice.toFixed(2)}`,
        ticketPrice: ticketPrice,
        totalTickets: 100,
        soldTickets: 0,
        startDate: startDate,
        endDate: null,
        finished: false,
        winningTicket: lastTwoDigits.toString().padStart(2, '0'),
        type: 'equipes',
    });

    await this.raffleNumberModel.create({
        raffleId: newRaffle.id,
        numberId: latestGeneratedNumber.id,
    });

    this.logger.log(
        `Rifa de Equipes criada com sucesso: ${newRaffle.raffleIdentifier}, winningTicket(temp): ${lastTwoDigits
            .toString()
            .padStart(2, '0')}, generatedNumberId: ${latestGeneratedNumber.id}, Preço: R$ ${ticketPrice.toFixed(2)}`,
    );

    return newRaffle;
}


    private getTeamNameByTicketNumber(raffle: Raffle,ticketNumber: string): string {
      if (!ticketNumber) return 'Nenhum';
        const ticketNumberInt = parseInt(ticketNumber, 10);
        const teamIndex = Math.floor(ticketNumberInt / 4);
        return this.teamNames[teamIndex] || 'Nenhum';
    }

    private getFormattedTeams(raffle: Raffle): any {
      const totalTickets = raffle.totalTickets;
      const ticketsPerTeam = 4;
      const totalTeams = totalTickets / ticketsPerTeam;
      const teams = {};

      for (let i = 0; i < totalTeams; i++) {
        const teamName = this.teamNames[i];
        const teamTickets: string[] = [];
        const members = {};

        for (let j = 0; j < ticketsPerTeam; j++) {
          const ticketNumber = (i * ticketsPerTeam + j)
            .toString()
            .padStart(2, '0');
          teamTickets.push(ticketNumber);

          const ticket = raffle.tickets.find(
            (t) => t.ticketNumber === ticketNumber,
          );
          if (ticket && ticket.user) {
            if (!members[ticket.user.id]) {
              members[ticket.user.id] = {
                id: ticket.user.id,
                name: ticket.user.name,
                tickets: [],
              };
            }
            members[ticket.user.id].tickets.push(ticketNumber);
          }
        }
        const teamMembers = Object.values(members);

        teams[teamName] = {
          teamName: teamName,
          tickets: teamTickets,
          members: teamMembers,
        };
      }

      return teams;
    }

    getTeamNames() {
        return this.teamNames;
      }

    async createTeamRafflesCronJob() {
      this.logger.log('Iniciando cron job para criar rifas fixas e extras de equipes...');
      for (const price of this.fixedRafflePrices) {
          const activeRaffles = await this.raffleModel.findAll({
              where: {
                  ticketPrice: price,
                  type: 'equipes',
                  finished: false,
              },
          });

          if (activeRaffles.length < 6) {
              try {
                  const newRaffle = await this.createTeamRaffle(price);
                  this.logger.log(
                      `Rifa de equipes de R$ ${price.toFixed(2)} criada pelo cron job (extra/reposição) com id: ${newRaffle.id}`,
                  );
              } catch (error) {
                  this.logger.error(
                      `Erro ao criar rifa de equipes de R$ ${price.toFixed(2)} pelo cron job (extra/reposição): ${(error as any).message}`,
                  );
              }
          }
      }

      this.logger.log('Cron job para criar rifas fixas e extras de equipes concluído.');
  }

  async finalizeTeamRaffle(raffleId: number, transactionHost?: any): Promise<Raffle> {
    const transaction = transactionHost
      ? transactionHost
      : await this.sequelize.transaction();
    try {
      const raffle = await this.raffleModel.findByPk(raffleId, {
        include: [
          {
            model: RaffleTicket,
            include: [
              {
                model: User,
                attributes: ['id', 'name', 'email'],
              },
            ],
          },
          {
            model: RaffleNumber,
            include: [
              {
                model: GeneratedNumber,
                include: [
                  {
                    model: Seed,
                    include: [
                      {
                        model: BlockchainHash,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            model: User,
            as: 'winnerUser',
            attributes: ['id', 'name', 'email'],
          },
        ],
        transaction,
      });

      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }

      if (raffle.finished) {
        throw new ConflictException('Rifa já finalizada.');
      }

      const now = new Date();
      if (
        (!raffle.endDate || raffle.endDate > now) &&
        raffle.soldTickets < raffle.totalTickets
      ) {
        throw new BadRequestException(
          'A rifa ainda não atingiu a data de sorteio ou todos os bilhetes não foram vendidos.',
        );
      }

      const winningDezena = raffle.winningTicket;
      const winningTeam = this.getTeamNameByTicketNumber(raffle,winningDezena);
      const winningTicket = raffle.tickets.find(
        (ticket) => ticket.ticketNumber === winningDezena,
      );
      const winningTeamTickets = raffle.tickets.filter(
        (ticket) => this.getTeamNameByTicketNumber(raffle,ticket.ticketNumber) === winningTeam,
      );
      const totalPrize = raffle.ticketPrice * raffle.soldTickets;
      const mainPrize = totalPrize * 0.5;
      const secondaryPrizePool = totalPrize * 0.3;
      const banca = totalPrize * 0.2;
      const secondaryPrize =
        winningTeamTickets.length > 1
          ? secondaryPrizePool / (winningTeamTickets.length - 1)
          : 0;

      raffle.finished = true;
      raffle.winningTicket = winningDezena;

      if (winningTicket) {
        raffle.winnerUserId = winningTicket.userId;
        const winnerUser = await this.userModel.findByPk(winningTicket.userId, {
          attributes: ['id', 'name', 'email'],
          transaction,
        },
      );

      if (!winnerUser) {
        throw new NotFoundException('Usuário vencedor não encontrado.');
      }

      raffle.winnerUser = winnerUser;
      const prizeAmount = raffle.ticketPrice * raffle.totalTickets * 0.7;
      await winnerUser.update(
        { balance: winnerUser.balance + prizeAmount },
        { transaction },
      );
          await this.raffleModel.update({ winnerUserId: raffle.winnerUserId, finished: true, winningTicket: winningDezena }, { where: { id: raffleId }, transaction });
    } else {
          this.logger.log(`Bilhete vencedor NÃO encontrado para a dezena ${winningDezena}`);
    }

      raffle.winningTicket = winningDezena;
      raffle.finished = true;
      await raffle.save({ transaction });

      if (!transactionHost) await transaction.commit();
      this.logger.log(`Rifa de equipe ${raffleId} finalizada com sucesso.`);
      return raffle;
    } catch (error) {
      if (!transactionHost) await transaction.rollback();
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      this.logger.error(
        `Erro ao finalizar a rifa de equipe ${raffleId}: ${(error as any).message}`,
        (error as any).stack,
      );
      throw new InternalServerErrorException(
        'Erro ao finalizar a rifa de equipe. Por favor, tente novamente.',
      );
    }
  }


  async getRaffleTeamsWithAvailability(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
        attributes: ['id', 'type', 'totalTickets'],
        include: [
          {
            model: RaffleTicket,
            attributes: ['ticketNumber', 'userId'],
              include: [
                {
                  model: User,
                  attributes: ['id', 'name'],
                },
              ],
          },
        ],
      });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    if (raffle.type !== 'equipes') {
      throw new BadRequestException(
        'Esta rota é válida apenas para rifas de equipes.',
      );
    }
    const formattedTeams = this.getFormattedTeams(raffle)

    const allTickets = Array.from({ length: raffle.totalTickets }, (_, i) =>
      i.toString().padStart(raffle.totalTickets.toString().length, '0')
    );

    const availableTickets: any = {};

        for (const teamName of Object.keys(formattedTeams)) {
            const boughtTickets = formattedTeams[teamName].tickets;
            const available = allTickets.filter((ticketNumber)=>!boughtTickets.includes(ticketNumber))
            availableTickets[teamName] = available;
        }


    return {
      raffleId: raffle.id,
      teams: Object.values(formattedTeams),
      availableTickets: availableTickets,
    };
}

  sendNotification(userId: number, arg1: string) {
    throw new Error('Method not implemented.');
  }
}