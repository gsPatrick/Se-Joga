import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from 'src/models/user/user.model';
import { DiceBet } from '../models/dice/dice-bet.model';
import { DiceRound } from '../models/dice/dice-round.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { DiceRoundSeed } from 'src/models/dice/dice_round_seeds';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Injectable()
export class DiceService {
    private readonly logger = new Logger(DiceService.name);

  constructor(
    @InjectModel(DiceRound) private diceRoundModel: typeof DiceRound,
        @InjectModel(DiceBet) private diceBetModel: typeof DiceBet,
        @InjectModel(User) private userModel: typeof User,
          @InjectModel(DiceRoundSeed) private diceRoundSeedModel: typeof DiceRoundSeed,
        private blockchainUtil: BlockchainUtil,
         @InjectModel(Seed) private seedModel: typeof Seed,
         @InjectModel(GeneratedNumber)
           private generatedNumberModel: typeof GeneratedNumber,
        private sequelize: Sequelize,
  ) {}

    async createDiceRound(userId: number): Promise<DiceRound> {
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


      // 3. Cria a rodada
      const diceRound = await this.diceRoundModel.create({
        createdBy: userId,
        hash: latestHashId.toString(),
        finished: false,
      });


    //4. Cria a seed para esta rodada

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

     await this.diceRoundSeedModel.create({
        roundId: diceRound.id,
        seedId: newSeed.id
      })

      this.logger.log(`Rodada de dado criada com id: ${diceRound.id} e seed id: ${newSeed.id}`);
     return diceRound;
}

private async getNextNumber(roundId:number): Promise<number> {
    const diceRound = await this.diceRoundModel.findByPk(roundId, {
        include: [
          {
            model: DiceRoundSeed,
              include: [
                {
                  model: Seed,
                   include:[{
                    model: GeneratedNumber,
                      order: [['createdAt', 'DESC']]
                    }]
                  }
              ]
            }]
      });
    
    if (!diceRound) {
        throw new NotFoundException('Rodada do dado não encontrada.');
    }

    const seed = diceRound.diceRoundSeed[0].seed;
    const generatedNumbers = seed.generatedNumbers;
    if(!generatedNumbers || generatedNumbers.length == 0){
        throw new NotFoundException('Nenhum número gerado encontrado para a seed da rodada.');
    }

    const number = generatedNumbers[0].number.valueOf() % 97;
    const finalNumber = number % 7;

      await this.generatedNumberModel.destroy({
        where: { id: generatedNumbers[0].id },
      })

    return finalNumber;
  }

