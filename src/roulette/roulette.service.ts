import { Injectable, Logger, BadRequestException, NotFoundException, Inject, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { User } from 'src/models/user/user.model';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { RouletteBet } from 'src/models/roulette/roulette-bet.model';
import { RouletteRound } from 'src/models/roulette/roulette-round.model';
import { OddUtils } from 'src/utils/odd.utils'; // Atualize o import
import { HashUtils } from 'src/utils/hash.utils';
import { Sequelize } from 'sequelize-typescript';
import { CreateRouletteBetDto } from './dto/create-roulette-bet.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Op } from 'sequelize';
import { Seed } from 'src/models/seed.model';



@Injectable()
export class RouletteService {
    private readonly logger = new Logger(RouletteService.name);
  generatedNumberModel: any;

    constructor(
      @InjectModel(RouletteRound)
      private rouletteRoundModel: typeof RouletteRound,
      @InjectModel(RouletteBet)
      private rouletteBetModel: typeof RouletteBet,
      @InjectModel(BlockchainHash)
      private blockchainHashModel: typeof BlockchainHash,
      @InjectModel(User) private userModel: typeof User,
      private readonly OddUtils: OddUtils,
      private readonly hashUtils: HashUtils,
      @Inject(REQUEST) private readonly request: Request, // Agora a injeção do Request deve funcionar
      private sequelize: Sequelize,
    ) {}

    // Função para gerar o número da roleta com base na dezena do hash
    async generateRouletteNumber(): Promise<{
      number: number;
      generatedNumber: number;
      seed: string;
      hash: string;
      hashTimestamp: Date;
  }> {
      const latestGeneratedNumber = await this.generatedNumberModel.findOne({
          order: [['createdAt', 'DESC']],
          include: [
              {
                  model: Seed,
                  include: [
                      {
                          model: BlockchainHash,
                          attributes: ['hash', 'timestamp'],
                      },
                  ],
              },
          ],
      });

      if (!latestGeneratedNumber) {
          throw new NotFoundException('Nenhum número gerado encontrado.');
      }

      const lastTwoDigits = latestGeneratedNumber.number % 100;
      const dezenaNumber = parseInt(lastTwoDigits.toString().slice(-2));

      return {
          number: dezenaNumber,
          generatedNumber: latestGeneratedNumber.number,
          seed: latestGeneratedNumber.seed.seed,
          hash: latestGeneratedNumber.seed.blockchainHash.hash,
          hashTimestamp: latestGeneratedNumber.seed.blockchainHash.timestamp,
      };
  }
  
    // Função para determinar a cor vencedora com base no número gerado
    private getWinningColor(winningNumber: number): string {
        if (winningNumber === 0) {
            return 'GREEN';
        }

        const redNumbers = [
            1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
        ];
        if (redNumbers.includes(winningNumber)) {
            return 'RED';
        }

        return 'BLACK';
    }



    async createRouletteRound(userId: number): Promise<any> {
      const transaction = await this.sequelize.transaction();
      try {
        // Gerar o número vencedor com base na dezena mais recente e obter informações do hash e da seed
        const {
          number: winningNumber,
          generatedNumber,
          seed,
          hash,
          hashTimestamp,
        } = await this.generateRouletteNumber(); 
  
        // Determinar a cor vencedora
        const winningColor = this.getWinningColor(winningNumber);
  
        // Criar uma nova rodada
        const newRound = await this.rouletteRoundModel.create(
          {
            hash: hash, // Usar o hash obtido de generateRouletteNumber
            winningNumber: winningNumber,
            winningColor: winningColor,
            finished: false, // Começa como não finalizada
            type: 'banca', // Define o tipo como 'banca' para o modo offline
            createdBy: userId,
          },
          { transaction },
        );
  
        await transaction.commit();
        this.logger.log(
          `Nova rodada de roleta (banca) criada: ${newRound.id}, gerada pelo número ${winningNumber}, da seed ${seed} e pelo hash ${hash} em ${hashTimestamp}`,
        );
  
        // Retornar o objeto com a nova rodada e as informações adicionais
        return {
          round: newRound,
          winningNumber: winningNumber,
          generatedNumber: generatedNumber,
          seed: seed,
          hash: hash,
          hashTimestamp: hashTimestamp,
        };
      } catch (error) {
        await transaction.rollback();
        this.logger.error(`Erro ao criar rodada de roleta: ${error.message}`);
        throw new InternalServerErrorException(
          'Erro ao criar rodada de roleta.',
        );
      }
    }
  

      @Cron(CronExpression.EVERY_30_SECONDS) // Executa a cada 30 segundos
      async finalizeExpiredRounds() {
        const now = new Date();
        const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    
        const expiredRounds = await this.rouletteRoundModel.findAll({
          where: {
            finished: false,
            createdAt: {
              [Op.lte]: thirtySecondsAgo, // Rodadas criadas há mais de 30 segundos
            },
          },
          include: [
            {
              model: RouletteBet,
              include: [
                {
                  model: User,
                  attributes: ['id', 'name', 'email'],
                },
              ],
            },
          ],
        });
    
        if (expiredRounds.length > 0) {
          this.logger.log(
            `Finalizando ${expiredRounds.length} rodadas de roleta expiradas...`,
          );
          const transaction = await this.sequelize.transaction();
          try {
            for (const round of expiredRounds) {
              await this.finalizeRouletteRound(round.id, transaction);
            }
            await transaction.commit();
            this.logger.log(`Rodadas de roleta expiradas finalizadas com sucesso.`);
          } catch (error) {
            await transaction.rollback();
            this.logger.error(
              `Erro ao finalizar rodadas de roleta expiradas: ${error.message}`,
            );
          }
        }
      }
    
      async finalizeRouletteRound(roundId: number, transactionHost?: any): Promise<RouletteRound> {
        const transaction = transactionHost
          ? transactionHost
          : await this.sequelize.transaction();
        try {
          // 1. Buscar a rifa
          const round = await this.rouletteRoundModel.findByPk(roundId, {
            include: [
              {
                model: RouletteBet,
                include: [
                  {
                    model: User,
                    attributes: ['id', 'name', 'email'],
                  },
                ],
              },
            ],
            transaction,
          });
    
          if (!round) {
            throw new NotFoundException('Rifa não encontrada.');
          }
    
          // 2. Verificar se a rifa já foi finalizada
          if (round.finished) {
            throw new ConflictException('Rifa já finalizada.');
          }
    
          // 3. Usar a dezena do winningTicket (definida na criação da rifa)
          const winningNumber = round.winningNumber;
          const winningColor = round.winningColor
    
          // 4. Calcular a premiação e atualizar o saldo do usuário
          const totalPrize = round.bets.reduce((sum, bet) => sum + Number(bet.betAmount), 0);
          const mainPrize = totalPrize * 0.7; // 70% para o vencedor principal
    
          // 5. Encontrar o bilhete vencedor e os bilhetes da equipe vencedora
          const winningTicket = round.bets.find(
            (bet) => bet.betType === 'NUMBER' && bet.betNumber === winningNumber,
          );
    
          // 6. Atualizar a rifa
          if (winningTicket) {
    
            // Carregar as informações do usuário vencedor
            const winnerUser = await this.userModel.findByPk(winningTicket.userId, {
                attributes: ['id', 'name', 'email', 'balance'],
                transaction,
            });
    
            if (!winnerUser) {
                throw new NotFoundException('Usuário vencedor não encontrado.');
            }
            // Atualiza o saldo do usuário
            await winnerUser.update({ balance: winnerUser.balance + mainPrize }, { transaction });
    
            // Enviar notificação ao vencedor principal
            await this.sendNotification(
                winnerUser.id,
                `Parabéns! Você ganhou na rodada ${round.id} da roleta com o numero ${winningNumber}! O valor de ${mainPrize} foi creditado em sua conta.`,
            );
            } else {
                // Enviar notificação para todos os participantes que não tiveram bilhete vencedor
                for (const bet of round.bets) {
                    await this.sendNotification(
                    bet.userId,
                    `A rodada de roleta ${round.id} foi finalizada. O número vencedor foi ${winningNumber}, na cor ${winningColor}. Infelizmente, você não ganhou desta vez.`,
                    );
                }
            }

            
    
          // Atualizar o status da rodada
          await round.update(
            {
              finished: true,
              winningNumber: winningNumber,
              winningColor: winningColor,
            },
            { transaction },
          );
    
          if (!transactionHost) await transaction.commit();
          this.logger.log(`Rodada de roleta ${roundId} finalizada com sucesso.`);
          return round;
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
            `Erro ao finalizar rodada de roleta ${roundId}: ${error.message}`,
            error.stack,
          );
          throw new InternalServerErrorException(
            'Erro ao finalizar rodada de roleta.',
          );
        }
      }
    sendNotification(id: number, arg1: string) {
        throw new Error('Method not implemented.');
    }

      async placeBet(
        userId: number,
        roundId: number,
        betData: CreateRouletteBetDto,
    ): Promise<RouletteBet> {
        const transaction = await this.sequelize.transaction();
    
        try {
            // 1. Buscar o usuário e a rodada
            const user = await this.userModel.findByPk(userId, { transaction });
            const round = await this.rouletteRoundModel.findByPk(roundId, { transaction });
    
            if (!user) {
                throw new NotFoundException('Usuário não encontrado.');
            }
            if (!round) {
                throw new NotFoundException('Rodada de roleta não encontrada.');
            }
    
            // 2. Verificar se a rodada não foi finalizada
            if (round.finished) {
                throw new BadRequestException('Esta rodada já foi finalizada.');
            }
    
            // 3. Validar o saldo do usuário
            if (user.balance < betData.betAmount) {
                throw new BadRequestException('Saldo insuficiente para fazer a aposta.');
            }
    
            // 4. Criar a aposta
            const bet = await this.rouletteBetModel.create(
                {
                    userId: userId,
                    roundId: roundId,
                    betType: betData.betType,
                    betAmount: betData.betAmount,
                    betNumber: betData.betNumber,
                    betColor: betData.betColor,
                    betColumn: betData.betColumn,
                    betDozen: betData.betDozen,
                    betOddEven: betData.betOddEven,
                    betChoice: betData.betChoice, // Certifique-se de salvar este campo
                },
                { transaction },
            );
    
            // 5. Deduzir o valor da aposta do saldo do usuário
            await user.update(
                { balance: user.balance - betData.betAmount },
                { transaction },
            );
    
            await transaction.commit();
            this.logger.log(
                `Usuário ${userId} fez uma aposta na rodada ${roundId}: ${JSON.stringify(
                    betData,
                )}`,
            );
    
            return bet;
        } catch (error) {
            await transaction.rollback();
            this.logger.error(
                `Erro ao fazer aposta para o usuário ${userId} na rodada ${roundId}: ${error.message}`,
            );
            throw error;
        }
    }
}