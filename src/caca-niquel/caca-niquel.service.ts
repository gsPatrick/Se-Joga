// src/caca-niquel/caca-niquel.service.ts
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from '../models/user/user.model';
import { CacaNiquelBet } from '../models/caca-niquel/caca-niquel-bet.model';
import { CacaNiquelRound } from '../models/caca-niquel/caca-niquel-round.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { Seed } from '../models/seed.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { CacaNiquelRoundSeed } from '../models/caca-niquel/caca-niquel-round-seed.model';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Injectable()
export class CacaNiquelService {
    private readonly logger = new Logger(CacaNiquelService.name);

    private readonly symbols = ['elemento_A', 'elemento_B', 'elemento_C', 'elemento_D', 'elemento_E', 'elemento_F', 'elemento_G', 'elemento_H', 'elemento_I', 'elemento_J'];

    constructor(
        @InjectModel(CacaNiquelRound) private cacaNiquelRoundModel: typeof CacaNiquelRound,
        @InjectModel(CacaNiquelBet) private cacaNiquelBetModel: typeof CacaNiquelBet,
        @InjectModel(User) private userModel: typeof User,
        @InjectModel(CacaNiquelRoundSeed) private cacaNiquelRoundSeedModel: typeof CacaNiquelRoundSeed,
        private blockchainUtil: BlockchainUtil,
        @InjectModel(Seed) private seedModel: typeof Seed,
        @InjectModel(GeneratedNumber) private generatedNumberModel: typeof GeneratedNumber,
        private sequelize: Sequelize,
    ) { }

    async createCacaNiquelRound(userId: number): Promise<CacaNiquelRound> {
        // 1. Busca o usuário
        const user = await this.userModel.findByPk(userId);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }

        // 2. Pega a hash mais recente
        const latestHashId = await this.blockchainUtil.getLatestHashId();
        if (latestHashId === -1) {
            throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
        }

        // 3. Cria a rodada
        const cacaNiquelRound = await this.cacaNiquelRoundModel.create({
            createdBy: userId,
            hash: latestHashId.toString(),
            finished: false,
        });

        // 4. Cria a seed para esta rodada
        const newSeed = await this.seedModel.findOne({
            where: { hashId: latestHashId },
            include: [
                {
                    model: GeneratedNumber,
                    order: [['createdAt', 'DESC']],
                    limit: 3, // Pega 3 numeros para os 3 rolos
                },
            ],
            order: [['createdAt', 'DESC']],
        });

        if (!newSeed || newSeed.generatedNumbers.length < 3) {
            throw new NotFoundException('Nenhuma seed ou GeneratedNumbers correspondente encontrado para a hash mais recente.');
        }

        await this.cacaNiquelRoundSeedModel.create({
            roundId: cacaNiquelRound.id,
            seedId: newSeed.id,
        });