   async buyDiceTickets(
    userId: number,
    roundId: number,
    betData: { betNumber?: number; betAmount: number, type: 'dupla' | 'tripla' },
    ): Promise<DiceBet[]> {
       const transaction = await this.sequelize.transaction();
       try {
     // 1. Buscar o usuário
       const user = await this.userModel.findByPk(userId, { transaction });
       if (!user) {
          throw new NotFoundException('Usuário não encontrado.');
         }

       // 2. Buscar a rodada
       const diceRound = await this.diceRoundModel.findByPk(roundId, { transaction });
       if(!diceRound){
           throw new NotFoundException('Rodada não encontrada.');
      }

    // 3. Verificar se a rodada já foi finalizada
        if (diceRound.finished) {
           throw new BadRequestException('Esta rodada já foi finalizada.');
        }
       
      const createdBets:DiceBet[] = [];

       if (betData.type === 'dupla') {
        let firstDiceNumber = 0
         let secondDiceNumber = 0;
         let hasSecondChance = true;
         while(hasSecondChance){
          // 4. Pega o numero gerado
          firstDiceNumber =  await this.getNextNumber(roundId)
          secondDiceNumber =  await this.getNextNumber(roundId)
        
            const newBet = await this.diceBetModel.create(
                {
                userId,
                roundId,
                betNumber: betData.betNumber,
                betAmount: betData.betAmount,
                  generatedNumber: (firstDiceNumber + secondDiceNumber),
                    win: false, 
                },
                { transaction }
              );
            createdBets.push(newBet);
            
           if (firstDiceNumber == betData.betNumber || secondDiceNumber == betData.betNumber){
            this.logger.log(
                `Usuário ${userId} teve uma chance extra na rodada ${roundId} apostando no número ${betData.betNumber} o número gerado foi: ${firstDiceNumber} e ${secondDiceNumber} `
           );
        
           }else{
            hasSecondChance = false;
           }
         }


      } else if (betData.type === 'tripla') {
        let firstDiceNumber = 0
        let secondDiceNumber = 0;
        let thirdDiceNumber = 0;
        let attempts = 3;
        for (let i = 0; i < attempts; i++) {
            // 4. Pega o numero gerado
            firstDiceNumber =  await this.getNextNumber(roundId)
            secondDiceNumber =  await this.getNextNumber(roundId)
            thirdDiceNumber =  await this.getNextNumber(roundId)

            const newBet = await this.diceBetModel.create(
                {
                userId,
                roundId,
                betNumber: betData.betNumber,
                betAmount: betData.betAmount,
                  generatedNumber: (firstDiceNumber + secondDiceNumber + thirdDiceNumber),
                    win: false,
                },
                { transaction }
              );
             createdBets.push(newBet);
               
             if ((firstDiceNumber == betData.betNumber && secondDiceNumber == betData.betNumber && thirdDiceNumber == betData.betNumber)) {
                i = attempts;
            }
            else{
            this.logger.log(`Usuario ${userId} teve mais uma tentativa na rodada ${roundId} para o numero ${betData.betNumber}  os numeros gerados foram ${firstDiceNumber} ${secondDiceNumber} ${thirdDiceNumber}`)
        }
        }
    }
       const totalAmount = createdBets.reduce((acc, bet) => acc + betData.betAmount, 0);

     // 5. Atualizar o saldo do usuário
      await user.update(
        { balance: user.balance - totalAmount },
        { transaction },
      );
         await transaction.commit();
    this.logger.log(`Usuário ${userId} apostou ${totalAmount} na rodada de id ${roundId} no modo ${betData.type} e no numero ${betData.betNumber}`);
       return createdBets;
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
        `Erro ao comprar bilhetes para a rodada ${roundId} pelo usuário ${userId}: ${(error as any).message}`,
        (error as any).stack,
        );
        throw new InternalServerErrorException(
        'Erro ao comprar bilhetes. Por favor, tente novamente.',
         );
        }
  }

    private checkAndGetPrize(bet: DiceBet): number{
        if(bet.betNumber == bet.generatedNumber)
         {
              return  bet.betAmount;
         }else{
                return 0;
          }
}


 async finalizeDiceRound(roundId: number, transactionHost?: any): Promise<DiceRound> {
    const transaction = transactionHost
      ? transactionHost
      : await this.sequelize.transaction();
    try{
        // 1. Buscar a rodada
        const diceRound = await this.diceRoundModel.findByPk(roundId,{
        include: [{ model: DiceBet,
              include: [
                {
                  model: User,
                  attributes: ['id', 'name', 'email'],
                },
              ],
           }],
           transaction
        });

        if (!diceRound) {
        throw new NotFoundException('Rodada não encontrada.');
        }

      // 2. Verificar se a rodada já foi finalizada
      if (diceRound.finished) {
        throw new ConflictException('Rodada já finalizada.');
      }
        const bets = diceRound.bets;

          for (const bet of bets) {
              const prize = this.checkAndGetPrize(bet)
            if(prize > 0)
           {
               bet.win = true;
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
                  `Usuário ${winnerUser.id} ganhou na rodada ${diceRound.id} e recebeu ${prize} pelo número ${bet.betNumber} o número gerado foi: ${bet.generatedNumber}`
                );
           }else{
                bet.win = false
            }
            await bet.save({ transaction });
          }
       diceRound.finished = true;
        await diceRound.save({transaction});

      if (!transactionHost) await transaction.commit();

      this.logger.log(`Rodada de dado ${roundId} finalizada.`);
    return diceRound;
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
        `Erro ao finalizar a rodada ${roundId}: ${(error as any).message}`,
        (error as any).stack,
      );
      throw new InternalServerErrorException(
        'Erro ao finalizar a rodada. Por favor, tente novamente.',
      );
        }
    }
    //   Consulta
    async getDiceRoundsWithDetails(): Promise<any[]> {
      const rounds = await this.diceRoundModel.findAll({
          include: [
              {
                  model: User,
                  as: 'createdByUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: DiceBet,
                   include: [{
                        model: User,
                        attributes: ['id', 'name', 'email'],
                    }],
                 },
                {
                   model: DiceRoundSeed,
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
      })
      return rounds.map(round => ({
        id: round.id,
         createdAt: round.createdAt,
          finished: round.finished,
          createdBy: {
            id: round.createdByUser?.id,
              name: round.createdByUser?.name,
            email: round.createdByUser?.email
          },
         hash: round.diceRoundSeed[0].seed.blockchainHash.hash,
         bets: round.bets.map(bet => ({
            id: bet.id,
             userId: bet.userId,
            betNumber: bet.betNumber,
            betAmount: bet.betAmount,
            generatedNumber: bet.generatedNumber,
             createdAt: bet.createdAt,
              win: bet.win,
              user: {
                id: bet.user?.id,
                  name: bet.user?.name,
                   email: bet.user?.email
                 }
            })),
     }));
  }
  
    async getDiceRoundByIdWithDetails(roundId: number): Promise<any> {
        const round = await this.diceRoundModel.findByPk(roundId, {
          include: [
              {
                  model: User,
                  as: 'createdByUser',
                  attributes: ['id', 'name', 'email'],
              },
              {
                  model: DiceBet,
                    include: [{
                        model: User,
                        attributes: ['id', 'name', 'email'],
                    }],
             },
              {
                model: DiceRoundSeed,
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
        return {
            id: round.id,
             createdAt: round.createdAt,
            finished: round.finished,
            createdBy: {
                id: round.createdByUser?.id,
                name: round.createdByUser?.name,
                email: round.createdByUser?.email,
            },
             hash: round.diceRoundSeed[0].seed.blockchainHash.hash,
            bets: round.bets.map(bet => ({
                id: bet.id,
                 userId: bet.userId,
                betNumber: bet.betNumber,
                betAmount: bet.betAmount,
                  generatedNumber: bet.generatedNumber,
                createdAt: bet.createdAt,
                win: bet.win,
                user: {
                   id: bet.user?.id,
                    name: bet.user?.name,
                    email: bet.user?.email,
                   }
             })),
       };
    }
    
   async getDiceRoundsPlayedByUser(userId: number): Promise<DiceRound[]> {
          return this.diceRoundModel.findAll({
            include: [
              {
                model: DiceBet,
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
               model: DiceRoundSeed,
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