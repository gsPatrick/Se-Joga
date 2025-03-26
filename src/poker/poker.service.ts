// src/poker/poker.service.ts
import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PokerRound } from '../models/poker/poker-round.model';
import { PokerPlayer } from '../models/poker/poker-player.model';
import { PokerHand } from '../models/poker/poker-hand.model';
import { PokerBet } from '../models/poker/poker-bet.model';
import { PokerRoundSeed } from '../models/poker/poker-round-seed.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { User } from 'src/models/user/user.model';
import { Sequelize, Op } from 'sequelize'; // Importe Sequelize e Op de 'sequelize' (CORRETO)
import { evaluateHand } from './poker-hand-evaluator';

@Injectable()
export class PokerService {
    private readonly logger = new Logger(PokerService.name);
    private readonly numberOfDecks = 2;
    private readonly totalCards = 52 * this.numberOfDecks;
    private readonly initialBalanceMachinePlayers = 1000;
    private readonly initialPingoValue = 5;
    private readonly maxCallsPerRound = 3;
    private readonly numberOfCommunityCardsInitially = 2;
    private readonly numberOfCommunityCardsTotal = 7;
    sequelize: any;

    constructor(
        @InjectModel(PokerRound) private pokerRoundModel: typeof PokerRound,
        @InjectModel(PokerPlayer) private pokerPlayerModel: typeof PokerPlayer,
        @InjectModel(PokerHand) private pokerHandModel: typeof PokerHand,
        @InjectModel(PokerBet) private pokerBetModel: typeof PokerBet,
        @InjectModel(PokerRoundSeed) private pokerRoundSeedModel: typeof PokerRoundSeed,
        @InjectModel(Seed) private seedModel: typeof Seed,
        @InjectModel(GeneratedNumber) private generatedNumberModel: typeof GeneratedNumber,
        @InjectModel(User) private userModel: typeof User,
        private blockchainUtil: BlockchainUtil,
        // private sequelize: Sequelize, // REMOVA A INJEÇÃO DESNECESSÁRIA DE Sequelize!
    ) { }
    
    
    async createPokerRound(userId: number): Promise<PokerRound> {
        this.logger.log(`Criando rodada de poker para o usuário ${userId}...`);
        const transaction = await this.sequelize.transaction();
        try {
            const user = userId ? await this.userModel.findByPk(userId, { transaction }) : null;
            if (userId && !user) {
                throw new NotFoundException('Usuário não encontrado.');
            }
    
            const latestHashId = await this.blockchainUtil.getLatestHashId();
            if (latestHashId === -1) {
                throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
            }
    
            const pokerRound = await this.pokerRoundModel.create({
                createdBy: userId || null,
                hash: latestHashId.toString(),
                finished: false,
            }, { transaction });
    
            const newSeed = await this.seedModel.findOne({
                where: { hashId: latestHashId },
                include: [
                    {
                        model: GeneratedNumber,
                        order: [['createdAt', 'DESC']],
                        limit: this.totalCards + this.numberOfCommunityCardsTotal,
                    },
                ],
                order: [['createdAt', 'DESC']],
                transaction: transaction // ✅ Transação CORRETA dentro do objeto de opções
            });
    
            if (!newSeed || newSeed.generatedNumbers.length < this.totalCards + this.numberOfCommunityCardsTotal) {
                throw new NotFoundException('Seed ou GeneratedNumbers insuficientes encontrados para a hash mais recente.');
            }
    
            await this.pokerRoundSeedModel.create({
                roundId: pokerRound.id,
                seedId: newSeed.id,
            }, { transaction });
    
            await transaction.commit();
            this.logger.log(`Rodada de poker criada com id: ${pokerRound.id} e seed id: ${newSeed.id}`);
            return pokerRound;
    
        } catch (error) {
            await transaction.rollback();
            this.logger.error(`Erro ao criar rodada de poker: ${(error as Error).message}`, (error as Error).stack);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Erro ao criar rodada de poker. Tente novamente.');
        }
    }
    
    
    async setupPlayersAndDealCards(roundId: number, userPlayerId: number): Promise<PokerRound> {
        const transaction = await this.sequelize.transaction();
        try {
            const pokerRound = await this.pokerRoundModel.findByPk(roundId, { transaction, include: [PokerRoundSeed] });
            if (!pokerRound) {
                throw new NotFoundException(`Rodada de Poker com ID ${roundId} não encontrada.`);
            }
            if (pokerRound.pokerPlayers && pokerRound.pokerPlayers.length > 0) {
                throw new ConflictException(`Jogadores já foram definidos para a rodada ${roundId}.`);
            }
    
            const user = await this.userModel.findByPk(userPlayerId, { transaction });
            if (!user) {
                throw new NotFoundException(`Usuário com ID ${userPlayerId} não encontrado.`);
            }
            const humanPokerPlayer = await this.pokerPlayerModel.create({
                roundId: roundId,
                userId: userPlayerId,
                balanceInGame: user.balance,
                isMachine: false,
            }, { transaction });
    
            const machinePlayers: PokerPlayer[] = [];
            for (let i = 0; i < 3; i++) {
                const machinePlayer = await this.pokerPlayerModel.create({
                    roundId: roundId,
                    userId: null,
                    balanceInGame: this.initialBalanceMachinePlayers,
                    isMachine: true,
                }, { transaction });
                machinePlayers.push(machinePlayer);
            }
    
            const allPlayers = [humanPokerPlayer, ...machinePlayers];
            await this.dealCardsToPlayers(pokerRound, allPlayers, transaction);
            await this.dealInitialCommunityCards(pokerRound, transaction);
    
            await transaction.commit();
            this.logger.log(`Jogadores configurados, cartas privadas e ${this.numberOfCommunityCardsInitially} cartas comunitárias iniciais distribuidas para a rodada ${roundId}.`);
            return pokerRound;
    
        } catch (error) {
            await transaction.rollback();
            this.logger.error(`Erro ao configurar jogadores e distribuir cartas: ${(error as Error).message}`, (error as Error).stack);
            if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException) {
                throw error;
            }
            throw new InternalServerErrorException('Erro ao iniciar partida de poker. Tente novamente.');
        }
    }
    
    
    private async dealCardsToPlayers(pokerRound: PokerRound, players: PokerPlayer[], transaction: any): Promise<void> {
        this.logger.log(`Distribuindo cartas privadas para ${players.length} jogadores na rodada ${pokerRound.id}...`);
    
        const seed = await this.pokerRoundSeedModel.findOne({
            where: { roundId: pokerRound.id },
            include: [{ model: Seed, include: [{ model: GeneratedNumber }] }],
            transaction: transaction 
        });
    
        if (!seed || !seed.seed || !seed.seed.generatedNumbers || seed.seed.generatedNumbers.length < this.totalCards + this.numberOfCommunityCardsTotal) {
            throw new InternalServerErrorException("Seed ou números gerados insuficientes para distribuir as cartas.");
        }
    
        const generatedNumbers = seed.seed.generatedNumbers;
        const deck = this.createDeck();
        const shuffledDeck = this.shuffleDeck(deck, generatedNumbers.map(gn => Number(gn.number.valueOf()) % this.totalCards));
    
        let cardIndex = 0;
    
        for (const player of players) {
            const hand = await this.pokerHandModel.create({ playerId: player.id }, { transaction });
            hand.card1 = shuffledDeck[cardIndex++];
            hand.card2 = shuffledDeck[cardIndex++];
            await hand.save({ transaction });
            this.logger.debug(`Cartas privadas distribuidas para o jogador ${player.id}: ${hand.card1}, ${hand.card2}`);
        }
        pokerRound['deckForCommunityCards'] = shuffledDeck.slice(cardIndex);
    }
    
    private async dealInitialCommunityCards(pokerRound: PokerRound, transaction: any): Promise<void> {
        this.logger.log(`Distribuindo ${this.numberOfCommunityCardsInitially} cartas comunitárias iniciais para a rodada ${pokerRound.id}...`);
        const deck = pokerRound['deckForCommunityCards'];
        if (!deck || deck.length < this.numberOfCommunityCardsInitially) {
            throw new InternalServerErrorException("Baralho insuficiente para cartas comunitárias iniciais.");
        }
    
        pokerRound['communityCards'] = deck.splice(0, this.numberOfCommunityCardsInitially);
        this.logger.debug(`Cartas comunitárias iniciais distribuidas para rodada ${pokerRound.id}: ${pokerRound['communityCards'].join(', ')}`);
    }
    
    private async dealNextCommunityCard(pokerRound: PokerRound, transaction: any): Promise<void> {
        this.logger.log(`Distribuindo próxima carta comunitária para a rodada ${pokerRound.id}...`);
        const deck = pokerRound['deckForCommunityCards'];
        if (!deck || deck.length < 1) {
            throw new InternalServerErrorException("Baralho insuficiente para mais cartas comunitárias.");
        }
        const nextCard = deck.splice(0, 1)[0];
        pokerRound['communityCards'].push(nextCard);
        this.logger.debug(`Carta comunitária adicional distribuida para rodada ${pokerRound.id}: ${nextCard}. Cartas comunitárias totais: ${pokerRound['communityCards'].join(', ')}`);
    }
    
    
    private createDeck(): string[] {
        const suits = ['C', 'D', 'H', 'S'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
        const deck: string[] = [];
    
        for (let n = 0; n < this.numberOfDecks; n++) {
            for (const suit of suits) {
                for (const rank of ranks) {
                    deck.push(rank + suit);
                }
            }
        }
        return deck;
    }
    
    private shuffleDeck(deck: string[], randomNumbers: number[]): string[] {
        if (deck.length !== randomNumbers.length) {
            throw new Error("O número de cartas e números aleatórios deve ser o mesmo para embaralhar.");
        }
        const shuffledDeck = [...deck];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = randomNumbers[i] % (i + 1);
            [shuffledDeck[i], shuffledDeck[j]] = [shuffledDeck[j], shuffledDeck[i]];
        }
        return shuffledDeck;
    }
    
    
    async playerBet(roundId: number, playerId: number, betType: string): Promise<PokerBet> {
        const transaction = await this.sequelize.transaction();
        try {
            const player = await this.pokerPlayerModel.findByPk(playerId, { transaction, include: [PokerRound] });
            if (!player) {
                throw new NotFoundException(`Jogador com ID ${playerId} não encontrado.`);
            }
            const round = player.pokerRound;
            if (!round || round.finished) {
                throw new BadRequestException(`Rodada com ID ${roundId} não existe ou já finalizou.`);
            }
            if (player.folded) {
                throw new BadRequestException(`Jogador ${playerId} já desistiu desta rodada.`);
            }
    
            let betAmountValue = 0;
            let isAllWin = false;
    
            if (betType === 'CALL_1X') {
                betAmountValue = this.initialPingoValue * 1;
            } else if (betType === 'CALL_2X') {
                betAmountValue = this.initialPingoValue * 2;
            } else if (betType === 'CALL_3X') {
                betAmountValue = this.initialPingoValue * 3;
            } else if (betType === 'ALL_WIN') {
                betAmountValue = player.balanceInGame;
                betType = 'ALL_WIN';
                isAllWin = true;
            } else if (betType === 'FOLD') {
                return this.playerFold(roundId, playerId);
            }
             else {
                throw new BadRequestException(`Tipo de aposta inválido: ${betType}. Use CALL_1X, CALL_2X, CALL_3X, ALL_WIN ou FOLD.`);
            }
    
    
            if (player.balanceInGame < betAmountValue && betType !== 'FOLD') {
                throw new BadRequestException(`Saldo insuficiente para a aposta ${betType}. Saldo: ${player.balanceInGame}, Aposta: ${betAmountValue}`);
            }
    
             // Check Call Limits (Simplified - Total 3 calls per round)
            const currentRoundBets = await this.pokerBetModel.findAll({
                where: { playerId: playerId, roundId: roundId, betType: { [Op.startsWith]: 'CALL_' } }, 
                transaction: transaction
            });
            if (betType.startsWith('CALL_') && currentRoundBets.length >= this.maxCallsPerRound) {
                throw new BadRequestException(`Limite de ${this.maxCallsPerRound} calls por rodada atingido.`);
            }
    
    
            const newBet = await this.pokerBetModel.create({
                playerId: playerId,
                roundId: roundId,
                betType: betType,
                betAmount: betAmountValue,
                isAllWin: isAllWin,
            }, { transaction });
    
            if (betType !== 'FOLD') {
                player.balanceInGame -= betAmountValue;
                await player.save({ transaction });
            }
    
            await transaction.commit();
            this.logger.log(`Jogador ${playerId} fez aposta do tipo ${betType} no valor de ${betAmountValue} na rodada ${roundId}.`);
            return newBet;
    
        } catch (error) {
            await transaction.rollback();
            this.logger.error(`Erro ao registrar aposta do jogador ${playerId}: ${(error as Error).message}`, (error as Error).stack);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Erro ao processar aposta. Tente novamente.');
        }
    }
    
    
    async playerFold(roundId: number, playerId: number): Promise<PokerBet> {
        const transaction = await this.sequelize.transaction();
        try {
            const player = await this.pokerPlayerModel.findByPk(playerId, { transaction, include: [PokerRound] });
            if (!player) {
                throw new NotFoundException(`Jogador com ID ${playerId} não encontrado.`);
            }
            const round = player.pokerRound;
            if (!round || round.finished) {
                throw new BadRequestException(`Rodada com ID ${roundId} não existe ou já finalizou.`);
            }
            if (player.folded) {
                throw new BadRequestException(`Jogador ${playerId} já desistiu desta rodada.`);
            }
    
            player.folded = true;
            await player.save({ transaction });
    
            const foldBet = await this.pokerBetModel.create({
                playerId: playerId,
                roundId: roundId,
                betType: 'FOLD',
                betAmount: 0,
            }, { transaction });
    
            await transaction.commit();
            this.logger.log(`Jogador ${playerId} desistiu (fold) da rodada ${roundId}.`);
            return foldBet;
    
        } catch (error) {
            await transaction.rollback();
            this.logger.error(`Erro ao registrar desistência do jogador ${playerId}: ${(error as Error).message}`, (error as Error).stack);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Erro ao processar desistência. Tente novamente.');
        }
    }
    
    
    async finalizeRound(roundId: number): Promise<PokerRound> {
        const transaction = await this.sequelize.transaction();
        try {
            const pokerRound = await this.pokerRoundModel.findByPk(roundId, { transaction, include: [PokerPlayer, PokerHand, PokerBet] });
            if (!pokerRound) {
                throw new NotFoundException(`Rodada de Poker com ID ${roundId} não encontrada.`);
            }
            if (pokerRound.finished) {
                throw new ConflictException(`Rodada de Poker com ID ${roundId} já finalizada.`);
            }
    
            const activePlayers = pokerRound.pokerPlayers.filter(player => !player.folded);
            if (activePlayers.length === 0) {
                this.logger.log(`Rodada ${roundId} finalizada sem vencedores (todos desistiram).`);
                pokerRound.finished = true;
                await pokerRound.save({ transaction });
                return pokerRound;
            }
    
            // 1. Evaluate hands and determine winner
            let winner: PokerPlayer | null = null;
            let bestHandRank = -1; // Initialize with a low rank
    
            for (const player of activePlayers) {
                const hand = await this.pokerHandModel.findOne({ where: { playerId: player.id } });
                if (hand && hand.card1 && hand.card2 && pokerRound['communityCards']) {
                    // Evaluate hand using imported function - adjust card format if needed
                    const playerHand = [hand.card1, hand.card2, ...pokerRound['communityCards']];
                    const handEvaluation = evaluateHand(playerHand); // Use evaluateHand here!
                    if (handEvaluation && handEvaluation.rank > bestHandRank) {
                        bestHandRank = handEvaluation.rank;
                        winner = player;
                        pokerRound.winningHand = handEvaluation; // Store winning hand info in round
                    }
                }
            }
    
            if (!winner) {
                this.logger.warn(`Não foi possível determinar um vencedor para a rodada ${roundId}. Possível erro na avaliação das mãos.`);
                pokerRound.finished = true;
                await pokerRound.save({ transaction });
                return pokerRound; // End round without winner if evaluation fails
            }
    
    
            // 2. Distribute pot
            let pot = 0;
            for (const bet of pokerRound.pokerBets) {
                pot += Number(bet.betAmount);
            }
    
            const allWinBet = pokerRound.pokerBets.find(bet => bet.playerId === winner.id && bet.betType === 'ALL_WIN');
            let prizeAmount = pot;
            if (allWinBet && pokerRound['communityCards'] && pokerRound['communityCards'].length >= (this.numberOfCommunityCardsTotal - 1)) { // Multiplier 5x applied if ALL_WIN and enough community cards
                prizeAmount = pot * 5;
                this.logger.log(`Jogador ${winner.id} ganhou com ALL_WIN (Penúltima carta comunitária revelada ou mais) e multiplicador 5x aplicado. Prêmio total: ${prizeAmount}`);
            } else if (allWinBet) {
                 this.logger.log(`Jogador ${winner.id} ganhou com ALL_WIN (Sem multiplicador 5x). Prêmio total: ${prizeAmount}`);
            }
    
            winner.balanceInGame += prizeAmount;
            await winner.save({ transaction });
            this.logger.log(`Jogador ${winner.id} ganhou a rodada ${roundId} com a mão ${pokerRound.winningHand.handName} e recebeu ${prizeAmount}.`);
    
    
            pokerRound.finished = true;
            await pokerRound.save({ transaction });
    
            await transaction.commit();
            this.logger.log(`Rodada de poker ${roundId} finalizada. Vencedor: Jogador ${winner.id}`);
            return pokerRound;
    
        } catch (error) {
            await transaction.rollback();
            this.logger.error(`Erro ao finalizar rodada de poker ${roundId}: ${(error as Error).message}`, (error as Error).stack);
            if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException) {
                throw error;
            }
            throw new InternalServerErrorException('Erro ao finalizar rodada de poker. Tente novamente.');
        }
    }
    
    
    async getPokerRoundDetails(roundId: number): Promise<PokerRound> {
        const pokerRound = await this.pokerRoundModel.findByPk(roundId, {
            include: [
                { model: PokerPlayer, include: [PokerHand, PokerBet, {model: User, attributes: ['id', 'name', 'email']}] },
            ],
        });
        if (!pokerRound) {
            throw new NotFoundException(`Rodada de Poker com ID ${roundId} não encontrada.`);
        }
        return pokerRound;
    }
}