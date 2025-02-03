import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../models/user/user.model';
import { RouletteBet } from '../models/roulette/roulette-bet.model';
import { RouletteRound } from '../models/roulette/roulette-round.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { BetGameRoundSeed } from '../models/bet/bet-game-round.model-seed';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Injectable()
export class RouletteService {
    [x: string]: any;
  private readonly logger = new Logger(RouletteService.name);

  constructor(
    @InjectModel(RouletteRound) private rouletteRoundModel: typeof RouletteRound,
    @InjectModel(RouletteBet) private rouletteBetModel: typeof RouletteBet,
    @InjectModel(User) private userModel: typeof User,
      @InjectModel(BetGameRoundSeed) private betGameRoundSeedModel: typeof BetGameRoundSeed,
        private blockchainUtil: BlockchainUtil,
         @InjectModel(Seed) private seedModel: typeof Seed,
          @InjectModel(GeneratedNumber)
         private generatedNumberModel: typeof GeneratedNumber,
    private sequelize: Sequelize,
  ) {}

   async createRouletteRound(userId: number, type: 'banca' | 'sala' = 'banca'): Promise<RouletteRound> {
         // 1. Busca o usuário
         const user = await this.userModel.findByPk(userId);
         if (!user) {
           throw new NotFoundException('Usuário não encontrado.');
          }

          // 2. Pega a hash mais recente
          const latestHashId = await this.blockchainUtil.getLatestHashId();
  
          if(latestHashId == -1){
               throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
         }

            const rouletteRound = await this.rouletteRoundModel.create({
                createdBy: userId,
                 hash: latestHashId.toString(),
              finished: false,
             type: type,
            })
          
      const newSeed = await this.seedModel.findOne({
            where: { hashId: latestHashId },
               include: [
                  {
                    model: GeneratedNumber,
                     order: [['createdAt', 'DESC']],
                     limit: 1,
                  },
                ],
              order: [['createdAt', 'DESC']],
            });

          if (!newSeed || newSeed.generatedNumbers.length === 0) {
            throw new NotFoundException(
                'Nenhuma seed ou generatedNumber correspondente encontrado para a hash mais recente.',
             );
            }

         await this.betGameRoundSeedModel.create({
              roundId: rouletteRound.id,
               seedId: newSeed.id
            })

          this.logger.log(`Rodada de roleta criada com id: ${rouletteRound.id}`);
          return rouletteRound;
      }

      private async getNextNumber(roundId:number): Promise<number> {
            const rouletteRound = await this.rouletteRoundModel.findByPk(roundId, {
                include: [
                     {
                        model: BetGameRoundSeed,
                             include: [
                                 {
                                  model: Seed,
                                     include: [
                                        {
                                        model: GeneratedNumber,
                                         order: [['createdAt', 'DESC']]
                                        }
                                      ]
                                   }
                           ]
                   }
               ]
            });
            if (!rouletteRound) {
            throw new NotFoundException('Rodada não encontrada.');
            }
        const seed = rouletteRound.betGameRoundSeed[0].seed;
          const generatedNumbers = seed.generatedNumbers;
             if(!generatedNumbers || generatedNumbers.length == 0){
                throw new NotFoundException('Nenhum número gerado encontrado para a seed da rodada.');
              }
  
    const number = generatedNumbers[0].number.valueOf() % 37;
        await this.generatedNumberModel.destroy({
          where: { id: generatedNumbers[0].id },
        })
        return number;
    }
    
