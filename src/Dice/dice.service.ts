// src/dice/dice.service.ts
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
// import { Cron, CronExpression } from '@nestjs/schedule'; // Cron não está sendo usado aqui
import { BlockchainHash } from 'src/models/blockchain-hash.model';

// --- Adiciona esta interface ---
interface WinnerInfo {
    userId: number;
    prize: number;
    betId: number;
    oldBalance: number;
    newBalance: number;
}
// ------------------------------

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
    ) { }

    async createDiceRound(userId: number): Promise<DiceRound> {
        const user = await this.userModel.findByPk(userId);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }

        const latestHashId = await this.blockchainUtil.getLatestHashId();
        if (latestHashId == -1) {
            throw new NotFoundException('Nenhuma hash de blockchain encontrada para iniciar a rodada.');
        }

        // Verifica se existe uma Seed e GeneratedNumber para o Hash mais recente ANTES de criar a rodada
        const seedCheck = await this.seedModel.findOne({
            where: { hashId: latestHashId },
            include: [{
                model: GeneratedNumber,
                required: true // Garante que só retorna se houver pelo menos um GeneratedNumber
            }],
        });

        if (!seedCheck) {
            this.logger.error(`Nenhuma seed ou generatedNumber encontrado para a hashId ${latestHashId}. Não é possível criar a rodada.`);
            throw new NotFoundException('Recursos de geração de números não encontrados para a hash mais recente. Tente novamente mais tarde.');
        }

        const diceRound = await this.diceRoundModel.create({
            createdBy: userId,
            hash: latestHashId.toString(), // Armazena o ID do hash, talvez devesse ser o hash em si?
            finished: false,
        });

        // Associa a Seed encontrada à rodada
        await this.diceRoundSeedModel.create({
            roundId: diceRound.id,
            seedId: seedCheck.id // Usa a seed que foi verificada
        });

        this.logger.log(`Rodada de dado criada com id: ${diceRound.id} associada à seed id: ${seedCheck.id}`);
        return diceRound;
    }

    private async getNextNumber(roundId: number, transaction: any): Promise<number> {
        // Busca a rodada e a seed associada DENTRO da transação para garantir consistência
        const diceRound = await this.diceRoundModel.findByPk(roundId, {
            include: [{
                model: DiceRoundSeed, // Model to include
                required: true,       // Must exist (INNER JOIN)
                include: [{           // Nested include
                    model: Seed,        // Model to include inside DiceRoundSeed
                    required: true,   // Must exist (INNER JOIN)
                    include: [{       // Nested include for GeneratedNumber
                        model: GeneratedNumber,
                        order: [['createdAt', 'DESC']], // Pega o mais recente primeiro
                        limit: 1, // Pega apenas um
                    }]
                }]
            }],
            transaction // Usa a transação
        });

        // Validações
        if (!diceRound) {
            // Isso não deveria acontecer se a busca inicial em buyDiceTickets funcionou, mas é uma segurança.
            throw new InternalServerErrorException('Falha ao buscar dados da rodada durante a obtenção do número.');
        }

        // --- CORREÇÃO DA VALIDAÇÃO AQUI ---
        // Acessa diceRoundSeed como objeto, não como array
        if (!diceRound.diceRoundSeed || !diceRound.diceRoundSeed.seed) {
            this.logger.error(`Inconsistência de dados: Falta DiceRoundSeed ou Seed para a rodada ${roundId}`);
            throw new InternalServerErrorException('Inconsistência nos dados da rodada.');
        }
        // -----------------------------------

        const seed = diceRound.diceRoundSeed.seed; // Acessa a seed diretamente
        const generatedNumbers = seed.generatedNumbers;

        // Verifica se há número disponível *antes* de tentar acessar
        if (!generatedNumbers || generatedNumbers.length === 0) {
            // Lança a exceção específica que será tratada em buyDiceTickets
            throw new NotFoundException('Nenhum número gerado disponível encontrado para a seed da rodada.');
        }

        const latestGeneratedNumber = generatedNumbers[0];
        const numberValue = latestGeneratedNumber.number; // É bigint, precisa converter se necessário

        // Calcula o número final (0-6)
        // Cuidado com a conversão de bigint para number se o número for muito grande
        const finalNumber = Number(BigInt(numberValue) % 97n % 7n);

        // Deleta o número usado DENTRO da mesma transação
        this.logger.debug(`Usando e deletando GeneratedNumber ID: ${latestGeneratedNumber.id} para rodada ${roundId}`);
        await this.generatedNumberModel.destroy({
            where: { id: latestGeneratedNumber.id },
            transaction // Usa a transação
        });

        return finalNumber;
    }


    // Funções auxiliares para cada tipo de aposta (handle...)
    // Importante: Passar a `transaction` para `getNextNumber`
    private async handleParEscolhidoBet(userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]): Promise<void> {
        let firstDiceNumber = 0;
        let secondDiceNumber = 0;
        let hasSecondChance = true;
        while (hasSecondChance) {
            // Passa a transação para getNextNumber
            firstDiceNumber = await this.getNextNumber(roundId, transaction);
            secondDiceNumber = await this.getNextNumber(roundId, transaction);

            const newBet = await this.diceBetModel.create({
                userId,
                roundId,
                betNumber: betData.betNumber,
                betAmount: betData.betAmount,
                type: 'par_escolhido',
                 // Armazena os dois números de forma identificável, se necessário
                // Exemplo: first * 10 + second (se sempre forem de 0 a 6)
                generatedNumber: (firstDiceNumber * 10 + secondDiceNumber),
                win: false,
            }, { transaction });
            createdBets.push(newBet);

            // A lógica de "chance extra" parece correta
            if (firstDiceNumber == betData.betNumber || secondDiceNumber == betData.betNumber) {
                this.logger.log(
                    `Usuário ${userId} teve uma chance extra na rodada ${roundId} (Par Escolhido: ${betData.betNumber}). Dados: ${firstDiceNumber}, ${secondDiceNumber}`
                );
            } else {
                hasSecondChance = false;
            }
        }
    }

    private async handleTriplaEscolhidaBet(userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]): Promise<void> {
        let firstDiceNumber = 0;
        let secondDiceNumber = 0;
        let thirdDiceNumber = 0;
        let attempts = 3; // Número máximo de tentativas
        let won = false;

        for (let i = 0; i < attempts && !won; i++) {
             // Passa a transação para getNextNumber
            firstDiceNumber = await this.getNextNumber(roundId, transaction);
            secondDiceNumber = await this.getNextNumber(roundId, transaction);
            thirdDiceNumber = await this.getNextNumber(roundId, transaction);

             // Armazena os três números de forma identificável
             // Exemplo: first * 100 + second * 10 + third
            const generatedValue = (firstDiceNumber * 100 + secondDiceNumber * 10 + thirdDiceNumber);

            // Só cria UMA aposta no final, mas registra as tentativas
             if ((firstDiceNumber == betData.betNumber && secondDiceNumber == betData.betNumber && thirdDiceNumber == betData.betNumber)) {
                 this.logger.log(`Usuário ${userId} acertou a Tripla Escolhida ${betData.betNumber} na tentativa ${i+1}. Dados: ${firstDiceNumber}, ${secondDiceNumber}, ${thirdDiceNumber}`);
                 won = true; // Para o loop
                 // Cria a aposta vencedora
                 const newBet = await this.diceBetModel.create({
                    userId, roundId,
                    betNumber: betData.betNumber, betAmount: betData.betAmount,
                    type: 'tripla_escolhida',
                    generatedNumber: generatedValue, // Armazena o valor combinado da tentativa vencedora
                    win: true // Marca como vencedora já aqui? (Ou deixa para finalize?) - Melhor deixar para finalize
                }, { transaction });
                createdBets.push(newBet);

            } else {
                 this.logger.log(`Usuário ${userId} tentou Tripla Escolhida ${betData.betNumber} (Tentativa ${i+1}/${attempts}). Dados: ${firstDiceNumber}, ${secondDiceNumber}, ${thirdDiceNumber}`);
                 // Se for a última tentativa e não ganhou, cria a aposta perdedora
                 if (i === attempts - 1) {
                     const newBet = await this.diceBetModel.create({
                        userId, roundId,
                        betNumber: betData.betNumber, betAmount: betData.betAmount,
                        type: 'tripla_escolhida',
                        generatedNumber: generatedValue, // Armazena o valor combinado da última tentativa
                        win: false
                    }, { transaction });
                    createdBets.push(newBet);
                 }
            }
        }
         // Garante que pelo menos uma aposta (a última ou a vencedora) seja criada
         if (createdBets.length === 0) {
             // Isso não deveria acontecer com a lógica acima, mas é uma segurança
              this.logger.error(`Nenhuma aposta criada para Tripla Escolhida do usuário ${userId} na rodada ${roundId}`);
               throw new InternalServerErrorException('Falha ao registrar a aposta Tripla Escolhida.');
         }
    }

    // --- NOVA FUNÇÃO: handleSomaDuplaBet ---
    private async handleSomaDuplaBet(userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]): Promise<void> {
        // Validação do número apostado para 'soma_dupla' (2 dados 0-6 -> soma 0-12)
        if (betData.betNumber < 0 || betData.betNumber > 12) {
            throw new BadRequestException(`Número ${betData.betNumber} inválido para a aposta tipo 'soma_dupla'. Deve ser entre 0 e 12.`);
        }

        // Passa a transação para getNextNumber
        const diceNumbers = [await this.getNextNumber(roundId, transaction), await this.getNextNumber(roundId, transaction)];
        const generatedSum = diceNumbers.reduce((acc, num) => acc + num, 0);
        const numberOfDices = 2;

        // Cria a aposta única para a soma dupla
        const newBet = await this.diceBetModel.create({
            userId,
            roundId,
            betNumber: betData.betNumber, // O número (soma) que o usuário apostou
            betAmount: betData.betAmount,
            type: 'soma_dupla', // <-- Define o tipo correto
            generatedNumber: generatedSum, // A soma real gerada
            win: false, // Será definido em finalizeRound
        }, { transaction });
        createdBets.push(newBet);
        this.logger.log(`Usuario ${userId} apostou na rodada ${roundId} (Soma Dupla: ${betData.betNumber}) com ${numberOfDices} dados. Soma gerada: ${generatedSum}. Dados: ${diceNumbers.join(', ')}`);
    }

    // --- NOVA FUNÇÃO: handleSomaTriplaBet ---
    private async handleSomaTriplaBet(userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]): Promise<void> {
        // Validação do número apostado para 'soma_tripla' (3 dados 0-6 -> soma 0-18)
        if (betData.betNumber < 0 || betData.betNumber > 18) {
            throw new BadRequestException(`Número ${betData.betNumber} inválido para a aposta tipo 'soma_tripla'. Deve ser entre 0 e 18.`);
        }

        // Passa a transação para getNextNumber
        const diceNumbers = [
            await this.getNextNumber(roundId, transaction),
            await this.getNextNumber(roundId, transaction),
            await this.getNextNumber(roundId, transaction)
        ];
        const generatedSum = diceNumbers.reduce((acc, num) => acc + num, 0);
        const numberOfDices = 3;

        // Cria a aposta única para a soma tripla
        const newBet = await this.diceBetModel.create({
            userId,
            roundId,
            betNumber: betData.betNumber, // O número (soma) que o usuário apostou
            betAmount: betData.betAmount,
            type: 'soma_tripla', // <-- Define o tipo correto
            generatedNumber: generatedSum, // A soma real gerada
            win: false, // Será definido em finalizeRound
        }, { transaction });
        createdBets.push(newBet);
        this.logger.log(`Usuario ${userId} apostou na rodada ${roundId} (Soma Tripla: ${betData.betNumber}) com ${numberOfDices} dados. Soma gerada: ${generatedSum}. Dados: ${diceNumbers.join(', ')}`);
    }

    private async handleAleatorioDuplaBet(userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]): Promise<void> {
        let firstDiceNumber = 0;
        let secondDiceNumber = 0;

         // Passa a transação para getNextNumber
        firstDiceNumber = await this.getNextNumber(roundId, transaction);
        secondDiceNumber = await this.getNextNumber(roundId, transaction);

        const newBet = await this.diceBetModel.create({
            userId,
            roundId,
            betNumber: null, // Não se aplica betNumber aqui
            betAmount: betData.betAmount,
            type: 'aleatorio_dupla',
             // Armazena os dois números de forma identificável
            generatedNumber: (firstDiceNumber * 10 + secondDiceNumber),
            win: false,
        }, { transaction });
        createdBets.push(newBet);
         this.logger.log(`Usuario ${userId} apostou na rodada ${roundId} (Aleatório Dupla). Números gerados: ${firstDiceNumber}, ${secondDiceNumber}`);
    }

    private async handleAleatorioTriplaBet(userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]): Promise<void> {
        let firstDiceNumber = 0;
        let secondDiceNumber = 0;
        let thirdDiceNumber = 0;

         // Passa a transação para getNextNumber
        firstDiceNumber = await this.getNextNumber(roundId, transaction);
        secondDiceNumber = await this.getNextNumber(roundId, transaction);
        thirdDiceNumber = await this.getNextNumber(roundId, transaction);

        const newBet = await this.diceBetModel.create({
            userId,
            roundId,
            betNumber: null, // Não se aplica betNumber aqui
            betAmount: betData.betAmount,
            type: 'aleatorio_tripla',
            // Armazena os três números de forma identificável
            generatedNumber: (firstDiceNumber * 100 + secondDiceNumber * 10 + thirdDiceNumber),
            win: false,
        }, { transaction });
        createdBets.push(newBet);
        this.logger.log(`Usuario ${userId} apostou na rodada ${roundId} (Aleatório Tripla). Números gerados: ${firstDiceNumber}, ${secondDiceNumber}, ${thirdDiceNumber}`);
    }


    async buyDiceTickets(
        userId: number,
        roundId: number,
        // --- MODIFICAÇÃO NO TIPO DE 'type' ---
        betData: { betNumber?: number | null; betAmount: number, type: 'par_escolhido' | 'tripla_escolhida' | 'soma_dupla' | 'soma_tripla' | 'aleatorio_dupla' | 'aleatorio_tripla' },
    ): Promise<DiceBet[]> {
        const transaction = await this.sequelize.transaction();
        try {
            // --- Validações Iniciais ---
            const user = await this.userModel.findByPk(userId, { transaction });
            if (!user) {
                throw new NotFoundException('Usuário não encontrado.');
            }

            const diceRound = await this.diceRoundModel.findByPk(roundId, { transaction });
            if (!diceRound) {
                throw new NotFoundException('Rodada não encontrada.');
            }
            if (diceRound.finished) {
                throw new BadRequestException('Esta rodada já foi finalizada.');
            }

             // --- MODIFICAÇÃO NA VALIDAÇÃO DE betNumber ---
             // Validação de betNumber conforme o tipo ANTES de chamar o handler
             const needsBetNumber = ['par_escolhido', 'tripla_escolhida', 'soma_dupla', 'soma_tripla'].includes(betData.type);
             if (needsBetNumber && (betData.betNumber === null || betData.betNumber === undefined)) {
                 throw new BadRequestException(`O campo 'betNumber' é obrigatório para o tipo de aposta '${betData.type}'.`);
             }
             if (!needsBetNumber && betData.betNumber !== null && betData.betNumber !== undefined) {
                  this.logger.warn(`betNumber ${betData.betNumber} foi enviado para o tipo ${betData.type} mas será ignorado.`);
                 // Zera para evitar confusão, já que os handlers aleatórios definem como null
                 betData.betNumber = null;
             }
             // --- FIM DA MODIFICAÇÃO ---


            const createdBets: DiceBet[] = [];

            // --- MODIFICAÇÃO NO MAPEAMENTO ---
            // Mapeamento de tipos de aposta para funções auxiliares
            // Garantindo que 'this' seja preservado ao chamar os handlers
            const betTypeHandlers: { [key: string]: (userId: number, roundId: number, betData: any, transaction: any, createdBets: DiceBet[]) => Promise<void> } = {
                'par_escolhido': this.handleParEscolhidoBet.bind(this),
                'tripla_escolhida': this.handleTriplaEscolhidaBet.bind(this),
                'soma_dupla': this.handleSomaDuplaBet.bind(this),       // <-- Adiciona novo handler
                'soma_tripla': this.handleSomaTriplaBet.bind(this),      // <-- Adiciona novo handler
                'aleatorio_dupla': this.handleAleatorioDuplaBet.bind(this),
                'aleatorio_tripla': this.handleAleatorioTriplaBet.bind(this),
            };
            // --- FIM DA MODIFICAÇÃO ---

            const handler = betTypeHandlers[betData.type];
            if (!handler) { // Verifica se o handler existe
                throw new BadRequestException(`Tipo de aposta inválido: ${betData.type}`);
            }

            // --- Execução da Lógica da Aposta ---
            // A função handler agora pode lançar NotFoundException se getNextNumber falhar
            // Os handlers handleSomaDuplaBet e handleSomaTriplaBet podem lançar BadRequestException para ranges inválidos
            await handler(userId, roundId, betData, transaction, createdBets);

            // Verifica se alguma aposta foi realmente criada (importante para Tripla Escolhida)
             if (createdBets.length === 0) {
                 this.logger.error(`Nenhuma aposta foi criada para o usuário ${userId} na rodada ${roundId}, tipo ${betData.type}. Handler pode ter falhado silenciosamente.`);
                 throw new InternalServerErrorException('Falha ao criar o registro da aposta.');
             }


            // --- Atualização de Saldo e Commit ---
            // Calcula o custo total SOMENTE das apostas efetivamente criadas
            // Assume que betAmount é o custo por 'jogada' ou 'tentativa' que resulta em um DiceBet
            // Se uma aposta como 'tripla_escolhida' custa X independente das tentativas, ajuste aqui.
            // Se cada tentativa custa, a lógica atual de adicionar a CADA DiceBet criado parece ok.
             const totalAmount = createdBets.reduce((acc, bet) => acc + bet.betAmount, 0); // Soma os betAmount dos registros criados


             // Verifica saldo ANTES de atualizar
             if (user.balance < totalAmount) {
                 throw new BadRequestException(`Saldo insuficiente. Saldo atual: ${user.balance}, Custo da aposta: ${totalAmount}`);
             }

            await user.update(
                { balance: user.balance - totalAmount },
                { transaction },
            );

            await transaction.commit();
            this.logger.log(`Usuário ${userId} apostou ${totalAmount} na rodada ${roundId} (Tipo: ${betData.type}, Número: ${betData.betNumber ?? 'N/A'}). Saldo restante: ${user.balance - totalAmount}.`);
            return createdBets; // Retorna as apostas criadas

        } catch (error) {
            // Garante o rollback em QUALQUER erro
            await transaction.rollback();

            // --- Tratamento de Erro Específico ---
            // Verifica se o erro é o de números esgotados vindo de getNextNumber
            if (error instanceof NotFoundException && error.message.includes('Nenhum número gerado disponível')) {
                 this.logger.warn(
                    `Esgotamento de números para a rodada ${roundId} ao tentar comprar bilhetes pelo usuário ${userId}. Tipo: ${betData.type}. Erro: ${error.message}`,
                    error.stack,
                );
                // Retorna um erro 400 claro para o usuário
                throw new BadRequestException(
                    'Não há números suficientes disponíveis nesta rodada para completar a aposta. Tente novamente mais tarde ou em uma nova rodada.',
                );
            }

            // Re-lança outros erros conhecidos (4xx)
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException || // Inclui erros de validação dos handlers de soma
                error instanceof ConflictException ||
                // Inclui o erro de inconsistência que pode ser lançado por getNextNumber
                (error instanceof InternalServerErrorException && error.message.includes('Inconsistência nos dados da rodada'))
            ) {
                throw error;
            }

            // Loga e lança um erro 500 genérico para qualquer outro problema inesperado
            this.logger.error(
                `Erro inesperado ao comprar bilhetes para a rodada ${roundId} pelo usuário ${userId}: ${(error as Error).message}`,
                (error as Error).stack,
            );
            throw new InternalServerErrorException(
                'Erro interno ao processar a compra de bilhetes. Por favor, tente novamente.', // Mensagem um pouco mais específica que a anterior
            );
        }
    }

     private checkAndGetPrize(bet: DiceBet): number {
         // Verifica o tipo de aposta para determinar a lógica de premiação
         const type = bet.type;
         const betNumber = bet.betNumber; // Número que o usuário apostou (pode ser null)
         const generatedNumber = bet.generatedNumber; // Número(s) gerado(s) pelo sistema (pode ser combinado)
         const betAmount = bet.betAmount; // Valor apostado

         try {
             // --- MODIFICAÇÃO AQUI: Separar 'soma' ---
             if (type === 'soma_dupla') {
                 // Usuário aposta na SOMA (betNumber) vs SOMA GERADA (generatedNumber)
                 if (betNumber === generatedNumber) {
                      this.logger.debug(`[Prize Check] Soma Dupla: Ganhou! Apostou ${betNumber}, Gerado ${generatedNumber}`);
                     return betAmount * this.getMultiplierForSoma(generatedNumber); // Multiplicador pode variar com a soma
                 }
             } else if (type === 'soma_tripla') {
                 // Usuário aposta na SOMA (betNumber) vs SOMA GERADA (generatedNumber)
                 if (betNumber === generatedNumber) {
                      this.logger.debug(`[Prize Check] Soma Tripla: Ganhou! Apostou ${betNumber}, Gerado ${generatedNumber}`);
                     return betAmount * this.getMultiplierForSoma(generatedNumber); // Usa a mesma função de multiplicador
                 }
             // --- FIM DA MODIFICAÇÃO ---
             } else if (type === 'par_escolhido') {
                 // Usuário aposta em UM NÚMERO (betNumber)
                 // generatedNumber contém DOIS números (ex: first * 10 + second)
                 const firstDice = Math.floor(generatedNumber / 10);
                 const secondDice = generatedNumber % 10;
                  // Ganha se o número apostado aparecer EM QUALQUER UM dos dados
                 if (firstDice === betNumber || secondDice === betNumber) {
                      this.logger.debug(`[Prize Check] Par Escolhido: Ganhou! Apostou ${betNumber}, Gerado ${firstDice}, ${secondDice}`);
                      // Definir multiplicador para Par Escolhido
                     return betAmount * 2; // Exemplo: 2x
                 }
             } else if (type === 'tripla_escolhida') {
                 // Usuário aposta em UM NÚMERO (betNumber)
                 // generatedNumber contém TRÊS números (ex: first * 100 + second * 10 + third)
                 const firstDice = Math.floor(generatedNumber / 100);
                 const secondDice = Math.floor((generatedNumber % 100) / 10);
                 const thirdDice = generatedNumber % 10;
                  // Ganha se o número apostado aparecer NOS TRÊS dados
                 if (firstDice === betNumber && secondDice === betNumber && thirdDice === betNumber) {
                      this.logger.debug(`[Prize Check] Tripla Escolhida: Ganhou! Apostou ${betNumber}, Gerado ${firstDice}, ${secondDice}, ${thirdDice}`);
                      // Definir multiplicador alto para Tripla Escolhida
                     return betAmount * 50; // Exemplo: 50x
                 }
             } else if (type === 'aleatorio_dupla') {
                 // Usuário não aposta em número específico
                 // generatedNumber contém DOIS números (ex: first * 10 + second)
                 const firstDice = Math.floor(generatedNumber / 10);
                 const secondDice = generatedNumber % 10;
                  // Ganha se os DOIS números gerados forem IGUAIS
                 if (firstDice === secondDice) {
                      this.logger.debug(`[Prize Check] Aleatório Dupla: Ganhou! Gerado ${firstDice}, ${secondDice}`);
                      // Definir multiplicador para Dupla Aleatória
                     return betAmount * 5; // Exemplo: 5x
                 }
             } else if (type === 'aleatorio_tripla') {
                 // Usuário não aposta em número específico
                 // generatedNumber contém TRÊS números (ex: first * 100 + second * 10 + third)
                 const firstDice = Math.floor(generatedNumber / 100);
                 const secondDice = Math.floor((generatedNumber % 100) / 10);
                 const thirdDice = generatedNumber % 10;
                  // Ganha se os TRÊS números gerados forem IGUAIS
                 if (firstDice === secondDice && secondDice === thirdDice) {
                      this.logger.debug(`[Prize Check] Aleatório Tripla: Ganhou! Gerado ${firstDice}, ${secondDice}, ${thirdDice}`);
                     // Definir multiplicador alto para Tripla Aleatória
                     return betAmount * 100; // Exemplo: 100x
                 }
             } else {
                 this.logger.warn(`Tipo de aposta desconhecido ou não premiável encontrado: ${type}`);
             }
         } catch (e) {
              this.logger.error(`Erro ao verificar prêmio para aposta ${bet.id} (Tipo: ${type}): ${(e as Error).message}`, (e as Error).stack);
             return 0; // Não dar prêmio se houver erro no cálculo
         }

         // Se nenhuma condição de vitória foi atendida
         return 0;
     }

      // Função auxiliar para definir multiplicadores da SOMA (exemplo)
      // Esta função agora serve tanto para soma_dupla quanto soma_tripla,
      // baseando-se no valor final da soma.
     private getMultiplierForSoma(soma: number): number {
         // Somas mais difíceis (extremos) pagam mais
         // Assume dados 0-6: Dupla (0-12), Tripla (0-18)
         if (soma < 0 || soma > 18) return 0; // Soma inválida

         if (soma === 0 || soma === 18) return 60; // Mais difícil
         if (soma === 1 || soma === 17) return 30;
         if (soma === 2 || soma === 16) return 15;
         if (soma === 3 || soma === 15) return 10;
         if (soma === 4 || soma === 14) return 8;
         if (soma === 5 || soma === 13) return 6;
         if (soma === 6 || soma === 12) return 5; // Meio difícil (inclui max dupla)
         if (soma === 7 || soma === 11) return 4;
         if (soma >= 8 && soma <= 10) return 3; // Somas mais comuns (centro)
         return 1; // Default (não deve ser atingido com a validação acima)
     }


    async finalizeDiceRound(roundId: number, transactionHost?: any): Promise<DiceRound> {
        const transaction = transactionHost
            ? transactionHost
            : await this.sequelize.transaction();
        try {
            const diceRound = await this.diceRoundModel.findByPk(roundId, {
                include: [{
                    model: DiceBet,
                    order: [['createdAt', 'ASC']],
                    include: [{
                        model: User,
                        attributes: ['id', 'name', 'email', 'balance'],
                    }],
                }],
                transaction
            });

            if (!diceRound) {
                if (!transactionHost) await transaction.rollback(); // Rollback se criamos a transação
                throw new NotFoundException('Rodada não encontrada.');
            }

            if (diceRound.finished) {
                if (!transactionHost) await transaction.rollback(); // Rollback se criamos a transação
                throw new ConflictException('Rodada já finalizada.');
            }


            const bets = diceRound.bets;
            // --- Define o tipo explicitamente aqui ---
            const winnersInfo: WinnerInfo[] = [];
            // ---------------------------------------

            for (const bet of bets) {
                const prize = this.checkAndGetPrize(bet);
                if (prize > 0) {
                    bet.win = true;
                    const winnerUser = bet.user;
                    if (!winnerUser) {
                        this.logger.error(`Usuário ${bet.userId} não encontrado para a aposta vencedora ${bet.id}`);
                        // Considerar se deve continuar ou parar a finalização
                        continue; // Continua para as próximas apostas
                    }

                    // Garante que oldBalance é um número
                    const oldBalance = Number(winnerUser.balance) || 0;
                    const newBalance = oldBalance + prize;

                    // Usa update em vez de save para garantir que apenas o balance seja alterado
                    await this.userModel.update(
                        { balance: newBalance },
                        { where: { id: winnerUser.id }, transaction }, // ESSENCIAL: usar a transação e o where
                    );

                    // Atualiza o objeto local para refletir a mudança, se necessário para logs posteriores
                    winnerUser.balance = newBalance;


                    // O objeto agora corresponde à interface WinnerInfo
                    winnersInfo.push({ userId: winnerUser.id, prize: prize, betId: bet.id, oldBalance: oldBalance, newBalance: newBalance });

                } else {
                    bet.win = false;
                }
                 // Salva a alteração (win=true/false) na aposta DENTRO da transação
                 // Usar update pode ser mais seguro se houver concorrência, mas save é comum aqui.
                await bet.save({ transaction });
            }

            // Marca a rodada como finalizada
            diceRound.finished = true;
            await diceRound.save({ transaction });

            // Commit apenas se não for uma transação externa
            if (!transactionHost) {
                await transaction.commit();
            }

            this.logger.log(`Rodada de dado ${roundId} finalizada.`);
            // Agora 'w' terá o tipo WinnerInfo inferido corretamente
            winnersInfo.forEach(w => {
                this.logger.log(`-- Vencedor: Usuário ${w.userId}, Prêmio: ${w.prize.toFixed(2)} (Aposta ${w.betId}). Saldo: ${w.oldBalance.toFixed(2)} -> ${w.newBalance.toFixed(2)}`);
            });

            // Retorna a rodada atualizada (sem recarregar do DB, pois já foi atualizada)
            // Recarregar pode ser mais seguro se a transação for longa ou complexa
            // await diceRound.reload({ transaction: transactionHost ? transaction : undefined }); // Opção para recarregar
            return diceRound;

        } catch (error) {
             // Rollback em caso de erro, se não for transação externa
            if (!transactionHost) {
                await transaction.rollback();
            }

            // Re-throw erros conhecidos
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException ||
                error instanceof ConflictException
            ) {
                throw error;
            }

            // Log e erro genérico para outros problemas
            this.logger.error(
                `Erro ao finalizar a rodada ${roundId}: ${(error as Error).message}`,
                (error as Error).stack,
            );
            throw new InternalServerErrorException(
                'Erro interno ao finalizar a rodada. Por favor, tente novamente.',
            );
        }
    }


    //   Consulta (getDiceRoundsWithDetails, getDiceRoundByIdWithDetails, getDiceRoundsPlayedByUser)
    //   Nenhuma mudança necessária aqui, mas garantir que os includes tragam dados consistentes.
    //   Exemplo: Adicionar include de User em DiceBet se precisar do nome do apostador.
    async getDiceRoundsWithDetails(): Promise<any[]> {
        const rounds = await this.diceRoundModel.findAll({
            include: [
                { model: User, as: 'createdByUser', attributes: ['id', 'name', 'email'] },
                {
                    model: DiceBet,
                    include: [{ model: User, attributes: ['id', 'name', 'email'] }], // User que fez a aposta
                },
                {
                    model: DiceRoundSeed,
                    include: [{
                        model: Seed,
                        include: [{ model: BlockchainHash }]
                    }]
                }
            ],
            order: [['createdAt', 'DESC']],
        });

        // Mapeia para o formato desejado, tratando possíveis nulos
        return rounds.map(round => ({
            id: round.id,
            createdAt: round.createdAt,
            finished: round.finished,
            createdBy: round.createdByUser ? { // Verifica se createdByUser existe
                id: round.createdByUser.id,
                name: round.createdByUser.name,
                email: round.createdByUser.email
            } : null,
             // Acessa a hash de forma segura
             hash: round.diceRoundSeed?.seed?.blockchainHash?.hash ?? 'Hash não disponível', // Corrigido acesso aqui também
             bets: round.bets.map(bet => ({
                 id: bet.id,
                 userId: bet.userId,
                 betNumber: bet.betNumber,
                 betAmount: bet.betAmount,
                 generatedNumber: bet.generatedNumber,
                 createdAt: bet.createdAt,
                 win: bet.win,
                 type: bet.type,
                 user: bet.user ? { // Verifica se user existe na aposta
                     id: bet.user.id,
                     name: bet.user.name,
                     email: bet.user.email
                 } : null
             })),
        }));
    }

     async getDiceRoundByIdWithDetails(roundId: number): Promise<any> {
         const round = await this.diceRoundModel.findByPk(roundId, {
            include: [
                 { model: User, as: 'createdByUser', attributes: ['id', 'name', 'email'] },
                 {
                     model: DiceBet,
                     include: [{ model: User, attributes: ['id', 'name', 'email'] }],
                 },
                 {
                     model: DiceRoundSeed,
                     include: [{
                         model: Seed,
                         include: [{ model: BlockchainHash }]
                     }]
                 }
             ],
         });

         if (!round) {
             throw new NotFoundException(`Rodada com ID ${roundId} não encontrada.`);
         }

        // Mapeia para o formato desejado, tratando possíveis nulos
         return {
             id: round.id,
             createdAt: round.createdAt,
             finished: round.finished,
             createdBy: round.createdByUser ? {
                 id: round.createdByUser.id,
                 name: round.createdByUser.name,
                 email: round.createdByUser.email,
             } : null,
             hash: round.diceRoundSeed?.seed?.blockchainHash?.hash ?? 'Hash não disponível', // Corrigido acesso aqui também
             bets: round.bets.map(bet => ({
                 id: bet.id,
                 userId: bet.userId,
                 betNumber: bet.betNumber,
                 betAmount: bet.betAmount,
                 generatedNumber: bet.generatedNumber,
                 createdAt: bet.createdAt,
                 win: bet.win,
                 type: bet.type,
                 user: bet.user ? {
                     id: bet.user.id,
                     name: bet.user.name,
                     email: bet.user.email,
                 } : null
             })),
         };
     }

     async getDiceRoundsPlayedByUser(userId: number): Promise<any[]> { // Retorna any[] para corresponder ao mapeamento
         const rounds = await this.diceRoundModel.findAll({
             include: [
                 { // Inclui DiceBet obrigatoriamente, filtrando por userId
                     model: DiceBet,
                     where: { userId: userId },
                     required: true,
                     include: [ // Inclui o User da aposta (que será o próprio userId)
                         { model: User, attributes: ['id', 'name', 'email'] },
                     ],
                 },
                 { // Inclui o User que criou a rodada
                      model: User, as: 'createdByUser', attributes: ['id', 'name', 'email']
                 },
                 { // Inclui a estrutura de Seed/Hash
                     model: DiceRoundSeed,
                     include: [{
                         model: Seed,
                         include: [{ model: BlockchainHash }]
                     }]
                 }
             ],
             order: [['createdAt', 'DESC']],
         });

          // Mapeia para o formato detalhado, similar ao getDiceRoundsWithDetails
         return rounds.map(round => ({
             id: round.id,
             createdAt: round.createdAt,
             finished: round.finished,
             createdBy: round.createdByUser ? {
                 id: round.createdByUser.id,
                 name: round.createdByUser.name,
                 email: round.createdByUser.email
             } : null,
             hash: round.diceRoundSeed?.seed?.blockchainHash?.hash ?? 'Hash não disponível', // Corrigido acesso aqui também
             // Filtra as apostas para mostrar apenas as do usuário (embora o 'where' principal já faça isso)
             bets: round.bets.filter(bet => bet.userId === userId).map(bet => ({
                 id: bet.id,
                 userId: bet.userId,
                 betNumber: bet.betNumber,
                 betAmount: bet.betAmount,
                 generatedNumber: bet.generatedNumber,
                 createdAt: bet.createdAt,
                 win: bet.win,
                 type: bet.type,
                 // O user da aposta será sempre o solicitante aqui
                 user: bet.user ? {
                     id: bet.user.id,
                     name: bet.user.name,
                     email: bet.user.email
                 } : null
             })),
         }));
     }
}