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

// Interface para um retorno de pagamento mais descritivo
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

    // Mapeamento dos elementos para ícones amigáveis
    private readonly symbolMap = {
        'elemento_A': 'urso', // URSO (JACKPOT)
        'elemento_B': 'strawberry',
        'elemento_C': 'diamond',
        'elemento_D': 'cherry',
        'elemento_E': 'roulette',
        'elemento_F': 'joker',
        'elemento_G': 'pineapple',
        'elemento_H': 'number7',
        'elemento_I': 'grape',
        'elemento_J': 'watermelon',
    };
    private readonly symbols = Object.keys(this.symbolMap); // ['elemento_A', 'elemento_B', ...]
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
    ) { }

    // (O método createCacaNiquelRound continua o mesmo)
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
    ): Promise<any> { // <--- RETORNO MUDOU PARA ANY PARA MAIOR FLEXIBILIDADE
        const transaction = await this.sequelize.transaction();
        try {
            const user = await this.userModel.findByPk(userId, { transaction });
            if (!user) throw new NotFoundException('Usuário não encontrado.');

            const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, { transaction });
            if (!cacaNiquelRound) throw new NotFoundException('Rodada não encontrada.');
            if (cacaNiquelRound.finished) throw new BadRequestException('Esta rodada já foi finalizada.');

            if (user.balance < betData.betAmount) throw new BadRequestException('Saldo insuficiente.');

            const generatedSymbols = await this.getNextSymbols(roundId);

            // Objeto de aposta temporário para passar para o cálculo
            const tempBet = {
                betAmount: betData.betAmount,
                principalSymbol: betData.principalSymbol,
                secondarySymbol: betData.secondarySymbol,
                generatedSymbols: generatedSymbols,
            };

            const payoutInfo = this.calculatePayout(tempBet);

            // Criar a aposta no DB
            const newBet = await this.cacaNiquelBetModel.create({
                userId,
                roundId,
                betAmount: betData.betAmount,
                principalSymbol: betData.principalSymbol,
                secondarySymbol: betData.secondarySymbol,
                generatedSymbols: generatedSymbols,
                win: payoutInfo.payout > 0,
                payout: payoutInfo.payout,
            }, { transaction });

            // Atualizar o saldo do usuário (subtrai aposta, soma o ganho)
            const newBalance = user.balance - betData.betAmount + payoutInfo.payout;
            await user.update({ balance: newBalance }, { transaction });

            // Finaliza a rodada automaticamente
            cacaNiquelRound.finished = true;
            await cacaNiquelRound.save({ transaction });

            await transaction.commit();

            // *** CONSTRUIR A RESPOSTA PERSONALIZADA ***
            const symbolCounts: { [key: string]: number } = {};
            generatedSymbols.forEach(symbol => {
                const iconName = this.symbolMap[symbol as keyof typeof this.symbolMap];
                symbolCounts[iconName] = (symbolCounts[iconName] || 0) + 1;
            });

            const rolledSymbolsResult = Object.entries(this.symbolMap).map(([key, icon], index) => ({
                id: index + 1,
                icon: icon,
                value: symbolCounts[icon] || 0, // value é a contagem de vezes que o ícone apareceu
            }));
            
            this.logger.log(`Usuário ${userId} apostou R$${betData.betAmount} e ganhou R$${payoutInfo.payout.toFixed(2)}. Combinação: ${payoutInfo.name}. Símbolos: ${generatedSymbols.join(', ')}`);

            return {
                bet: newBet.toJSON(),
                payoutInfo: payoutInfo,
                rolledSymbols: rolledSymbolsResult,
                newBalance: newBalance
            };

        } catch (error) {
            await transaction.rollback();
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            this.logger.error(`Erro ao comprar aposta para rodada ${roundId}: ${(error as any).message}`, (error as any).stack);
            throw new InternalServerErrorException('Erro ao comprar aposta. Por favor, tente novamente.');
        }
    }

    private calculatePayout(bet: {
        betAmount: number;
        principalSymbol: string;
        secondarySymbol: string;
        generatedSymbols: string[];
    }): PayoutInfo {
        const { betAmount, principalSymbol, secondarySymbol, generatedSymbols } = bet;

        // Filtra os símbolos que não são o urso, o principal ou o secundário
        const outroSymbols = this.symbols.filter(sym => sym !== this.ursoSymbol && sym !== principalSymbol && sym !== secondarySymbol);

        // Conta a ocorrência de cada tipo de símbolo no resultado
        const symbolCounts: { [symbol: string]: number } = {};
        generatedSymbols.forEach(symbol => {
            symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
        });

        let multiplier = 0;
        let name = "Sem Prêmio";
        let description = "Nenhuma combinação vencedora.";
        let animationHint: PayoutInfo['animationHint'] = 'none';

        // Tabela de pagamentos adaptada para retornar um objeto PayoutInfo
        if (symbolCounts[secondarySymbol] === 1 && outroSymbols.some(sym => (symbolCounts[sym] || 0) === 2)) {
            multiplier = 1.2; name = "Par de Outros com Secundário"; description = "Um símbolo secundário e um par de outros símbolos."; animationHint = 'small-win';
        } else if (symbolCounts[principalSymbol] === 1 && outroSymbols.some(sym => (symbolCounts[sym] || 0) === 2)) {
            multiplier = 1.5; name = "Par de Outros com Principal"; description = "Um símbolo principal e um par de outros símbolos."; animationHint = 'small-win';
        } else if (symbolCounts[principalSymbol] === 1 && symbolCounts[this.ursoSymbol] === 1 && generatedSymbols.length === 2) { // Exemplo hipotético de 2 rolos
            multiplier = 2.0; name = "Principal e Urso"; description = "Um símbolo principal e um urso."; animationHint = 'medium-win';
        } else if (symbolCounts[secondarySymbol] === 1 && symbolCounts[this.ursoSymbol] === 1 && generatedSymbols.length === 2) {
            multiplier = 1.8; name = "Secundário e Urso"; description = "Um símbolo secundário e um urso."; animationHint = 'medium-win';
        } else if (symbolCounts[principalSymbol] === 1 && symbolCounts[secondarySymbol] === 1 && generatedSymbols.length === 2) {
            multiplier = 2.5; name = "Principal e Secundário"; description = "Um símbolo principal e um secundário."; animationHint = 'medium-win';
        } else if (symbolCounts[principalSymbol] === 1 && symbolCounts[secondarySymbol] === 1 && symbolCounts[this.ursoSymbol] === 1) {
            multiplier = 3.0; name = "Sequência Principal, Secundário e Urso"; description = "Um de cada: principal, secundário e urso."; animationHint = 'medium-win';
        } else if (symbolCounts[principalSymbol] === 1 && symbolCounts[this.ursoSymbol] === 2) {
            multiplier = 5.0; name = "Principal com Par de Ursos"; description = "Um símbolo principal e dois ursos."; animationHint = 'big-win';
        } else if (symbolCounts[secondarySymbol] === 1 && symbolCounts[this.ursoSymbol] === 2) {
            multiplier = 3.5; name = "Secundário com Par de Ursos"; description = "Um símbolo secundário e dois ursos."; animationHint = 'big-win';
        } else if (symbolCounts[principalSymbol] === 2 && outroSymbols.some(sym => (symbolCounts[sym] || 0) === 1)) {
            multiplier = 3.5; name = "Par de Principal com Outro"; description = "Dois símbolos principais e um outro símbolo."; animationHint = 'big-win';
        } else if (symbolCounts[principalSymbol] === 2 && symbolCounts[this.ursoSymbol] === 1) {
            multiplier = 8.0; name = "Par de Principal com Urso"; description = "Dois símbolos principais e um urso."; animationHint = 'big-win';
        } else if (symbolCounts[principalSymbol] === 2 && symbolCounts[secondarySymbol] === 1) {
            multiplier = 6.0; name = "Par de Principal com Secundário"; description = "Dois símbolos principais e um secundário."; animationHint = 'big-win';
        } else if (symbolCounts[principalSymbol] === 3) {
            multiplier = 10.0; name = "Trinca do Principal"; description = "Três símbolos principais iguais!"; animationHint = 'jackpot';
        } else if (symbolCounts[secondarySymbol] === 2 && outroSymbols.some(sym => (symbolCounts[sym] || 0) === 1)) {
            multiplier = 2.5; name = "Par de Secundário com Outro"; description = "Dois símbolos secundários e um outro símbolo."; animationHint = 'medium-win';
        } else if (symbolCounts[secondarySymbol] === 2 && symbolCounts[this.ursoSymbol] === 1) {
            multiplier = 4.0; name = "Par de Secundário com Urso"; description = "Dois símbolos secundários e um urso."; animationHint = 'big-win';
        } else if (symbolCounts[secondarySymbol] === 2 && symbolCounts[principalSymbol] === 1) {
            multiplier = 3.0; name = "Par de Secundário com Principal"; description = "Dois símbolos secundários e um principal."; animationHint = 'medium-win';
        } else if (symbolCounts[secondarySymbol] === 3) {
            multiplier = 6.0; name = "Trinca do Secundário"; description = "Três símbolos secundários iguais!"; animationHint = 'big-win';
        }

        return {
            payout: betAmount * multiplier,
            multiplier: multiplier,
            name: name,
            description: description,
            animationHint: animationHint,
        };
    }

    // Método finalizer adaptado para usar o novo calculatePayout
    async finalizeCacaNiquelRound(roundId: number, transactionHost?: any): Promise<CacaNiquelRound> {
        const transaction = transactionHost ? transactionHost : await this.sequelize.transaction();
        try {
            const cacaNiquelRound = await this.cacaNiquelRoundModel.findByPk(roundId, {
                include: [{ model: CacaNiquelBet, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }],
                transaction
            });

            if (!cacaNiquelRound) throw new NotFoundException('Rodada de caça-níquel não encontrada.');
            if (cacaNiquelRound.finished) throw new ConflictException('Esta rodada de caça-níquel já foi finalizada.');

            const bets = cacaNiquelRound.bets;
            if (bets) {
                for (const bet of bets) {
                    const payoutInfo = this.calculatePayout(bet); // Usa a função modificada
                    if (payoutInfo.payout > 0) {
                        bet.win = true;
                        bet.payout = payoutInfo.payout; // Pega o valor do objeto retornado
                        const winnerUser = await this.userModel.findByPk(bet.userId, { transaction });
                        if (!winnerUser) throw new NotFoundException('Usuário vencedor não encontrado.');
                        
                        // O saldo já foi atualizado no `buyBet`, aqui seria redundante
                        // await winnerUser.update({ balance: winnerUser.balance + payoutInfo.payout }, { transaction });
                        
                        this.logger.log(`Usuário ${winnerUser.id} ganhou R$${payoutInfo.payout.toFixed(2)} na rodada ${cacaNiquelRound.id} com aposta de R$${bet.betAmount.toFixed(2)}`);
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


    /**
     * NOVO MÉTODO: Retorna a tabela de pagamentos completa para o frontend.
     */
    getPayTable(): any[] {
        this.logger.debug('Retornando a tabela de pagamentos completa.');
        return [
            { id: 1, name: "Trinca do Principal", multiplier: 10.0, description: "Três símbolos principais iguais!", example: ['principal', 'principal', 'principal'], animationHint: 'jackpot' },
            { id: 2, name: "Par de Principal com Urso", multiplier: 8.0, description: "Dois símbolos principais e um urso.", example: ['principal', 'principal', 'urso'], animationHint: 'big-win' },
            { id: 3, name: "Trinca do Secundário", multiplier: 6.0, description: "Três símbolos secundários iguais!", example: ['secondary', 'secondary', 'secondary'], animationHint: 'big-win' },
            { id: 4, name: "Par de Principal com Secundário", multiplier: 6.0, description: "Dois símbolos principais e um secundário.", example: ['principal', 'principal', 'secondary'], animationHint: 'big-win' },
            { id: 5, name: "Principal com Par de Ursos", multiplier: 5.0, description: "Um símbolo principal e dois ursos.", example: ['principal', 'urso', 'urso'], animationHint: 'big-win' },
            { id: 6, name: "Par de Secundário com Urso", multiplier: 4.0, description: "Dois símbolos secundários e um urso.", example: ['secondary', 'secondary', 'urso'], animationHint: 'big-win' },
            { id: 7, name: "Secundário com Par de Ursos", multiplier: 3.5, description: "Um símbolo secundário e dois ursos.", example: ['secondary', 'urso', 'urso'], animationHint: 'big-win' },
            { id: 8, name: "Par de Principal com Outro", multiplier: 3.5, description: "Dois símbolos principais e um outro símbolo.", example: ['principal', 'principal', 'other'], animationHint: 'big-win' },
            { id: 9, name: "Par de Secundário com Principal", multiplier: 3.0, description: "Dois símbolos secundários e um principal.", example: ['secondary', 'secondary', 'principal'], animationHint: 'medium-win' },
            { id: 10, name: "Sequência Principal, Secundário e Urso", multiplier: 3.0, description: "Um de cada: principal, secundário e urso.", example: ['principal', 'secondary', 'urso'], animationHint: 'medium-win' },
            { id: 11, name: "Principal e Secundário", multiplier: 2.5, description: "Um símbolo principal e um secundário.", example: ['principal', 'secondary'], animationHint: 'medium-win' },
            { id: 12, name: "Par de Secundário com Outro", multiplier: 2.5, description: "Dois símbolos secundários e um outro símbolo.", example: ['secondary', 'secondary', 'other'], animationHint: 'medium-win' },
            { id: 13, name: "Principal e Urso", multiplier: 2.0, description: "Um símbolo principal e um urso.", example: ['principal', 'urso'], animationHint: 'medium-win' },
            { id: 14, name: "Secundário e Urso", multiplier: 1.8, description: "Um símbolo secundário e um urso.", example: ['secondary', 'urso'], animationHint: 'medium-win' },
            { id: 15, name: "Par de Outros com Principal", multiplier: 1.5, description: "Um símbolo principal e um par de outros símbolos.", example: ['principal', 'other', 'other'], animationHint: 'small-win' },
            { id: 16, name: "Par de Outros com Secundário", multiplier: 1.2, description: "Um símbolo secundário e um par de outros símbolos.", example: ['secondary', 'other', 'other'], animationHint: 'small-win' },
        ];
    }
    
    // (O resto dos métodos, como getCacaNiquelRoundsWithDetails, continuam os mesmos)
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