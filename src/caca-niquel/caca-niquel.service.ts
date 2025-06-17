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

interface PayoutInfo {
    payout: number;
    multiplier: number;
    name: string;
    description: string;
    animationHint: 'none' | 'small-win' | 'medium-win' | 'big-win' | 'jackpot';
}

@Injectable()
export class CacaNiquelService {
    private readonly logger = new Logger(CacaNiquelService.name);

    private readonly symbolMap = {
        'elemento_A': 'urso', 'elemento_B': 'strawberry', 'elemento_C': 'diamond',
        'elemento_D': 'cherry', 'elemento_E': 'roulette', 'elemento_F': 'joker',
        'elemento_G': 'pineapple', 'elemento_H': 'number7', 'elemento_I': 'grape',
        'elemento_J': 'watermelon',
    };
    
    private readonly reverseSymbolMap: { [iconName: string]: string };
    private readonly symbols = Object.keys(this.symbolMap);
    private readonly ursoSymbol = 'elemento_A';

    constructor(
        @InjectModel(CacaNiquelRound) private cacaNiquelRoundModel: typeof CacaNiquelRound,
        @InjectModel(CacaNiquelBet) private cacaNiquelBetModel: typeof CacaNiquelBet,
        @InjectModel(User) private userModel: typeof User,
        @InjectModel(CacaNiquelRoundSeed) private cacaNiquelRoundSeedModel: typeof CacaNiquelRoundSeed,
        private blockchainUtil: BlockchainUtil,
        @InjectModel(Seed) private seedModel: typeof Seed,
        @InjectModel(GeneratedNumber) private generatedNumberModel: typeof GeneratedNumber,
        private sequelize: Sequelize,
    ) {
        this.reverseSymbolMap = Object.entries(this.symbolMap).reduce((acc, [key, value]) => {
            acc[value] = key;
            return acc;
        }, {} as { [key: string]: string });
    }

    async createCacaNiquelRound(userId: number): Promise<CacaNiquelRound> {
        const user = await this.userModel.findByPk(userId);
        if (!user) throw new NotFoundException('Usuário não encontrado.');
        const latestHashId = await this.blockchainUtil.getLatestHashId();
        if (latestHashId === -1) throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
        const cacaNiquelRound = await this.cacaNiquelRoundModel.create({ createdBy: userId, hash: latestHashId.toString(), finished: false });
        const newSeed = await this.seedModel.findOne({ where: { hashId: latestHashId }, include: [{ model: GeneratedNumber, order: [['createdAt', 'DESC']], limit: 3 }], order: [['createdAt', 'DESC']] });
        if (!newSeed || newSeed.generatedNumbers.length < 3) throw new NotFoundException('Nenhuma seed ou GeneratedNumbers correspondente encontrado para a hash mais recente.');
        await this.cacaNiquelRoundSeedModel.create({ roundId: cacaNiquelRound.id, seedId: newSeed.id });
        this.logger.log(`Rodada de caça-níquel criada com id: ${cacaNiquelRound.id} e seed id: ${newSeed.id}`);
        return cacaNiquelRound;
    }

