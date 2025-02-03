import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../models/user/user.model';
import { BingoCard } from '../models/bingo/bingo-card.model';
import { BingoGame } from '../models/bingo/bingo-game.model';
import { BlockchainUtil } from '../Utils/blockchain.util';  
import { Seed } from '../models/seed.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { BingoNumber } from '../models/bingo/bingo-number.model';
import { BingoGameRound } from '../models/bingo/bingo-game-round.model';
import { BingoGameSeed } from '../models/bingo/bingo_game_seeds';
import { Op } from 'sequelize';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Injectable()
export class BingoService {
  private readonly logger = new Logger(BingoService.name);
    blockchainHashModel: any;

  constructor(
    @InjectModel(BingoGame) private bingoGameModel: typeof BingoGame,
    @InjectModel(BingoCard) private bingoCardModel: typeof BingoCard,
      @InjectModel(BingoNumber) private bingoNumberModel: typeof BingoNumber,
    @InjectModel(User) private userModel: typeof User,
     @InjectModel(BingoGameSeed) private bingoGameSeedModel: typeof BingoGameSeed,
        private blockchainUtil: BlockchainUtil,
        @InjectModel(Seed) private seedModel: typeof Seed,
        @InjectModel(GeneratedNumber)
         private generatedNumberModel: typeof GeneratedNumber,
    private sequelize: Sequelize,
  ) {}
    
      async createBingoGame(userId: number): Promise<BingoGame> {
        // 1. Busca o usuário
          const user = await this.userModel.findByPk(userId);
            if (!user) {
              throw new NotFoundException('Usuário não encontrado.');
            }
         // 2. Pega a hash mais recente
       const latestHashId = await this.blockchainHashModel.findOne({
            order: [['timestamp', 'DESC']],
         });
          if(latestHashId == -1){
               throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
             }
      // 3. Cria a rodada
        const bingoGame = await this.bingoGameModel.create({
          createdBy: userId,
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
             throw new NotFoundException(
                'Nenhuma seed ou generatedNumber correspondente encontrado para a hash mais recente.',
             );
            }

          await this.bingoGameSeedModel.create({
              gameId: bingoGame.id,
               seedId: newSeed.id
            })
           this.logger.log(`Partida de bingo criada com id: ${bingoGame.id} e seed id: ${newSeed.id}`);
          return bingoGame;
      }

    async buyBingoCards(
      userId: number,
      gameId: number,
        cardData: { cardType: '3x3' | '5x5', numberOfCards: number },
        type: 'user' | 'machine'
    ): Promise<BingoCard[]> {
        const transaction = await this.sequelize.transaction();
      try {
        // 1. Buscar o usuário
        const user = await this.userModel.findByPk(userId, { transaction });
            if (!user) {
                throw new NotFoundException('Usuário não encontrado.');
           }
        // 2. Buscar a partida
        const bingoGame = await this.bingoGameModel.findByPk(gameId, { transaction });
            if (!bingoGame) {
                throw new NotFoundException('Partida de bingo não encontrada.');
           }
        // 3. Verificar se a partida já foi finalizada
            if (bingoGame.finished) {
              throw new BadRequestException('Esta partida já foi finalizada.');
            }
          const createdCards: BingoCard[] = [];
          let odd:number = 1;
          for (let i = 0; i < cardData.numberOfCards; i++) {
              const newCard =  await this.bingoCardModel.create({
                 bingoGameId: gameId,
                userId: userId
            }, { transaction });
            if(type == 'machine'){
                const value =  await this.getNextNumber(gameId)
                newCard.value = value
                 if (cardData.numberOfCards == 3 ) odd = 3.6;
                if(cardData.numberOfCards == 2 ) odd = 5;
                if(cardData.numberOfCards == 10 ) odd = 9.16
                if(cardData.numberOfCards == 6 ) odd = 5.83
                if(cardData.numberOfCards == 1) odd = 3.33
              newCard.updatedAt = new Date()
            }
            await this.createBingoNumbers(newCard.id, cardData.cardType, transaction)
                createdCards.push(newCard);
            }
          await transaction.commit();
        this.logger.log(
            `Usuário ${userId} comprou ${cardData.numberOfCards} cartelas do tipo ${cardData.cardType} na rodada ${gameId}. Cartelas: ${createdCards.map(card => card.id).join(", ")}`,
         );
          return createdCards;
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
            `Erro ao comprar bilhetes para a rodada ${gameId} pelo usuário ${userId}: ${(error as any).message}`,
            (error as any).stack,
        );
        throw new InternalServerErrorException(
          'Erro ao comprar bilhetes. Por favor, tente novamente.',
         );
    }
}
    private async createBingoNumbers(cardId: number, cardType: '3x3' | '5x5', transactionHost?: any): Promise<void> {
      const transaction = transactionHost
        ? transactionHost
        : await this.sequelize.transaction();
  
     try {
        const size = cardType === '3x3' ? 9 : 25;
         const numbers = new Set<number>();
    
        while (numbers.size < size) {
            const number = Math.floor(Math.random() * 76); // Gera números de 0 a 75
            numbers.add(number);
         }

         const createdNumbers = await this.bingoNumberModel.bulkCreate(
            Array.from(numbers).map((number) => ({
                bingoCardId: cardId,
                value: number,
            })),
            { transaction },
          );
          await transaction.commit();
       this.logger.log(
            `Criados ${size} numeros aleatorios para a cartela ${cardId}. Números: ${createdNumbers
               .map((number) => number.value)
              .join(', ')}`,
           );
        }
    catch (error) {
         await transaction.rollback();
          this.logger.error(
             `Erro ao gerar números da cartela: ${(error as any).message}`,
            (error as any).stack,
          );
       throw new InternalServerErrorException(
          'Erro ao criar cartelas. Por favor, tente novamente.',
           );
        }
  }

