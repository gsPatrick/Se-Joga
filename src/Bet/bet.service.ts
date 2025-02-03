import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../models/user/user.model';
import { Bet } from '../models/bet/bet.model';
import { BetGameRound } from '../models/bet/bet-game-round.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { BetGameRoundSeed } from '../models/bet/bet-game-round.model-seed';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Injectable()
export class BetService {
    private readonly logger = new Logger(BetService.name);

    constructor(
        @InjectModel(BetGameRound) private betGameRoundModel: typeof BetGameRound,
        @InjectModel(Bet) private betModel: typeof Bet,
        @InjectModel(User) private userModel: typeof User,
         @InjectModel(BetGameRoundSeed) private betGameRoundSeedModel: typeof BetGameRoundSeed,
        private blockchainUtil: BlockchainUtil,
        @InjectModel(Seed) private seedModel: typeof Seed,
        @InjectModel(GeneratedNumber) private generatedNumberModel: typeof GeneratedNumber,
        private sequelize: Sequelize,
  ) {}


 async createBetGameRound(userId: number): Promise<BetGameRound> {
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
        const betGameRound = await this.betGameRoundModel.create({
            createdBy: userId,
            hash: latestHashId.toString(),
            finished: false,
        });

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
            throw new NotFoundException('Nenhuma seed ou generatedNumber correspondente encontrado para a hash mais recente.');
        }

     await this.betGameRoundSeedModel.create({
          roundId: betGameRound.id,
           seedId: newSeed.id
          })

