// raffle.service.ts
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { Seed } from '../models/seed.model';
import { RaffleNumber } from '../models/raffle/raffle-number.model';
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model';
import { Sequelize } from 'sequelize-typescript'; // Use Sequelize from sequelize-typescript for typings
import { Transaction } from 'sequelize'; // Import Transaction from 'sequelize'
import { User } from '../models/user/user.model';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Op } from 'sequelize';
import { AuthService } from 'src/Auth/auth.service'; // Importar AuthService


@Injectable()
export class RaffleService {
  private readonly logger = new Logger(RaffleService.name);

  public readonly teamNames = [
    'Brasil', 'Alemanha', 'Itália', 'Argentina', 'França',
    'Espanha', 'Inglaterra', 'Uruguai', 'Holanda', 'Portugal',
    'Bélgica', 'Croácia', 'México', 'Colômbia', 'Chile',
    'Paraguai', 'Estados Unidos', 'Rússia', 'Suécia', 'Dinamarca',
    'Servia', 'Japão', 'Coreia do Sul', 'Camarões', 'Nigéria'
  ];

  public readonly fixedRafflePrices = [5, 10, 20, 30, 50, 100];


  constructor(
    @InjectModel(Raffle) private raffleModel: typeof Raffle,
    @InjectModel(BlockchainHash)
    private blockchainHashModel: typeof BlockchainHash,
    @InjectModel(GeneratedNumber)
    private generatedNumberModel: typeof GeneratedNumber,
    @InjectModel(RaffleNumber)
    private raffleNumberModel: typeof RaffleNumber,
    @InjectModel(Seed) private seedModel: typeof Seed,
    @InjectModel(User) private userModel: typeof User,
    @InjectModel(RaffleTicket) private raffleTicketModel: typeof RaffleTicket,
    private sequelize: Sequelize, // Usando Sequelize de sequelize-typescript
    private authService: AuthService, // Injetar AuthService
  ) { }

  async initializeFixedRaffles() {
    this.logger.log('Inicializando rifas fixas...');
    for (const price of this.fixedRafflePrices) {
      try {
        // Garante que só cria se não houver 6 ativas daquele preço/tipo
        const traditionalCount = await this.raffleModel.count({ where: { ticketPrice: price, type: 'tradicional', finished: false } });
        if (traditionalCount < 6) {
            await this.createSystemRaffle(price);
            this.logger.log(`Rifa tradicional de R$ ${price.toFixed(2)} inicializada.`);
        } else {
            this.logger.log(`Já existem ${traditionalCount} rifas tradicionais ativas de R$ ${price.toFixed(2)}. Nenhuma nova foi criada.`);
        }
      } catch (error) {
        this.logger.error(`Erro ao inicializar rifa tradicional de R$ ${price.toFixed(2)}: ${(error as any).message}`);
      }
      try {
        // Garante que só cria se não houver 6 ativas daquele preço/tipo
        const teamCount = await this.raffleModel.count({ where: { ticketPrice: price, type: 'equipes', finished: false } });
         if (teamCount < 6) {
            await this.createTeamRaffle(price);
            this.logger.log(`Rifa de equipes de R$ ${price.toFixed(2)} inicializada.`);
        } else {
            this.logger.log(`Já existem ${teamCount} rifas de equipes ativas de R$ ${price.toFixed(2)}. Nenhuma nova foi criada.`);
        }
      } catch (error) {
        this.logger.error(`Erro ao inicializar rifa de equipes de R$ ${price.toFixed(2)}: ${(error as any).message}`);
      }
    }
    this.logger.log('Inicialização de rifas fixas concluída.');
  }