  private async getNextNumber(gameId:number): Promise<number> {
    const bingoGame = await this.bingoGameModel.findByPk(gameId, {
        include: [
                 {
                    model: BingoGameSeed,
                       include: [
                           {
                              model: Seed,
                                include:[{
                                  model: GeneratedNumber,
                                 order: [['createdAt', 'DESC']]
                                }]
                             }
                         ]
                    }
              ]
         });
            if (!bingoGame) {
              throw new NotFoundException('Rodada não encontrada.');
            }

            const seed = bingoGame.bingoGameSeed[0].seed;
        const generatedNumbers = seed.generatedNumbers;
          if(!generatedNumbers || generatedNumbers.length == 0){
                  throw new NotFoundException('Nenhum número gerado encontrado para a seed da rodada.');
               }
    const number = generatedNumbers[0].number.valueOf() % 76;
        await this.generatedNumberModel.destroy({
          where: { id: generatedNumbers[0].id },
        });
        return number;
    }

  async finalizeBingoRound(roundId: number, transactionHost?: any): Promise<BingoGame> {
    const transaction = transactionHost
      ? transactionHost
      : await this.sequelize.transaction();
    try{
        // 1. Buscar a partida
         const bingoGame = await this.bingoGameModel.findByPk(roundId, {
           include: [{ model: BingoCard,
                include:[{
                     model: User,
                       attributes: ['id', 'name', 'email'],
                      }]
          }],
            transaction
        });

        if (!bingoGame) {
         throw new NotFoundException('Partida de bingo não encontrada.');
      }
      // 2. Verificar se a partida já foi finalizada
       if (bingoGame.finished) {
         throw new ConflictException('Esta partida já foi finalizada.');
          }
      // 3. Obter o número sorteado
       const number = await this.getNextNumber(roundId);

        const drawnNumber = await this.bingoNumberModel.create({
           value: number,
              bingoGameRoundId: roundId
          }, { transaction });
    
        for (const card of bingoGame.bingoCards) {
           // 5. Checar vitoria
              const user = await this.userModel.findByPk(card.userId,{transaction});
              if (user) {
                const prize = this.checkAndGetPrize(card,number, bingoGame);
                   await user.update({balance: user.balance + prize }, { transaction });
                 this.logger.log(
                  `Usuário ${user.id} ganhou na partida ${bingoGame.id} com a cartela ${card.id} e recebeu o valor de: ${prize}`
                   );
           } else {
                this.logger.log(`Usuário não encontrado para a cartela ${card.id}`);
               }
         }
    
      bingoGame.finished = true;
          await bingoGame.save({ transaction });

       if (!transactionHost) await transaction.commit();
           this.logger.log(`Partida de bingo ${roundId} finalizada com sucesso. Número sorteado: ${number}`);
       return bingoGame;
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
            `Erro ao finalizar a partida de bingo ${roundId}: ${(error as any).message}`,
           (error as any).stack,
         );
        throw new InternalServerErrorException(
           'Erro ao finalizar a partida de bingo. Por favor, tente novamente.',
         );
      }
  }
  
