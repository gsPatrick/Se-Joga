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
  private readonly logger = new Logger(RaffleService.name);

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
          `Erro ao criar rifa pelo cron job: ${error.message}`,
        );
      }
    }

    this.logger.log('Cron job para criar rifas concluído.');
  }

  async buyRaffleTickets(
    userId: number,
    raffleId: number,
    quantity: number,
  ): Promise<RaffleTicket[]> {
    const transaction = await this.sequelize.transaction();

    try {
      // 1. Buscar o usuário
      const user = await this.userModel.findByPk(userId, {
        transaction,
      });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // 2. Buscar a rifa
      const raffle = await this.raffleModel.findByPk(raffleId, {
        transaction,
        include: [
          {
            model: RaffleTicket,
            attributes: ['ticketNumber'], // Carrega apenas o ticketNumber
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

      // 4. Verificar se há bilhetes disponíveis
      if (raffle.soldTickets + quantity > raffle.totalTickets) {
        throw new BadRequestException('Não há bilhetes suficientes disponíveis.');
      }

      // 5. Verificar se o usuário tem saldo suficiente
      if (user.balance < raffle.ticketPrice * quantity) {
        throw new BadRequestException('Saldo insuficiente.');
      }

      // 6. Gerar os números dos bilhetes
      const ticketNumbers = [];
      for (let i = 0; i < quantity; i++) {
        const ticketNumber = this.generateUniqueTicketNumber(raffle);
        ticketNumbers.push(ticketNumber);
      }

      // 7. Criar os registros RaffleTicket
      const createdTickets = await this.raffleTicketModel.bulkCreate(
        ticketNumbers.map((ticketNumber) => ({
          userId,
          raffleId,
          ticketNumber,
        })),
        { transaction },
      );

      // 8. Atualizar o saldo do usuário
      await user.update(
        { balance: user.balance - raffle.ticketPrice * quantity },
        { transaction },
      );

      // 9. Atualizar o número de bilhetes vendidos da rifa
      await raffle.update(
        { soldTickets: raffle.soldTickets + quantity },
        { transaction },
      );

      await transaction.commit(); // Confirmar a transação

      this.logger.log(
        `Usuário ${userId} comprou ${quantity} bilhete(s) para a rifa ${raffleId}. Bilhetes: ${ticketNumbers.join(', ')}`,
      );

      return createdTickets;
    } catch (error) {
      await transaction.rollback(); // Reverter a transação em caso de erro

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `Erro ao comprar bilhetes para a rifa ${raffleId} pelo usuário ${userId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Erro ao comprar bilhetes. Por favor, tente novamente.',
      );
    }
  }

  // Função auxiliar para gerar números de bilhetes únicos
  private generateUniqueTicketNumber(raffle: Raffle): string {
    let ticketNumber: string
    do {
    ticketNumber = Math.floor(Math.random() * raffle.totalTickets).toString().padStart(raffle.totalTickets.toString().length, '0');
    } while (raffle.tickets && raffle.tickets.some(ticket => ticket.ticketNumber === ticketNumber));

    return ticketNumber;
}

  async getRafflesWithDetails(): Promise<any[]> {
    const raffles = await this.raffleModel.findAll({
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
      order: [['createdAt', 'DESC']],
    });
  
    return raffles.map((raffle) => {
      // **Mudança: Agora winningTicketInfo é preenchido SEMPRE, independentemente do status da rifa**
      let winningTicketInfo = null;
      if (raffle.raffleNumbers && raffle.raffleNumbers.length > 0) {
        const generatedNumber = raffle.raffleNumbers[0].generatedNumber;
        const seed = generatedNumber ? generatedNumber.seed : null;
        const blockchainHash = seed ? seed.blockchainHash : null;
  
        winningTicketInfo = {
          ticketNumber: raffle.winningTicket, // Pode ser null se a rifa não estiver finalizada
          numberId: generatedNumber ? generatedNumber.id : null,
          dezena: generatedNumber
            ? generatedNumber.number.toString().slice(-2)
            : null,
          generatedNumber: generatedNumber ? generatedNumber.number : null,
          sequence: generatedNumber ? generatedNumber.sequence : null,
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
        winningTicket: winningTicketInfo, // Agora winningTicketInfo SEMPRE é usado
        tickets: raffle.tickets.map((ticket) => ({
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          user: ticket.user
            ? {
                id: ticket.user.id,
                name: ticket.user.name,
                email: ticket.user.email,
              }
            : null,
          createdAt: ticket.createdAt,
        })),
        createdAt: raffle.createdAt,
        updatedAt: raffle.updatedAt,
      };
    });
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
        `Erro ao finalizar a rifa ${raffleId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Erro ao finalizar a rifa. Por favor, tente novamente.',
      );
    }
  }

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
        },
      ],
    });
    const transaction = await this.sequelize.transaction();
    try {
      for (const raffle of rafflesToFinalize) {
        try {
          await this.finalizeRaffle(raffle.id, transaction);
          this.logger.log(`Rifa ${raffle.id} finalizada pelo cron job.`);
        } catch (error) {
          this.logger.error(
            `Erro ao finalizar rifa ${raffle.id} pelo cron job: ${error.message}`,
          );
        }
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      this.logger.error(
        `Erro ao finalizar rifas pelo cron job: ${error.message}`,
      );
    }

    this.logger.log('Cron job para finalizar rifas concluído.');
  }

//   USER 

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

}