    async buyBet(
        userId: number,
        roundId: number,
        betData: { betType: string, betChoice: string; betAmount: number, betNumber?: number, betColor?: string, betColumn?: number },
        ): Promise<RouletteBet> {
         const transaction = await this.sequelize.transaction();
             try {
                // 1. Buscar o usuário
            const user = await this.userModel.findByPk(userId, { transaction });
            if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }
        // 2. Buscar a rodada
            const rouletteRound = await this.rouletteRoundModel.findByPk(roundId,{transaction});
        if (!rouletteRound) {
          throw new NotFoundException('Rodada não encontrada.');
            }
       // 3. Verificar se a rodada já foi finalizada
           if (rouletteRound.finished) {
            throw new BadRequestException('Esta rodada já foi finalizada.');
             }
                 // 4. Pega o numero gerado
            const generatedNumber = await this.getNextNumber(roundId)


        // 5. Criar a aposta
             const newBet = await this.rouletteBetModel.create(
                  {
                       userId,
                       roundId,
                    betType: betData.betType,
                      betChoice: betData.betChoice,
                      betAmount: betData.betAmount,
                     betNumber: betData.betNumber || null,
                      betColor: betData.betColor || null,
                    betColumn: betData.betColumn || null,
                    win: false,
                     generatedNumber
                 },
                { transaction }
            );

        // 6. Atualizar o saldo do usuário
           await user.update(
              { balance: user.balance - betData.betAmount },
               { transaction },
            );

         await transaction.commit();

            this.logger.log(
            `Usuário ${userId} fez uma aposta na rodada ${roundId} no mercado ${betData.betType} no valor de ${betData.betAmount} com a escolha ${betData.betChoice}. Número gerado: ${generatedNumber}`
          );
        return newBet;
        }
        catch (error) {
        await transaction.rollback();

        if (
            error instanceof NotFoundException ||
            error instanceof BadRequestException
        ) {
            throw error;
        }

        this.logger.error(
            `Erro ao comprar bilhete para rodada ${roundId}: ${(error as any).message}`,
            (error as any).stack,
          );
          throw new InternalServerErrorException(
            'Erro ao comprar bilhetes. Por favor, tente novamente.',
         );
    }
  }
  private checkAndGetPrize(bet: RouletteBet, winningNumber: number, winningColor: string): number{
    let win = false
      if (bet.betType === 'NUMBER' && bet.betChoice === String(winningNumber)) {
            win = true;
        }
        if (bet.betType === 'COLUMN' && (bet.betColumn === 1 && [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34].includes(winningNumber))
                || (bet.betColumn === 2 && [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35].includes(winningNumber))
                || (bet.betColumn === 3 && [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36].includes(winningNumber))) {
            win = true;
          }
        if (bet.betType === 'COLOR' && bet.betChoice === winningColor) {
            win = true;
         }
        if(bet.betType == "DOZEN" && bet.betChoice ==  "1-12" && winningNumber >= 1 && winningNumber <= 12 )
          {
              win = true
           }
       if(bet.betType == "DOZEN" && bet.betChoice == "13-24" && winningNumber >= 13 && winningNumber <= 24)
            {
               win = true
            }
       if(bet.betType == "DOZEN" && bet.betChoice == "25-36" && winningNumber >= 25 && winningNumber <= 36)
           {
               win = true
             }
    if (bet.betType === 'ODD_EVEN' && (
        (bet.betChoice === 'ODD' && winningNumber % 2 !== 0) ||
        (bet.betChoice === 'EVEN' && winningNumber % 2 === 0)
      )
      ) {
           win = true
      }
          if(win){
            return bet.betAmount * Number(bet.odd);
        }
    else{
            return 0
       }
  }
 async finalizeBetGameRound(roundId: number, transactionHost?: any): Promise<RouletteRound> {
        const transaction = transactionHost
          ? transactionHost
          : await this.sequelize.transaction();
        try{
           // 1. Buscar a rodada
            const rouletteRound = await this.rouletteRoundModel.findByPk(roundId, {
                include: [{model: RouletteBet,
               include: [
                {
                    model: User,
                 attributes: ['id', 'name', 'email'],
               },
              ],
            },
            {
              model: BetGameRoundSeed,
               include: [
                 {
                  model: Seed,
                   include: [
                        {
                         model: BlockchainHash,
                      }
                  ]
                   }
                ]
            }
        ],
             transaction
          });
            if (!rouletteRound) {
              throw new NotFoundException('Rodada de roleta não encontrada.');
           }
            // 2. Verificar se a rodada já foi finalizada
            if (rouletteRound.finished) {
               throw new ConflictException('Esta rodada já foi finalizada.');
            }
       // 3. Obter o número e cor do resultado
        const winningNumber = await this.getNextNumber(roundId);
        const winningColor = this.getWinningColor(winningNumber)
         rouletteRound.winningNumber = winningNumber
         rouletteRound.winningColor = winningColor

         const bets = rouletteRound.bets
              for (const bet of bets) {
                    const prize = this.checkAndGetPrize(bet, winningNumber, winningColor);
                if (prize > 0) {
                    bet.win = true
                         await bet.save({ transaction });
                    const winnerUser = await this.userModel.findByPk(bet.userId, {
                       attributes: ['id', 'name', 'email'],
                       transaction
                     });
                 if (winnerUser) {
                     await winnerUser.update(
                        { balance: winnerUser.balance + prize },
                          { transaction },
                         );
                 } else {
                     throw new NotFoundException('Usuário vencedor não encontrado.');
                 }
                     this.logger.log(
                        `Usuário ${winnerUser.id} ganhou na rodada ${rouletteRound.id} no mercado ${bet.betType} com a escolha ${bet.betChoice} e recebeu ${prize}. O número sorteado foi: ${winningNumber} e a cor: ${winningColor}`
                     );
                }
                 else {
                      bet.win = false;
                      await bet.save({ transaction });
                     this.logger.log(
                        `Usuário ${bet.userId} perdeu na rodada ${rouletteRound.id} no mercado ${bet.betType} com a escolha ${bet.betChoice}. Numero sorteado: ${winningNumber} e cor: ${winningColor}`,
                       );
                  }
          }
          rouletteRound.finished = true
          await rouletteRound.save({transaction});

          if (!transactionHost) await transaction.commit();
            this.logger.log(`Rodada de roleta ${rouletteRound.id} finalizada com sucesso. Número sorteado foi: ${winningNumber} cor: ${winningColor}`);
            return rouletteRound;
        }
          catch (error) {
            if (!transactionHost) await transaction.rollback();
              if (
               error instanceof NotFoundException ||
               error instanceof BadRequestException ||
               error instanceof ConflictException
            ) {
                throw error;
          }

            this.logger.error(
                `Erro ao finalizar a rodada de roleta ${roundId}: ${(error as any).message}`,
               (error as any).stack,
            );
             throw new InternalServerErrorException(
                'Erro ao finalizar a rodada de roleta. Por favor, tente novamente.',
            );
      }
  }

 async getBetRoundsWithDetails(): Promise<any[]> {
        return this.rouletteRoundModel.findAll({
            include: [
              {
                model: User,
                as: 'createdByUser',
                attributes: ['id', 'name', 'email'],
               },
             {
                 model: RouletteBet,
                  include: [{
                    model: User,
                      attributes: ['id', 'name', 'email'],
                  }],
               },
               {
                   model: BetGameRoundSeed,
                        include: [
                            {
                                model: Seed,
                                 include:[{
                                   model: BlockchainHash
                               }]
                            }
                        ]
                    }
              ],
            order: [['createdAt', 'DESC']]
          });
    }
      
     async getBetRoundByIdWithDetails(roundId: number): Promise<any> {
        const round = await this.rouletteRoundModel.findByPk(roundId, {
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'name', 'email'],
                },
                {
                    model: RouletteBet,
                      include: [{
                          model: User,
                           attributes: ['id', 'name', 'email'],
                      }],
                  },
                {
                      model: BetGameRoundSeed,
                           include: [
                             {
                               model: Seed,
                                  include:[{
                                    model: BlockchainHash
                                   }]
                                 }
                             ]
                   }
            ],
        });
      
        if (!round) {
            throw new NotFoundException('Rodada não encontrada.');
          }
        return round;
      }
  
       async getRouletteRoundsPlayedByUser(userId: number): Promise<RouletteRound[]> {
        return this.rouletteRoundModel.findAll({
          include: [
            {
              model: RouletteBet,
               where: { userId: userId },
              required: true,
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
               model: BetGameRoundSeed,
                    include: [
                       {
                        model: Seed,
                        include:[{
                         model: BlockchainHash
                       }]
                      }
                    ]
           }
         ],
        order: [['createdAt', 'DESC']],
       });
      }
    
}