        this.logger.log(`Rodada de caça-níquel criada com id: ${cacaNiquelRound.id} e seed id: ${newSeed.id}`);
        return cacaNiquelRound;
    }

    private async getNextSymbols(roundId: number): Promise<string[]> {
        const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, {
            include: [
                {
                    model: CacaNiquelRoundSeed,
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
                }]
        });

        if (!cacaNiquelRound) {
            throw new NotFoundException('Rodada de caça-níquel não encontrada.');
        }

        if (!cacaNiquelRound.cacaNiquelRoundSeed) {
            throw new InternalServerErrorException('Seed da rodada de caça-níquel não encontrada.');
        }

        const seed = cacaNiquelRound.cacaNiquelRoundSeed.seed; // ✅ Sem alteração aqui, pois já verificamos cacaNiquelRoundSeed
        if (!seed) { // ✅ Adicionada verificação para seed
            throw new InternalServerErrorException('Seed não encontrada no CacaNiquelRoundSeed.');
        }

        const generatedNumbers = seed.generatedNumbers;
        if (!generatedNumbers || generatedNumbers.length < 3) {
            throw new NotFoundException('Números gerados insuficientes para esta rodada de caça-níquel.');
        }

        const symbolsResult: string[] = [];
        for (let i = 0; i < 3; i++) {
            const number = Number(generatedNumbers[i].number) % 100;
            const symbolIndex = Math.floor(number / 10);
            symbolsResult.push(this.symbols[symbolIndex]);

            await this.generatedNumberModel.destroy({ // Remove o numero usado
                where: { id: generatedNumbers[i].id },
            });
        }

        return symbolsResult;
    }   


    async buyBet(
        userId: number,
        roundId: number,
        betData: { betAmount: number, principalSymbol: string, secondarySymbol: string },
    ): Promise<CacaNiquelBet> {
        const transaction = await this.sequelize.transaction();
        try {
            // 1. Buscar o usuário
            const user = await this.userModel.findByPk(userId, { transaction });
            if (!user) {
                throw new NotFoundException('Usuário não encontrado.');
            }

            // 2. Buscar a rodada
            const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, { transaction });
            if (!cacaNiquelRound) {
                throw new NotFoundException('Rodada não encontrada.');
            }

            // 3. Verificar se a rodada já foi finalizada
            if (cacaNiquelRound.finished) {
                throw new BadRequestException('Esta rodada já foi finalizada.');
            }

            // 4. Gerar símbolos para a rodada
            const generatedSymbols = await this.getNextSymbols(roundId);

            // 5. Criar a aposta
            const newBet = await this.cacaNiquelBetModel.create(
                {
                    userId,
                    roundId,
                    betAmount: betData.betAmount,
                    principalSymbol: betData.principalSymbol,
                    secondarySymbol: betData.secondarySymbol,
                    generatedSymbols: generatedSymbols,
                    win: false, // Inicialmente como não vencedor
                    payout: 0, // Inicialmente sem payout
                },
                { transaction }
            );

            // 6. Atualizar o saldo do usuário
            if (user.balance < betData.betAmount) {
                throw new BadRequestException('Saldo insuficiente.');
            }
            await user.update({ balance: user.balance - betData.betAmount }, { transaction });

            await transaction.commit();
            this.logger.log(`Usuário ${userId} fez uma aposta na rodada ${roundId} no valor de ${betData.betAmount} com símbolos principal: ${betData.principalSymbol} e secundário: ${betData.secondarySymbol}. Símbolos gerados: ${generatedSymbols.join(', ')}`);
            return newBet;

        } catch (error) {
            await transaction.rollback();
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            this.logger.error(`Erro ao comprar aposta para rodada ${roundId}: ${(error as any).message}`, (error as any).stack);
            throw new InternalServerErrorException('Erro ao comprar aposta. Por favor, tente novamente.');
        }
    }

    private calculatePayout(bet: CacaNiquelBet): number {
        const generatedSymbols = bet.generatedSymbols;
        const principalSymbol = bet.principalSymbol;
        const secondarySymbol = bet.secondarySymbol;
        const ursoSymbol = 'elemento_A'; // Urso é fixo como elemento_A
        const outroSymbols = this.symbols.filter(sym => sym !== ursoSymbol && sym !== principalSymbol && sym !== secondarySymbol);


        const symbolCounts: { [symbol: string]: number } = {
            [ursoSymbol]: 0,
            [principalSymbol]: 0,
            [secondarySymbol]: 0,
        };
        outroSymbols.forEach(sym => symbolCounts[sym] = 0); // Inicializa contagem para 'Outros'

        generatedSymbols.forEach(symbol => {
            if (symbol === ursoSymbol) symbolCounts[ursoSymbol]++;
            else if (symbol === principalSymbol) symbolCounts[principalSymbol]++;
            else if (symbol === secondarySymbol) symbolCounts[secondarySymbol]++;
            else if (outroSymbols.includes(symbol)) symbolCounts[symbol]++; // Conta 'Outros'
        });

        let payoutMultiplier = 0;

        // Adaptação da tabela de pagamentos para usar os símbolos e contagens
        if (symbolCounts[secondarySymbol] === 1 && outroSymbols.some(sym => symbolCounts[sym] === 2 )) payoutMultiplier = 1.2; // Linha 1
        else if (symbolCounts[principalSymbol] === 1 && outroSymbols.some(sym => symbolCounts[sym] === 2 )) payoutMultiplier = 1.5; // Linha 2
        else if (symbolCounts[principalSymbol] === 1 && symbolCounts[ursoSymbol] === 1) payoutMultiplier = 2.0; // Linha 3
        else if (symbolCounts[secondarySymbol] === 1 && symbolCounts[ursoSymbol] === 1) payoutMultiplier = 1.8; // Linha 4
        else if (symbolCounts[principalSymbol] === 1 && symbolCounts[secondarySymbol] === 1) payoutMultiplier = 2.5; // Linha 5
        else if (symbolCounts[principalSymbol] === 1 && symbolCounts[secondarySymbol] === 1 && symbolCounts[ursoSymbol] === 1) payoutMultiplier = 3.0; // Linha 6
        else if (symbolCounts[principalSymbol] === 1 && symbolCounts[ursoSymbol] === 2) payoutMultiplier = 5.0; // Linha 7
        else if (symbolCounts[secondarySymbol] === 1 && symbolCounts[ursoSymbol] === 2) payoutMultiplier = 3.5; // Linha 8
        else if (symbolCounts[principalSymbol] === 2 && outroSymbols.some(sym => symbolCounts[sym] === 1 )) payoutMultiplier = 3.5; // Linha 9
        else if (symbolCounts[principalSymbol] === 2 && symbolCounts[ursoSymbol] === 1) payoutMultiplier = 8.0; // Linha 10
        else if (symbolCounts[principalSymbol] === 2 && symbolCounts[secondarySymbol] === 1) payoutMultiplier = 6.0; // Linha 11
        else if (symbolCounts[principalSymbol] === 3) payoutMultiplier = 10.0; // Linha 12
        else if (symbolCounts[secondarySymbol] === 2 && outroSymbols.some(sym => symbolCounts[sym] === 1 )) payoutMultiplier = 2.5; // Linha 13
        else if (symbolCounts[secondarySymbol] === 2 && symbolCounts[ursoSymbol] === 1) payoutMultiplier = 4.0; // Linha 14
        else if (symbolCounts[secondarySymbol] === 2 && symbolCounts[principalSymbol] === 1) payoutMultiplier = 3.0; // Linha 15
        else if (symbolCounts[secondarySymbol] === 3) payoutMultiplier = 6.0; // Linha 16


        return bet.betAmount * payoutMultiplier;
    }


    async finalizeCacaNiquelRound(roundId: number, transactionHost?: any): Promise<CacaNiquelRound> {
        const transaction = transactionHost ? transactionHost : await this.sequelize.transaction();
        try {
            const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, {
                include: [{ model: CacaNiquelBet, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }],
                transaction
            });

            if (!cacaNiquelRound) {
                throw new NotFoundException('Rodada de caça-níquel não encontrada.');
            }
            if (cacaNiquelRound.finished) {
                throw new ConflictException('Esta rodada de caça-níquel já foi finalizada.');
            }

            const bets = cacaNiquelRound.bets; // ✅ Sem alteração aqui, bets já está sendo atribuído corretamente
            if (bets) { // ✅ Adicionada verificação para bets
                for (const bet of bets) {
                    const payout = this.calculatePayout(bet);
                    if (payout > 0) {
                        bet.win = true;
                        bet.payout = payout;
                        const winnerUser = await this.userModel.findByPk(bet.userId, { transaction });
                        if (!winnerUser) {
                            throw new NotFoundException('Usuário vencedor não encontrado.');
                        }
                        await winnerUser.update({ balance: winnerUser.balance + payout }, { transaction });
                        this.logger.log(`Usuário ${winnerUser.id} ganhou R$${payout.toFixed(2)} na rodada ${cacaNiquelRound.id} com aposta de R$${bet.betAmount.toFixed(2)}`);
                    }
                    await bet.save({ transaction });
                }
            }


            cacaNiquelRound.finished = true;
            await cacaNiquelRound.save({ transaction });

            if (!transactionHost) await transaction.commit();
            this.logger.log(`Rodada de caça-níquel ${roundId} finalizada com sucesso.`);
            return cacaNiquelRound;

        } catch (error) {
            if (!transactionHost) await transaction.rollback();
            if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException) {
                throw error;
            }
            this.logger.error(`Erro ao finalizar rodada de caça-níquel ${roundId}: ${(error as any).message}`, (error as any).stack);
            throw new InternalServerErrorException('Erro ao finalizar rodada de caça-níquel. Por favor, tente novamente.');
        }
    }


    async getCacaNiquelRoundsWithDetails(): Promise<any[]> {
        return this.cacaNiquelRoundModel.findAll({
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'name', 'email'],
                },
                {
                    model: CacaNiquelBet,
                    include: [{
                        model: User,
                        attributes: ['id', 'name', 'email'],
                    }],
                },
                {
                    model: CacaNiquelRoundSeed,
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

    async getCacaNiquelRoundByIdWithDetails(roundId: number): Promise<any> {
        const round = await this.cacaNiquelRoundModel.findByPk(roundId, {
            include: [
                {
                    model: User,
                    as: 'createdByUser',
                    attributes: ['id', 'name', 'email'],
                },
                {
                    model: CacaNiquelBet,
                    include: [{
                        model: User,
                        attributes: ['id', 'name', 'email'],
                    }],
                },
                {
                    model: CacaNiquelRoundSeed,
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

        if (!round) {
            throw new NotFoundException('Rodada não encontrada.');
        }
        return round;
    }

    async getCacaNiquelRoundsPlayedByUser(userId: number): Promise<CacaNiquelRound[]> {
        return this.cacaNiquelRoundModel.findAll({
            include: [
                {
                    model: CacaNiquelBet,
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
                    model: CacaNiquelRoundSeed,
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