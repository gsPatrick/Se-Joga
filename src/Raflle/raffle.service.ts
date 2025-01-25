import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { Seed } from '../models/seed.model';
import { RaffleNumber } from '../models/raffle/raffle-number.model';
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model';
import { Sequelize } from 'sequelize-typescript';
import { User } from 'src/models/user/user.model';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Op } from 'sequelize';

@Injectable()
export class RaffleService {
  getTeamNames() {
    throw new Error('Method not implemented.');
  }
  private readonly logger = new Logger(RaffleService.name);

    public readonly teamNames = [
        'Brasil', 'Alemanha', 'Itália', 'Argentina', 'França',
        'Espanha', 'Inglaterra', 'Uruguai', 'Holanda', 'Portugal',
        'Bélgica', 'Croácia', 'México', 'Colômbia', 'Chile',
        'Paraguai', 'Estados Unidos', 'Rússia', 'Suécia', 'Dinamarca',
        'Servia', 'Japão', 'Coreia do Sul', 'Camarões', 'Nigéria'
      ];

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

  async createSystemRaffle(endDate?: Date): Promise<Raffle> {
    // 1. Encontrar a hash mais recente
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });

    if (!latestHash) {
      throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
    }

    // 2. Encontrar a seed correspondente à hash mais recente
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

    // 3. Obter o generatedNumber mais recente da seed
    const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];

    // 4. Extrair a última dezena do número
    const lastTwoDigits = BigInt(latestGeneratedNumber.number) % 100n;

    // **CORREÇÃO: Definir startDate para a hora atual da criação da rifa**
    const startDate = new Date();

    // 5. Criar a rifa
    const newRaffle = await this.raffleModel.create({
      raffleIdentifier: `RIFA-${Date.now()}`,
      createdBy: null,
      title: 'Rifa Automática',
      description: `Rifa gerada automaticamente com base na hash ${latestHash.hash}`,
      ticketPrice: 10.0,
      totalTickets: 100,
      soldTickets: 0,
      startDate: startDate, // Usar a variável startDate
      endDate: endDate || null,
      finished: false,
      winningTicket: lastTwoDigits.toString().padStart(2, '0'),
    }, {
      transaction: null, // Certifique-se de que a transação seja nula
    });

    // 6. Criar o RaffleNumber associado
    await this.raffleNumberModel.create({
      raffleId: newRaffle.id,
      numberId: latestGeneratedNumber.id,
    }, {
      transaction: null, // Certifique-se de que a transação seja nula
    });

    this.logger.log(
      `Rifa criada com sucesso: ${newRaffle.raffleIdentifier}, winningTicket(temp): ${lastTwoDigits
        .toString()
        .padStart(2, '0')}, generatedNumberId: ${latestGeneratedNumber.id}`,
    );

    return newRaffle;
  }

  // Cron job para criar rifas a cada 2 horas
  @Cron('0 0 */2 * * *')
  async createRafflesCronJob() {
    this.logger.log('Iniciando cron job para criar rifas...');

    for (let i = 0; i < 7; i++) {
      try {
        const newRaffle = await this.createSystemRaffle();
        this.logger.log(`Rifa criada pelo cron job com id: ${newRaffle.id}`);

        // Define a data de finalização para 2 horas após a criação da rifa
        const endDate = new Date(
          newRaffle.createdAt.getTime() + 2 * 60 * 60 * 1000,
        );

        // Atualiza a rifa com a nova data de finalização
        await this.raffleModel.update(
          { endDate: endDate },
          { where: { id: newRaffle.id } },
        );
        this.logger.log(
          `Rifa ${newRaffle.id} atualizada com endDate: ${endDate}`,
        );
      } catch (error) {
        this.logger.error(
          `Erro ao criar rifa pelo cron job: ${(error as any).message}`,
        );
      }
    }

    this.logger.log('Cron job para criar rifas concluído.');
  }

  async buyRaffleTickets(
    userId: number,
    raffleId: number,
    ticketData: { type: 'tradicional' | 'equipes'; quantityOrNumbers: number | string[] },
  ): Promise<RaffleTicket[]> {
    const transaction = await this.sequelize.transaction();
    try {
      // 1. Buscar o usuário
      const user = await this.userModel.findByPk(userId, { transaction });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // 2. Buscar a rifa
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

      // 3. Verificar se a rifa está finalizada
      if (raffle.finished) {
        throw new BadRequestException('Esta rifa já foi finalizada.');
      }

      // 4. Determinar a quantidade de bilhetes e os números dos bilhetes
      let quantity: number;
      let ticketNumbers: string[];

      if (ticketData.type === 'tradicional') {
        // Compra para rifa tradicional
        if (typeof ticketData.quantityOrNumbers === 'number') {
          // Compra aleatória
          quantity = ticketData.quantityOrNumbers;
          if (raffle.soldTickets + quantity > raffle.totalTickets) {
            throw new BadRequestException(
              'Não há bilhetes suficientes disponíveis.',
            );
          }
          ticketNumbers = this.generateUniqueTicketNumbers(raffle, quantity);
        } else {
          // Compra de bilhetes específicos
          ticketNumbers = ticketData.quantityOrNumbers;
          quantity = ticketNumbers.length;

          // Validar os números dos bilhetes
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
        // Compra para rifa de equipes
        if (typeof ticketData.quantityOrNumbers === 'number') {
          throw new BadRequestException(
            'Para rifas de equipe, forneça os números dos bilhetes.',
          );
        }

        ticketNumbers = ticketData.quantityOrNumbers;
        quantity = ticketNumbers.length;

        // Validar os números dos bilhetes para a rifa de equipes
        const validTeamTicketNumbers = ticketNumbers.every((ticketNumber) => {
          const num = parseInt(ticketNumber, 10);
          return (
            num >= 0 &&
            num < raffle.totalTickets
          );
        });

        if (!validTeamTicketNumbers) {
          throw new BadRequestException(
            'Números de bilhetes inválidos para a rifa de equipes.',
          );
        }

        // Verificar se os bilhetes já foram comprados
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

      // 5. Verificar se o usuário tem saldo suficiente
      if (user.balance < raffle.ticketPrice * quantity) {
        throw new BadRequestException('Saldo insuficiente.');
      }

      // 6. Criar os registros RaffleTicket
      const createdTickets = await this.raffleTicketModel.bulkCreate(
        ticketNumbers.map((ticketNumber) => ({
          userId,
          raffleId,
          ticketNumber,
        })),
        { transaction },
      );

      // 7. Atualizar o saldo do usuário
      await user.update(
        { balance: user.balance - raffle.ticketPrice * quantity },
        { transaction },
      );

      // 8. Atualizar o número de bilhetes vendidos da rifa
      await raffle.update(
        { soldTickets: raffle.soldTickets + quantity },
        { transaction },
      );

      await transaction.commit();

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

    //Função para gerar numberos unicos, agora recebendo a quantidade
    private generateUniqueTicketNumbers(
        raffle: Raffle,
        quantity: number,
    ): string[] {
        const ticketNumbers = new Set<string>();
        while (ticketNumbers.size < quantity) {
            const ticketNumber = Math.floor(Math.random() * raffle.totalTickets)
            .toString()
            .padStart(raffle.totalTickets.toString().length, '0');
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

  // Aplicar filtros, se fornecidos
  if (filters.finished !== undefined) {
      where.finished = filters.finished === 'true';
  }
  if (filters.winnerUserId) {
      where.winnerUserId = filters.winnerUserId;
  }
  if (filters.userId) {
      where['$tickets.userId$'] = filters.userId;
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
              include: [{
                  model: User,
                  attributes: ['id', 'name', 'email'],
              }],
          },
          {
              model: User,
              as: 'createdByUser',
              attributes: ['id', 'name', 'email'],
          },
          {
              model: User,
              as: 'winnerUser',
              attributes: ['id', 'name', 'email'],
          },
          {
              model: RaffleNumber,
              include: [{
                  model: GeneratedNumber,
                  include: [{
                      model: Seed,
                      include: [{
                          model: BlockchainHash,
                      }],
                  }],
              }],
          },
      ],
      where,
      order: [['createdAt', 'DESC']],
  });

  return raffles.map(raffle => ({
      id: raffle.id,
      raffleIdentifier: raffle.raffleIdentifier,
      type: raffle.type,
      createdBy: raffle.createdByUser ? {
          id: raffle.createdByUser.id,
          name: raffle.createdByUser.name,
          email: raffle.createdByUser.email
      } : null,
      winner: raffle.winnerUser ? {
          id: raffle.winnerUser.id,
          name: raffle.winnerUser.name,
          email: raffle.winnerUser.email
      } : null,
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
  }));
}

private formatWinningTicketInfo(raffle: Raffle): any {
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
    seed: seed ? seed.seed : null,
    hash: blockchainHash ? blockchainHash.hash : null,
    hashTimestamp: blockchainHash ? blockchainHash.timestamp : null,
  };
}

  private formatRaffleTickets(raffle: Raffle): any[] {
    if (!raffle.tickets) {
        return [];
    }

    const formattedTeams = this.getFormattedTeams(raffle);


    return raffle.tickets.map(ticket => {
        let team = formattedTeams[this.getTeamNameByTicketNumber(raffle,ticket.ticketNumber)];

        return {
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            user: ticket.user ? {
                id: ticket.user.id,
                name: ticket.user.name,
                email: ticket.user.email,
            } : null,
            team: team,
            createdAt: ticket.createdAt,
        };
    });
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
        as: 'createdByUser',
        attributes: ['id', 'name', 'email'],
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

  return {
    id: raffle.id,
    raffleIdentifier: raffle.raffleIdentifier,
    type: raffle.type,
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
      // 1. Buscar a rifa
      const raffle = await this.raffleModel.findByPk(raffleId, {
        include: [
          {
            model: RaffleTicket,
          },
        ],
        transaction,
      });

      if (!raffle) {
        throw new NotFoundException('Rifa não encontrada.');
      }

      // 2. Verificar se a rifa já foi finalizada
      if (raffle.finished) {
        throw new ConflictException('Rifa já finalizada.');
      }

      // 3. Verificar se a data do sorteio já passou ou se todos os bilhetes foram vendidos
      const now = new Date();
      if (
        (!raffle.endDate || raffle.endDate > now) &&
        raffle.soldTickets < raffle.totalTickets
      ) {
        throw new BadRequestException(
          'A rifa ainda não atingiu a data de sorteio ou todos os bilhetes não foram vendidos.',
        );
      }

      // 4. Usar a dezena do winningTicket (definida na criação da rifa)
      const winningDezena = raffle.winningTicket;

      // 5. Encontrar o bilhete vencedor
      const winningTicket = raffle.tickets.find(
        (ticket) => ticket.ticketNumber === winningDezena,
      );

      // 6. Atualizar a rifa
      if (winningTicket) {
        raffle.winnerUserId = winningTicket.userId;

        // Carregar as informações do usuário vencedor
        const winnerUser = await this.userModel.findByPk(
          winningTicket.userId,
          {
            attributes: ['id', 'name', 'email'], // Carrega apenas os atributos necessários
            transaction,
          },
        );

        if (!winnerUser) {
          throw new NotFoundException('Usuário vencedor não encontrado.');
        }

        // **Associar o usuário vencedor ao objeto raffle**
        raffle.winnerUser = winnerUser;

        // Creditar o prêmio ao usuário vencedor - aqui você define a lógica do prêmio
        const prizeAmount = raffle.ticketPrice * raffle.totalTickets * 0.7; // Exemplo: 70% do valor total dos bilhetes
        await winnerUser.update(
          { balance: winnerUser.balance + prizeAmount },
          { transaction },
        );
        this.logger.log(
          `Usuário ${winnerUser.id} ganhou a rifa ${raffle.id} e recebeu ${prizeAmount}`,
        );
      }

      raffle.winningTicket = winningDezena; // winningTicket é atualizado para ficar consistente
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
        `Erro ao finalizar a rifa ${raffleId}: ${(error as any).message}`,
        (error as any).stack,
      );
      throw new InternalServerErrorException(
        'Erro ao finalizar a rifa. Por favor, tente novamente.',
      );
    }
  }

   // **Cron job para finalizar rifas (modificado)**
   @Cron(CronExpression.EVERY_MINUTE) // Executa a cada minuto
   async finalizeRafflesCronJob() {
       this.logger.log('Iniciando cron job para finalizar rifas...');

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
           // Adicionado informações do usuário
           include: [
               {
               model: User,
               attributes: ['id', 'name', 'email'],
               },
           ],
           },
           //Adicionado para ter o hash para notificação
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
           try {
               if (raffle.type === 'tradicional') {
                   await this.finalizeRaffle(raffle.id, transaction);
                   this.logger.log(`Rifa tradicional ${raffle.id} finalizada pelo cron job.`);
               } else if (raffle.type === 'equipes') {
                   await this.finalizeTeamRaffle(raffle.id, transaction);
                   this.logger.log(`Rifa de equipes ${raffle.id} finalizada pelo cron job.`);
               }
           } catch (error) {
           this.logger.error(
               `Erro ao finalizar rifa ${raffle.id} pelo cron job: ${(error as any).message}`,
           );
           }
       }
       await transaction.commit();
       } catch (error) {
       await transaction.rollback();
       this.logger.error(
           `Erro ao finalizar rifas pelo cron job: ${(error as any).message}`,
       );
       }

       this.logger.log('Cron job para finalizar rifas concluído.');
   }