private checkAndGetPrize(bingoCard: BingoCard, winningNumber: number, bingoGame: BingoGame): number {
        if(bingoGame.type == 'user'){
            // Lógica de premiação para usuário vs usuário
            let linhaCompleta = false
             let colunaCompleta = false;
          let cartelaCompleta = false;
            // Check Linha
        if(bingoCard.numbers){
         // Check colunas
          }
       
            if (linhaCompleta) return (bingoCard.bingoGame.ticketPrice * bingoCard.bingoGame.totalTickets) * 0.2
          if (colunaCompleta) return (bingoCard.bingoGame.ticketPrice * bingoCard.bingoGame.totalTickets) * 0.2
              if(cartelaCompleta)  return (bingoCard.bingoGame.ticketPrice * bingoCard.bingoGame.totalTickets) * 0.5
        }
        else{
           const odd = this.getOddBasedOnCard(bingoCard.bingoGame.bingoCards.length, winningNumber)
             return (bingoCard.bingoGame.ticketPrice * bingoCard.bingoGame.totalTickets) * odd
          }
      return 0
    }

    private getOddBasedOnCard(numberOfCards:number,winningNumber: number): number{
        if(numberOfCards === 3) {
            return 3.33;
        }
        if(numberOfCards === 6){
            return 5.83;
       }
      if(numberOfCards === 10){
             return 9.16;
        }
     if(numberOfCards === 2)
     {
        return 3.33;
        }
   if(numberOfCards === 10 )
        {
        return 5;
       }
    if (numberOfCards === 1) {
         return 3.6;
       }
      return 1
  }
    
    async getBingoGamesWithDetails(): Promise<any[]> {
        return this.bingoGameModel.findAll({
            include: [
              {
                model: User,
                  as: 'createdByUser',
                  attributes: ['id', 'name', 'email'],
              },
                {
                  model: BingoCard,
                    include: [{
                      model: User,
                         attributes: ['id', 'name', 'email'],
                      }],
                 },
              {
                 model: BingoGameSeed,
                     include: [
                       {
                           model: Seed,
                          include: [{
                               model: BlockchainHash
                            }]
                        }
                     ]
                  }
         ],
            order: [['createdAt', 'DESC']],
        });
    }
        
     async getBingoGameByIdWithDetails(gameId: number): Promise<any> {
        const game = await this.bingoGameModel.findByPk(gameId, {
            include: [
              {
                  model: User,
                   as: 'createdByUser',
                    attributes: ['id', 'name', 'email'],
               },
              {
                    model: BingoCard,
                      include: [{
                        model: User,
                           attributes: ['id', 'name', 'email'],
                        }],
              },
                 {
                   model: BingoGameSeed,
                        include: [
                            {
                             model: Seed,
                             include: [{
                                model: BlockchainHash
                             }]
                          }
                      ]
                  }
        ],
     });
         if(!game){
              throw new NotFoundException(`Partida de bingo de id: ${gameId} não foi encontrada`);
          }
       return game;
    }
        
      async getBingoGamesPlayedByUser(userId: number): Promise<BingoGame[]> {
        return this.bingoGameModel.findAll({
          include: [
            {
               model: BingoCard,
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
                    model: BingoGameSeed,
                         include: [
                           {
                             model: Seed,
                                 include: [{
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