    private async getNextSymbols(roundId: number, principalSymbolId: string, secondarySymbolId: string): Promise<string[]> {
        const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, { include: [{ model: CacaNiquelRoundSeed, include: [{ model: Seed, include: [{ model: GeneratedNumber, order: [['createdAt', 'DESC']] }] }] }] });
        if (!cacaNiquelRound) throw new NotFoundException('Rodada de caça-níquel não encontrada.');
        if (!cacaNiquelRound.cacaNiquelRoundSeed?.seed?.generatedNumbers) throw new InternalServerErrorException('Seed ou números gerados não encontrados para a rodada.');
        const generatedNumbers = cacaNiquelRound.cacaNiquelRoundSeed.seed.generatedNumbers;
        if (generatedNumbers.length < 3) throw new NotFoundException('Números gerados insuficientes para esta rodada.');
        const symbolsResult: string[] = [];
        const outroSymbols = this.symbols.filter(s => s !== this.ursoSymbol && s !== principalSymbolId && s !== secondarySymbolId);
        for (let i = 0; i < 3; i++) {
            const randomNumber = Number(generatedNumbers[i].number) % 100;
            let chosenSymbol: string;
            if (randomNumber < 10) { chosenSymbol = this.ursoSymbol; }
            else if (randomNumber < 20) { chosenSymbol = principalSymbolId; }
            else if (randomNumber < 30) { chosenSymbol = secondarySymbolId; }
            else { const outroIndex = (randomNumber - 30) % outroSymbols.length; chosenSymbol = outroSymbols[outroIndex]; }
            symbolsResult.push(chosenSymbol);
            await this.generatedNumberModel.destroy({ where: { id: generatedNumbers[i].id } });
        }
        return symbolsResult;
    }

    async buyBet(userId: number, roundId: number, betData: { betAmount: number, principalSymbol: string, secondarySymbol: string }): Promise<any> {
        const principalSymbolId = this.reverseSymbolMap[betData.principalSymbol];
        const secondarySymbolId = this.reverseSymbolMap[betData.secondarySymbol];

        if (!principalSymbolId || !secondarySymbolId) {
            throw new BadRequestException('Nome de símbolo principal ou secundário inválido.');
        }

        const transaction = await this.sequelize.transaction();
        try {
            const user = await this.userModel.findByPk(userId, { transaction });
            if (!user) throw new NotFoundException('Usuário não encontrado.');
            
            const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, { transaction });
            if (!cacaNiquelRound) throw new NotFoundException('Rodada não encontrada.');
            if (cacaNiquelRound.finished) throw new BadRequestException('Esta rodada já foi finalizada.');
            if (user.balance < betData.betAmount) throw new BadRequestException('Saldo insuficiente.');

            const generatedSymbols = await this.getNextSymbols(roundId, principalSymbolId, secondarySymbolId);
            const payoutInfo = this.calculatePayout({ betAmount: betData.betAmount, principalSymbol: principalSymbolId, secondarySymbol: secondarySymbolId, generatedSymbols });

            const newBet = await this.cacaNiquelBetModel.create({ 
                userId, roundId, betAmount: betData.betAmount, 
                principalSymbol: principalSymbolId,
                secondarySymbol: secondarySymbolId,
                generatedSymbols, win: payoutInfo.payout > 0, payout: payoutInfo.payout 
            }, { transaction });
            
            const newBalance = user.balance - betData.betAmount + payoutInfo.payout;
            await user.update({ balance: newBalance }, { transaction });

            cacaNiquelRound.finished = true;
            await cacaNiquelRound.save({ transaction });
            await transaction.commit();

            const symbolCounts: { [key: string]: number } = {};
            generatedSymbols.forEach(symbol => {
                const iconName = this.symbolMap[symbol as keyof typeof this.symbolMap];
                symbolCounts[iconName] = (symbolCounts[iconName] || 0) + 1;
            });
            const rolledSymbolsResult = Object.entries(this.symbolMap).map(([key, icon], index) => ({ id: index + 1, icon: icon, value: symbolCounts[icon] || 0 }));
            
            this.logger.log(`Usuário ${userId} apostou R$${betData.betAmount} e ganhou R$${payoutInfo.payout.toFixed(2)}. Combinação: ${payoutInfo.name}. Símbolos: ${generatedSymbols.join(', ')}`);

            const { principalSymbol, secondarySymbol, ...betResult } = newBet.toJSON();

            return { 
                bet: betResult,
                payoutInfo, 
                rolledSymbols: rolledSymbolsResult, 
                newBalance 
            };

        } catch (error) {
            await transaction.rollback();
            if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
            this.logger.error(`Erro ao comprar aposta para rodada ${roundId}: ${(error as any).message}`, (error as any).stack);
            throw new InternalServerErrorException('Erro ao comprar aposta. Por favor, tente novamente.');
        }
    }

    private calculatePayout(bet: { betAmount: number; principalSymbol: string; secondarySymbol: string; generatedSymbols: string[]; }): PayoutInfo {
        const { betAmount, principalSymbol, secondarySymbol, generatedSymbols } = bet;
        const outroSymbols = this.symbols.filter(s => s !== this.ursoSymbol && s !== principalSymbol && s !== secondarySymbol);
        const symbolCounts: { [symbol: string]: number } = {};
        generatedSymbols.forEach(symbol => { symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1; });
        let multiplier = 0;
        let name = "Sem Prêmio";
        let animationHint: PayoutInfo['animationHint'] = 'none';
        const isPair = (symbol: string) => (symbolCounts[symbol] || 0) === 2;
        const isSingle = (symbol: string) => (symbolCounts[symbol] || 0) === 1;
        const isThreeOfAKind = (symbol: string) => (symbolCounts[symbol] || 0) === 3;
        const hasPairOfOthers = () => outroSymbols.some(sym => isPair(sym));
        const hasSingleOther = () => outroSymbols.some(sym => isSingle(sym));
        if (isSingle(secondarySymbol) && hasPairOfOthers()) { multiplier = 1.20; name = "Par de Outros com Secundário"; animationHint = 'small-win'; }
        else if (isSingle(principalSymbol) && hasPairOfOthers()) { multiplier = 1.50; name = "Par de Outros com Principal"; animationHint = 'small-win'; }
        else if (isSingle(principalSymbol) && isSingle(this.ursoSymbol) && hasSingleOther()) { multiplier = 2.00; name = "Principal, Urso e Outro"; animationHint = 'medium-win'; }
        else if (isSingle(secondarySymbol) && isSingle(this.ursoSymbol) && hasSingleOther()) { multiplier = 1.80; name = "Secundário, Urso e Outro"; animationHint = 'medium-win'; }
        else if (isSingle(principalSymbol) && isSingle(secondarySymbol) && hasSingleOther()) { multiplier = 2.50; name = "Principal, Secundário e Outro"; animationHint = 'medium-win'; }
        else if (isSingle(principalSymbol) && isSingle(secondarySymbol) && isSingle(this.ursoSymbol)) { multiplier = 3.00; name = "Sequência Principal, Secundário e Urso"; animationHint = 'medium-win'; }
        else if (isSingle(principalSymbol) && isPair(this.ursoSymbol)) { multiplier = 5.00; name = "Principal com Par de Ursos"; animationHint = 'big-win'; }
        else if (isSingle(secondarySymbol) && isPair(this.ursoSymbol)) { multiplier = 3.50; name = "Secundário com Par de Ursos"; animationHint = 'big-win'; }
        else if (isPair(principalSymbol) && hasSingleOther()) { multiplier = 3.50; name = "Par de Principal com Outro"; animationHint = 'big-win'; }
        else if (isPair(principalSymbol) && isSingle(this.ursoSymbol)) { multiplier = 8.00; name = "Par de Principal com Urso"; animationHint = 'big-win'; }
        else if (isPair(principalSymbol) && isSingle(secondarySymbol)) { multiplier = 6.00; name = "Par de Principal com Secundário"; animationHint = 'big-win'; }
        else if (isThreeOfAKind(principalSymbol)) { multiplier = 10.00; name = "Trinca do Principal"; animationHint = 'jackpot'; }
        else if (isPair(secondarySymbol) && hasSingleOther()) { multiplier = 2.50; name = "Par de Secundário com Outro"; animationHint = 'medium-win'; }
        else if (isPair(secondarySymbol) && isSingle(this.ursoSymbol)) { multiplier = 4.00; name = "Par de Secundário com Urso"; animationHint = 'big-win'; }
        else if (isPair(secondarySymbol) && isSingle(principalSymbol)) { multiplier = 3.00; name = "Par de Secundário com Principal"; animationHint = 'medium-win'; }
        else if (isThreeOfAKind(secondarySymbol)) { multiplier = 6.00; name = "Trinca do Secundário"; animationHint = 'big-win'; }
        return { payout: betAmount * multiplier, multiplier, name, description: name, animationHint };
    }
    getPayTable(): any[] {
        this.logger.debug('Retornando a tabela de pagamentos completa.');
        return [ { id: 12, name: "Trinca do Principal", multiplier: 10.00 }, { id: 10, name: "Par de Principal com Urso", multiplier: 8.00 }, { id: 11, name: "Par de Principal com Secundário", multiplier: 6.00 }, { id: 16, name: "Trinca do Secundário", multiplier: 6.00 }, { id: 7, name: "Principal com Par de Ursos", multiplier: 5.00 }, { id: 14, name: "Par de Secundário com Urso", multiplier: 4.00 }, { id: 8, name: "Secundário com Par de Ursos", multiplier: 3.50 }, { id: 9, name: "Par de Principal com Outro", multiplier: 3.50 }, { id: 6, name: "Sequência Principal, Secundário e Urso", multiplier: 3.00 }, { id: 15, name: "Par de Secundário com Principal", multiplier: 3.00 }, { id: 5, name: "Principal, Secundário e Outro", multiplier: 2.50 }, { id: 13, name: "Par de Secundário com Outro", multiplier: 2.50 }, { id: 3, name: "Principal, Urso e Outro", multiplier: 2.00 }, { id: 4, name: "Secundário, Urso e Outro", multiplier: 1.80 }, { id: 2, name: "Par de Outros com Principal", multiplier: 1.50 }, { id: 1, name: "Par de Outros com Secundário", multiplier: 1.20 }, ];
    }
    async getCacaNiquelRoundsWithDetails(): Promise<any[]> {
        return this.cacaNiquelRoundModel.findAll({ include: [ { model: User, as: 'createdByUser', attributes: ['id', 'name', 'email'] }, { model: CacaNiquelBet, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }, { model: CacaNiquelRoundSeed, include: [{ model: Seed, include: [{ model: BlockchainHash }] }] } ], order: [['createdAt', 'DESC']], });
    }
    async getCacaNiquelRoundByIdWithDetails(roundId: number): Promise<any> {
        const round = await this.cacaNiquelRoundModel.findByPk(roundId, { include: [ { model: User, as: 'createdByUser', attributes: ['id', 'name', 'email'] }, { model: CacaNiquelBet, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }, { model: CacaNiquelRoundSeed, include: [{ model: Seed, include: [{ model: BlockchainHash }] }] } ], });
        if (!round) { throw new NotFoundException('Rodada não encontrada.'); }
        return round;
    }
    async getCacaNiquelRoundsPlayedByUser(userId: number): Promise<CacaNiquelRound[]> {
        return this.cacaNiquelRoundModel.findAll({ include: [ { model: CacaNiquelBet, where: { userId: userId }, required: true, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }, { model: User, as: 'createdByUser', attributes: ['id', 'name', 'email'] }, { model: CacaNiquelRoundSeed, include: [{ model: Seed, include: [{ model: BlockchainHash }] }] } ], order: [['createdAt', 'DESC']], });
    }
}