//   USER 

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
          where: { userId: userId }, // Filtra os bilhetes do usuário
          required: true, // Força que a rifa tenha pelo menos um bilhete do usuário
        },
        // Incluir outros relacionamentos necessários para exibir detalhes da rifa
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
        winnerUserId: userId, // Filtra as rifas onde o usuário é o vencedor
        finished: true, // Garante que a rifa foi finalizada
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
          [Op.ne]: userId, // Filtra as rifas onde o usuário NÃO é o vencedor
        },
      },
      order: [['createdAt', 'DESC']],
    });
  }
  
  async getUserRaffleData(userId: number): Promise<any> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'cpf', 'phone', 'balance'], // Adicione os atributos que você deseja retornar
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

    // Formatando a resposta para incluir os detalhes das rifas
    const formattedRaffles = user.raffleTickets.map(ticket => {
      const raffle = ticket.raffle;
      let winningTicketInfo: {
        ticketNumber: string;
        numberId: number | null;
        dezena: string | null;
        generatedNumber: bigint | null;
        sequence: number | null;
        seed: string | null;
        hash: string | null;
        hashTimestamp: Date | null;
      } | null = null;

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


  // Parte do serviço da RIFA DE TIME

  async createTeamRaffle(teamName: string, endDate?: Date): Promise<Raffle> {
    // 1. Encontrar a hash mais recente
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });

    if (!latestHash) {
      throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
    }

    // 2. Encontrar a seed correspondente à hash mais recente
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

    // 3. Obter o generatedNumber mais recente da seed
    const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];

    // 4. Extrair a última dezena do número
    const lastTwoDigits = BigInt(latestGeneratedNumber.number) % 100n;

    // 5. Criar a rifa
    const startDate = new Date();
    const newRaffle = await this.raffleModel.create({
      raffleIdentifier: `RIFA-EQUIPES-${Date.now()}`,
      createdBy: null,
      title: `Rifa de Equipes ${teamName}`, // Usando o teamName aqui
      description: `Rifa de equipes gerada automaticamente com base na hash ${latestHash.hash}`,
      ticketPrice: 10.0,
      totalTickets: 100,
      soldTickets: 0,
      startDate: startDate,
      endDate: endDate || null,
      finished: false,
      winningTicket: lastTwoDigits.toString().padStart(2, '0'),
      type: 'equipes', // Define o tipo como 'equipes'
    });

    // 6. Criar o RaffleNumber associado
    await this.raffleNumberModel.create({
      raffleId: newRaffle.id,
      numberId: latestGeneratedNumber.id,
    });

    this.logger.log(
      `Rifa de Equipes criada com sucesso: ${newRaffle.raffleIdentifier}, winningTicket(temp): ${lastTwoDigits
        .toString()
        .padStart(2, '0')}, generatedNumberId: ${latestGeneratedNumber.id}`,
    );

    return newRaffle;
  }


    // Método para determinar a equipe vencedora com base na dezena
    private getTeamNameByTicketNumber(raffle: Raffle,ticketNumber: string): string {
        const ticketNumberInt = parseInt(ticketNumber, 10);
        const teamIndex = Math.floor(ticketNumberInt / 5); // Cada equipe tem 5 números
        return this.teamNames[teamIndex];
    }

    private getFormattedTeams(raffle: Raffle): any {
        const totalTickets = raffle.totalTickets;
        const ticketsPerTeam = 5;
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



  // Cron job para criar rifas de equipes a cada 10 segundos
  @Cron('0 0 */2 * * *')
  async createTeamRafflesCronJob() {
    this.logger.log('Iniciando cron job para criar rifas de equipes...');

    for (const teamName of this.teamNames) {
      try {
        const newRaffle = await this.createTeamRaffle(teamName);
        this.logger.log(
          `Rifa de equipes ${teamName} criada pelo cron job com id: ${newRaffle.id}`,
        );

        // Define a data de finalização para 2 horas após a criação da rifa
        const endDate = new Date(
          newRaffle.createdAt.getTime() + 2 * 60 * 60 * 1000,
        );

        // Atualiza a rifa com a nova data de finalização
        await this.raffleModel.update(
          { endDate: endDate },
          { where: { id: newRaffle.id } },
        );
        this.logger.log(
          `Rifa de equipes ${newRaffle.id} atualizada com endDate: ${endDate}`,
        );
      } catch (error) {
        this.logger.error(
          `Erro ao criar rifa de equipes pelo cron job: ${(error as any).message}`,
        );
      }
    }

    this.logger.log('Cron job para criar rifas de equipes concluído.');
  }

  async finalizeTeamRaffle(raffleId: number, transactionHost?: any): Promise<Raffle> {
    const transaction = transactionHost
      ? transactionHost
      : await this.sequelize.transaction();
    try {
      // 1. Buscar a rifa
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

      // 2. Verificar se a rifa já foi finalizada
      if (raffle.finished) {
        throw new ConflictException('Rifa já finalizada.');
      }

      // 3. Verificar se a data do sorteio já passou ou se todos os bilhetes foram vendidos
      const now = new Date();
      if (
        (!raffle.endDate || raffle.endDate > now) &&
        raffle.soldTickets < raffle.totalTickets
      ) {
        throw new BadRequestException(
          'A rifa ainda não atingiu a data de sorteio ou todos os bilhetes não foram vendidos.',
        );
      }

      // 4. Identificar a dezena vencedora e a equipe vencedora
      const winningDezena = raffle.winningTicket;
      const winningTeam = this.getTeamNameByTicketNumber(raffle,winningDezena);

      // 5. Encontrar o bilhete vencedor e os bilhetes da equipe vencedora
      const winningTicket = raffle.tickets.find(
        (ticket) => ticket.ticketNumber === winningDezena,
      );
      const winningTeamTickets = raffle.tickets.filter(
        (ticket) => this.getTeamNameByTicketNumber(raffle,ticket.ticketNumber) === winningTeam,
      );

      // 6. Calcular a premiação
      const totalPrize = raffle.ticketPrice * raffle.soldTickets;
      const mainPrize = totalPrize * 0.7; // 70% para o vencedor principal
      const secondaryPrizePool = totalPrize * 0.2; // 20% para dividir entre os vencedores secundários
      const secondaryPrize =
        winningTeamTickets.length > 1
          ? secondaryPrizePool / (winningTeamTickets.length - 1)
          : 0; // Subtrai 1 para excluir o vencedor principal

      // 7. Atualizar a rifa
      raffle.finished = true;
      raffle.winningTicket = winningDezena;

      // 8. Distribuir os prêmios e enviar notificações
      if (winningTicket) {
        // Atualizar o vencedor principal
        raffle.winnerUserId = winningTicket.userId;
        const winnerUser = await this.userModel.findByPk(winningTicket.userId, {
          attributes: ['id', 'name', 'email'],
          transaction,
        });
          if (winnerUser) {
            await winnerUser.update(
              { balance: winnerUser.balance + mainPrize },
              { transaction },
            );
         
              // Enviar notificação ao vencedor principal
            await this.sendNotification(
              winnerUser.id,
              `Parabéns! Você ganhou a rifa de equipe ${raffle.id} com o bilhete ${winningDezena}! O valor de ${mainPrize} foi creditado em sua conta.`,
            );
            
        }  else {
             throw new NotFoundException('Usuário vencedor não encontrado.');
        }

        // Distribuir prêmios secundários e enviar notificações
        for (const ticket of winningTeamTickets) {
          if (ticket.id !== winningTicket.id) {
            const secondaryWinner = await this.userModel.findByPk(
              ticket.userId,
              {
                attributes: ['id', 'name', 'email'],
                transaction,
              },
            );
             if (secondaryWinner) {
              await secondaryWinner.update(
                { balance: secondaryWinner.balance + secondaryPrize },
                { transaction },
              );
             await this.sendNotification(
              secondaryWinner.id,
              `Você ganhou um prêmio secundário na rifa de equipe ${raffle.id}! O valor de ${secondaryPrize} foi creditado em sua conta.`,
            );
            } else {
              throw new NotFoundException('Usuário vencedor secundário não encontrado.');
             }
          }
        }
      } else {
        // Enviar notificação para todos os participantes que não tiveram bilhete vencedor
        for (const ticket of raffle.tickets) {
          await this.sendNotification(
            ticket.userId,
            `A rifa de equipe ${raffle.id} foi finalizada. A dezena vencedora foi ${winningDezena}, pertencente à equipe ${winningTeam}. Infelizmente, você não ganhou desta vez.`,
          );
        }
      }

      // Atualizar os dados da rifa e salvar
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
  sendNotification(userId: number, arg1: string) {
    throw new Error('Method not implemented.');
  }
}