        this.logger.log(`Rodada de bet criada com id: ${betGameRound.id} e seed id: ${newSeed.id}`);
        return betGameRound;
  }
  

  private async getNextNumber(roundId:number): Promise<number> {
    const betRound = await this.betGameRoundModel.findByPk(roundId, {
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
                  },
               ]
            }
       ]
    });
    if(!betRound)  throw new NotFoundException('Rodada do bet não encontrada.');
    const seed = betRound.betGameRoundSeed[0].seed;
      const generatedNumbers = seed.generatedNumbers;
        if(!generatedNumbers || generatedNumbers.length == 0){
            throw new NotFoundException('Nenhum número gerado encontrado para a seed da rodada.');
        }
  
  const number = generatedNumbers[0].number.valueOf() % 97;
    await this.generatedNumberModel.destroy({
        where: { id: generatedNumbers[0].id },
          })

        return number;
}


  async buyBet(
    userId: number,
    roundId: number,
    betData: { market: string,chosenNumber?: string, betAmount: number, odd:number },
  ): Promise<Bet> {
    const transaction = await this.sequelize.transaction();
    try {
        // 1. Buscar o usuário
      const user = await this.userModel.findByPk(userId, { transaction });
      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

    // 2. Buscar a rodada
       const betRound = await this.betGameRoundModel.findByPk(roundId, {transaction});
       if(!betRound){
         throw new NotFoundException('Rodada não encontrada.');
       }

      // 3. Verificar se a rodada já foi finalizada
      if (betRound.finished) {
        throw new BadRequestException('Esta rodada já foi finalizada.');
      }
         // 4. Pega o numero gerado
       const generatedNumber = await this.getNextNumber(roundId)

         // 5. Criar a aposta
    const newBet = await this.betModel.create(
        {
            userId,
            roundId,
            market: betData.market,
            chosenNumber: betData.chosenNumber || null,
            betAmount: betData.betAmount,
            win: false,
            odd: betData.odd,
             generatedNumber: generatedNumber,
        },
        { transaction }
    );

    // 6. Atualizar o saldo do usuário
     await user.update(
        { balance: user.balance - betData.betAmount },
        { transaction },
      );

      await transaction.commit();
      this.logger.log(`Usuário ${userId} fez uma aposta na rodada ${roundId} no mercado ${betData.market} no valor de ${betData.betAmount}. Numero gerado: ${generatedNumber} apostando no número: ${betData.chosenNumber} odd ${betData.odd}`);

      return newBet;
    } catch (error) {
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


  private checkAndGetPrize(bet: Bet, finalNumber: number): number{
    if(bet.market == "Par" && finalNumber % 2 == 0){
        return bet.betAmount * Number(bet.odd);
    }

    if(bet.market == "Ímpar" && finalNumber % 2 !== 0){
         return bet.betAmount * Number(bet.odd);
        }
    
      if(bet.market == "Blocos"){
          const num = Number(bet.chosenNumber)
           if (
               (num >= 0 && num <= 19 && finalNumber >= 0 && finalNumber <= 19) ||
               (num >= 20 && num <= 39 && finalNumber >= 20 && finalNumber <= 39) ||
               (num >= 40 && num <= 59 && finalNumber >= 40 && finalNumber <= 59) ||
              (num >= 60 && num <= 79 && finalNumber >= 60 && finalNumber <= 79) ||
               (num >= 80 && num <= 99 && finalNumber >= 80 && finalNumber <= 99)
              )
               {
                    return bet.betAmount * Number(bet.odd);
                 }
        }
      if(bet.market == "Maior" && finalNumber > Number(bet.chosenNumber))
       {
        return bet.betAmount * Number(bet.odd);
       }

      if(bet.market == "Menor" && finalNumber < Number(bet.chosenNumber))
        {
        return bet.betAmount * Number(bet.odd);
      }
      return 0
}


  async finalizeBetGameRound(roundId: number, transactionHost?: any): Promise<BetGameRound> {
    const transaction = transactionHost
      ? transactionHost
      : await this.sequelize.transaction();
      try{
            // 1. Buscar a rodada
            const betRound = await this.betGameRoundModel.findByPk(roundId, {
            include: [{ model: Bet,
                include: [
                    {
                      model: User,
                      attributes: ['id', 'name', 'email'],
                     },
                ]
              }],
            transaction
            });

            if (!betRound) {
                throw new NotFoundException('Rodada não encontrada.');
            }
            // 2. Verificar se a rodada já foi finalizada
            if (betRound.finished) {
                throw new ConflictException('Esta rodada já foi finalizada.');
            }

            // 3. pega o numero da rodada
            const finalNumber = await this.getNextNumber(roundId);

          const bets = betRound.bets;
          for (const bet of bets) {
                // 4. Verifica a vitória
              const prize = this.checkAndGetPrize(bet, finalNumber);

            if (prize > 0) {
               bet.win = true
               await bet.save({ transaction });
                const winnerUser = await this.userModel.findByPk(bet.userId, {
                    attributes: ['id', 'name', 'email'],
                   transaction
                  });
                if (!winnerUser) {
                    throw new NotFoundException('Usuário vencedor não encontrado.');
                }
                await winnerUser.update(
                  { balance: winnerUser.balance + prize },
                  { transaction },
                );
             this.logger.log(
               `Usuário ${winnerUser.id} ganhou na rodada ${betRound.id} no mercado ${bet.market} com o número ${bet.chosenNumber}  e recebeu ${prize}`
             );
            }
            else {
                bet.win = false;
                await bet.save({transaction})
                this.logger.log(
                    `Usuário ${bet.userId} perdeu na rodada ${betRound.id} no mercado ${bet.market} no numero ${bet.chosenNumber} o número gerado foi: ${finalNumber}`,
                   );
            }
          }

          betRound.finished = true
          await betRound.save({transaction});

          if (!transactionHost) await transaction.commit();
          this.logger.log(`Rodada de bet ${roundId} finalizada com sucesso. Numero sorteado: ${finalNumber}.`);
          return betRound;
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
              `Erro ao finalizar rodada ${roundId}: ${(error as any).message}`,
              (error as any).stack,
          );
          throw new InternalServerErrorException(
              'Erro ao finalizar a rodada. Por favor, tente novamente.',
          );
      }
    }

   async getBetRoundsWithDetails(): Promise<any[]> {
        return this.betGameRoundModel.findAll({
             include: [
            {
                model: User,
                as: 'createdByUser',
                attributes: ['id', 'name', 'email'],
            },
           {
              model: Bet,
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
                          model: BlockchainHash
                          }
                        ]
                   }
                    ]
           }
        ],
         order: [['createdAt', 'DESC']]
      });
    }
    async getBetRoundByIdWithDetails(roundId: number): Promise<any> {
        const round = await this.betGameRoundModel.findByPk(roundId, {
            include: [
              {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'name', 'email'],
                },
                {
                    model: Bet,
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

           return round
      }

       async getBetRoundsPlayedByUser(userId: number): Promise<BetGameRound[]> {
            return this.betGameRoundModel.findAll({
              include: [
                {
                  model: Bet,
                  where: { userId: userId },
                  required: true,
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
              model: BetGameRoundSeed,
                  include: [
                    {
                      model: Seed,
                         include: [ {
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