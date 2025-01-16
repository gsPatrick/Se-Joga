// src/dice/dice.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { User } from 'src/models/user/user.model';
import { DiceBet } from 'src/models/dice/dice-bet.model';
import { DiceRound } from 'src/models/dice/dice-round.model';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { DiceRoundSeed } from 'src/models/dice/dice_round_seeds';
import { Seed } from 'src/models/seed.model';

@Injectable()
export class DiceService {
  private readonly logger = new Logger(DiceService.name);

  constructor(
    @InjectModel(BlockchainHash)
    private blockchainHashModel: typeof BlockchainHash,
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(DiceBet)
    private diceBetModel: typeof DiceBet,
    @InjectModel(DiceRound)
    private diceRoundModel: typeof DiceRound,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  async playDice(userId: number, bet: number, chosenNumber: number): Promise<any> {
    // 1. Validar a entrada
    if (chosenNumber < 1 || chosenNumber > 6 || !Number.isInteger(chosenNumber)) {
      throw new BadRequestException('Número escolhido deve ser um inteiro entre 1 e 6.');
    }
    if (!Number.isInteger(bet) || bet <= 0) {
      throw new BadRequestException('A aposta deve ser um inteiro maior que zero.');
    }

    // 2. Buscar o usuário
    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // 3. Verificar se o usuário tem saldo suficiente
    if (user.balance < bet) {
      throw new BadRequestException('Saldo insuficiente.');
    }

    // 4. Buscar a hash mais recente
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });
    if (!latestHash) {
      throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
    }

    // 5. Gerar o número do dado (1 a 6) com base na última dezena do hash
    const lastDigitOfHash = parseInt(latestHash.hash.slice(-1), 16); // Pega o último dígito do hash e converte para decimal
    const generatedNumber = (lastDigitOfHash % 6) + 1; // Usa o resto da divisão por 6 para gerar um número entre 1 e 6

    // 6. Determinar o resultado
    const win = generatedNumber === chosenNumber;
    const payout = win ? bet * 5 : 0; // Multiplicador de 5x para vitória

    // 7. Criar uma nova rodada (DiceRound)
    const newDiceRound = await this.diceRoundModel.create({
      hash: latestHash.hash,
      finished: true,
      createdBy: userId,
    });

    // 8. Criar um novo registro de aposta (DiceBet)
    const newDiceBet = await this.diceBetModel.create({
      userId: userId,
      roundId: newDiceRound.id,
      betNumber: chosenNumber,
      betAmount: bet,
      win: win,
      generatedNumber: generatedNumber,
    });

    // 9. Atualizar o saldo do usuário
    await user.update({ balance: user.balance - bet + payout });

    // 10. Registrar o resultado
    this.logger.log(
      `Usuário ${userId} apostou ${bet} no número ${chosenNumber}. Número gerado: ${generatedNumber}. Resultado: ${
        win ? 'Ganhou' : 'Perdeu'
      }. Saldo atual: ${user.balance}`,
    );

    return {
      win,
      generatedNumber,
      payout,
      newBalance: user.balance,
    };
  }

  async getDiceGamesByUser(userId: number, filter: 'all' | 'won' | 'lost' = 'all'): Promise<any[]> {
    const where: any = { userId };

    if (filter === 'won') {
      where.win = true;
    } else if (filter === 'lost') {
      where.win = false;
    }

    const bets = await this.diceBetModel.findAll({
      where,
      include: [
        {
          model: DiceRound,
          attributes: ['hash', 'createdAt'],
          include: [
            {
              model: DiceRoundSeed,
              as: 'diceRoundSeed', // Alias para a associação
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
            },
          ],
        },
        {
          model: User,
          attributes: ['id', 'name', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    return bets.map(bet => {
      const diceRoundSeed = bet.round?.diceRoundSeed;
      const seed = diceRoundSeed?.seed;
      const blockchainHash = seed?.blockchainHash

      return {
        id: bet.id,
        userId: bet.userId,
        roundId: bet.roundId,
        betNumber: bet.betNumber,
        betAmount: bet.betAmount,
        win: bet.win,
        createdAt: bet.createdAt,
        generatedNumber: bet.generatedNumber,
        round: {
          hash: bet.round.hash,
          createdAt: bet.round.createdAt,
          seed: seed ? seed.seed : null,
          blockchainHash: blockchainHash ? {
            hash: blockchainHash.hash,
            timestamp: blockchainHash.timestamp,
          } : null,
        },
        user: {
          id: bet.user.id,
          name: bet.user.name,
          email: bet.user.email
        }
      };
    });
  }

}