  async getActiveFixedRaffles(): Promise<any> {
    this.logger.log('Buscando rifas fixas ativas...');
    const activeFixedRaffles = {};

    for (const price of this.fixedRafflePrices) {
        // Busca rifas Tradicionais
        const traditionalRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'tradicional', finished: false },
            include: [ /* Includes necessários */ ], // Adicione includes se precisar de detalhes
            order: [['createdAt', 'DESC']],
            limit: 6,
        });

        // Busca rifas de Equipes
        const teamRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'equipes', finished: false },
            include: [ /* Includes necessários */ ], // Adicione includes se precisar de detalhes
            order: [['createdAt', 'DESC']],
            limit: 6,
        });

        activeFixedRaffles[price] = {
            tradicional: traditionalRaffles.map(raffle => this.formatRaffleSummary(raffle)), // Usar função de formatação
            equipes: teamRaffles.map(raffle => this.formatRaffleSummary(raffle)), // Usar função de formatação
        };
    }

    return activeFixedRaffles;
  }

  // Função auxiliar para formatar resumo da rifa (pode ser expandida)
  private formatRaffleSummary(raffle: Raffle): any {
      return {
          id: raffle.id,
          raffleIdentifier: raffle.raffleIdentifier,
          type: raffle.type,
          title: raffle.title,
          ticketPrice: raffle.ticketPrice, // Manter como número para possíveis cálculos no front
          totalTickets: raffle.totalTickets,
          soldTickets: raffle.soldTickets,
          finished: raffle.finished,
          // Adicionar mais campos se necessário para o resumo
          expectedDrawTime: this.calculateExpectedDrawTime(raffle), // Calcula horário esperado
          createdAt: raffle.createdAt,
      };
  }

  // Função auxiliar para calcular o horário esperado do sorteio
  private calculateExpectedDrawTime(raffle: Raffle): Date | null {
    if (raffle.finished) {
      return raffle.drawDate || raffle.updatedAt; // Se finalizada, retorna a data do sorteio ou atualização
    }

    const now = new Date();

    // Condição 1: Esgotada ou Data de Fim passada
    if (raffle.soldTickets >= raffle.totalTickets || (raffle.endDate && raffle.endDate <= now)) {
        const nextHour = new Date(now);
        nextHour.setHours(now.getHours() + 1, 0, 0, 0); // Próxima hora cheia
        return nextHour;
    }

    // Condição 2: Data de Fim futura definida
    if (raffle.endDate) {
      return raffle.endDate;
    }

    // Condição 3: Indeterminada (não esgotada, sem data de fim)
    return null;
  }


  // Função auxiliar para calcular detalhes do prêmio
  private calculatePrizeDetails(raffle: Raffle): any {
    const totalCollectedValue = raffle.ticketPrice * raffle.soldTickets; // Usar vendidos para prêmio real
    const totalPotentialValue = raffle.ticketPrice * raffle.totalTickets; // Usar total para estimativa

    // Validação básica para evitar NaN ou valores negativos
    if (isNaN(totalCollectedValue) || totalCollectedValue < 0 || !raffle.ticketPrice || !raffle.totalTickets) {
         return {
             totalCollected: 0,
             houseShare: 0,
             totalDistributedToPlayers: 0,
             mainWinnerPotentialPrize: 0, // Novo campo
             mainWinnerNetPrize: raffle.finished ? 0 : null, // Novo campo (real se finalizado)
             mainWinnerReferrerCommission: raffle.finished ? 0 : null, // Novo campo (real se finalizado)
             mainWinnerReferrerActive: raffle.finished ? false : null, // Novo campo: indicador ativo no mês?
             teamPrizePoolPotential: 0, // Novo campo
             teamMembersTotalNetPrize: raffle.finished ? 0 : null, // Novo campo (real se finalizado)
             teamMembersReferrerCommissionTotal: raffle.finished ? 0 : null, // Novo campo (real se finalizado)
              // Novo campo: lista de membros da equipe com status de indicação e prêmio
            teamMembersDetails: raffle.finished ? [] : null,
             winningTeamName: raffle.finished ? (raffle as any).winningTeamName ?? "Indeterminado" : null, // Obter nome real se finalizado
             numberOfWinningTeamMembersReceivingPrize: raffle.finished ? (raffle as any).winningTeamMembersCount ?? 0 : null, // Novo campo (real se finalizado)
             details: "Não foi possível calcular os detalhes do prêmio (dados inválidos)."
         };
    }

    let actualTotalPrizeDistributed = 0; // Total que foi pago aos jogadores E seus indicadores

    if (raffle.type === 'tradicional') {
      // Prêmio real é 85% do valor *coletado* (vendido)
      const actualPrizePool = totalCollectedValue * 0.85;
      const houseShareBase = totalCollectedValue * 0.15; // Parte BASE que fica com a casa (15%)

      let mainWinnerNetPrize = 0;
      let mainWinnerReferrerCommission = 0;
      let mainWinnerReferrerActive = false; // Status de atividade do indicador do ganhador principal

      if (raffle.finished && raffle.winnerUserId !== undefined && raffle.winnerUserId !== null) {
           // Se finalizado e tem vencedor, precisamos saber se o vencedor foi indicado
           // Assume que winnerUser foi incluído com referrerId e referrer (pelo reload na finalização)
           const winnerUserWithReferrer = (raffle as any).winnerUser;

           if (winnerUserWithReferrer?.referrerId) {
               mainWinnerReferrerActive = (raffle as any).mainWinnerReferrerActive; // Pega o status calculado na finalização

               // O cálculo da comissão e prêmio líquido é feito na finalização.
               // Aqui, apenas usamos os valores que deveriam ter sido calculados e armazenados/passados.
               // Como não estamos recarregando com valores distribuídos, apenas com o usuário,
               // precisamos recalcular a lógica base para a exibição.
               // O valor REAL pago já está no banco (saldo do usuário).
               // Para exibir AQUI, podemos usar a lógica base de 85/5/95 e o status de atividade.

               const potentialReferrerCommission = actualPrizePool * 0.05;
               const potentialWinnerNetPrize = actualPrizePool * 0.95;

               if (mainWinnerReferrerActive) {
                   mainWinnerReferrerCommission = potentialReferrerCommission;
                   mainWinnerNetPrize = potentialWinnerNetPrize;
               } else {
                   // Comissão não foi para o indicador, foi para a casa. Ganhador recebe o total.
                   mainWinnerNetPrize = actualPrizePool; // Ganhador recebe os 85% inteiros
                   mainWinnerReferrerCommission = 0; // Comissão não creditada
               }

           } else {
               // Ganhador não tem indicador. Ganhador recebe o prêmio total (85%).
               mainWinnerNetPrize = actualPrizePool;
               mainWinnerReferrerCommission = 0;
               mainWinnerReferrerActive = false; // Não há indicador, status irrelevante (ou false)
           }
           actualTotalPrizeDistributed = mainWinnerNetPrize + mainWinnerReferrerCommission;

      } else {
          // Rifa não finalizada ou sem vencedor
          actualTotalPrizeDistributed = 0; // Nenhum prêmio foi distribuído ainda
          mainWinnerNetPrize = 0;
          mainWinnerReferrerCommission = 0;
      }
        // A share da casa REAL é o total coletado menos o total distribuído para jogadores/indicadores
        const actualHouseShare = totalCollectedValue - actualTotalPrizeDistributed;


      return {
        totalCollected: totalCollectedValue, // Valor total arrecadado com a venda de bilhetes
        houseShare: actualHouseShare, // Parte REAL que ficou com a casa (inclui comissões não ativas)
        totalDistributedToPlayers: actualTotalPrizeDistributed, // Total que saiu da casa para jogadores/indicadores
        mainWinnerPotentialPrize: totalPotentialValue * 0.85, // Estimativa se todos os bilhetes fossem vendidos (85%)
        mainWinnerNetPrize: raffle.finished ? mainWinnerNetPrize : null, // Prêmio líquido REAL do ganhador (se finalizado)
        mainWinnerReferrerCommission: raffle.finished ? mainWinnerReferrerCommission : null, // Comissão REAL do indicador (se finalizado)
        mainWinnerReferrerActive: raffle.finished ? mainWinnerReferrerActive : null, // Indicador ativo no mês (se finalizado)
        teamPrizePoolPotential: 0, // Não aplicável
        teamMembersTotalNetPrize: raffle.finished ? 0 : null, // Não aplicável
        teamMembersReferrerCommissionTotal: raffle.finished ? 0 : null, // Não aplicável
         teamMembersDetails: raffle.finished ? [] : null, // Não aplicável
        winningTeamName: null, // Não aplicável
        numberOfWinningTeamMembersReceivingPrize: null, // Não aplicável
        details: raffle.finished
            ? `Distribuição Finalizada (Base em R$ ${totalCollectedValue.toFixed(2)} coletados): Prêmio Pool (85%): R$ ${actualPrizePool.toFixed(2)}. Ganhador Neto: R$ ${mainWinnerNetPrize.toFixed(2)}. Comissão Indicador (Status Ativo: ${mainWinnerReferrerActive ? 'Sim' : 'Não'}): R$ ${mainWinnerReferrerCommission.toFixed(2)}. Casa: R$ ${actualHouseShare.toFixed(2)}.`
            : `Estimativa de Prêmios (Base em R$ ${totalPotentialValue.toFixed(2)} total potencial): Pool Estimado (85%): R$ ${(totalPotentialValue * 0.85).toFixed(2)}. Comissão Indicador (5% do Prêmio Ganho) e Prêmio Neto (95% do Prêmio Ganho) aplicados APENAS se o ganhador for indicado E o indicador estiver ativo no mês. Casa (15% estimado): R$ ${houseShareBase.toFixed(2)} (inclui potencial comissão não creditada).` // Atualizar % estimado da casa
      };
    } else if (raffle.type === 'equipes') {
      const actualMainPrizePool = totalCollectedValue * 0.50; // 50% do coletado para o pool principal
      const actualTeamPrizePool = totalCollectedValue * 0.30; // 30% do coletado para o pool da equipe
       const houseShareBase = totalCollectedValue * 0.20; // 20% do coletado fica com a casa (base)

      let mainWinnerNetPrize = 0;
      let mainWinnerReferrerCommission = 0;
      let mainWinnerReferrerActive = false; // Status de atividade do indicador do ganhador principal

      let teamMembersTotalNetPrize = 0; // Total líquido pago aos membros da equipe (excluindo principal)
      let teamMembersReferrerCommissionTotal = 0; // Total de comissões pagas aos indicadores dos membros da equipe
      let teamMembersDetails: any[] = []; // Detalhes de cada membro da equipe vencedora
      let winningTeamName: string | null = null;
      let numberOfWinningTeamMembersReceivingPrize = 0; // Contagem real de membros que ganharam no pool
      let actualTotalPrizeDistributed = 0; // Total distribuído para jogadores/indicadores

      if (raffle.finished) {
           // Para calcular os prêmios REAIS, precisamos dos tickets com usuários e referrerId
           // Assume-se que o service finalizeTeamRaffle populou raffle.tickets com user.referrerId
           winningTeamName = this.getTeamNameByTicketNumber(raffle, raffle.winningTicket);

           // 1. Processar Ganhador Principal (se houver)
           const mainWinningTicket = raffle.tickets?.find(t => t.ticketNumber === raffle.winningTicket);
           const mainWinnerUser = mainWinningTicket?.user; // User model fetched with referrerId

           if (mainWinnerUser) {
                if (mainWinnerUser.referrerId) {
                    mainWinnerReferrerActive = (raffle as any).mainWinnerReferrerActive; // Pega o status calculado na finalização

                    const potentialReferrerCommission = actualMainPrizePool * 0.05;
                    const potentialWinnerNetPrize = actualMainPrizePool * 0.95;

                    if (mainWinnerReferrerActive) {
                        mainWinnerReferrerCommission = potentialReferrerCommission;
                        mainWinnerNetPrize = potentialWinnerNetPrize;
                    } else {
                        // Comissão não foi para o indicador, foi para a casa. Ganhador recebe o total.
                        mainWinnerNetPrize = actualMainPrizePool;
                        mainWinnerReferrerCommission = 0;
                    }
                } else {
                    // Ganhador não tem indicador. Ganhador recebe o prêmio total (50%).
                    mainWinnerNetPrize = actualMainPrizePool;
                    mainWinnerReferrerCommission = 0;
                    mainWinnerReferrerActive = false; // Não há indicador, status irrelevante
                }
               actualTotalPrizeDistributed += mainWinnerNetPrize + mainWinnerReferrerCommission;

           } else {
              // Ninguém comprou o bilhete principal
              mainWinnerNetPrize = 0;
              mainWinnerReferrerCommission = 0;
               mainWinnerReferrerActive = false; // Ninguém ganhou principal
              // mainWinnerUserId remains null
           }


           // 2. Processar Pool da Equipe (30%)
           if (winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
                // Filter from the fetched 'tickets' array, exclude the main winner
                const winningTeamTickets = raffle.tickets?.filter( // Usar raffle.tickets aqui, que foi incluído
                    (ticket) => this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                                (mainWinnerUser ? ticket.userId !== mainWinnerUser.id : true) // Excluir o ganhador principal pelo ID se ele existe
                ) || []; // Garantir que seja um array, mesmo que vazio

                const teamMemberUsersWhoBought = new Map<number, User>(); // Map UserID -> User model (with referrerId)
                winningTeamTickets.forEach(ticket => {
                    if (ticket.user) { // Ensure ticket has a user
                         // Usar apenas o primeiro ticket encontrado por usuário para pegar a instância de usuário
                        if (!teamMemberUsersWhoBought.has(ticket.user.id)) {
                             teamMemberUsersWhoBought.set(ticket.user.id, ticket.user);
                        }
                    }
                });

                numberOfWinningTeamMembersReceivingPrize = teamMemberUsersWhoBought.size;

                if (numberOfWinningTeamMembersReceivingPrize > 0) {
                    const individualTeamPrizeShare = actualTeamPrizePool / numberOfWinningTeamMembersReceivingPrize;
                     this.logger.log(`Equipe Vencedora ${winningTeamName}: ${numberOfWinningTeamMembersReceivingPrize} membro(s) elegível(is) para o prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}). Parte base individual: R$ ${individualTeamPrizeShare.toFixed(2)}.`);

                    for (const user of teamMemberUsersWhoBought.values()) {
                        let memberNetPrizeShare = individualTeamPrizeShare;
                        let memberReferrerCommissionShare = 0;
                        let memberReferrerActive = false; // Track referrer activity status for this member

                        // Check if this team member has a referrer and if referrer is active this month
                        if (user.referrerId) {
                             // Pega o status de atividade do indicador deste membro, calculado na finalização
                             // Assumindo que finalizeTeamRaffle anexa uma lista de status de indicadores de membros
                             const memberReferrerStatus = (raffle as any).teamMemberReferrerActiveStatuses?.find(s => s.userId === user.id);
                             memberReferrerActive = memberReferrerStatus?.isActive || false;

                            const potentialMemberReferrerCommission = individualTeamPrizeShare * 0.05;
                            const potentialMemberNetPrize = individualTeamPrizeShare * 0.95;


                             if (memberReferrerActive) {
                                 memberReferrerCommissionShare = potentialMemberReferrerCommission;
                                 memberNetPrizeShare = potentialMemberNetPrize;
                             } else {
                                // Comissão não é creditada, fica na Casa. Membro recebe a parte total.
                                memberNetPrizeShare = individualTeamPrizeShare;
                                memberReferrerCommissionShare = 0; // Comissão não creditada é 0
                             }
                         } else {
                             // Membro não tem indicador
                             memberNetPrizeShare = individualTeamPrizeShare;
                             memberReferrerCommissionShare = 0;
                             memberReferrerActive = false; // Não há indicador
                         }

                        teamMembersTotalNetPrize += memberNetPrizeShare;
                        teamMembersReferrerCommissionTotal += memberReferrerCommissionShare;
                         teamMembersDetails.push({ // Adicionar detalhes deste membro
                            userId: user.id,
                            userName: user.name,
                            netPrize: memberNetPrizeShare,
                            referrerCommission: memberReferrerCommissionShare,
                            referrerActive: memberReferrerActive,
                            hasReferrer: user.referrerId !== undefined && user.referrerId !== null, // Indica se tinha indicador
                         });
                    }
                     actualTotalPrizeDistributed += teamMembersTotalNetPrize + teamMembersReferrerCommissionTotal;
                }
           }
      }

       // A share da casa REAL é o total coletado menos o total distribuído para jogadores/indicadores
       const actualHouseShare = totalCollectedValue - actualTotalPrizeDistributed;


      return {
        totalCollected: totalCollectedValue, // Valor total arrecadado
        houseShare: actualHouseShare, // Parte REAL que fica com a casa (inclui comissões não ativas)
        totalDistributedToPlayers: actualTotalPrizeDistributed, // Total que saiu da casa para jogadores/indicadores

        mainWinnerPotentialPrize: totalPotentialValue * 0.50, // Estimativa se todos os bilhetes fossem vendidos (50%)
        mainWinnerNetPrize: raffle.finished ? mainWinnerNetPrize : null, // Prêmio líquido REAL do ganhador principal (se finalizado)
        mainWinnerReferrerCommission: raffle.finished ? mainWinnerReferrerCommission : null, // Comissão REAL do indicador do principal (se finalizado)
        mainWinnerReferrerActive: raffle.finished ? mainWinnerReferrerActive : null, // Indicador do principal ativo (se finalizado)

        teamPrizePoolPotential: totalPotentialValue * 0.30, // Estimativa se todos os bilhetes fossem vendidos (30%)
        teamMembersTotalNetPrize: raffle.finished ? teamMembersTotalNetPrize : null, // Total líquido REAL distribuído aos membros da equipe (se finalizado)
        teamMembersReferrerCommissionTotal: raffle.finished ? teamMembersReferrerCommissionTotal : null, // Total de comissões REAL para indicadores dos membros da equipe (se finalizado)
         teamMembersDetails: raffle.finished ? teamMembersDetails : null, // Detalhes individuais dos membros da equipe vencedora
        winningTeamName: raffle.finished ? (winningTeamName ?? "N/A") : null, // Nome da equipe vencedora (se finalizado)
        numberOfWinningTeamMembersReceivingPrize: raffle.finished ? numberOfWinningTeamMembersReceivingPrize : null, // Número de membros da equipe que receberam prêmio (se finalizado)

        details: raffle.finished
            ? `Distribuição Finalizada (Base em R$ ${totalCollectedValue.toFixed(2)} coletados):` +
              ` Prêmio Principal (50%): R$ ${actualMainPrizePool.toFixed(2)} (Neto: R$ ${mainWinnerNetPrize.toFixed(2)}, Comissão Indicador: R$ ${mainWinnerReferrerCommission.toFixed(2)}, Indicador Ativo: ${mainWinnerReferrerActive ? 'Sim' : 'Não'}).` +
              ` Pool Equipe ${winningTeamName ?? 'N/A'} (30%): R$ ${actualTeamPrizePool.toFixed(2)} dividido entre ${numberOfWinningTeamMembersReceivingPrize} membro(s).` +
              ` Detalhes Membros: ${teamMembersDetails.map(d => `[User ${d.userId}, Neto R$ ${d.netPrize.toFixed(2)}, Comissão Indicador R$ ${d.referrerCommission.toFixed(2)}, Indicador Ativo: ${d.referrerActive ? 'Sim' : 'Não'}]`).join(', ')}.` +
              ` Casa: R$ ${actualHouseShare.toFixed(2)}.`
            : `Estimativa de Prêmios (Base em R$ ${totalPotentialValue.toFixed(2)} total potencial):` +
              ` Principal (50%): R$ ${(totalPotentialValue * 0.50).toFixed(2)}.` +
              ` Pool Equipe (30%): R$ ${(totalPotentialValue * 0.30).toFixed(2)} (a ser dividido).` +
              ` Comissão Indicador (5% do Prêmio Ganho) aplicada SOBRE o prêmio individual de cada ganhador (Principal e membros da equipe) APENAS se forem indicados E o indicador estiver ativo no mês. Casa (20% estimado): R$ ${houseShareBase.toFixed(2)} (inclui potencial comissão não creditada).`
      };
    }

    // Caso surja um novo tipo de rifa não tratado
    return null;
  }

  // Função auxiliar para formatar bilhete (0-99 para 1-100)
  private formatTicketNumberDisplay(ticketNumber: string): string {
    if (ticketNumber === null || ticketNumber === undefined || ticketNumber === '') return 'N/A'; // Tratar null/undefined/empty
    try {
        const num = parseInt(ticketNumber, 10);
        if (isNaN(num)) return ticketNumber; // Retorna original se não for número
        // Validar se está dentro do range esperado 0-99
         if (num < 0 || num > 99) return ticketNumber; // Retorna original se fora do range 0-99

        return (num + 1).toString(); // Soma 1 e converte para string
    } catch (e: any) {
        this.logger.error(`Erro ao formatar número de bilhete "${ticketNumber}": ${e.message}`);
        return ticketNumber; // Retorna original em caso de erro
    }
}

  async getAllFixedAndExtraRaffles(): Promise<any> {
    // ... (lógica existente)
    // APLICAR formatRaffleSummary nos retornos
    // ...
    this.logger.log('Buscando todas as rifas fixas e extras...');
    const allFixedRaffles = {
        tradicional: {},
        equipes: {}
    };

    for (const price of this.fixedRafflePrices) {
        const traditionalRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'tradicional' },
            include: [ /* Includes */ ], order: [['createdAt', 'DESC']],
        });
        const teamRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'equipes' },
             include: [ /* Includes */ ], order: [['createdAt', 'DESC']],
        });

        allFixedRaffles.tradicional[price] = traditionalRaffles.map(raffle => this.formatRaffleSummary(raffle));
        allFixedRaffles.equipes[price] = teamRaffles.map(raffle => this.formatRaffleSummary(raffle));
    }
    return allFixedRaffles;
  }

  async createSystemRaffle(ticketPrice: number): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });

    if (!latestHash) {
      throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
    }

    // Busca a seed e o generatedNumber MAIS RECENTE associado à hash
    const correspondingSeed = await this.seedModel.findOne({
        where: { hashId: latestHash.id },
        include: [
            {
                model: GeneratedNumber,
                 // Busca o número que AINDA NÃO FOI USADO (isUsed = false)
                where: { isUsed: false },
                order: [['createdAt', 'ASC']], // Pega o mais antigo NÃO usado
                limit: 1,
            },
        ],
        order: [['createdAt', 'DESC']], // Pega a seed mais recente primeiro
    });

    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
      // Tentar gerar número se não existir? Por agora, lança erro.
      throw new NotFoundException(
        `Nenhuma seed ou generatedNumber NÃO USADO correspondente encontrado para a hash ${latestHash.id}. Execute a geração de números.`
      );
    }

    const generatedNumberToUse = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(generatedNumberToUse.number) % 100n; // 0 a 99
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0'); // Formato '00' a '99'

    const startDate = new Date();

    // Define endDate como 7 dias a partir de agora, por exemplo
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7); // Adiciona 7 dias

    const newRaffle = await this.raffleModel.create({
      raffleIdentifier: `RJ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`, // ID mais único e curto
      type: 'tradicional', // Definindo o tipo
      title: `Rifa Tradicional - Loto Jack - R$ ${ticketPrice.toFixed(2)}`, // Nome Fantasia
      description: `Rifa Loto Jack gerada automaticamente. Prêmio: 85% do total arrecadado para o bilhete sorteado, com 5% desse valor destinado ao indicador do ganhador APENAS se o indicador estiver ativo no mês. 15% para a Casa (inclui comissões não creditadas). Baseado na hash ${latestHash.hash}.`,
      ticketPrice: ticketPrice,
      totalTickets: 100, // 00 a 99
      soldTickets: 0,
      startDate: startDate,
      endDate: endDate, // Adiciona a data de fim
      finished: false,
      winningTicket: winningTicketNumber, // Armazena 00-99 internamente
      drawDate: null, // Será preenchido na finalização
    });

    // Associa o número gerado à rifa E MARCA COMO USADO
     await this.generatedNumberModel.update(
         { isUsed: true },
         { where: { id: generatedNumberToUse.id } }
     );

    await this.raffleNumberModel.create({
      raffleId: newRaffle.id,
      numberId: generatedNumberToUse.id,
    });


    this.logger.log(
      `Rifa Tradicional ${newRaffle.raffleIdentifier} (ID ${newRaffle.id}) criada usando GeneratedNumber ID ${generatedNumberToUse.id}. Preço: R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );

    return newRaffle;
  }

  @Cron(CronExpression.EVERY_HOUR) // Roda a cada hora
  async createRafflesCronJob() {
    this.logger.log('CRON: Verificando necessidade de criar rifas fixas...');
    for (const price of this.fixedRafflePrices) {
        // Tradicional
        const activeTraditionalCount = await this.raffleModel.count({
            where: { ticketPrice: price, type: 'tradicional', finished: false },
        });
        if (activeTraditionalCount < 6) {
            const needed = 6 - activeTraditionalCount;
            this.logger.log(`CRON: Necessário criar ${needed} rifa(s) tradicional(is) de R$ ${price.toFixed(2)}.`);
            for (let i = 0; i < needed; i++) {
                try {
                    await this.createSystemRaffle(price);
                } catch (error) {
                    this.logger.error(`CRON: Erro ao criar rifa tradicional de R$ ${price.toFixed(2)}: ${(error as any).message}`);
                }
            }
        }

        // Equipes
        const activeTeamCount = await this.raffleModel.count({
            where: { ticketPrice: price, type: 'equipes', finished: false },
        });
        if (activeTeamCount < 6) {
            const needed = 6 - activeTeamCount;
             this.logger.log(`CRON: Necessário criar ${needed} rifa(s) de equipes de R$ ${price.toFixed(2)}.`);
            for (let i = 0; i < needed; i++) {
                try {
                    await this.createTeamRaffle(price);
                } catch (error) {
                    this.logger.error(`CRON: Erro ao criar rifa de equipes de R$ ${price.toFixed(2)}: ${(error as any).message}`);
                }
            }
        }
    }
    this.logger.log('CRON: Verificação para criar rifas concluída.');
  }

  async buyRaffleTickets(
    userId: number,
    raffleId: number,
    ticketData: { type: 'tradicional' | 'equipes'; quantityOrNumbers: number | string[] },
  ): Promise<RaffleTicket[]> {
    // Start transaction
    const transaction = await this.sequelize.transaction();
    try {
      // Fetch user within transaction - Lock the user row during balance update later
      const user = await this.userModel.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE }); // Lock the user!
      if (!user) {
        // No rollback needed here, transaction just started, no lock acquired yet
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Step 1: Find and lock the Raffle row ONLY
      const raffle = await this.raffleModel.findByPk(raffleId, {
        transaction,
        lock: transaction.LOCK.UPDATE, // Lock only the raffle row
        // NO INCLUDE during lock acquisition!
      });

      // Basic checks on the raffle itself (after acquiring lock)
      if (!raffle) {
        // Lock might have been acquired, attempt rollback before throwing
        await transaction.rollback(); // Rollback since lock might be held
        throw new NotFoundException('Rifa não encontrada.');
      }
      if (raffle.finished) {
        await transaction.rollback(); // Rollback since lock might be held
        throw new BadRequestException('Esta rifa já foi finalizada.');
      }
       if (raffle.type !== ticketData.type) {
          await transaction.rollback(); // Rollback since lock might be held
          throw new BadRequestException(`Tipo de compra (${ticketData.type}) incompatível com o tipo da rifa (${raffle.type}).`);
      }

      // Step 2: Fetch existing ticket numbers separately *within the same transaction*
      // This does NOT need a lock on tickets themselves, as the raffle row itself is locked.
      const existingTicketsData = await this.raffleTicketModel.findAll({
          where: { raffleId: raffle.id },
          attributes: ['ticketNumber'], // Only need the numbers
          transaction, // Use the same transaction
          raw: true, // Get plain objects for efficiency
      });
      // Create a Set of existing ticket numbers ('00'-'99') for quick lookup
      const existingTicketNumbers = new Set(existingTicketsData.map(t => t.ticketNumber));

      // --- Logic for determining tickets to buy ('00'-'99' format) ---
      let quantity: number;
      let ticketNumbersToBuy: string[]; // Internal format '00'-'99'

      // Calculate available slots based on the accurately fetched existing numbers
      const availableSlots = raffle.totalTickets - existingTicketNumbers.size;

      if (typeof ticketData.quantityOrNumbers === 'number') { // Random purchase requested
        quantity = ticketData.quantityOrNumbers;
        // Validate quantity input (no rollback needed for basic input validation)
        if (quantity <= 0) {
             throw new BadRequestException('A quantidade de bilhetes deve ser maior que zero.');
        }
        // Check if enough tickets are available (condition check after lock)
        if (quantity > availableSlots) {
           await transaction.rollback(); // Rollback as condition failed after lock
          throw new BadRequestException(
            `Não há ${quantity} bilhetes disponíveis. Apenas ${availableSlots} restantes.`,
          );
        }
        // Generate unique available numbers in '00'-'99' format
        ticketNumbersToBuy = this.generateUniqueAvailableTicketNumbers(raffle.totalTickets, existingTicketNumbers, quantity);

      } else { // Specific purchase requested
        const requestedNumbersFront = ticketData.quantityOrNumbers; // Array of "1"-"100" strings from frontend
        // Convert and validate frontend numbers ('1'-'100') to internal ('00'-'99')
        ticketNumbersToBuy = requestedNumbersFront.map(numStr => {
            const num = parseInt(numStr, 10);
            // Input validation (no rollback needed yet)
            if (isNaN(num) || num < 1 || num > raffle.totalTickets) {
                throw new BadRequestException(`Número de bilhete inválido: ${numStr}. Deve ser entre 1 e ${raffle.totalTickets}.`);
            }
            return (num - 1).toString().padStart(2, '0'); // Convert '1'->'00', '100'->'99'
        });

        quantity = ticketNumbersToBuy.length;
         // Input validation (no rollback needed yet)
         if (quantity <= 0) {
             throw new BadRequestException('Nenhum número de bilhete fornecido.');
        }

        // Check availability against the fetched Set (condition check after lock)
        const alreadySold = ticketNumbersToBuy.filter(num => existingTicketNumbers.has(num));
        if (alreadySold.length > 0) {
             await transaction.rollback(); // Rollback as condition failed after lock
             throw new BadRequestException(
              `Os seguintes bilhetes (formato 1-100) já foram comprados: ${alreadySold.map(this.formatTicketNumberDisplay).join(', ')}`,
            );
        }
        // Check duplicates in the user's request (condition check after lock)
        const duplicatesInRequest = ticketNumbersToBuy.filter((item, index) => ticketNumbersToBuy.indexOf(item) !== index);
        if (duplicatesInRequest.length > 0) {
             // Although technically input validation, it's checked after lock, so rollback is safer.
             await transaction.rollback();
             throw new BadRequestException(
              `Os seguintes bilhetes (formato 1-100) estão duplicados na sua requisição: ${duplicatesInRequest.map(this.formatTicketNumberDisplay).join(', ')}`,
            );
        }
        // Check if requesting more than available (condition check after lock)
        if (quantity > availableSlots) {
            await transaction.rollback(); // Rollback as condition failed after lock
           throw new BadRequestException(
             `Você tentou comprar ${quantity} bilhetes, mas apenas ${availableSlots} estão disponíveis.`
           );
        }
      }

      // Check user balance (condition check after lock)
      const totalCost = raffle.ticketPrice * quantity;
      if (user.balance < totalCost) {
         await transaction.rollback(); // Rollback as condition failed after lock
        throw new BadRequestException(`Saldo insuficiente. Necessário: R$ ${totalCost.toFixed(2)}, Disponível: R$ ${user.balance.toFixed(2)}.`);
      }

      // --- Perform Database Updates ---

      // Create the new raffle tickets ('00'-'99' format)
      const createdTickets = await this.raffleTicketModel.bulkCreate(
        ticketNumbersToBuy.map((ticketNumberInternal) => ({
          userId,
          raffleId,
          ticketNumber: ticketNumberInternal, // Save internal format
        })),
        { transaction }, // Use the transaction
      );

      // Update user's balance using the transactional method
      // The user model instance 'user' was fetched WITH the transaction/lock
      await this.authService.updateUserBalance(user.id, -totalCost, transaction);


      // Update the raffle's sold tickets count accurately
      const newSoldCount = existingTicketNumbers.size + quantity;
      await raffle.update(
        { soldTickets: newSoldCount },
        { transaction }, // Use the transaction
      );

      // --- Post-Update Actions (still within try, before commit) ---

      // Check if the raffle sold out with this purchase
      if (newSoldCount >= raffle.totalTickets) {
          this.logger.log(`Rifa ${raffleId} (tipo: ${raffle.type}) esgotou com esta compra. Verificando necessidade de criar nova...`);
          // Trigger async creation of the next raffle if needed (don't await, don't block the purchase)
          this.createNextRaffleIfNeeded(raffle.type, raffle.ticketPrice).catch(err => {
              // Log error but don't fail the current purchase because of this background task
              this.logger.error(`Erro (não bloqueante) ao tentar criar próxima rifa após esgotamento da ${raffleId}: ${err.message}`);
          });
      }

      // --- Commit Transaction ---
      // If all operations succeed, commit the transaction
      await transaction.commit();

      // --- Log Success ---
      this.logger.log(
        `Usuário ${userId} comprou ${quantity} bilhete(s) para a rifa ${raffleId}. Bilhetes (formato 1-100): ${ticketNumbersToBuy.map(this.formatTicketNumberDisplay).join(', ')}`
      );

      // --- Return Result ---
      // Return the created ticket objects (they contain the internal '00'-'99' number)
      return createdTickets;

    } catch (error) {
      // --- Error Handling & Rollback ---
      // Attempt to rollback the transaction if an error occurred and it's still active
      // Check if transaction exists AND is not completed ('commit' or 'rollback')
      if (transaction && (transaction as any).finished === null) { // Use (transaction as any).finished
            try {
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação de compra da rifa ${raffleId} por usuário ${userId} devido a erro no catch.`);
            } catch (rollbackError: any) {
                 // Log only unexpected rollback errors
                 if (!rollbackError.message?.includes('already')) { // Ignore "Transaction already committed/rolled back" errors
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para compra da rifa ${raffleId} por ${userId}: ${rollbackError}`);
                 }
            }
       }

      // --- Re-throw or Handle Error ---
      // Re-throw specific known exceptions (NotFound, BadRequest)
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

       // Handle the specific balance error from updateUserBalance gracefully
       if (error instanceof Error && error.message?.includes('Insufficient balance during transaction')) { // Match the error message from AuthService
            throw new BadRequestException('Saldo insuficiente para concluir a compra.');
       }


      // Log the captured error for debugging
      this.logger.error(
        `Erro capturado no CATCH ao comprar bilhetes para rifa ${raffleId} por usuário ${userId}: ${(error as any).message}`, (error as any).stack
      );

      // Handle the specific "FOR UPDATE cannot be applied" error gracefully for the user
      if (error instanceof Error && error.message?.includes('FOR UPDATE cannot be applied')) {
           throw new InternalServerErrorException('Erro temporário ao processar compra devido a concorrência. Por favor, tente novamente.');
      }

      // Throw a generic internal server error for other unexpected issues
      throw new InternalServerErrorException('Erro interno ao processar a compra de bilhetes.');
    }
  }

    // Função auxiliar para criar a próxima rifa se necessário
    private async createNextRaffleIfNeeded(type: 'tradicional' | 'equipes', price: number): Promise<void> {
        const activeCount = await this.raffleModel.count({
            where: { ticketPrice: price, type: type, finished: false }
        });

        if (activeCount < 6) {
             this.logger.log(`Detectado que há menos de 6 rifas ativas (${activeCount}) do tipo ${type} e preço ${price}. Criando nova...`);
             try {
                 if (type === 'tradicional') {
                     await this.createSystemRaffle(price);
                 } else {
                     await this.createTeamRaffle(price);
                 }
                 this.logger.log(`Nova rifa do tipo ${type} e preço ${price} criada com sucesso.`);
             } catch (err) {
                  this.logger.error(`Falha ao criar rifa extra do tipo ${type} e preço ${price}: ${(err as Error).message}`);
             }
        } else {
             this.logger.log(`Já existem ${activeCount} rifas ativas do tipo ${type} e preço ${price}. Nenhuma nova rifa necessária no momento.`);
        }
    }

  private generateUniqueAvailableTicketNumbers(totalTickets: number, existingNumbers: Set<string>, quantity: number): string[] {
    const availableNumbers: string[] = [];
    for (let i = 0; i < totalTickets; i++) {
        const numStr = i.toString().padStart(2, '0');
        if (!existingNumbers.has(numStr)) {
            availableNumbers.push(numStr);
        }
    }

    // Embaralha os disponíveis para aleatoriedade
    for (let i = availableNumbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableNumbers[i], availableNumbers[j]] = [availableNumbers[j], availableNumbers[i]];
    }

    return availableNumbers.slice(0, quantity);
  }

  // Atualizar getRafflesWithDetails e getRaffleByIdWithDetails para usar as novas funções
  async getRafflesWithDetails(filters: any = {}): Promise<any[]> {
    const where: any = {};
    // ... (lógica de filtros existente) ...
     if (filters.finished !== undefined) {
          where.finished = filters.finished === 'true' || filters.finished === true; // Tratar string/boolean
      }
      if (filters.type) {
          where.type = filters.type;
      }
      // Adicionar outros filtros conforme necessário

    const raffles = await this.raffleModel.findAll({
      include: [
        // Incluir os tickets com user E referrer para o calculatePrizeDetails (para rifas de equipes)
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email', 'referrerId'] }] },
        // Incluir o winnerUser COM referrer para o calculatePrizeDetails (para rifas tradicionais e equipe)
        { model: User, as: 'winnerUser', attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
        { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
      ],
      where,
      order: [['createdAt', 'DESC']], // Ou outra ordenação desejada
    });

    // Mapear para o formato de resposta detalhado
    return raffles.map((raffle) => this.formatRaffleDetails(raffle));
  }

  async getRaffleByIdWithDetails(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      include: [
         // Incluir os tickets com user E referrer para o calculatePrizeDetails (para rifas de equipes)
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email', 'referrerId'] }] },
        // Incluir o winnerUser COM referrer para o calculatePrizeDetails (para rifas tradicionais e equipe)
        { model: User, as: 'winnerUser', attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
        { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
      ],
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    // Formatar para a resposta detalhada
    return this.formatRaffleDetails(raffle);
  }

  // Função centralizada para formatar detalhes da rifa
  public formatRaffleDetails(raffle: Raffle): any {
    // Ensure raffle has necessary relations loaded for calculatePrizeDetails and other formatting
    // If this method is called with a raffle instance that doesn't have, e.g., `tickets` included,
    // those parts will be empty, but the method structure supports it.
    const formattedTickets = this.formatRaffleTickets(raffle); // Formata os tickets 1-100
    const winningTicketInfo = this.formatWinningTicketInfo(raffle); // Formata info do bilhete vencedor 1-100
    // Passar a instância 'raffle' diretamente para calculatePrizeDetails
    const prizeDetails = this.calculatePrizeDetails(raffle); // Calcula detalhes do prêmio
    const expectedDrawTime = this.calculateExpectedDrawTime(raffle); // Calcula horário esperado

    let winningTeamDetails: { teamName: string; tickets: string[]; members: { id: number; name: string; tickets: string[] }[] } | null = null;
    if (raffle.type === 'equipes' && raffle.finished && winningTicketInfo?.ticketNumber) { // prizeDetails?.winningTeamName já pode ser usado aqui
        // getFormattedTeams precisa dos tickets com User e Referrer (assumindo que raffle já os incluiu)
        const formattedTeams = this.getFormattedTeams(raffle); // Pega times formatados internos 00-99

        // Mapeia a equipe vencedora para formatar seus tickets e membros para 1-100
        const winningTeamName = this.getTeamNameByTicketNumber(raffle, raffle.winningTicket); // Usa o bilhete vencedor interno
        const winningTeamInternalData = formattedTeams[winningTeamName]; // Dados internos da equipe vencedora

        if (winningTeamInternalData) {
             winningTeamDetails = {
                 teamName: winningTeamName,
                 tickets: winningTeamInternalData.tickets.map(this.formatTicketNumberDisplay), // Formata tickets do time para 1-100
                 members: winningTeamInternalData.members.map(member => ({ // Formata tickets dos membros para 1-100
                     id: member.id,
                     name: member.name,
                     tickets: member.tickets.map(this.formatTicketNumberDisplay),
                 })),
             };
        } else {
            winningTeamDetails = {
                 teamName: winningTeamName ?? "N/A", // Fallback
                 tickets: [], members: []
            };
        }
    }

    // Se finalizado, tentar obter o indicador do ganhador principal para mostrar
    let winnerReferrerInfo: { id: number; name: string; } | null = null; // Corrigida a tipagem
     if (raffle.finished && raffle.winnerUser?.referrerId) {
         winnerReferrerInfo = {
             id: raffle.winnerUser.referrerId,
             name: raffle.winnerUser.referrer?.name || 'Usuário Desconhecido', // Use o nome da relação se disponível
         };
     }


    return {
      id: raffle.id,
      raffleIdentifier: raffle.raffleIdentifier,
      type: raffle.type,
      // Incluir dados do vencedor, incluindo o indicador se houver
      winner: raffle.winnerUser ? {
           id: raffle.winnerUser.id,
           name: raffle.winnerUser.name,
           // email: raffle.winnerUser.email, // Opcional
           referrer: winnerReferrerInfo, // Informação do indicador do vencedor
      } : null,
      title: raffle.title,
      description: raffle.description,
      ticketPrice: raffle.ticketPrice, // Manter número
      totalTickets: raffle.totalTickets,
      soldTickets: raffle.soldTickets,
      startDate: raffle.startDate,
      endDate: raffle.endDate,
      drawDate: raffle.drawDate, // Data real do sorteio (quando ocorreu)
      expectedDrawTime: expectedDrawTime, // Data/hora esperada
      finished: raffle.finished,
      winningTicket: winningTicketInfo, // Objeto com detalhes e número formatado 1-100
      prizeDetails: prizeDetails, // Objeto com detalhes do prêmio (já inclui comissão)
      winningTeamDetails: winningTeamDetails, // Detalhes da equipe vencedora (para rifa de equipes)
      // tickets: formattedTickets, // Opcional: incluir lista completa de tickets aqui? Pode ser grande. Melhor endpoint separado.
      createdAt: raffle.createdAt,
      updatedAt: raffle.updatedAt,
      // Adicionar mais campos se necessário
    };
  }


  private formatWinningTicketInfo(raffle: Raffle): any {
    if (!raffle.finished || !raffle.winningTicket) { // Verifica se finalizou E tem winningTicket
      return null;
    }
    // winningTicket está armazenado como 00-99
    const displayTicketNumber = this.formatTicketNumberDisplay(raffle.winningTicket);

    // Tenta buscar info do número gerado associado
    const raffleNumber = raffle.raffleNumbers?.[0];
    const generatedNumber = raffleNumber?.generatedNumber;
    const seed = generatedNumber?.seed;
    const blockchainHash = seed?.blockchainHash;

    return {
      ticketNumber: displayTicketNumber, // Número formatado 1-100
      internalTicketNumber: raffle.winningTicket, // Número interno 00-99 (para referência/debug)
      generatedNumberId: generatedNumber?.id,
      generatedNumberValue: generatedNumber?.number?.toString(), // Valor completo gerado
      sequence: generatedNumber?.sequence,
      seedId: seed?.id,
      // seedValue: seed?.seed, // Opcional: Expor seed? Talvez não seja seguro.
      hashId: blockchainHash?.id,
      hashValue: blockchainHash?.hash,
      hashTimestamp: blockchainHash?.timestamp,
    };
  }

  // Função para formatar a lista de tickets (usada no novo endpoint e talvez internamente)
  public formatRaffleTickets(raffle: Raffle): any[] {
    // getFormattedTeams precisa dos tickets com User e Referrer (assumindo que raffle já os incluiu)
    if (!raffle.tickets) {
      return [];
    }

    const formattedTeamsData = raffle.type === 'equipes' ? this.getFormattedTeams(raffle) : null;

    return raffle.tickets.map(ticket => {
      const displayTicketNumber = this.formatTicketNumberDisplay(ticket.ticketNumber); // Formata 00-99 para 1-100
      let teamInfo: { teamName: string } | null = null;

      if (formattedTeamsData) {
          const teamName = this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber);
          const team = formattedTeamsData[teamName];
           if (team) {
              teamInfo = {
                 teamName: team.teamName,
                 // Não incluir a lista completa de tickets e membros aqui para evitar redundância massiva
              };
           }
      }

      return {
        id: ticket.id,
        ticketNumber: displayTicketNumber, // Exibe 1-100
        internalTicketNumber: ticket.ticketNumber, // Mantém 00-99 internamente se precisar
        user: ticket.user ? {
          id: ticket.user.id,
          name: ticket.user.name,
          // email: ticket.user.email // Opcional: expor email?
          // referrerId: ticket.user.referrerId // Opcional: expor referrerId no ticket?
        } : null,
        team: teamInfo, // Adiciona info da equipe se aplicável
        purchaseDate: ticket.createdAt, // Data da compra do bilhete
      };
    });
  }

  // NOVO MÉTODO para buscar tickets de uma rifa
  async getRaffleTickets(raffleId: number): Promise<any[]> {
      this.logger.log(`Buscando tickets para a rifa ${raffleId}...`);
      const raffle = await this.raffleModel.findByPk(raffleId, {
          include: [
              {
                  model: RaffleTicket,
                  as: 'tickets',
                  include: [
                      {
                          model: User,
                          attributes: ['id', 'name'], // Buscar apenas ID e nome do usuário
                      },
                  ],
                  order: [['createdAt', 'ASC']], // Ordenar por data de compra, por exemplo
              },
          ],
      });

      if (!raffle) {
          throw new NotFoundException(`Rifa com ID ${raffleId} não encontrada.`);
      }

      // Usa a função de formatação padronizada
      return this.formatRaffleTickets(raffle);
  }

  async finalizeRaffle(raffleId: number, transactionHost?: Transaction): Promise<Raffle> {
    const transaction = transactionHost || await this.sequelize.transaction(); // Usa transação existente ou cria uma nova
    let raffle; // Declare raffle outside try to ensure access in catch

    try {
      // Step 1: Find and lock the Raffle row
      // Include winning ticket user with referrer info for prize distribution logic AND for reload/return value
       raffle = await this.raffleModel.findByPk(raffleId, {
         transaction,
         lock: transaction.LOCK.UPDATE,
         include: [{ model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] }],
       });


      if (!raffle) {
        if (!transactionHost) await transaction.rollback();
        throw new NotFoundException('Rifa tradicional não encontrada.');
      }
      if (raffle.finished) {
        this.logger.warn(`Tentativa de finalizar rifa tradicional ${raffleId} que já está finalizada.`);
        if (!transactionHost) await transaction.commit();
        // Reload with necessary relations before returning (already included in the initial fetch)
        // await raffle.reload({ ... }); // Not needed if already included
        return raffle;
      }
      if (raffle.type !== 'tradicional') {
         if (!transactionHost) await transaction.rollback();
         throw new BadRequestException(`A Rifa ${raffleId} é do tipo ${raffle.type} e não pode ser finalizada por este método.`);
      }

      const now = new Date();
      const isSoldOut = raffle.soldTickets >= raffle.totalTickets;
      const isEndDateReached = raffle.endDate && raffle.endDate <= now;

      if (!isSoldOut && !isEndDateReached) {
        if (!transactionHost) await transaction.rollback();
        throw new BadRequestException(
          `A rifa tradicional ${raffleId} ainda não pode ser finalizada. Bilhetes vendidos: ${raffle.soldTickets}/${raffle.totalTickets}. Data de fim: ${raffle.endDate?.toISOString() ?? 'N/A'}.`
        );
      }

      const winningTicketNumberInternal = raffle.winningTicket;
      if (!winningTicketNumberInternal) {
           if (!transactionHost) await transaction.rollback();
          throw new InternalServerErrorException(`Rifa tradicional ${raffleId} não possui um bilhete sorteado definido.`);
      }
      this.logger.log(`Finalizando Rifa Tradicional ${raffleId}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}`);

      // Find the winning ticket from the already included tickets
      const winningTicket = raffle.tickets?.find(t => t.ticketNumber === winningTicketNumberInternal);

      let winnerUserId: number | null = null;
      let totalPrizeAmount = 0; // O pool total de prêmio para o ganhador (85% do coletado)
      let mainWinnerReferrerActive = false; // Track referrer activity status

      const totalCollectedValue = raffle.ticketPrice * raffle.soldTickets;
      totalPrizeAmount = totalCollectedValue * 0.85; // 85% do valor REALMENTE coletado

      if (winningTicket && winningTicket.user) {
        const winnerUser = winningTicket.user; // User model fetched with referrerId
        winnerUserId = winnerUser.id;
        this.logger.log(`Bilhete ${winningTicketNumberInternal} (usuário ${winnerUserId} - ${winnerUser.name}) é o vencedor.`);

        let winnerNetPrize = totalPrizeAmount; // Assume que ganha tudo inicialmente (antes da comissão)
        let referrerCommission = 0;

        // Check if winner has a referrer and award commission
        if (winnerUser.referrerId) {
             this.logger.log(`Usuário ${winnerUserId} (ganhador) foi indicado por ${winnerUser.referrerId}.`);
             const referrerUser = await this.authService.findReferrerById(winnerUser.id, transaction); // Buscar indicador na transação

            if (referrerUser) {
                // Check if the referrer played any game this month
                mainWinnerReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);

                if (mainWinnerReferrerActive) {
                    // Calcular 5% do prêmio TOTAL (85%) para o indicador
                    referrerCommission = totalPrizeAmount * 0.05;
                    // O ganhador recebe os 95% restantes do prêmio TOTAL (85%)
                    winnerNetPrize = totalPrizeAmount * 0.95;

                    // Creditar comissão ao indicador
                     this.logger.log(`Indicador ${referrerUser.id} está ativo. Creditando comissão de indicação de R$ ${referrerCommission.toFixed(2)}.`);
                    await this.authService.updateUserBalance(referrerUser.id, referrerCommission, transaction);

                } else {
                     this.logger.log(`Indicador ${referrerUser.id} NÃO está ativo este mês. Comissão de R$ ${totalPrizeAmount * 0.05} NÃO creditada e vai para a Casa.`);
                     // Comissão não é creditada ao indicador, fica implicitamente na Casa. Ganhador recebe o prêmio total.
                     winnerNetPrize = totalPrizeAmount;
                     referrerCommission = 0; // Comissão não creditada é 0
                }

            } else {
                 this.logger.warn(`Indicador (ID ${winnerUser.referrerId}) do usuário ganhador ${winnerUserId} não encontrado. Comissão não aplicável/creditada.`);
                 // Se o indicador não for encontrado, o ganhador recebe o prêmio total
                 winnerNetPrize = totalPrizeAmount;
                 referrerCommission = 0;
                 mainWinnerReferrerActive = false; // Não há indicador válido
            }
        } else {
             this.logger.log(`Usuário ${winnerUserId} (ganhador) não foi indicado. Sem comissão para indicador.`);
             // Ganhador não tem indicador
             winnerNetPrize = totalPrizeAmount;
             referrerCommission = 0;
             mainWinnerReferrerActive = false; // Não há indicador
        }

        // Creditar prêmio líquido ao ganhador
         this.logger.log(`Creditando prêmio líquido de R$ ${winnerNetPrize.toFixed(2)} para o ganhador ${winnerUserId}.`);
        await this.authService.updateUserBalance(winnerUser.id, winnerNetPrize, transaction);

      } else {
        this.logger.log(`Nenhum bilhete vendido corresponde ao número sorteado ${winningTicketNumberInternal}. Prêmio (R$ ${totalPrizeAmount.toFixed(2)}) não distribuído aos jogadores/indicadores.`);
        winnerUserId = null; // Explicitamente nulo se ninguém comprou o bilhete
        mainWinnerReferrerActive = false; // Ninguém ganhou, sem indicador ativo relevante
      }

      // Step 3: Update the raffle status
      await raffle.update({
        finished: true,
        drawDate: now,
        winnerUserId: winnerUserId,
      }, { transaction });

      // Step 4: Commit transaction if it's local
      if (!transactionHost) await transaction.commit();

      this.logger.log(`Rifa Tradicional ${raffleId} finalizada com sucesso.`);

      // Step 5: Reload to get updated relations and attach details for formatRaffleDetails
      // Need winnerUser with referrer and tickets with users+referrer for formatRaffleDetails
       await raffle.reload({
            include: [
                { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'] }] }
            ],
            transaction // Use transaction for reload if it's still active (though likely committed here)
        });
        // Attach the calculated active status for formatRaffleDetails
        (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive;


      return raffle;

    } catch (error) {
       // Ensure rollback if transaction was local and error occurred
       // Check if transaction exists AND is not completed ('commit' or 'rollback')
       if (!transactionHost && transaction && (transaction as any).finished === null) { // Use (transaction as any).finished
            try {
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação da rifa tradicional ${raffleId} devido a erro.`);
            } catch (rollbackError: any) {
                 if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para rifa tradicional ${raffleId}: ${rollbackError}`);
                 }
            }
       }
      // Re-throw specific errors or log and throw generic
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException || error instanceof InternalServerErrorException) {
        throw error;
      }
       // Re-throw specific error from updateUserBalance
       if (error instanceof Error && ((error as any).isHandled)) { // Check for the .isHandled flag
           this.logger.error(`Erro esperado durante finalização da rifa ${raffleId}: ${error.message}`);
           // Converter para InternalServerError se não for um BadRequest que já foi lançado
           if (!(error instanceof BadRequestException)) {
                 throw new InternalServerErrorException(`Erro na operação de saldo durante a finalização da rifa ${raffleId}: ${error.message}`);
           }
            throw error; // Re-throw BadRequest
       }


      this.logger.error(`Erro inesperado ao finalizar a rifa tradicional ${raffleId}: ${(error as any).message}`, (error as any).stack);
      throw new InternalServerErrorException('Erro interno ao finalizar a rifa tradicional.');
    }
  }





  @Cron('*/5 * * * *') // Roda a cada 5 minutos para verificar rifas a finalizar
  async finalizeRafflesCronJob() {
      const now = new Date();
      this.logger.log(`CRON [${now.toISOString()}]: Verificando rifas para finalizar...`);

      // Buscar rifas que estão prontas para finalizar (esgotadas ou data de fim atingida)
      // e que AINDA NÃO ESTÃO FINALIZADAS.
      const rafflesToFinalize = await this.raffleModel.findAll({
          where: {
              finished: false,
              [Op.or]: [
                  { soldTickets: { [Op.gte]: Sequelize.col('totalTickets') } }, // Esgotadas (vendidos >= total)
                  { endDate: { [Op.lte]: now } } // Data de fim atingida (fim <= agora)
              ]
          },
           // Não usar lock aqui na busca inicial, pois a finalização individual terá sua própria transação e lock
           // lock: true, // Tenta bloquear as linhas encontradas
           // skipLocked: true // Pula as que já estão bloqueadas por outra instância/processo
           // Ordering might help process oldest first or newest first
           order: [['endDate', 'ASC'], ['createdAt', 'ASC']] // Prioriza as que venceram primeiro, depois as mais antigas
      });

      if (rafflesToFinalize.length === 0) {
          this.logger.log('CRON: Nenhuma rifa encontrada para finalizar nesta execução.');
          return;
      }

      this.logger.log(`CRON: Encontradas ${rafflesToFinalize.length} rifas para processar finalização.`);

      // Processar cada rifa individualmente em sua própria transação
      for (const raffle of rafflesToFinalize) {
          this.logger.log(`CRON: Iniciando processamento para Rifa ID: ${raffle.id}, Tipo: ${raffle.type}, Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}, EndDate: ${raffle.endDate?.toISOString()}`);
          // A finalização da rifa já gerencia sua própria transação e lock
          try {
              if (raffle.type === 'tradicional') {
                  // Passa undefined para transactionHost, indicando que o método deve criar a sua
                  await this.finalizeRaffle(raffle.id, undefined);
              } else if (raffle.type === 'equipes') {
                   // Passa undefined para transactionHost, indicando que o método deve criar a sua
                  await this.finalizeTeamRaffle(raffle.id, undefined);
              }
              this.logger.log(`CRON: Rifa ${raffle.id} finalizada com sucesso.`);
          } catch (error) {
              // Captura erros individuais para não parar o cron job inteiro
              this.logger.error(`CRON: Erro ao finalizar rifa ${raffle.id}: ${(error as any).message}`);
               // Logar stack para erros inesperados
               if (!(error instanceof BadRequestException || error instanceof NotFoundException || ((error as any).isHandled))) { // Não logar stack para erros "tratados" como saldo insuficiente ou usuário não encontrado em transação
                   this.logger.error(`CRON: Stacktrace para Rifa ${raffle.id}: ${(error as any).stack}`);
               }
          }
      }
      this.logger.log('CRON: Processamento de finalização de rifas concluído.');
  }


  async getRaffleTeams(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      attributes: ['id', 'type', 'totalTickets'], // Campos básicos da rifa
      include: [
        {
          model: RaffleTicket,
          attributes: ['ticketNumber', 'userId'], // Bilhetes comprados
          include: [
            { model: User, attributes: ['id', 'name'] }, // Dono do bilhete
          ],
        },
      ],
    });

    if (!raffle) throw new NotFoundException('Rifa não encontrada.');
    if (raffle.type !== 'equipes') throw new BadRequestException('Esta rota é válida apenas para rifas de equipes.');

    const formattedTeams = this.getFormattedTeams(raffle);

    // Formatar números de tickets para exibição 1-100 dentro da estrutura
    Object.values(formattedTeams).forEach((team: any) => {
        team.tickets = team.tickets.map(this.formatTicketNumberDisplay);
        team.members.forEach((member: any) => {
             member.tickets = member.tickets.map(this.formatTicketNumberDisplay);
        });
    });


    return formattedTeams;
  }


  async getRafflesPlayedByUser(userId: number): Promise<any[]> { // Alterado retorno para any[]
    // Buscar as rifas onde o usuário comprou pelo menos um ticket
    const raffles = await this.raffleModel.findAll({
        include: [
            {
                model: RaffleTicket,
                as: 'tickets', // Precisa incluir TODOS os tickets para a rifa de equipe e calculatePrizeDetails
                // Sem 'where' nesta inclusão para ter todos os tickets da rifa
                required: true, // Garante que só venham rifas que o usuário jogou (pelo filtro abaixo)
                 // Incluir User e Referrer para poder usar formatRaffleDetails e calculatePrizeDetails
                include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] // Incluir Referrer aqui
            },
            // Incluir winnerUser e Referrer para formatRaffleDetails
            { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
             // Incluir RaffleNumber, GeneratedNumber, Seed, BlockchainHash para formatWinningTicketInfo
            { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
            { model: User, as: 'createdByUser', attributes: ['id', 'name']} // Quem criou (se aplicável)
        ],
        where: Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`), // Filtra no WHERE principal
        order: [['createdAt', 'DESC']] // Ordena as rifas
    });

    // Mapeia e formata os detalhes de cada rifa jogada
    return raffles.map(raffle => {
         const details = this.formatRaffleDetails(raffle);
         // Adiciona os tickets específicos do usuário a esta rifa formatada
         details.userTickets = this.formatRaffleTickets(raffle) // Formata TODOS os tickets da rifa
                               .filter(ticket => ticket.user?.id === userId); // Filtra apenas os do usuário logado
         return details;
     });
  }

  async getWonRafflesByUser(userId: number): Promise<any[]> { // Alterado retorno para any[]
    // Buscar *todas* as rifas finalizadas onde o usuário participou
       const raffles = await this.raffleModel.findAll({
           where: {
               finished: true, // Apenas rifas finalizadas
                [Op.and]: [ // Garante que o usuário participou
                    Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`)
                ]
           },
           include: [
               // Incluir TODOS os tickets da rifa com User e Referrer, necessário para determinar ganhadores da equipe e filtrar quem GANHOU
                { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'] }] },
               // Incluir winnerUser e Referrer para formatRaffleDetails
               { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
               // Incluir RaffleNumber, GeneratedNumber, Seed, BlockchainHash para formatWinningTicketInfo
               { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
           ],
           order: [['drawDate', 'DESC']], // Ordenar pelas mais recentes ganhas/finalizadas
       });

     // Agora, filtrar as rifas onde o usuário *realmente* ganhou
     const wonRaffles = raffles.filter(raffle => {
         if (raffle.winnerUserId === userId) {
             return true; // Ele ganhou o prêmio principal
         }
         if (raffle.type === 'equipes' && raffle.finished) {
             // Verificar se ele estava na equipe vencedora E comprou um bilhete nela (e não era o ganhador principal, já tratado acima)
             const winningTicketNumberInternal = raffle.winningTicket;
              if (!winningTicketNumberInternal) return false; // Não tem bilhete vencedor definido

             const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal);

             if (winningTeamName && winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
                 // Buscar tickets do usuário nesta rifa
                 const userTicketsInThisRaffle = raffle.tickets?.filter(ticket => ticket.userId === userId) || [];

                 // Verificar se algum ticket do usuário pertence à equipe vencedora
                 return userTicketsInThisRaffle.some(ticket =>
                     this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                     ticket.userId !== raffle.winnerUserId // Garante que não é o ganhador principal
                 );
             }
         }
         return false; // Não ganhou nesta rifa
     });

     // Formata cada rifa ganha usando a função detalhada
     return wonRaffles.map(raffle => this.formatRaffleDetails(raffle));
  }
  async getLostRafflesByUser(userId: number): Promise<any[]> { // Alterado retorno para any[]
    // Buscar *todas* as rifas finalizadas onde o usuário participou
     const raffles = await this.raffleModel.findAll({
         where: {
             finished: true, // Apenas rifas finalizadas
              [Op.and]: [ // Garante que o usuário participou
                  Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`)
              ]
         },
         include: [
             // Incluir TODOS os tickets da rifa com User e Referrer, necessário para determinar ganhadores da equipe e filtrar quem PERDEU
              { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'] }] },
             // Incluir winnerUser e Referrer para formatRaffleDetails
             { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
             // Incluir RaffleNumber, GeneratedNumber, Seed, BlockchainHash para formatWinningTicketInfo
             { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
         ],
         order: [['drawDate', 'DESC']], // Ordenar pelas mais recentes perdidas/finalizadas
     });

      // Agora, filtrar as rifas onde o usuário *realmente* PERDEU
     const lostRaffles = raffles.filter(raffle => {
         // Ele perdeu se ele participou (já garantido pelo WHERE) E ele NÃO ganhou
         // A lógica de "ele não ganhou" é o oposto da lógica em getWonRafflesByUser

         if (raffle.winnerUserId === userId) {
             return false; // Ele ganhou o prêmio principal, então não perdeu
         }
          if (raffle.type === 'equipes' && raffle.finished) {
              // Verificar se ele estava na equipe vencedora E comprou um bilhete nela (e não era o ganhador principal)
              const winningTicketNumberInternal = raffle.winningTicket;
               if (!winningTicketNumberInternal) return true; // Se não tem bilhete vencedor, ninguém ganhou (ele perdeu)

              const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal);

               if (winningTeamName && winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
                  // Buscar tickets do usuário nesta rifa
                  const userTicketsInThisRaffle = raffle.tickets?.filter(ticket => ticket.userId === userId) || [];

                  // Verificar se algum ticket do usuário pertence à equipe vencedora (excluindo o ganhador principal)
                  const wonTeamPrize = userTicketsInThisRaffle.some(ticket =>
                      this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                      ticket.userId !== raffle.winnerUserId // Garante que não é o ganhador principal
                  );

                  if (wonTeamPrize) {
                       return false; // Ele ganhou prêmio na equipe, então não perdeu totalmente
                  }
               }
          }
         // Se não ganhou prêmio principal E não ganhou prêmio na equipe, então perdeu
         return true;
     });

    // Formata cada rifa perdida usando a função detalhada
    return lostRaffles.map(raffle => this.formatRaffleDetails(raffle));
}

async getUserRaffleData(userId: number): Promise<any> {
  const user = await this.userModel.findByPk(userId, {
    attributes: ['id', 'name', 'email', 'cpf', 'phone', 'balance'], // Dados do usuário
  });

  if (!user) {
    throw new NotFoundException('Usuário não encontrado.');
  }

  // Busca todas as rifas que o usuário participou
  const playedRaffles = await this.raffleModel.findAll({
      include: [
          {
              model: RaffleTicket,
              as: 'tickets', // Incluir TODOS os tickets para a lógica de equipe e detalhes do prêmio
              // Sem 'where' nesta inclusão para ter todos os tickets da rifa
              required: true, // Garante que só venham rifas que ele jogou (pelo filtro abaixo)
              // Incluir User e Referrer para poder usar formatRaffleDetails e calculatePrizeDetails
              include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] // Incluir Referrer aqui
          },
          // Incluir winnerUser e Referrer para formatRaffleDetails
          { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
           // Incluir RaffleNumber, GeneratedNumber, Seed, BlockchainHash para formatWinningTicketInfo
          { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
          { model: User, as: 'createdByUser', attributes: ['id', 'name']} // Quem criou (se aplicável)
      ],
      where: Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`), // Filtra no WHERE principal
      order: [['createdAt', 'DESC']] // Ordena as rifas
  });

  // Mapeia e formata os detalhes de cada rifa jogada
  return Raffle.map(raffle => {
       const details = this.formatRaffleDetails(raffle);
       // Adiciona os tickets específicos do usuário a esta rifa formatada
       details.userTickets = this.formatRaffleTickets(raffle) // Formata TODOS os tickets da rifa
                             .filter(ticket => ticket.user?.id === userId); // Filtra apenas os do usuário logado
       return details;
   });
}

async createTeamRaffle(ticketPrice: number): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({ order: [['timestamp', 'DESC']] });
    if (!latestHash) throw new NotFoundException('Nenhuma hash de blockchain encontrada.');

    // Busca a seed e o generatedNumber MAIS RECENTE associado à hash
    const correspondingSeed = await this.seedModel.findOne({
        where: { hashId: latestHash.id },
        include: [
            {
                model: GeneratedNumber,
                // Busca o número que AINDA NÃO FOI USADO (isUsed = false)
                 where: { isUsed: false },
                 order: [['createdAt', 'ASC']], // Pega o mais antigo NÃO usado
                 limit: 1,
            },
        ],
        order: [['createdAt', 'DESC']],
    });
    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
        throw new NotFoundException(`Nenhuma seed/generatedNumber NÃO USADO encontrado para a hash ${latestHash.id}. Execute a geração de números.`);
    }

    const generatedNumberToUse = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(generatedNumberToUse.number) % 100n;
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0'); // 00-99

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7); // 7 dias para finalizar, por exemplo

    const newRaffle = await this.raffleModel.create({
        raffleIdentifier: `RL-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`, // ID mais único e curto (RL = Rifa Loto Seleções)
        type: 'equipes', // Define o tipo
        title: `Rifa de Equipes - Loto Seleções - R$ ${ticketPrice.toFixed(2)}`, // Nome Fantasia
        description: `Rifa Loto Seleções gerada automaticamente. Prêmio: 50% do total arrecadado para o bilhete exato sorteado, 30% para os membros da equipe do bilhete sorteado. Comissão de 5% do prêmio ganho para o indicador de CADA ganhador APENAS se o indicador estiver ativo no mês. 20% para a Casa (inclui comissões não creditadas). Baseado na hash ${latestHash.hash}`,
        ticketPrice: ticketPrice,
        totalTickets: 100, // 00-99
        soldTickets: 0,
        startDate: startDate,
        endDate: endDate, // Data de fim
        finished: false,
        winningTicket: winningTicketNumber, // Armazena 00-99
        drawDate: null,
    });

     // Associa o número gerado à rifa E MARCA COMO USADO
     await this.generatedNumberModel.update(
         { isUsed: true },
         { where: { id: generatedNumberToUse.id } }
     );

    await this.raffleNumberModel.create({
        raffleId: newRaffle.id,
        numberId: generatedNumberToUse.id,
    });

    this.logger.log(
        `Rifa de Equipes ${newRaffle.raffleIdentifier} (ID ${newRaffle.id}) criada usando GeneratedNumber ID ${generatedNumberToUse.id}. Preço: R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );
    return newRaffle;
  }

  private getTeamNameByTicketNumber(raffle: Raffle, ticketNumber: string): string {
    if (!ticketNumber || raffle.type !== 'equipes') return 'N/A'; // Ajuste para retornar N/A
    try {
        const ticketNumberInt = parseInt(ticketNumber, 10); // ticketNumber é 00-99
        if (isNaN(ticketNumberInt) || ticketNumberInt < 0 || ticketNumberInt >= raffle.totalTickets) {
            return 'Inválido';
        }
        const teamIndex = Math.floor(ticketNumberInt / 4); // 0-24 para 100 tickets
        return this.teamNames[teamIndex] || 'Desconhecido'; // Retorna nome ou 'Desconhecido'
     } catch (e) {
         return 'Erro';
     }
  }

  private getFormattedTeams(raffle: Raffle): any {
    if (raffle.type !== 'equipes' || !raffle.tickets) return {}; // Retorna objeto vazio se não for de equipes ou não tiver tickets

    const totalTickets = raffle.totalTickets; // Geralmente 100
    const ticketsPerTeam = 4; // Fixo em 4
    const totalTeams = Math.min(this.teamNames.length, Math.floor(totalTickets / ticketsPerTeam)); // Usa o menor entre nomes disponíveis e times possíveis
    const teams: { [key: string]: { teamName: string; tickets: string[]; members: { id: number; name: string; tickets: string[] }[] } } = {}; // Tipagem mais clara

    // Indexa os tickets comprados por número interno
    const ticketsMap = new Map<string, RaffleTicket>(raffle.tickets.map(t => [t.ticketNumber, t]));

    for (let i = 0; i < totalTeams; i++) {
      const teamName = this.teamNames[i];
      const teamTicketsInternal: string[] = []; // Armazena 00-99 internamente
      const membersMap = new Map<number, { id: number; name: string; tickets: string[] }>(); // Mapa de membros por ID

      for (let j = 0; j < ticketsPerTeam; j++) {
        const ticketNumberInternal = (i * ticketsPerTeam + j).toString().padStart(2, '0'); // 00-99
        teamTicketsInternal.push(ticketNumberInternal);

        const purchasedTicket = ticketsMap.get(ticketNumberInternal);
        if (purchasedTicket && purchasedTicket.user) {
          const userId = purchasedTicket.user.id;
          if (!membersMap.has(userId)) {
            membersMap.set(userId, {
              id: userId,
              name: purchasedTicket.user.name,
              tickets: [], // Armazenará números internos 00-99
            });
          }
          membersMap.get(userId)?.tickets.push(ticketNumberInternal);
        }
      }

      teams[teamName] = {
        teamName: teamName,
        tickets: teamTicketsInternal, // Lista de números internos 00-99 do time
        members: Array.from(membersMap.values()), // Lista de membros com seus tickets internos
      };
    }

    return teams;
  }

  getTeamNames() {
    return this.teamNames;
  }

    @Cron(CronExpression.EVERY_HOUR) // Roda junto com a criação de rifas tradicionais
    async createTeamRafflesCronJob() {
        // Esta lógica foi integrada em `createRafflesCronJob`
         // Este método pode ser removido ou mantido vazio se `createRafflesCronJob` já cobre
        // this.logger.log('CRON: createTeamRafflesCronJob chamado (lógica agora em createRafflesCronJob)');
    }

    async finalizeTeamRaffle(raffleId: number, transactionHost?: Transaction): Promise<Raffle> {
      const transaction = transactionHost || await this.sequelize.transaction();
      let raffle; // Declare raffle outside try

      try {
        // Step 1: Find and lock the Raffle row
        // Include ALL tickets with their users and referrer info for prize distribution logic AND for reload/return value
        raffle = await this.raffleModel.findByPk(raffleId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
          include: [{ model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] }],
        });


        if (!raffle) {
           if (!transactionHost) await transaction.rollback();
           throw new NotFoundException('Rifa de equipes não encontrada.');
        }
        if (raffle.finished) {
             this.logger.warn(`Tentativa de finalizar rifa de equipes ${raffleId} que já está finalizada.`);
             if (!transactionHost) await transaction.commit();
             // Reload before returning (already included in the initial fetch)
             // await raffle.reload({...}); // Not needed if already included
             return raffle;
        }
         if (raffle.type !== 'equipes') {
           if (!transactionHost) await transaction.rollback();
           throw new BadRequestException(`A Rifa ${raffleId} é do tipo ${raffle.type} e não pode ser finalizada por este método.`);
         }

        const now = new Date();
        const isSoldOut = raffle.soldTickets >= raffle.totalTickets;
        const isEndDateReached = raffle.endDate && raffle.endDate <= now;

        if (!isSoldOut && !isEndDateReached) {
             if (!transactionHost) await transaction.rollback(); // Rollback before throwing
           throw new BadRequestException(
             `A rifa de equipes ${raffleId} ainda não pode ser finalizada. Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}. Fim: ${raffle.endDate?.toISOString() ?? 'N/A'}.`
           );
        }

        const winningTicketNumberInternal = raffle.winningTicket;
         if (!winningTicketNumberInternal) {
              if (!transactionHost) await transaction.rollback(); // Rollback before throwing
             throw new InternalServerErrorException(`Rifa de equipes ${raffleId} não possui um bilhete sorteado definido.`);
         }
        this.logger.log(`Finalizando Rifa de Equipes ${raffleId}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}`);

        // Use the already included tickets
        const tickets = raffle.tickets || [];

        // --- Calculation and Distribution Logic ---
        const totalCollectedValue = raffle.ticketPrice * raffle.soldTickets;
        const actualMainPrizePool = totalCollectedValue * 0.50; // 50% do coletado para o pool principal
        const actualTeamPrizePool = totalCollectedValue * 0.30; // 30% do coletado para o pool da equipe
        // const houseShareBase = totalCollectedValue * 0.20; // 20% do coletado fica com a casa (base)


        let mainWinnerUserId: number | null = null;
        let mainWinnerNetPrize = 0;
        let mainWinnerReferrerCommission = 0;
        let mainWinnerReferrerActive = false; // Track referrer activity status for main winner

        let teamMembersTotalNetPrize = 0; // Total líquido pago aos membros da equipe (excluindo principal)
        let teamMembersReferrerCommissionTotal = 0; // Total de comissões pagas aos indicadores dos membros da equipe
        let teamMemberReferrerActiveStatuses: { userId: number, isActive: boolean }[] = []; // Track referrer activity status for each team member

        let numberOfWinningTeamMembersReceivingPrize = 0; // Contagem real de membros que ganharam no pool

        // 1. Processar Ganhador Principal (50%)
        const mainWinningTicket = tickets.find(t => t.ticketNumber === winningTicketNumberInternal);
        const mainWinnerUser = mainWinningTicket?.user; // User model fetched with referrerId

        if (mainWinnerUser) {
            mainWinnerUserId = mainWinnerUser.id;
            this.logger.log(`Prêmio Principal (50% = R$ ${actualMainPrizePool.toFixed(2)}) para usuário ${mainWinnerUserId} (${mainWinnerUser.name}) - Bilhete ${winningTicketNumberInternal}`);

            let winnerNetPrizeShare = actualMainPrizePool;
            let referrerCommissionShare = 0;

            // Check if main winner has a referrer and if referrer is active this month
            if (mainWinnerUser.referrerId) {
                 this.logger.log(`Ganhador Principal ${mainWinnerUserId} foi indicado por ${mainWinnerUser.referrerId}.`);
                 const referrerUser = await this.authService.findReferrerById(mainWinnerUser.id, transaction);

                 if (referrerUser) {
                    mainWinnerReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);

                    if (mainWinnerReferrerActive) {
                        referrerCommissionShare = actualMainPrizePool * 0.05; // 5% do prêmio principal
                        winnerNetPrizeShare = actualMainPrizePool * 0.95; // 95% do prêmio principal

                        // Creditar comissão ao indicador
                        this.logger.log(`Indicador ${referrerUser.id} (do Ganhador Principal) está ativo. Creditando comissão de indicação de R$ ${referrerCommissionShare.toFixed(2)}.`);
                        await this.authService.updateUserBalance(referrerUser.id, referrerCommissionShare, transaction);
                    } else {
                         this.logger.log(`Indicador ${referrerUser.id} (do Ganhador Principal) NÃO está ativo este mês. Comissão de R$ ${actualMainPrizePool * 0.05} NÃO creditada e vai para a Casa.`);
                         // Comissão não é creditada ao indicador, fica implicitamente na Casa. Ganhador recebe o prêmio total.
                         winnerNetPrizeShare = actualMainPrizePool;
                         referrerCommissionShare = 0; // Comissão não creditada é 0
                    }
                 } else {
                     this.logger.warn(`Indicador (ID ${mainWinnerUser.referrerId}) do Ganhador Principal ${mainWinnerUserId} não encontrado. Comissão não aplicável/creditada.`);
                     // Indicador não encontrado, ganhador recebe o prêmio total
                     winnerNetPrizeShare = actualMainPrizePool;
                     referrerCommissionShare = 0;
                     mainWinnerReferrerActive = false; // Não há indicador válido
                 }
            } else {
                 this.logger.log(`Ganhador Principal ${mainWinnerUserId} não foi indicado. Sem comissão para indicador.`);
                 // Ganhador não tem indicador
                 winnerNetPrizeShare = actualMainPrizePool;
                 referrerCommissionShare = 0;
                 mainWinnerReferrerActive = false; // Não há indicador
            }
            mainWinnerNetPrize = winnerNetPrizeShare;
            mainWinnerReferrerCommission = referrerCommissionShare;

            // Creditar prêmio líquido ao ganhador principal
            this.logger.log(`Creditando prêmio líquido de R$ ${mainWinnerNetPrize.toFixed(2)} para o Ganhador Principal ${mainWinnerUserId}.`);
            await this.authService.updateUserBalance(mainWinnerUser.id, mainWinnerNetPrize, transaction);
        } else {
           this.logger.log(`Ninguém comprou o bilhete principal ${winningTicketNumberInternal}. Prêmio principal (R$ ${actualMainPrizePool.toFixed(2)}) não distribuído.`);
           // mainWinnerUserId remains null
            mainWinnerReferrerActive = false; // Ninguém ganhou principal
        }


        // 2. Processar Pool da Equipe (30%)
        const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal);

        if (winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
            // Filter from the fetched 'tickets' array, exclude the main winner
            const winningTeamTickets = tickets.filter(
                (ticket) => this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                            (mainWinnerUser ? ticket.userId !== mainWinnerUser.id : true) // Excluir o ganhador principal pelo ID se ele existe
            );

            const teamMemberUsersWhoBought = new Map<number, User>(); // Map UserID -> User model (with referrerId)
            winningTeamTickets.forEach(ticket => {
                if (ticket.user) { // Ensure ticket has a user
                     // Usar apenas o primeiro ticket encontrado por usuário para pegar a instância de usuário
                    if (!teamMemberUsersWhoBought.has(ticket.user.id)) {
                         teamMemberUsersWhoBought.set(ticket.user.id, ticket.user);
                    }
                }
            });

            numberOfWinningTeamMembersReceivingPrize = teamMemberUsersWhoBought.size;

            if (numberOfWinningTeamMembersReceivingPrize > 0) {
                const individualTeamPrizeShare = actualTeamPrizePool / numberOfWinningTeamMembersReceivingPrize;
                this.logger.log(`Equipe Vencedora ${winningTeamName}: ${numberOfWinningTeamMembersReceivingPrize} membro(s) elegível(is) para o prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}). Parte base individual: R$ ${individualTeamPrizeShare.toFixed(2)}.`);

                for (const user of teamMemberUsersWhoBought.values()) {
                    let memberNetPrizeShare = individualTeamPrizeShare;
                    let memberReferrerCommissionShare = 0;
                    let memberReferrerActive = false; // Track referrer activity status for this member

                    // Check if this team member has a referrer and if referrer is active this month
                    if (user.referrerId) {
                         this.logger.log(`Membro da equipe vencedora ${user.id} foi indicado por ${user.referrerId}.`);
                         const referrerUser = await this.authService.findReferrerById(user.id, transaction);

                         if (referrerUser) {
                              memberReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);

                             const potentialMemberReferrerCommission = individualTeamPrizeShare * 0.05;
                             const potentialMemberNetPrize = individualTeamPrizeShare * 0.95;


                             if (memberReferrerActive) {
                                 memberReferrerCommissionShare = potentialMemberReferrerCommission;
                                 memberNetPrizeShare = potentialMemberNetPrize;

                                // Creditar comissão ao indicador
                                 this.logger.log(`Indicador ${referrerUser.id} (do membro ${user.id}) está ativo. Creditando comissão de indicação de R$ ${memberReferrerCommissionShare.toFixed(2)}.`);
                                await this.authService.updateUserBalance(referrerUser.id, memberReferrerCommissionShare, transaction);
                             } else {
                                this.logger.log(`Indicador ${referrerUser.id} (do membro ${user.id}) NÃO está ativo este mês. Comissão de R$ ${individualTeamPrizeShare * 0.05} NÃO creditada e vai para a Casa.`);
                                // Comissão não é creditada, fica na Casa. Membro recebe a parte total.
                                memberNetPrizeShare = individualTeamPrizeShare;
                                memberReferrerCommissionShare = 0; // Comissão não creditada é 0
                             }
                         } else {
                            this.logger.warn(`Indicador (ID ${user.referrerId}) do membro da equipe ${user.id} não encontrado. Comissão não aplicável/creditada.`);
                             // Indicador não encontrado, membro recebe a parte total
                            memberNetPrizeShare = individualTeamPrizeShare;
                            memberReferrerCommissionShare = 0;
                            memberReferrerActive = false; // Não há indicador válido
                         }
                    } else {
                         this.logger.log(`Membro da equipe ${user.id} não foi indicado. Sem comissão para indicador.`);
                         // Membro não tem indicador
                         memberNetPrizeShare = individualTeamPrizeShare;
                         memberReferrerCommissionShare = 0;
                         memberReferrerActive = false; // Não há indicador
                    }

                    teamMembersTotalNetPrize += memberNetPrizeShare;
                    teamMembersReferrerCommissionTotal += memberReferrerCommissionShare;
                     // Store the active status for calculatePrizeDetails formatting
                     teamMemberReferrerActiveStatuses.push({ userId: user.id, isActive: memberReferrerActive });

                    // Creditar prêmio líquido ao membro da equipe
                    this.logger.log(`Creditando prêmio líquido de R$ ${memberNetPrizeShare.toFixed(2)} para o membro da equipe ${user.id}.`);
                    await this.authService.updateUserBalance(user.id, memberNetPrizeShare, transaction);
                }
            } else {
                this.logger.log(`Equipe Vencedora ${winningTeamName}: Nenhum outro membro (além do vencedor principal, se houver) comprou bilhetes. Prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}) não distribuído.`);
            }
        } else {
            this.logger.log(`Não foi possível determinar a equipe vencedora (ticket: ${winningTicketNumberInternal}, nome: ${winningTeamName}). Prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}) não distribuído.`);
        }

        // --- Update Raffle Status ---
        await raffle.update({
          finished: true,
          drawDate: now,
          winnerUserId: mainWinnerUserId, // Still set the main winner (exact ticket holder)
        }, { transaction });

         // --- Commit ---
        if (!transactionHost) await transaction.commit();
        this.logger.log(`Rifa de equipe ${raffleId} finalizada com sucesso.`);

         // --- Reload and Return ---
         // Reload outside the lock/transaction logic to get fresh data with relations
         // Need winnerUser with referrer and tickets with users+referrer for formatRaffleDetails
         await raffle.reload({
               include: [
                    { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                    { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'] }] }
                ],
               transaction // Use transaction for reload if applicable
           });

        // Attach calculated details for formatRaffleDetails to use
         (raffle as any).winningTeamName = winningTeamName;
         (raffle as any).winningTeamMembersCount = numberOfWinningTeamMembersReceivingPrize;
         (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive; // Attach main winner referrer status
         (raffle as any).teamMemberReferrerActiveStatuses = teamMemberReferrerActiveStatuses; // Attach team members referrer statuses


        return raffle;

      } catch (error) {
          // Ensure rollback if transaction was local and error occurred
           // Check if transaction exists AND is not completed ('commit' or 'rollback')
         if (!transactionHost && transaction && (transaction as any).finished === null) { // Use (transaction as any).finished
              try {
                  await transaction.rollback();
                  this.logger.warn(`Rollback executado para transação da rifa de equipe ${raffleId} devido a erro.`);
              } catch (rollbackError: any) {
                   if (!rollbackError.message?.includes('already')) {
                       this.logger.error(`Erro ao tentar executar rollback no CATCH para rifa de equipe ${raffleId}: ${rollbackError}`);
                   }
              }
         }
         // Re-throw specific errors or log and throw generic
        if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException || error instanceof InternalServerErrorException) {
           throw error;
        }
         // Re-throw specific error from updateUserBalance
         if (error instanceof Error && ((error as any).isHandled)) { // Check for the .isHandled flag
             this.logger.error(`Erro esperado durante finalização da rifa ${raffleId}: ${error.message}`);
             // Converter para InternalServerError se não for um BadRequest que já foi lançado
             if (!(error instanceof BadRequestException)) {
                   throw new InternalServerErrorException(`Erro na operação de saldo durante a finalização da rifa ${raffleId}: ${error.message}`);
             }
              throw error; // Re-throw BadRequest
         }

        this.logger.error(`Erro inesperado ao finalizar a rifa de equipe ${raffleId}: ${(error as any).message}`, (error as any).stack);
        throw new InternalServerErrorException('Erro interno ao finalizar a rifa de equipe.');
      }
    }
  


    async getRaffleTeamsWithAvailability(raffleId: number): Promise<any> {
      const raffle = await this.raffleModel.findByPk(raffleId, {
          attributes: ['id', 'type', 'totalTickets', 'finished'], // Inclui 'finished'
          include: [
              { model: RaffleTicket, attributes: ['ticketNumber', 'userId'], include: [{ model: User, attributes: ['id', 'name'] }] },
          ],
      });

      if (!raffle) throw new NotFoundException('Rifa não encontrada.');
      if (raffle.type !== 'equipes') throw new BadRequestException('Esta rota é válida apenas para rifas de equipes.');
       if (raffle.finished) throw new BadRequestException('Esta rifa já foi finalizada, não há disponibilidade.');


      // getFormattedTeams precisa dos tickets com User (assumindo que raffle já os incluiu)
      const formattedTeams = this.getFormattedTeams(raffle); // Usa a função que retorna números internos 00-99

      const allInternalTickets = Array.from({ length: raffle.totalTickets }, (_, i) => i.toString().padStart(2, '0'));
      const purchasedInternalTickets = new Set(raffle.tickets?.map(t => t.ticketNumber) || []); // Garantir que raffle.tickets não é null/undefined

      const availableTicketsByTeam: { [key: string]: string[] } = {}; // Armazenará números formatados 1-100

      for (const teamName of Object.keys(formattedTeams)) {
          const teamData = formattedTeams[teamName];
          availableTicketsByTeam[teamName] = teamData.tickets // Pega os tickets INTERNOS do time (00-99)
              .filter(internalTicket => !purchasedInternalTickets.has(internalTicket)) // Filtra os que NÃO foram comprados
              .map(this.formatTicketNumberDisplay); // Formata os disponíveis para 1-100
      }

       // Formata os números dos tickets dentro dos times e membros para exibição 1-100
       Object.values(formattedTeams).forEach((team: any) => {
            team.tickets = team.tickets.map(this.formatTicketNumberDisplay); // Números totais do time
            team.members.forEach((member: any) => {
                 // Garante que member.tickets existe antes de chamar map
                if (member.tickets) {
                     member.tickets = member.tickets.map(this.formatTicketNumberDisplay); // Números comprados pelo membro
                } else {
                    member.tickets = []; // Define como array vazio se não existir
                }
            });
        });


      return {
          raffleId: raffle.id,
          teams: Object.values(formattedTeams), // Dados dos times com tickets formatados 1-100
          availableTicketsByTeam: availableTicketsByTeam, // Tickets disponíveis por time, formatados 1-100
      };
  }


  // Método obsoleto ou não implementado, remover ou implementar se necessário
  // sendNotification(userId: number, arg1: string) {
  //   throw new Error('Method not implemented.');
  // }
}