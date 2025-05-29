// raffle.service.ts
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { Seed } from '../models/seed.model';
import { RaffleNumber } from '../models/raffle/raffle-number.model';
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { User } from '../models/user/user.model';
import { Cron, CronExpression } from '@nestjs/schedule'; // Importe CronExpression teste
import { Op } from 'sequelize';
import { AuthService } from 'src/Auth/auth.service';
import { sendMessageMass, sendMessageWinning, sendMessageMassWinning } from '../Whatsapp/sendMessage'; // <-- Adicione sendMessageMassWinning aqui
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

  public readonly fixedRafflePrices = [5, 10, 20, 30, 50, 100]; // Preços fixos


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
    private sequelize: Sequelize,
    private authService: AuthService,
  ) { }

  // Método para garantir a existência das rifas fixas originais (isExtra = false)
  async initializeFixedRaffles() {
      this.logger.log('Inicializando/Verificando rifas fixas originais (garantindo uma ativa por preço/tipo)...');
      for (const price of this.fixedRafflePrices) {
          // Verifica para Rifa Tradicional
          try {
              const existingTraditional = await this.raffleModel.findOne({
                   where: { ticketPrice: price, type: 'tradicional', isExtra: false, finished: false },
              });
              if (!existingTraditional) {
                  this.logger.log(`Nenhuma rifa TRADICIONAL original (isExtra=false) ativa encontrada para R$ ${price.toFixed(2)}. Criando uma nova.`);
                  await this.createSystemRaffle(price, false); // Cria a rifa original (não extra)
              } else {
                  this.logger.log(`Já existe uma rifa TRADICIONAL original (isExtra=false) ativa para R$ ${price.toFixed(2)} (ID: ${existingTraditional.id}). Nenhuma nova criada.`);
              }
          } catch (error) {
              this.logger.error(`Erro ao inicializar rifa TRADICIONAL original de R$ ${price.toFixed(2)}: ${(error as any).message}`);
          }

          // Verifica para Rifa de Equipes
          try {
              const existingTeam = await this.raffleModel.findOne({
                  where: { ticketPrice: price, type: 'equipes', isExtra: false, finished: false },
              });
              if (!existingTeam) {
                  this.logger.log(`Nenhuma rifa de EQUIPES original (isExtra=false) ativa encontrada para R$ ${price.toFixed(2)}. Criando uma nova.`);
                  await this.createTeamRaffle(price, false); // Cria a rifa original (não extra)
              } else {
                   this.logger.log(`Já existe uma rifa de EQUIPES original (isExtra=false) ativa para R$ ${price.toFixed(2)} (ID: ${existingTeam.id}). Nenhuma nova criada.`);
              }
          } catch (error) {
               this.logger.error(`Erro ao inicializar rifa de EQUIPES original de R$ ${price.toFixed(2)}: ${(error as any).message}`);
          }
      }
      this.logger.log('Verificação/Inicialização de rifas fixas originais concluída.');
  }


   // Função auxiliar para formatar resumo da rifa (pode ser expandida)
   private formatRaffleSummary(raffle: Raffle): any {
    const totalPotentialValue = Number(raffle.ticketPrice) * Number(raffle.totalTickets);
    let potentialMainPrize = 0;

    if (raffle.type === 'tradicional') {
        potentialMainPrize = totalPotentialValue * 0.80; // 80% do total potencial
    } else if (raffle.type === 'equipes') {
        potentialMainPrize = totalPotentialValue * 0.50; // 50% do total potencial para o ganhador principal
    }

    return {
        id: raffle.id,
        raffleIdentifier: raffle.raffleIdentifier,
        type: raffle.type,
        title: raffle.title,
        ticketPrice: Number(raffle.ticketPrice),
        totalTickets: raffle.totalTickets,
        soldTickets: raffle.soldTickets,
        finished: raffle.finished,
        isExtra: raffle.isExtra,
        expectedDrawTime: this.calculateExpectedDrawTime(raffle),
        createdAt: raffle.createdAt,
        potentialMainPrizeValue: potentialMainPrize, // <-- NOVO CAMPO ADICIONADO
        // Adicionar um campo para o prêmio da equipe potencial se for rifa de equipes
        ...(raffle.type === 'equipes' && { potentialTeamPrizePoolValue: totalPotentialValue * 0.30 })
    };
}

  // Função auxiliar para calcular o horário esperado do sorteio
  private calculateExpectedDrawTime(raffle: Raffle): Date | null {
    if (raffle.finished) {
      return raffle.drawDate || raffle.updatedAt; // Se finalizada, retorna a data do sorteio ou atualização
    }

    const now = new Date();

    if (raffle.soldTickets >= raffle.totalTickets || (raffle.endDate && raffle.endDate <= now)) {
        const nextHour = new Date(now);
        if (nextHour.getMinutes() > 0 || nextHour.getSeconds() > 0 || nextHour.getMilliseconds() > 0) {
            nextHour.setHours(now.getHours() + 1, 0, 0, 0);
        } else {
             nextHour.setHours(now.getHours() + 1, 0, 0, 0);
        }
        return nextHour;
    }

    if (raffle.endDate) {
      return raffle.endDate;
    }

    return null;
  }


  // Função auxiliar para calcular detalhes do prêmio (usada para exibição)
  private calculatePrizeDetails(raffle: Raffle): any {
    const totalCollectedValue = Number(raffle.ticketPrice) * Number(raffle.soldTickets);
    const totalPotentialValue = Number(raffle.ticketPrice) * Number(raffle.totalTickets);

    if (isNaN(totalCollectedValue) || totalCollectedValue < 0 || isNaN(totalPotentialValue) || totalPotentialValue < 0 || !raffle.ticketPrice || !raffle.totalTickets) {
         return {
             totalCollected: 0,
             houseGrossShare: 0,
             houseNetShare: 0,
             totalDistributedToPlayers: 0,
             totalReferrerCommissionPaid: 0,
             mainWinnerPrize: 0, // Prêmio efetivamente pago ao ganhador se finalizada
             potentialMainPrizeIfSoldOut: 0, // Prêmio potencial do ganhador principal se 100% vendida
             mainWinnerReferrerCommission: raffle.finished ? 0 : null,
             mainWinnerReferrerActive: raffle.finished ? false : null,
             teamPrizePoolPotential: 0, // Pool potencial da equipe se 100% vendida
             teamMembersTotalPrize: raffle.finished ? 0 : null, // Prêmio efetivamente pago aos membros da equipe
             teamMembersReferrerCommissionTotal: 0,
             teamMembersDetails: raffle.finished ? [] : null,
             winningTeamName: raffle.finished ? (raffle as any).winningTeamName ?? "Indeterminado" : null,
             numberOfWinningTeamMembersReceivingPrize: raffle.finished ? (raffle as any).numberOfWinningTeamMembersReceivingPrize ?? 0 : null,
             details: "Não foi possível calcular os detalhes do prêmio (dados inválidos)."
         };
    }

    const houseGrossSharePercentage = 0.20;
    const playerPrizePoolPercentage = 0.80; // Total para jogadores
    const referrerCommissionRateOnHouseShare = 0.05;

    // Valores potenciais baseados em 100% de vendas
    const potentialHouseGrossShareIfSoldOut = totalPotentialValue * houseGrossSharePercentage;
    const potentialReferrerCommissionIfSoldOut = potentialHouseGrossShareIfSoldOut * referrerCommissionRateOnHouseShare;
    let potentialMainPrizeIfSoldOut = 0;
    let potentialTeamPrizePoolIfSoldOut = 0;

    if (raffle.type === 'tradicional') {
        potentialMainPrizeIfSoldOut = totalPotentialValue * playerPrizePoolPercentage; // Ganhador leva tudo do pool de jogadores (80%)
    } else if (raffle.type === 'equipes') {
        potentialMainPrizeIfSoldOut = totalPotentialValue * 0.50; // 50% do total para o principal
        potentialTeamPrizePoolIfSoldOut = totalPotentialValue * 0.30; // 30% do total para a equipe
    }


    let totalReferrerCommissionPaid = 0;
    let actualTotalPrizeDistributedToPlayers = 0;
    let mainWinnerPrizePaid = 0; // Prêmio efetivamente pago
    let teamMembersTotalPrizePaid = 0; // Prêmio efetivamente pago
    let mainWinnerReferrerCommission = 0;
    let mainWinnerReferrerActive: boolean | null = null;
    let winningTeamName: string | null = null;
    let numberOfWinningTeamMembersReceivingPrize: number | null = null;
    let teamMembersDetails: any[] | null = null;
    let houseGrossShare = 0;
    let houseNetShare = 0;
    const mainWinnerUser = raffle.winnerUser;


    if (raffle.finished) {
        mainWinnerPrizePaid = (raffle as any).mainWinnerPrize ?? 0;
        mainWinnerReferrerCommission = (raffle as any).mainWinnerReferrerCommission ?? 0;
        mainWinnerReferrerActive = (raffle as any).mainWinnerReferrerActive ?? false;
        teamMembersTotalPrizePaid = (raffle as any).teamMembersTotalPrize ?? 0;
        winningTeamName = (raffle as any).winningTeamName ?? null;
        numberOfWinningTeamMembersReceivingPrize = (raffle as any).numberOfWinningTeamMembersReceivingPrize ?? null;
        teamMembersDetails = ((raffle as any).winningTeamMembersDetails ?? []).map(member => ({
            ...member,
        }));

        actualTotalPrizeDistributedToPlayers = mainWinnerPrizePaid + teamMembersTotalPrizePaid;
        totalReferrerCommissionPaid = mainWinnerReferrerCommission + ((raffle as any).teamMembersReferrerCommissionTotal ?? 0);

        houseGrossShare = totalCollectedValue * houseGrossSharePercentage; // Baseado no que foi coletado
        houseNetShare = houseGrossShare - totalReferrerCommissionPaid;

        if (raffle.type === 'tradicional') {
            // ... (lógica de detalhes para rifa tradicional finalizada, igual a antes)
            // Adicionamos os campos potenciais para referência, mesmo que finalizada
            return {
                totalCollected: totalCollectedValue,
                houseGrossShare: houseGrossShare,
                houseNetShare: houseNetShare,
                totalDistributedToPlayers: actualTotalPrizeDistributedToPlayers,
                totalReferrerCommissionPaid: totalReferrerCommissionPaid,
                mainWinnerPrize: mainWinnerPrizePaid, // Prêmio pago
                potentialMainPrizeIfSoldOut: potentialMainPrizeIfSoldOut, // <-- NOVO (para referência)
                mainWinnerReferrerCommission: mainWinnerReferrerCommission,
                mainWinnerReferrerActive: mainWinnerReferrerActive,
                teamPrizePoolPotential: 0, // Não aplicável
                potentialTeamPrizePoolIfSoldOut: 0, // <-- NOVO (para referência)
                teamMembersTotalPrize: 0,
                teamMembersReferrerCommissionTotal: 0,
                teamMembersDetails: [],
                winningTeamName: null,
                numberOfWinningTeamMembersReceivingPrize: null,
                details: `Distribuição Finalizada (Base em R$ ${totalCollectedValue.toFixed(2)} coletados): ` +
                         `Ganhador recebeu R$ ${mainWinnerPrizePaid.toFixed(2)}. ` + // Usar prêmio pago
                         `Casa (bruto): R$ ${houseGrossShare.toFixed(2)}. ` +
                         (mainWinnerReferrerActive && mainWinnerUser ? `Indicador do ganhador (ativo) recebeu R$ ${mainWinnerReferrerCommission.toFixed(2)}. ` : (mainWinnerUser && mainWinnerUser.referrerId ? `Indicador do ganhador não ativo ou inexistente, comissão potencial de R$ ${(totalCollectedValue * houseGrossSharePercentage * referrerCommissionRateOnHouseShare).toFixed(2)} não paga. ` : 'Ganhador não teve indicador ou não houve ganhador.')) +
                         `Casa (líquido): R$ ${houseNetShare.toFixed(2)}.`,
            };
        } else if (raffle.type === 'equipes') {
            // ... (lógica de detalhes para rifa de equipes finalizada, igual a antes)
            // Adicionamos os campos potenciais para referência
            return {
                totalCollected: totalCollectedValue,
                houseGrossShare: houseGrossShare,
                houseNetShare: houseNetShare,
                totalDistributedToPlayers: actualTotalPrizeDistributedToPlayers,
                totalReferrerCommissionPaid: totalReferrerCommissionPaid,
                mainWinnerPrize: mainWinnerPrizePaid, // Prêmio pago
                potentialMainPrizeIfSoldOut: potentialMainPrizeIfSoldOut, // <-- NOVO (para referência)
                mainWinnerReferrerCommission: mainWinnerReferrerCommission,
                mainWinnerReferrerActive: mainWinnerReferrerActive,
                teamPrizePoolPotential: potentialTeamPrizePoolIfSoldOut, // Potencial da equipe se 100% vendida
                potentialTeamPrizePoolIfSoldOut: potentialTeamPrizePoolIfSoldOut, // <-- NOVO (para referência, mesmo valor de teamPrizePoolPotential)
                teamMembersTotalPrize: teamMembersTotalPrizePaid, // Pago para equipe
                teamMembersReferrerCommissionTotal: (raffle as any).teamMembersReferrerCommissionTotal ?? 0,
                teamMembersDetails: teamMembersDetails,
                winningTeamName: winningTeamName,
                numberOfWinningTeamMembersReceivingPrize: numberOfWinningTeamMembersReceivingPrize,
                details: `Distribuição Finalizada (Base em R$ ${totalCollectedValue.toFixed(2)} coletados): ` +
                         `Prêmio Principal: Ganhador recebeu R$ ${mainWinnerPrizePaid.toFixed(2)}. ` +
                         `Pool Equipe Vencedora (${winningTeamName ?? 'N/A'}): Distribuído R$ ${teamMembersTotalPrizePaid.toFixed(2)} entre ${numberOfWinningTeamMembersReceivingPrize ?? 0} membro(s) elegíveis. ` +
                         `Casa (bruto): R$ ${houseGrossShare.toFixed(2)}. ` +
                         (mainWinnerReferrerActive && mainWinnerUser ? `Indicador do ganhador principal (ativo) recebeu R$ ${mainWinnerReferrerCommission.toFixed(2)}. ` : (mainWinnerUser && mainWinnerUser.referrerId ? `Indicador do ganhador principal não ativo ou inexistente, comissão potencial de R$ ${(totalCollectedValue * houseGrossSharePercentage * referrerCommissionRateOnHouseShare).toFixed(2)} não paga. ` : 'Ganhador principal não teve indicador ou não houve ganhador.')) +
                         `Comissões para indicadores de membros da equipe (se aplicável e ativos): R$ ${((raffle as any).teamMembersReferrerCommissionTotal ?? 0).toFixed(2)} (total). ` +
                         `Casa (líquido): R$ ${houseNetShare.toFixed(2)}.`,
            };
        }
    } else {
        // Se a rifa NÃO finalizou, calculamos valores POTENCIAIS
        // 'potentialMainPrizeIfSoldOut' e 'potentialTeamPrizePoolIfSoldOut' já foram calculados acima.

        if (raffle.type === 'tradicional') {
            return {
                totalCollected: totalCollectedValue,
                houseGrossShare: totalCollectedValue * houseGrossSharePercentage, // Atual
                houseNetShare: (totalCollectedValue * houseGrossSharePercentage) - 0, // Atual
                totalDistributedToPlayers: totalCollectedValue * playerPrizePoolPercentage, // Atual
                totalReferrerCommissionPaid: 0,
                mainWinnerPrize: null, // Ainda não há ganhador
                potentialMainPrizeIfSoldOut: potentialMainPrizeIfSoldOut, // <-- VALOR QUE VOCÊ QUER EXIBIR
                mainWinnerReferrerCommission: potentialReferrerCommissionIfSoldOut, // Potencial
                mainWinnerReferrerActive: null,
                teamPrizePoolPotential: 0, // Não aplicável
                potentialTeamPrizePoolIfSoldOut: 0, // <-- VALOR QUE VOCÊ QUER EXIBIR (0 para tradicional)
                teamMembersTotalPrize: 0,
                teamMembersReferrerCommissionTotal: 0,
                teamMembersDetails: null,
                winningTeamName: null,
                numberOfWinningTeamMembersReceivingPrize: null,
                details: `Estimativa de Prêmios (Base em R$ ${totalPotentialValue.toFixed(2)} total potencial se 100% vendida): ` +
                         `Prêmio para Ganhador: R$ ${potentialMainPrizeIfSoldOut.toFixed(2)}. ` +
                         `Casa (bruto): R$ ${potentialHouseGrossShareIfSoldOut.toFixed(2)}. ` +
                         `Se o ganhador tiver indicador ativo, este receberia R$ ${potentialReferrerCommissionIfSoldOut.toFixed(2)}, pagos pela casa. ` +
                         `Casa (líquido) seria R$ ${(potentialHouseGrossShareIfSoldOut - potentialReferrerCommissionIfSoldOut).toFixed(2)}. ` +
                         `Valor atual arrecadado: R$ ${totalCollectedValue.toFixed(2)}.`,
            };
        } else if (raffle.type === 'equipes') {
            return {
                totalCollected: totalCollectedValue,
                houseGrossShare: totalCollectedValue * houseGrossSharePercentage, // Atual
                houseNetShare: (totalCollectedValue * houseGrossSharePercentage) - 0, // Atual
                totalDistributedToPlayers: totalCollectedValue * playerPrizePoolPercentage, // Atual
                totalReferrerCommissionPaid: 0,
                mainWinnerPrize: null, // Ainda não há ganhador
                potentialMainPrizeIfSoldOut: potentialMainPrizeIfSoldOut, // <-- VALOR QUE VOCÊ QUER EXIBIR
                mainWinnerReferrerCommission: potentialReferrerCommissionIfSoldOut, // Potencial para indicador do principal
                mainWinnerReferrerActive: null,
                teamPrizePoolPotential: potentialTeamPrizePoolIfSoldOut, // Potencial da equipe se 100% vendida
                potentialTeamPrizePoolIfSoldOut: potentialTeamPrizePoolIfSoldOut, // <-- VALOR QUE VOCÊ QUER EXIBIR
                teamMembersTotalPrize: null, // Ainda não há
                teamMembersReferrerCommissionTotal: null, // Ainda não há
                teamMembersDetails: null,
                winningTeamName: null,
                numberOfWinningTeamMembersReceivingPrize: null,
                details: `Estimativa de Prêmios (Base em R$ ${totalPotentialValue.toFixed(2)} total potencial se 100% vendida): ` +
                         `Prêmio Principal: R$ ${potentialMainPrizeIfSoldOut.toFixed(2)}. Pool Equipe: R$ ${potentialTeamPrizePoolIfSoldOut.toFixed(2)}. ` +
                         `Casa (bruto): R$ ${potentialHouseGrossShareIfSoldOut.toFixed(2)}. ` +
                         `Se o ganhador PRINCIPAL tiver indicador ativo, este receberia R$ ${potentialReferrerCommissionIfSoldOut.toFixed(2)}, pagos pela casa. ` +
                         `Indicadores de membros da equipe VENCEDORA (se ativos) também receberiam cada um R$ ${potentialReferrerCommissionIfSoldOut.toFixed(2)}, pagos pela casa. ` +
                         `Casa (líquido) seria R$ ${(potentialHouseGrossShareIfSoldOut - (potentialReferrerCommissionIfSoldOut * /* Estimativa de N indicadores ativos */ 1)) .toFixed(2)}. ` +
                         `Valor atual arrecadado: R$ ${totalCollectedValue.toFixed(2)}.`,
            };
        }
    }
    return null; // Fallback
  }

  private formatTicketNumberDisplay(ticketNumber: string): string {
    if (ticketNumber === null || ticketNumber === undefined || ticketNumber === '') return 'N/A';
    try {
        const num = parseInt(ticketNumber, 10);
        if (isNaN(num)) return ticketNumber;
         if (num < 0 || num > 99) return ticketNumber;
        return (num + 1).toString().padStart(num === 99 ? 3 : 2, '0');
    } catch (e: any) {
        this.logger.error(`Erro ao formatar número de bilhete "${ticketNumber}": ${e.message}`);
        return ticketNumber;
    }
}

  async getAllFixedAndExtraRaffles(): Promise<any> {
    this.logger.log('Buscando todas as rifas fixas e extras (ativas e finalizadas)...');
    const allFixedRaffles = {
        tradicional: {},
        equipes: {}
    };

    for (const price of this.fixedRafflePrices) {
        const traditionalRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'tradicional' },
            include: [ { model: User, as: 'winnerUser' } ], order: [['createdAt', 'DESC']],
        });
        const teamRaffles = await this.raffleModel.findAll({
            where: { ticketPrice: price, type: 'equipes' },
             include: [ { model: User, as: 'winnerUser' } ], order: [['createdAt', 'DESC']],
        });

        allFixedRaffles.tradicional[price] = traditionalRaffles.map(raffle => this.formatRaffleSummary(raffle));
        allFixedRaffles.equipes[price] = teamRaffles.map(raffle => this.formatRaffleSummary(raffle));
    }
    return allFixedRaffles;
  }

  async getActiveTraditionalRafflesGroupedByPrice(): Promise<{ [price: number]: any[] }> {
      this.logger.log('Buscando rifas TRADICIONAIS ativas, agrupadas por preço...');
      const activeRaffles = await this.raffleModel.findAll({
          where: {
              type: 'tradicional',
              finished: false,
              ticketPrice: {
                  [Op.in]: this.fixedRafflePrices
              }
          },
          order: [['ticketPrice', 'ASC'], ['createdAt', 'ASC']],
      });

      const groupedRaffles: { [price: number]: any[] } = {};
       this.fixedRafflePrices.forEach(price => {
           groupedRaffles[price] = [];
       });

      activeRaffles.forEach(raffle => {
           const price = Number(raffle.ticketPrice);
           if (groupedRaffles[price]) {
               groupedRaffles[price].push(this.formatRaffleSummary(raffle));
           } else {
                this.logger.warn(`Rifa tradicional ativa com preço ${price} não está na lista de preços fixos. ID: ${raffle.id}`);
           }
      });
      return groupedRaffles;
  }

   async getActiveTeamRafflesGroupedByPrice(): Promise<{ [price: number]: any[] }> {
      this.logger.log('Buscando rifas de EQUIPES ativas, agrupadas por preço...');
      const activeRaffles = await this.raffleModel.findAll({
          where: {
              type: 'equipes',
              finished: false,
              ticketPrice: {
                  [Op.in]: this.fixedRafflePrices
              }
          },
          order: [['ticketPrice', 'ASC'], ['createdAt', 'ASC']],
      });

      const groupedRaffles: { [price: number]: any[] } = {};
       this.fixedRafflePrices.forEach(price => {
           groupedRaffles[price] = [];
       });

      activeRaffles.forEach(raffle => {
           const price = Number(raffle.ticketPrice);
           if (groupedRaffles[price]) {
               groupedRaffles[price].push(this.formatRaffleSummary(raffle));
           } else {
                this.logger.warn(`Rifa de equipe ativa com preço ${price} não está na lista de preços fixos. ID: ${raffle.id}`);
           }
      });
      return groupedRaffles;
  }


  public async createSystemRaffle(ticketPrice: number, isExtra: boolean): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });

    if (!latestHash) {
       const errorMessage = `Nenhuma hash de blockchain encontrada para criar nova rifa (tipo: tradicional, preço: ${ticketPrice}, isExtra: ${isExtra}).`;
       this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }

    const correspondingSeed = await this.seedModel.findOne({
        where: { hashId: latestHash.id },
        include: [
            {
                model: GeneratedNumber,
                where: { isUsed: false },
                order: [['createdAt', 'ASC']],
                limit: 1,
            },
        ],
        order: [['createdAt', 'DESC']],
    });

    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
       const errorMessage = `Nenhuma seed ou generatedNumber NÃO USADO encontrado para a hash ${latestHash.id} para criar nova rifa (tipo: tradicional, preço: ${ticketPrice}, isExtra: ${isExtra}). Execute a geração de números.`;
        this.logger.error(errorMessage);
       throw new InternalServerErrorException(errorMessage);
    }

    const generatedNumberToUse = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(generatedNumberToUse.number) % 100n;
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0');

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7);

     const baseTitle = `Rifa Tradicional - Loto Jack - R$ ${ticketPrice.toFixed(2)}`;
     const extraTitle = `Rifa Tradicional EXTRA - R$ ${ticketPrice.toFixed(2)}`;

     // DESCRIÇÃO ATUALIZADA COM NOVAS PORCENTAGENS
     const baseDescription = `Rifa Loto Jack gerada automaticamente. O prêmio para o bilhete sorteado é de 80% do valor total arrecadado. Se o ganhador foi indicado e o indicador estiver ativo no mês, este recebe 5% da parte da casa (equivalente a 1% do total arrecadado) como bônus, pago pela Casa. A Casa retém o restante. Baseado na hash ${latestHash.hash}.`;
     const extraDescription = `Rifa EXTRA gerada automaticamente após o esgotamento da rifa fixa original de mesmo valor. Prêmio de 80% do total arrecadado. Se o ganhador foi indicado e o indicador estiver ativo no mês, este recebe 5% da parte da casa (equivalente a 1% do total arrecadado) como bônus, pago pela Casa. Casa retém o restante. Baseado na hash ${latestHash.hash}.`;


    const newRaffle = await this.raffleModel.create({
      raffleIdentifier: `${isExtra ? 'RJ-EX' : 'RJ'}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      type: 'tradicional',
      title: isExtra ? extraTitle : baseTitle,
      description: isExtra ? extraDescription : baseDescription,
      ticketPrice: ticketPrice,
      totalTickets: 100,
      soldTickets: 0,
      startDate: startDate,
      endDate: endDate,
      finished: false,
      winningTicket: winningTicketNumber,
      drawDate: null,
      isExtra: isExtra,
    });

    await this.generatedNumberModel.update(
         { isUsed: true },
         { where: { id: generatedNumberToUse.id } }
     );

    await this.raffleNumberModel.create({
      raffleId: newRaffle.id,
      numberId: generatedNumberToUse.id,
    });

    this.logger.log(
      `Rifa Tradicional (ID ${newRaffle.id}, ${isExtra ? 'EXTRA' : 'FIXA ORIGINAL'}) criada para R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );
    return newRaffle;
  }

  public async createTeamRaffle(ticketPrice: number, isExtra: boolean): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({ order: [['timestamp', 'DESC']] });
    if (!latestHash) {
        const errorMessage = `Nenhuma hash de blockchain encontrada para criar nova rifa (tipo: equipes, preço: ${ticketPrice}, isExtra: ${isExtra}).`;
        this.logger.error(errorMessage);
        throw new InternalServerErrorException(errorMessage);
    }

    const correspondingSeed = await this.seedModel.findOne({
        where: { hashId: latestHash.id },
        include: [
            {
                model: GeneratedNumber,
                 where: { isUsed: false },
                 order: [['createdAt', 'ASC']],
                 limit: 1,
            },
        ],
        order: [['createdAt', 'DESC']],
    });
    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
        const errorMessage = `Nenhuma seed/generatedNumber NÃO USADO encontrado para a hash ${latestHash.id} para criar nova rifa (tipo: equipes, preço: ${ticketPrice}, isExtra: ${isExtra}). Execute a geração de números.`;
         this.logger.error(errorMessage);
        throw new InternalServerErrorException(errorMessage);
    }

    const generatedNumberToUse = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(generatedNumberToUse.number) % 100n;
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0');

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7);

     const baseTitle = `Rifa de Equipes - Loto Seleções - R$ ${ticketPrice.toFixed(2)}`;
     const extraTitle = `Rifa de Equipes EXTRA - R$ ${ticketPrice.toFixed(2)}`;

     // DESCRIÇÃO ATUALIZADA COM NOVAS PORCENTAGENS
     const baseDescription = `Rifa Loto Seleções gerada automaticamente. O prêmio é dividido: 50% do total arrecadado (pool principal) para o bilhete exato sorteado, e 30% do total arrecadado (pool da equipe) dividido igualmente entre os membros da equipe vencedora elegíveis. Para CADA ganhador (principal e membros da equipe), se ele foi indicado e o indicador estiver ativo no mês, este recebe 5% da parte da casa (equivalente a 1% do total arrecadado) como bônus de indicação, pago PELA CASA. A Casa retém o restante. Baseado na hash ${latestHash.hash}`;
     const extraDescription = `Rifa EXTRA gerada automaticamente após o esgotamento da rifa fixa original de mesmo valor. Prêmio: 50% principal + 30% pool equipe. Para CADA ganhador (principal e membros da equipe), se ele foi indicado e o indicador estiver ativo no mês, este recebe 5% da parte da casa (equivalente a 1% do total arrecadado) como bônus de indicação, pago PELA CASA. Casa retém o restante. Baseado na hash ${latestHash.hash}`;

    const newRaffle = await this.raffleModel.create({
        raffleIdentifier: `${isExtra ? 'RL-EX' : 'RL'}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        type: 'equipes',
        title: isExtra ? extraTitle : baseTitle,
        description: isExtra ? extraDescription : baseDescription,
        ticketPrice: ticketPrice,
        totalTickets: 100,
        soldTickets: 0,
        startDate: startDate,
        endDate: endDate,
        finished: false,
        winningTicket: winningTicketNumber,
        drawDate: null,
        isExtra: isExtra,
    });

     await this.generatedNumberModel.update(
         { isUsed: true },
         { where: { id: generatedNumberToUse.id } }
     );

    await this.raffleNumberModel.create({
        raffleId: newRaffle.id,
        numberId: generatedNumberToUse.id,
    });

    this.logger.log(
        `Rifa de Equipes (ID ${newRaffle.id}, ${isExtra ? 'EXTRA' : 'FIXA ORIGINAL'}) criada para R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );
    return newRaffle;
  }


    @Cron(CronExpression.EVERY_MINUTE)
    async ensureFixedRafflesCronJob() {
        this.logger.log('CRON: Verificando necessidade de criar rifas FIXAS ORIGINAIS (isExtra=false) a cada minuto...');
        for (const price of this.fixedRafflePrices) {
            try {
                const existingTraditional = await this.raffleModel.findOne({
                    where: { ticketPrice: price, type: 'tradicional', isExtra: false, finished: false },
                });
                if (!existingTraditional) {
                     this.logger.log(`CRON: Nenhuma rifa TRADICIONAL original ativa encontrada para R$ ${price.toFixed(2)}. Criando uma nova.`);
                    await this.createSystemRaffle(price, false);
                } else {
                    this.logger.debug(`CRON: Já existe rifa TRADICIONAL original ativa para R$ ${price.toFixed(2)} (ID: ${existingTraditional.id}).`);
                }
            } catch (error) {
                 this.logger.error(`CRON: Erro ao verificar/criar rifa TRADICIONAL original de R$ ${price.toFixed(2)}: ${(error as any).message}`);
            }

             try {
                const existingTeam = await this.raffleModel.findOne({
                     where: { ticketPrice: price, type: 'equipes', isExtra: false, finished: false },
                });
                if (!existingTeam) {
                    this.logger.log(`CRON: Nenhuma rifa de EQUIPES original ativa encontrada para R$ ${price.toFixed(2)}. Criando uma nova.`);
                    await this.createTeamRaffle(price, false);
                } else {
                    this.logger.debug(`CRON: Já existe rifa de EQUIPES original ativa para R$ ${price.toFixed(2)} (ID: ${existingTeam.id}).`);
                }
            } catch (error) {
                 this.logger.error(`CRON: Erro ao verificar/criar rifa de EQUIPES original de R$ ${price.toFixed(2)}: ${(error as any).message}`);
            }
        }
        this.logger.log('CRON: Verificação/Criação de rifas FIXAS ORIGINAIS concluída.');
    }


    private async createNextRaffleIfNeeded(type: 'tradicional' | 'equipes', price: number, wasExtra: boolean): Promise<void> {
        if (wasExtra) {
            this.logger.log(`Rifa EXTRA (tipo: ${type}, preço: ${price}) esgotada. NÃO será criada outra EXTRA automaticamente via esgotamento.`);
            return;
        }

         this.logger.log(`Rifa FIXA ORIGINAL (tipo: ${type}, preço: ${price}) esgotada. Criando rifa EXTRA...`);
         try {
             if (type === 'tradicional') {
                  await this.createSystemRaffle(price, true);
             } else {
                  await this.createTeamRaffle(price, true);
             }
             this.logger.log(`Nova rifa EXTRA (tipo: ${type}, preço: ${price}) criada com sucesso após esgotamento da fixa original.`);

         } catch (err) {
             this.logger.error(`Falha CRÍTICA ao criar rifa EXTRA após esgotamento da fixa original (tipo: ${type}, preço: ${price}): ${(err as Error).message}`);
         }
    }


  async buyRaffleTickets(
    userId: number,
    raffleId: number,
    ticketData: { type: 'tradicional' | 'equipes'; quantityOrNumbers: number | string[] },
  ): Promise<RaffleTicket[]> {
    const transaction = await this.sequelize.transaction();
    try {
      const user = await this.userModel.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) {
        await transaction.rollback(); // Adicionado rollback se usuário não encontrado antes de qualquer outra coisa
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Converter o saldo do usuário para número AQUI e verificar
      const userBalanceNumeric = parseFloat(user.balance as any);
      if (isNaN(userBalanceNumeric)) {
          this.logger.error(`Saldo do usuário ${userId} (valor: "${user.balance}") não pôde ser convertido para um número válido.`);
          await transaction.rollback();
          throw new InternalServerErrorException('Formato de saldo do usuário inválido.');
      }

      const raffle = await this.raffleModel.findByPk(raffleId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!raffle) {
        await transaction.rollback();
        throw new NotFoundException('Rifa não encontrada.');
      }
      if (raffle.finished) {
        await transaction.rollback();
        throw new BadRequestException('Esta rifa já foi finalizada.');
      }
       if (raffle.type !== ticketData.type) {
          await transaction.rollback();
          throw new BadRequestException(`Tipo de compra (${ticketData.type}) incompatível com o tipo da rifa (${raffle.type}).`);
      }

      // Converter o preço do bilhete para número e verificar
      const ticketPriceNumeric = parseFloat(raffle.ticketPrice as any);
      if (isNaN(ticketPriceNumeric)) {
        this.logger.error(`Preço do bilhete da rifa ${raffleId} (valor: "${raffle.ticketPrice}") não pôde ser convertido para um número válido.`);
        await transaction.rollback();
        throw new InternalServerErrorException('Formato de preço do bilhete inválido.');
      }


      const existingTicketsData = await this.raffleTicketModel.findAll({
          where: { raffleId: raffle.id },
          attributes: ['ticketNumber'],
          transaction,
          raw: true,
      });
      const existingTicketNumbers = new Set(existingTicketsData.map(t => t.ticketNumber));

      let quantity: number;
      let ticketNumbersToBuy: string[];

      const availableSlots = raffle.totalTickets - existingTicketNumbers.size;

      if (typeof ticketData.quantityOrNumbers === 'number') {
        quantity = ticketData.quantityOrNumbers;
        if (quantity <= 0) {
             await transaction.rollback(); // Adicionado rollback
             throw new BadRequestException('A quantidade de bilhetes deve ser maior que zero.');
        }
        if (quantity > availableSlots) {
           await transaction.rollback();
          throw new BadRequestException(
            `Não há ${quantity} bilhetes disponíveis. Apenas ${availableSlots} restantes.`,
          );
        }
        ticketNumbersToBuy = this.generateUniqueAvailableTicketNumbers(raffle.totalTickets, existingTicketNumbers, quantity);

      } else {
        const requestedNumbersFront = ticketData.quantityOrNumbers;
        ticketNumbersToBuy = requestedNumbersFront.map(numStr => {
            const num = parseInt(numStr, 10);
            if (isNaN(num) || num < 1 || num > raffle.totalTickets) {
                // Não precisa de rollback aqui pois ainda não alteramos nada crítico
                throw new BadRequestException(`Número de bilhete inválido: ${numStr}. Deve ser entre 1 e ${raffle.totalTickets}.`);
            }
            return (num - 1).toString().padStart(2, '0');
        });

        quantity = ticketNumbersToBuy.length;
         if (quantity <= 0) {
             await transaction.rollback(); // Adicionado rollback
             throw new BadRequestException('Nenhum número de bilhete fornecido.');
        }

        const alreadySold = ticketNumbersToBuy.filter(num => existingTicketNumbers.has(num));
        if (alreadySold.length > 0) {
             await transaction.rollback();
             throw new BadRequestException(
              `Os seguintes bilhetes (formato 1-100) já foram comprados: ${alreadySold.map(this.formatTicketNumberDisplay).join(', ')}`,
            );
        }
        const duplicatesInRequest = ticketNumbersToBuy.filter((item, index) => ticketNumbersToBuy.indexOf(item) !== index);
        if (duplicatesInRequest.length > 0) {
             await transaction.rollback();
             throw new BadRequestException(
              `Os seguintes bilhetes (formato 1-100) estão duplicados na sua requisição: ${duplicatesInRequest.map(this.formatTicketNumberDisplay).join(', ')}`,
            );
        }
        if (quantity > availableSlots) { // Esta verificação deve usar a quantidade real de números únicos solicitados.
            await transaction.rollback();
           throw new BadRequestException(
             `Você tentou comprar ${quantity} bilhetes, mas apenas ${availableSlots} estão disponíveis.`
           );
        }
      }

      const totalCost = ticketPriceNumeric * quantity; // Usa o preço numérico
      if (userBalanceNumeric < totalCost) { // Usa o saldo numérico
         await transaction.rollback();
        throw new BadRequestException(`Saldo insuficiente. Necessário: R$ ${totalCost.toFixed(2)}, Disponível: R$ ${userBalanceNumeric.toFixed(2)}.`);
      }

      const createdTickets = await this.raffleTicketModel.bulkCreate(
        ticketNumbersToBuy.map((ticketNumberInternal) => ({
          userId,
          raffleId,
          ticketNumber: ticketNumberInternal,
        })),
        { transaction },
      );

      await this.authService.updateUserBalance(user.id, -totalCost, transaction); // totalCost já é numérico

      const newSoldCount = existingTicketNumbers.size + quantity;
      await raffle.update(
        { soldTickets: newSoldCount },
        { transaction },
      );

      if (newSoldCount >= raffle.totalTickets) {
          this.logger.log(`Rifa ${raffle.id} (tipo: ${raffle.type}, isExtra: ${raffle.isExtra}) esgotou com esta compra. Verificando necessidade de criar próxima...`);
          // Usar ticketPriceNumeric que já é um número
          this.createNextRaffleIfNeeded(raffle.type, ticketPriceNumeric, raffle.isExtra).catch(err => {
              this.logger.error(`Erro (não bloqueante) ao tentar criar próxima rifa após esgotamento da ${raffle.id}: ${err.message}`);
          });
      }

      await transaction.commit();

      this.logger.log(
        `Usuário ${userId} comprou ${quantity} bilhete(s) para a rifa ${raffle.id}. Bilhetes (formato 1-100): ${ticketNumbersToBuy.map(this.formatTicketNumberDisplay).join(', ')}`
      );

      return createdTickets;

    } catch (error) {
      if (transaction && (transaction as any).finished === null) { // Verifica se a transação não foi finalizada (commit/rollback)
            try {
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação de compra da rifa ${raffleId} por usuário ${userId} devido a erro no catch: ${(error as Error).message}`);
            } catch (rollbackError: any) {
                 // Evitar logar erro de rollback se já foi feito ou não é necessário
                 if (!rollbackError.message?.includes('already rollbacked') && !rollbackError.message?.includes('not in progress')) {
                    this.logger.error(`Erro crítico ao tentar executar rollback no CATCH para compra da rifa ${raffleId} por ${userId}: ${rollbackError}`);
                 }
            }
       }

      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error; // Re-throw known errors
      }

       if (error instanceof Error && error.message?.includes('Insufficient balance during transaction')) {
            throw new BadRequestException('Saldo insuficiente para concluir a compra.'); // Mais específico
       }

      this.logger.error(
        `Erro capturado no CATCH ao comprar bilhetes para rifa ${raffleId} por usuário ${userId}: ${(error as any).message}`, (error as any).stack
      );

      // Tratar erros de concorrência de forma mais genérica se não forem os já tratados
      if (error instanceof Error && (error.message?.includes('FOR UPDATE cannot be applied') || error.message?.includes('could not serialize access'))) {
           throw new InternalServerErrorException('Erro temporário ao processar compra devido a concorrência. Por favor, tente novamente.');
      }
      // Fallback para outros erros
      throw new InternalServerErrorException('Erro interno ao processar a compra de bilhetes.');
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

    // Embaralhar para aleatoriedade se necessário, ou apenas pegar os primeiros 'quantity'
    // Se a ordem não importa e precisa ser rápido:
    // if (availableNumbers.length < quantity) throw new Error("Logic error: Not enough available numbers after filtering.");

    // Embaralhar (Fisher-Yates shuffle)
    for (let i = availableNumbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableNumbers[i], availableNumbers[j]] = [availableNumbers[j], availableNumbers[i]];
    }

    return availableNumbers.slice(0, quantity);
  }

  async getRafflesWithDetails(filters: any = {}): Promise<any[]> {
    const where: any = {};
     if (filters.finished !== undefined) {
          where.finished = filters.finished === 'true' || filters.finished === true;
      }
      if (filters.type) {
          where.type = filters.type;
      }
       if (filters.isExtra !== undefined) {
           where.isExtra = filters.isExtra === 'true' || filters.isExtra === true;
       }

    const raffles = await this.raffleModel.findAll({
      include: [
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] },
        { model: User, as: 'winnerUser', attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
        { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
      ],
      where,
      order: [['createdAt', 'DESC']],
    });

    return raffles.map((raffle) => this.formatRaffleDetails(raffle));
  }

  async getRaffleByIdWithDetails(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      include: [
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] },
        { model: User, as: 'winnerUser', attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
        { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
      ],
    });

    if (!raffle) {
      throw new NotFoundException('Rifa não encontrada.');
    }

    return this.formatRaffleDetails(raffle);
  }

  public formatRaffleDetails(raffle: Raffle): any {
    const formattedTickets = this.formatRaffleTickets(raffle);
    const winningTicketInfo = this.formatWinningTicketInfo(raffle);
    const prizeDetailsObject = this.calculatePrizeDetails(raffle); // Objeto completo retornado
    const expectedDrawTime = this.calculateExpectedDrawTime(raffle);

    let winningTeamDetails: { teamName: string; tickets: string[]; members: { userId: number; userName: string; prize: number; referrerCommission: number; referrerActive: boolean; hasReferrer: boolean; tickets: string[]; }[] } | null = null;
    if (raffle.type === 'equipes' && raffle.finished) {
        winningTeamDetails = (raffle as any).winningTeamMembersDetails ? {
            teamName: (raffle as any).winningTeamName ?? "N/A",
            tickets: (raffle as any).winningTeamMembersDetails.flatMap((m: any) => m.tickets).map(this.formatTicketNumberDisplay),
            members: (raffle as any).winningTeamMembersDetails.map((member: any) => ({
                userId: member.userId,
                userName: member.userName,
                prize: member.prize,
                referrerCommission: member.referrerCommission,
                referrerActive: member.referrerActive,
                hasReferrer: member.hasReferrer,
                tickets: member.tickets.map(this.formatTicketNumberDisplay),
            }))
        } : { teamName: (raffle as any).winningTeamName ?? "N/A", tickets: [], members: [] };
    }

    let winnerReferrerInfo: { id: number; name: string; } | null = null;
     if (raffle.finished && raffle.winnerUser?.referrerId) {
         winnerReferrerInfo = {
             id: raffle.winnerUser.referrerId,
             name: raffle.winnerUser.referrer?.name || 'Usuário Desconhecido',
         };
     }

    // Extrair os valores desejados do prizeDetailsObject
    // Usando os nomes "totalPotentialValue" e "potentialWinnerPrize" para consistência com formatRaffleSummary
    // O campo "potentialMainPrizeIfSoldOut" dentro de prizeDetailsObject é o que queremos chamar de "potentialWinnerPrize" aqui.
    const totalPotentialValue = Number(raffle.ticketPrice) * Number(raffle.totalTickets);
    const potentialWinnerPrize = prizeDetailsObject?.potentialMainPrizeIfSoldOut ?? 0;
    const potentialTeamPrizePool = prizeDetailsObject?.potentialTeamPrizePoolIfSoldOut ?? 0;

    return {
      id: raffle.id,
      raffleIdentifier: raffle.raffleIdentifier,
      type: raffle.type,
      isExtra: raffle.isExtra,
      winner: raffle.winnerUser ? {
           id: raffle.winnerUser.id,
           name: raffle.winnerUser.name,
           referrer: winnerReferrerInfo,
      } : null,
      title: raffle.title,
      description: raffle.description,
      ticketPrice: Number(raffle.ticketPrice),
      totalTickets: Number(raffle.totalTickets),
      soldTickets: Number(raffle.soldTickets),
      startDate: raffle.startDate,
      endDate: raffle.endDate,
      drawDate: raffle.drawDate,
      expectedDrawTime: expectedDrawTime,
      finished: raffle.finished,
      winningTicket: winningTicketInfo,
      prizeDetails: prizeDetailsObject, // Retorna o objeto completo de prizeDetails como antes

      // Adicionando os campos com os nomes solicitados para a visualização detalhada
      totalPotentialValue: totalPotentialValue,         // <-- VALOR TOTAL POTENCIAL
      potentialWinnerPrize: potentialWinnerPrize,     // <-- PRÊMIO LÍQUIDO POTENCIAL DO CAMPEÃO
      ...(raffle.type === 'equipes' && { potentialTeamPrizePool: potentialTeamPrizePool }), // <-- PRÊMIO LÍQUIDO POTENCIAL DO POOL DA EQUIPE

      winningTeamDetails: winningTeamDetails,
      createdAt: raffle.createdAt,
      updatedAt: raffle.updatedAt,
    };
  }


  private formatWinningTicketInfo(raffle: Raffle): any {
    if (!raffle.finished || !raffle.winningTicket) {
      return null;
    }
    const displayTicketNumber = this.formatTicketNumberDisplay(raffle.winningTicket);

    const raffleNumber = raffle.raffleNumbers?.[0];
    const generatedNumber = raffleNumber?.generatedNumber;
    const seed = generatedNumber?.seed;
    const blockchainHash = seed?.blockchainHash;

    return {
      ticketNumber: displayTicketNumber,
      internalTicketNumber: raffle.winningTicket,
      generatedNumberId: generatedNumber?.id,
      generatedNumberValue: generatedNumber?.number?.toString(),
      sequence: generatedNumber?.sequence,
      seedId: seed?.id,
      hashId: blockchainHash?.id,
      hashValue: blockchainHash?.hash,
      hashTimestamp: blockchainHash?.timestamp,
    };
  }

  public formatRaffleTickets(raffle: Raffle): any[] {
    if (!raffle.tickets) {
      return [];
    }

    const formattedTeamsData = raffle.type === 'equipes' ? this.getFormattedTeams(raffle) : null;

    return raffle.tickets.map(ticket => {
      const displayTicketNumber = this.formatTicketNumberDisplay(ticket.ticketNumber);
      let teamInfo: { teamName: string } | null = null;

      if (formattedTeamsData) {
          const teamName = this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber);
          const team = formattedTeamsData[teamName];
           if (team) {
              teamInfo = {
                 teamName: team.teamName,
              };
           }
      }

      return {
        id: ticket.id,
        ticketNumber: displayTicketNumber,
        internalTicketNumber: ticket.ticketNumber,
        user: ticket.user ? {
          id: ticket.user.id,
          name: ticket.user.name,
        } : null,
        team: teamInfo,
        purchaseDate: ticket.createdAt,
      };
    });
  }


private async notifyWinnersAndLosers(
    raffle: Raffle,
    tickets: RaffleTicket[], // Precisamos dos tickets carregados com User (incluindo phone)
    winnerUser: User | null, // O User ganhador principal (pode ser null)
    winningTeamMembersDetails?: any[], // Detalhes dos membros da equipe vencedora (apenas para equipes)
) {
    this.logger.log(`Iniciando envio de mensagens para rifa ${raffle.id} (Tipo: ${raffle.type})...`);

    const now = new Date();
    const formattedDrawDate = format(raffle.drawDate || now, 'dd/MM/yyyy HH:mm', { locale: ptBR });
    const winningTicketDisplay = this.formatTicketNumberDisplay(raffle.winningTicket);
    const raffleSeries = raffle.raffleIdentifier;

    // Mapa rápido de UserID para Telefone
    const usersWithPhone = new Map<number, string>();
    tickets.forEach(ticket => {
         if (ticket.user && ticket.user.phone) {
              usersWithPhone.set(ticket.user.id, ticket.user.phone);
         }
    });

    // --- Lógica para Rifa Tradicional (MANTIDA COMO ESTÁ) ---
    if (raffle.type === 'tradicional') {
        // Enviar mensagem para o ganhador (se houver)
        if (winnerUser && winnerUser.phone) {
            try {
                 await sendMessageWinning(winnerUser.phone, formattedDrawDate, winningTicketDisplay, winningTicketDisplay);
                 this.logger.log(`Mensagem de vitória enviada para o ganhador ${winnerUser.id} (${winnerUser.phone}) da rifa ${raffle.id}.`);
            } catch (msgErr: any) {
                 this.logger.error(`Falha ao enviar mensagem de vitória para o ganhador ${winnerUser.id} (${winnerUser.phone}) da rifa ${raffle.id}: ${msgErr.message}`);
            }
        } else if (winnerUser && !winnerUser.phone) {
             this.logger.warn(`Ganhador ${winnerUser.id} da rifa ${raffle.id} não possui número de telefone cadastrado. Mensagem de vitória não enviada.`);
        } else {
             this.logger.log(`Nenhum ganhador na rifa tradicional ${raffle.id} (bilhete ${raffle.winningTicket} não vendido). Nenhuma mensagem de vitória para usuário específico.`);
        }

        // Enviar mensagem em massa para os não ganhadores (todos exceto o ganhador principal)
        const nonWinnerUserIds = new Set<number>();
        const allTicketBuyerIds = new Set<number>();
        tickets.forEach(ticket => {
            if (ticket.user) {
                allTicketBuyerIds.add(ticket.user.id);
            }
        });

        allTicketBuyerIds.forEach(userId => {
            if (!winnerUser || userId !== winnerUser.id) {
                nonWinnerUserIds.add(userId);
            }
        });

        const nonWinnerPhones: string[] = [];
         nonWinnerUserIds.forEach(userId => {
             const phone = usersWithPhone.get(userId); // Usar o mapa criado no topo
             if (phone) {
                  nonWinnerPhones.push(phone);
             }
        });


        if (nonWinnerPhones.length > 0) {
             this.logger.log(`Enviando mensagem de não vitória para ${nonWinnerPhones.length} usuário(s) da rifa ${raffle.id}.`);
            try {
                await sendMessageMass(nonWinnerPhones, formattedDrawDate, winningTicketDisplay, raffleSeries);
                 this.logger.log(`Mensagem em massa enviada para ${nonWinnerPhones.length} usuário(s) da rifa ${raffle.id}.`);
            } catch (msgErr: any) {
                 this.logger.error(`Falha ao enviar mensagem em massa para rifa tradicional ${raffle.id}: ${msgErr.message}`);
            }
        } else {
             this.logger.log(`Nenhum não ganhador com telefone cadastrado na rifa tradicional ${raffle.id}. Nenhuma mensagem em massa enviada.`);
        }
    }

    // --- Lógica para Rifa de Equipes (MODIFICADA) ---
    else if (raffle.type === 'equipes') {
        const winningTeamName = this.getTeamNameByTicketNumber(raffle, raffle.winningTicket);

         // Enviar mensagem para o ganhador PRINCIPAL (se houver)
         if (winnerUser && winnerUser.phone) {
              try {
                  // Ganhador principal recebe a mensagem individual de vitória
                  await sendMessageWinning(winnerUser.phone, formattedDrawDate, winningTicketDisplay, winningTicketDisplay);
                   this.logger.log(`Mensagem de vitória (principal) enviada para ${winnerUser.id} (${winnerUser.phone}) da rifa ${raffle.id}.`);
              } catch (msgErr: any) {
                   this.logger.error(`Falha ao enviar mensagem de vitória (principal) para ${winnerUser.id} (${winnerUser.phone}) da rifa ${raffle.id}: ${msgErr.message}`);
              }
         } else if (winnerUser && !winnerUser.phone) {
              this.logger.warn(`Ganhador principal ${winnerUser.id} da rifa ${raffle.id} não possui número de telefone. Mensagem de vitória não enviada.`);
         } else {
             this.logger.log(`Nenhum ganhador principal na rifa de equipes ${raffle.id}. Nenhuma mensagem de vitória para usuário específico.`);
         }

         // Identificar membros da equipe vencedora (EXCLUINDO o ganhador principal)
         const winningTeamMemberUserIds = new Set<number>();
         if (winningTeamMembersDetails) { // winningTeamMembersDetails é o array de detalhes dos membros elegíveis
             winningTeamMembersDetails.forEach(member => {
                 // Se o membro da equipe NÃO for o ganhador principal, adiciona à lista para mensagem em massa da equipe
                 if (!winnerUser || member.userId !== winnerUser.id) {
                      winningTeamMemberUserIds.add(member.userId);
                 }
             });
         }

         const winningTeamMemberPhones: string[] = [];
         winningTeamMemberUserIds.forEach(userId => {
             const phone = usersWithPhone.get(userId); // Usar o mapa criado no topo
             if (phone) {
                  winningTeamMemberPhones.push(phone);
             }
         });


         // Enviar mensagem em massa para os MEMBROS DA EQUIPE VENCEDORA (exceto o principal)
         if (winningTeamMemberPhones.length > 0) {
              this.logger.log(`Enviando mensagem de vitória (equipe) para ${winningTeamMemberPhones.length} membro(s) da equipe vencedora da rifa ${raffle.id}.`);
             try {
                 // Usar a NOVA função sendMessageMassWinning
                 await sendMessageMassWinning(winningTeamMemberPhones, formattedDrawDate, winningTicketDisplay, raffleSeries);
                  this.logger.log(`Mensagem em massa (equipe) enviada para ${winningTeamMemberPhones.length} membro(s) da equipe vencedora da rifa ${raffle.id}.`);
             } catch (msgErr: any) {
                  this.logger.error(`Falha ao enviar mensagem em massa (equipe) para rifa de equipes ${raffle.id}: ${msgErr.message}`);
             }
         } else {
              // Isso pode acontecer se o ganhador principal for o ÚNICO membro da equipe vencedora a comprar um bilhete.
              this.logger.log(`Nenhum membro da equipe vencedora elegível (exceto o ganhador principal) com telefone cadastrado na rifa de equipes ${raffle.id}. Nenhuma mensagem em massa (equipe) enviada.`);
         }

         // Identificar TODOS os usuários que NÃO ganharam NADA (nem prêmio principal, nem prêmio de equipe)
         const allWinnerUserIds = new Set<number>(); // Set de IDs de todos os ganhadores (principal + equipe)
         if (winnerUser) allWinnerUserIds.add(winnerUser.id); // Ganhador principal
         winningTeamMemberUserIds.forEach(userId => allWinnerUserIds.add(userId)); // Membros da equipe vencedora (já excluídos do principal)

         const nonWinnerPhones: string[] = [];
         usersWithPhone.forEach((phone, userId) => { // Iterar sobre TODOS os compradores com telefone
              if (!allWinnerUserIds.has(userId)) { // Se o usuário NÃO está na lista de TODOS os ganhadores
                  nonWinnerPhones.push(phone);
              }
         });


         // Enviar mensagem em massa para os NÃO GANHADORES (perdedores)
         if (nonWinnerPhones.length > 0) {
              this.logger.log(`Enviando mensagem de não vitória para ${nonWinnerPhones.length} usuário(s) (perdedores) da rifa de equipes ${raffle.id}.`);
             try {
                 // Usar a função sendMessageMass original
                 await sendMessageMass(nonWinnerPhones, formattedDrawDate, winningTicketDisplay, raffleSeries);
                  this.logger.log(`Mensagem em massa (perdedores) enviada para ${nonWinnerPhones.length} usuário(s) da rifa de equipes ${raffle.id}.`);
             } catch (msgErr: any) {
                  this.logger.error(`Falha ao enviar mensagem em massa (perdedores) para rifa de equipes ${raffle.id}: ${msgErr.message}`);
             }
         } else {
             // Isso pode acontecer se TODOS os compradores com telefone forem ganhadores (principal ou da equipe)
             this.logger.log(`Nenhum não ganhador com telefone cadastrado na rifa de equipes ${raffle.id}. Nenhuma mensagem em massa (perdedores) enviada.`);
         }

    } // Fim da lógica para rifa de equipes

    this.logger.log(`Envio de mensagens para rifa ${raffle.id} concluído.`);
}




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
                          attributes: ['id', 'name'],
                      },
                  ],
                  order: [['createdAt', 'ASC']],
              },
          ],
      });

      if (!raffle) {
          throw new NotFoundException(`Rifa com ID ${raffleId} não encontrada.`);
      }

      return this.formatRaffleTickets(raffle);
  }

  async finalizeRaffle(raffleId: number, transactionHost?: Transaction): Promise<Raffle> {
    const transaction = transactionHost || await this.sequelize.transaction();
    let raffle: Raffle | null = null;
    let winnerUser: User | null = null;

    try {
      raffle = await this.raffleModel.findByPk(raffleId, {
         transaction,
         lock: transaction.LOCK.UPDATE,
       });

      if (!raffle) {
        if (!transactionHost) await transaction.rollback();
        throw new NotFoundException('Rifa tradicional não encontrada.');
      }
      if (raffle.finished) {
        this.logger.warn(`Tentativa de finalizar rifa tradicional ${raffleId} que já está finalizada.`);
        if (!transactionHost) await transaction.commit();
        return raffle; // Retorna a rifa já finalizada
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
      this.logger.log(`Finalizando Rifa Tradicional ${raffle.id}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}. isExtra: ${raffle.isExtra}`);

      const tickets = await this.raffleTicketModel.findAll({
           where: { raffleId: raffle.id },
           include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }],
           transaction
       });

      const winningTicket = tickets?.find(t => t.ticketNumber === winningTicketNumberInternal);

      let winnerUserId: number | null = null;
      const totalCollectedValue = Number(raffle.ticketPrice) * Number(raffle.soldTickets);
      const houseSharePercentage = 0.20;
      const playerPrizePercentage = 0.80;
      const referrerCommissionRateOnHouseShare = 0.05;

      let actualWinnerPrize = 0;
      let mainWinnerReferrerCommission = 0;
      let mainWinnerReferrerActive = false;

      if (winningTicket && winningTicket.user) {
        const winnerUser = winningTicket.user;
        winnerUserId = winnerUser.id;
        this.logger.log(`Bilhete ${winningTicketNumberInternal} (usuário ${winnerUserId} - ${winnerUser.name}) é o vencedor.`);

        actualWinnerPrize = totalCollectedValue * playerPrizePercentage; // 80% do total
        this.logger.log(`Creditando prêmio de R$ ${actualWinnerPrize.toFixed(2)} (80% do total) para o ganhador ${winnerUserId}.`);
        await this.authService.updateUserBalance(winnerUser.id, actualWinnerPrize, transaction);

        if (winnerUser.referrerId) {
             this.logger.log(`Usuário ${winnerUserId} (ganhador) foi indicado por ${winnerUser.referrerId}.`);
             const referrerUser = winnerUser.referrer;

            if (referrerUser) {
                mainWinnerReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);

                const commissionAmount = (totalCollectedValue * houseSharePercentage) * referrerCommissionRateOnHouseShare; // 1% do total

                if (mainWinnerReferrerActive) {
                    mainWinnerReferrerCommission = commissionAmount;
                    this.logger.log(`Indicador ${referrerUser.id} está ativo. Creditando comissão de R$ ${mainWinnerReferrerCommission.toFixed(2)} (1% do total arrecadado) PAGO PELA CASA.`);
                    await this.authService.updateUserBalance(referrerUser.id, mainWinnerReferrerCommission, transaction);
                } else {
                     this.logger.log(`Indicador ${referrerUser.id} NÃO está ativo. Comissão de R$ ${commissionAmount.toFixed(2)} NÃO creditada e fica com a Casa.`);
                     mainWinnerReferrerCommission = 0;
                }
            } else {
                 this.logger.warn(`Indicador (ID ${winnerUser.referrerId}) do usuário ganhador ${winnerUserId} não encontrado. Comissão não aplicável.`);
                 mainWinnerReferrerCommission = 0;
                 mainWinnerReferrerActive = false;
            }
        } else {
             this.logger.log(`Usuário ${winnerUserId} (ganhador) não foi indicado. Sem comissão para indicador.`);
             mainWinnerReferrerCommission = 0;
             mainWinnerReferrerActive = false;
        }
      } else {
        this.logger.log(`Nenhum bilhete vendido corresponde ao número sorteado ${winningTicketNumberInternal}. Prêmio (R$ ${(totalCollectedValue * playerPrizePercentage).toFixed(2)}) não distribuído.`);
        winnerUserId = null;
        actualWinnerPrize = 0;
        mainWinnerReferrerCommission = 0;
        mainWinnerReferrerActive = false;
      }

      await raffle.update({
        finished: true,
        drawDate: now,
        winnerUserId: winnerUserId,
      }, { transaction });

      if (!transactionHost) await transaction.commit();
      this.logger.log(`Rifa Tradicional ${raffle.id} finalizada com sucesso.`);

      if (!transactionHost) await transaction.commit(); // <-- COMMIT AQUI

      // =============================================
      // === CHAMADA PARA A NOVA FUNÇÃO DE MENSAGENS ===
      // =============================================
   try {
         // CORREÇÃO: Passe winnerUser (objeto User | null), NÃO winnerUserId
         await this.notifyWinnersAndLosers(raffle, tickets, winnerUser);
    } catch (messagingError: any) {
        this.logger.error(`ERRO DURANTE O PROCESSO DE NOTIFICAÇÃO para rifa ${raffle.id}: ${messagingError.message}`, messagingError.stack);
    }
      // =============================================
      // === FIM DA CHAMADA ===
      // =============================================


       // O reload agora acontece AQUI, após o commit e o envio das mensagens
       // É importante para garantir que o objeto retornado tenha o estado finalizado
       // e os dados incluídos para formatRaffleDetails.

      
       await raffle.reload({ // Await the reload
            include: [
                { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] },
                { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
            ],
        });

        (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive;
        (raffle as any).mainWinnerReferrerCommission = mainWinnerReferrerCommission;
        (raffle as any).mainWinnerPrize = actualWinnerPrize;
        (raffle as any).winningTeamName = null;
        (raffle as any).numberOfWinningTeamMembersReceivingPrize = null;
        (raffle as any).teamMembersTotalPrize = 0;
        (raffle as any).teamMembersReferrerCommissionTotal = 0;
        (raffle as any).winningTeamMembersDetails = [];

      return raffle;

    } catch (error) {
       if (!transactionHost && transaction && (transaction as any).finished === null) {
            try {
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação da rifa tradicional ${raffleId} devido a erro.`);
            } catch (rollbackError: any) {
                 if (!rollbackError.message?.includes('already')) {
                    this.logger.error(`Erro ao tentar executar rollback no CATCH para rifa tradicional ${raffleId}: ${rollbackError}`);
                 }
            }
       }
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException || error instanceof InternalServerErrorException) {
        throw error;
      }
       if (error instanceof Error && ((error as any).isHandled)) {
           this.logger.error(`Erro esperado durante finalização da rifa ${raffle?.id ?? raffleId}: ${error.message}`);
           if (!(error instanceof BadRequestException)) {
                 throw new InternalServerErrorException(`Erro na operação de saldo durante a finalização da rifa ${raffle?.id ?? raffleId}: ${error.message}`);
           }
            throw error;
       }
      this.logger.error(`Erro inesperado ao finalizar a rifa tradicional ${raffle?.id ?? raffleId}: ${(error as any).message}`, (error as any).stack);
      throw new InternalServerErrorException('Erro interno ao finalizar a rifa tradicional.');
    }
  }

  


    @Cron('*/5 * * * *')
  async finalizeRafflesCronJob() {
      const now = new Date();
      this.logger.log(`CRON [${now.toISOString()}]: Verificando rifas para finalizar...`);

      const rafflesToFinalize = await this.raffleModel.findAll({
          where: {
              finished: false,
              [Op.or]: [
                  { soldTickets: { [Op.gte]: Sequelize.col('totalTickets') } }
              ]
          },
           order: [['endDate', 'ASC'], ['createdAt', 'ASC']]
      });

      if (rafflesToFinalize.length === 0) {
          this.logger.log('CRON: Nenhuma rifa encontrada para finalizar nesta execução.');
          return;
      }

      this.logger.log(`CRON: Encontradas ${rafflesToFinalize.length} rifas para processar finalização.`);

      for (const raffle of rafflesToFinalize) {
          this.logger.log(`CRON: Iniciando processamento para Rifa ID: ${raffle.id}, Tipo: ${raffle.type}, Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}, EndDate: ${raffle.endDate?.toISOString()}, isExtra: ${raffle.isExtra}`);
          try {
              if (raffle.type === 'tradicional') {
                  await this.finalizeRaffle(raffle.id, undefined);
              } else if (raffle.type === 'equipes') {
                  await this.finalizeTeamRaffle(raffle.id, undefined);
              }
              this.logger.log(`CRON: Rifa ${raffle.id} finalizada com sucesso.`);
          } catch (error) {
              this.logger.error(`CRON: Erro ao finalizar rifa ${raffle.id}: ${(error as any).message}`);
               if (!(error instanceof BadRequestException || error instanceof NotFoundException || ((error as any).isHandled))) {
                   this.logger.error(`CRON: Stacktrace para Rifa ${raffle.id}: ${(error as any).stack}`);
               }
          }
      }
      this.logger.log('CRON: Processamento de finalização de rifas concluído.');
  }


  async getRaffleTeams(raffleId: number): Promise<any> {
    const raffle = await this.raffleModel.findByPk(raffleId, {
      attributes: ['id', 'type', 'totalTickets'],
      include: [
        {
          model: RaffleTicket,
          attributes: ['ticketNumber', 'userId'],
          include: [
            { model: User, attributes: ['id', 'name'] },
          ],
        },
      ],
    });

    if (!raffle) throw new NotFoundException('Rifa não encontrada.');
    if (raffle.type !== 'equipes') throw new BadRequestException('Esta rota é válida apenas para rifas de equipes.');

    const formattedTeams = this.getFormattedTeams(raffle);

    Object.values(formattedTeams).forEach((team: any) => {
        team.tickets = team.tickets.map(this.formatTicketNumberDisplay);
        team.members.forEach((member: any) => {
             member.tickets = member.tickets.map(this.formatTicketNumberDisplay);
        });
    });

    return formattedTeams;
  }


  async getRafflesPlayedByUser(userId: number): Promise<any[]> {
    const raffles = await this.raffleModel.findAll({
        include: [
            {
                model: RaffleTicket,
                as: 'tickets',
                required: true,
                include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }]
            },
            { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
            { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
            { model: User, as: 'createdByUser', attributes: ['id', 'name']}
        ],
        where: Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`),
        order: [['createdAt', 'DESC']]
    });

    return raffles.map(raffle => {
         const details = this.formatRaffleDetails(raffle);
         details.userTickets = this.formatRaffleTickets(raffle)
                               .filter(ticket => ticket.user?.id === userId);
         return details;
     });
  }

  async getWonRafflesByUser(userId: number): Promise<any[]> {
       const raffles = await this.raffleModel.findAll({
           where: {
               finished: true,
                [Op.and]: [
                    Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`)
                ]
           },
           include: [
                { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'] }] },
               { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
               { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
           ],
           order: [['drawDate', 'DESC']],
       });

     const wonRaffles = raffles.filter(raffle => {
         if (raffle.winnerUserId === userId) {
             return true;
         }
         if (raffle.type === 'equipes' && raffle.finished) {
             const winningTicketNumberInternal = raffle.winningTicket;
              if (!winningTicketNumberInternal) return false;

             const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal);

             if (winningTeamName && winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
                 const userTicketsInThisRaffle = raffle.tickets?.filter(ticket => ticket.userId === userId) || [];
                 return userTicketsInThisRaffle.some(ticket =>
                     this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                     ticket.userId !== raffle.winnerUserId
                 );
             }
         }
         return false;
     });

     return wonRaffles.map(raffle => this.formatRaffleDetails(raffle));
  }
  async getLostRafflesByUser(userId: number): Promise<any[]> {
     const raffles = await this.raffleModel.findAll({
         where: {
             finished: true,
              [Op.and]: [
                  Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`)
              ]
         },
         include: [
              { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'] }] },
             { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
             { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
         ],
         order: [['drawDate', 'DESC']],
     });

     const lostRaffles = raffles.filter(raffle => {
         if (raffle.winnerUserId === userId) {
             return false;
         }
          if (raffle.type === 'equipes' && raffle.finished) {
              const winningTicketNumberInternal = raffle.winningTicket;
               if (!winningTicketNumberInternal) return true; // Se não há bilhete vencedor, todos os participantes perdem

              const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal);

               if (winningTeamName && winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
                  const userTicketsInThisRaffle = raffle.tickets?.filter(ticket => ticket.userId === userId) || [];
                  const wonTeamPrize = userTicketsInThisRaffle.some(ticket =>
                      this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                      ticket.userId !== raffle.winnerUserId // Se ele já ganhou o prêmio principal, não conta como perdido aqui
                  );
                  if (wonTeamPrize) { // Se ele ganhou o prêmio da equipe (e não o principal)
                       return false;
                  }
               }
          }
         return true; // Se não ganhou nem o principal nem o da equipe (ou é rifa tradicional e não é o winnerUserId)
     });

    return lostRaffles.map(raffle => this.formatRaffleDetails(raffle));
}

async getUserRaffleData(userId: number): Promise<any> {
  const user = await this.userModel.findByPk(userId, {
    attributes: ['id', 'name', 'email', 'cpf', 'phone', 'balance'],
  });

  if (!user) {
    throw new NotFoundException('Usuário não encontrado.');
  }

  const playedRaffles = await this.raffleModel.findAll({
      include: [
          {
              model: RaffleTicket,
              as: 'tickets',
              required: true,
              include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }]
          },
          { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
          { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
          { model: User, as: 'createdByUser', attributes: ['id', 'name']}
      ],
      where: Sequelize.literal(`EXISTS (SELECT 1 FROM raffle_tickets rt WHERE rt."raffleId" = "Raffle"."id" AND rt."userId" = ${userId})`),
      order: [['createdAt', 'DESC']]
  });

  return playedRaffles.map(raffle => {
       const details = this.formatRaffleDetails(raffle);
       details.userTickets = this.formatRaffleTickets(raffle)
                             .filter(ticket => ticket.user?.id === userId);
       return details;
   });
}

  private getTeamNameByTicketNumber(raffle: Raffle, ticketNumber: string): string {
    if (!ticketNumber || raffle.type !== 'equipes') return 'N/A';
    try {
        const ticketNumberInt = parseInt(ticketNumber, 10);
        if (isNaN(ticketNumberInt) || ticketNumberInt < 0 || ticketNumberInt >= raffle.totalTickets) {
            return 'Inválido';
        }
        const teamIndex = Math.floor(ticketNumberInt / 4);
        return this.teamNames[teamIndex] || 'Desconhecido';
     } catch (e) {
         return 'Erro';
     }
  }

  private getFormattedTeams(raffle: Raffle): any {
    if (raffle.type !== 'equipes' || !raffle.tickets) return {};

    const totalTickets = raffle.totalTickets;
    const ticketsPerTeam = 4;
    const totalTeams = Math.min(this.teamNames.length, Math.floor(totalTickets / ticketsPerTeam));
    const teams: { [key: string]: { teamName: string; tickets: string[]; members: { id: number; name: string; tickets: string[] }[] } } = {};

    const ticketsMap = new Map<string, RaffleTicket>(raffle.tickets.map(t => [t.ticketNumber, t]));

    for (let i = 0; i < totalTeams; i++) {
      const teamName = this.teamNames[i];
      const teamTicketsInternal: string[] = [];
      const membersMap = new Map<number, { id: number; name: string; tickets: string[] }>();

      for (let j = 0; j < ticketsPerTeam; j++) {
        const ticketNumberInternal = (i * ticketsPerTeam + j).toString().padStart(2, '0');
        if (i * ticketsPerTeam + j < totalTickets) {
            teamTicketsInternal.push(ticketNumberInternal);

            const purchasedTicket = ticketsMap.get(ticketNumberInternal);
            if (purchasedTicket && purchasedTicket.user) {
              const userId = purchasedTicket.user.id;
              if (!membersMap.has(userId)) {
                membersMap.set(userId, {
                  id: userId,
                  name: purchasedTicket.user.name,
                  tickets: [],
                });
              }
              membersMap.get(userId)?.tickets.push(ticketNumberInternal);
            }
        }
      }

      teams[teamName] = {
        teamName: teamName,
        tickets: teamTicketsInternal,
        members: Array.from(membersMap.values()),
      };
    }
    return teams;
  }

  getTeamNames() {
    return this.teamNames;
  }

async finalizeTeamRaffle(raffleId: number, transactionHost?: Transaction): Promise<Raffle> {
    const transaction = transactionHost || await this.sequelize.transaction();
    let raffle: Raffle | null = null; // raffle pode ser null inicialmente

    try {
      raffle = await this.raffleModel.findByPk(raffleId, { // raffle é atribuído aqui
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!raffle) { // Verificação de nulidade de raffle
         if (!transactionHost) await transaction.rollback();
         throw new NotFoundException('Rifa de equipes não encontrada.');
      }
      // A partir daqui, raffle NÃO É MAIS NULL dentro deste bloco try,
      // a menos que seja reatribuído para null, o que não acontece.

      if (raffle.finished) {
           this.logger.warn(`Tentativa de finalizar rifa de equipes ${raffleId} que já está finalizada.`);
           if (!transactionHost) await transaction.commit();
           // Recarregar com relações antes de retornar, caso o chamador espere isso.
           // A instância 'raffle' já deve ter as relações do findByPk inicial se elas foram incluídas.
           // Se não, ou se precisar garantir os dados mais recentes:
           await raffle.reload({
                include: [
                    { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                    { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] },
                    { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
                ]
           });
           // Anexar os detalhes calculados se eles já foram armazenados na rifa de alguma forma
           // ou se a formatação no retorno os preenche.
           // Para consistência, se a rifa já está finalizada e tem esses campos, podemos usá-los.
            (raffle as any).mainWinnerPrize = (raffle as any).mainWinnerPrize ?? 0;
            (raffle as any).mainWinnerReferrerCommission = (raffle as any).mainWinnerReferrerCommission ?? 0;
            (raffle as any).mainWinnerReferrerActive = (raffle as any).mainWinnerReferrerActive ?? false;
            (raffle as any).teamMembersTotalPrize = (raffle as any).teamMembersTotalPrize ?? 0;
            (raffle as any).teamMembersReferrerCommissionTotal = (raffle as any).teamMembersReferrerCommissionTotal ?? 0;
            (raffle as any).winningTeamName = (raffle as any).winningTeamName ?? null;
            (raffle as any).numberOfWinningTeamMembersReceivingPrize = (raffle as any).numberOfWinningTeamMembersReceivingPrize ?? 0;
            (raffle as any).winningTeamMembersDetails = (raffle as any).winningTeamMembersDetails ?? [];
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
           if (!transactionHost) await transaction.rollback();
         throw new BadRequestException(
           `A rifa de equipes ${raffleId} ainda não pode ser finalizada. Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}. Fim: ${raffle.endDate?.toISOString() ?? 'N/A'}.`
         );
      }

      const winningTicketNumberInternal = raffle.winningTicket;
       if (!winningTicketNumberInternal) {
            if (!transactionHost) await transaction.rollback();
           throw new InternalServerErrorException(`Rifa de equipes ${raffleId} não possui um bilhete sorteado definido.`);
       }
      this.logger.log(`Finalizando Rifa de Equipes ${raffle.id}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}. isExtra: ${raffle.isExtra}`);

      const tickets = await this.raffleTicketModel.findAll({
          where: { raffleId: raffle.id }, // Confirme se a sintaxe está correta aqui, parece incorreta (deveria ser { raffleId: raffle.id })
          include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }],
          transaction
      });

      const totalCollectedValue = Number(raffle.ticketPrice) * Number(raffle.soldTickets);
      const houseSharePercentage = 0.20; // 20% para a casa
      const referrerCommissionRateOnHouseShare = 0.05; // 5% DA PARTE DA CASA (20%)

      const mainPrizePoolPercentage = 0.50; // 50% do total para o ganhador principal
      const teamPrizePoolPercentage = 0.30; // 30% do total para a equipe
      // Os 20% restantes são da casa

      let actualMainPrize = totalCollectedValue * mainPrizePoolPercentage;
      let actualTeamPrizePool = totalCollectedValue * teamPrizePoolPercentage;

      let mainWinnerPrizePaid = 0;
      let mainWinnerReferrerCommissionPaid = 0;
      let mainWinnerReferrerActive = false;

      let teamMembersTotalPrizePaid = 0;
      let teamMembersTotalReferrerCommissionPaid = 0; // Total de comissões pagas aos indicadores dos membros da equipe
      const winningTeamMembersDetails: any[] = [];
      let numberOfWinningTeamMembersReceivingPrize = 0;
      let winnerUserId: number | null = null;


      const mainWinningTicket = tickets.find(t => t.ticketNumber === winningTicketNumberInternal);

      // CORREÇÃO: Garante que mainWinnerUser seja User | null
      const mainWinnerUser = mainWinningTicket?.user || null;


      if (mainWinnerUser) {
          winnerUserId = mainWinnerUser.id;
          mainWinnerPrizePaid = actualMainPrize; // Ganhador recebe os 50%
          this.logger.log(`Prêmio Principal (50% = R$ ${actualMainPrize.toFixed(2)}) para usuário ${mainWinnerUser.id} (${mainWinnerUser.name}). Creditando R$ ${mainWinnerPrizePaid.toFixed(2)}.`);
          await this.authService.updateUserBalance(mainWinnerUser.id, mainWinnerPrizePaid, transaction);

          if (mainWinnerUser.referrerId) {
               const referrerUser = mainWinnerUser.referrer;
               if (referrerUser) {
                  mainWinnerReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);
                  // Comissão é 5% da parte da casa (20% do total) = 1% do total arrecadado
                  const commissionAmount = (totalCollectedValue * houseSharePercentage) * referrerCommissionRateOnHouseShare;
                  if (mainWinnerReferrerActive) {
                      mainWinnerReferrerCommissionPaid = commissionAmount;
                      this.logger.log(`Indicador ${referrerUser.id} (do Ganhador Principal) está ativo. Creditando comissão de R$ ${mainWinnerReferrerCommissionPaid.toFixed(2)} (1% do total) PAGO PELA CASA.`);
                      await this.authService.updateUserBalance(referrerUser.id, mainWinnerReferrerCommissionPaid, transaction);
                  } else {
                       this.logger.log(`Indicador ${referrerUser.id} (do Ganhador Principal) NÃO está ativo. Comissão de R$ ${commissionAmount.toFixed(2)} NÃO creditada e fica com a Casa.`);
                       mainWinnerReferrerCommissionPaid = 0; // Garante que seja 0 se não pago
                  }
               } else {
                  this.logger.warn(`Indicador (ID ${mainWinnerUser.referrerId}) do Ganhador Principal ${mainWinnerUser.id} não encontrado. Comissão não aplicável.`);
                  mainWinnerReferrerCommissionPaid = 0;
                  mainWinnerReferrerActive = false;
               }
          } else {
              this.logger.log(`Ganhador Principal ${mainWinnerUser.id} não foi indicado. Sem comissão para indicador.`);
              mainWinnerReferrerCommissionPaid = 0;
              mainWinnerReferrerActive = false;
          }
      } else {
         this.logger.log(`Ninguém comprou o bilhete principal ${winningTicketNumberInternal}. Prêmio principal (R$ ${actualMainPrize.toFixed(2)}) não distribuído.`);
         mainWinnerPrizePaid = 0;
         mainWinnerReferrerCommissionPaid = 0;
         mainWinnerReferrerActive = false;
      }

      // raffle aqui NUNCA é null por causa da checagem no início.
      const winningTeamName = this.getTeamNameByTicketNumber(raffle!, winningTicketNumberInternal);

      if (winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
          const winningTeamTickets = tickets.filter(
              // raffle aqui NUNCA é null
              (ticket) => this.getTeamNameByTicketNumber(raffle!, ticket.ticketNumber) === winningTeamName &&
                          (mainWinnerUser ? ticket.userId !== mainWinnerUser.id : true) // Exclui o ganhador principal
          );

          const teamMemberUsersWhoBought = new Map<number, User>(); // UserID -> User object
          winningTeamTickets.forEach(ticket => {
              if (ticket.user && !teamMemberUsersWhoBought.has(ticket.user.id)) { // Apenas usuários únicos
                   teamMemberUsersWhoBought.set(ticket.user.id, ticket.user);
              }
          });

          numberOfWinningTeamMembersReceivingPrize = teamMemberUsersWhoBought.size;

          if (numberOfWinningTeamMembersReceivingPrize > 0) {
              const individualTeamPoolShare = actualTeamPrizePool / numberOfWinningTeamMembersReceivingPrize; // Divide o pool de 30%
              this.logger.log(`Equipe Vencedora ${winningTeamName}: ${numberOfWinningTeamMembersReceivingPrize} membro(s) elegível(is) para o prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}). Parte base individual: R$ ${individualTeamPoolShare.toFixed(2)}.`);

              for (const user of teamMemberUsersWhoBought.values()) {
                  let memberPrizeShare = individualTeamPoolShare; // Prêmio do membro da equipe
                  teamMembersTotalPrizePaid += memberPrizeShare;
                  this.logger.log(`Creditando prêmio líquido de R$ ${memberPrizeShare.toFixed(2)} para o membro da equipe ${user.id}.`);
                  await this.authService.updateUserBalance(user.id, memberPrizeShare, transaction);

                  let memberReferrerCommissionShare = 0;
                  let memberReferrerActive = false;

                  if (user.referrerId) {
                       const referrerUser = user.referrer;
                       if (referrerUser) {
                            memberReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);
                            // Comissão é 5% da parte da casa (20% do total) = 1% do total arrecadado
                            const commissionAmount = (totalCollectedValue * houseSharePercentage) * referrerCommissionRateOnHouseShare;
                            if (memberReferrerActive) {
                               memberReferrerCommissionShare = commissionAmount;
                               teamMembersTotalReferrerCommissionPaid += memberReferrerCommissionShare; // Acumula comissão da equipe
                               this.logger.log(`Indicador ${referrerUser.id} (do membro ${user.id}) está ativo. Creditando comissão de R$ ${memberReferrerCommissionShare.toFixed(2)} (1% do total) PAGO PELA CASA.`);
                              await this.authService.updateUserBalance(referrerUser.id, memberReferrerCommissionShare, transaction);
                            } else {
                              this.logger.log(`Indicador ${referrerUser.id} (do membro ${user.id}) NÃO está ativo. Comissão de R$ ${commissionAmount.toFixed(2)} NÃO creditada e fica com a Casa.`);
                              memberReferrerCommissionShare = 0; // Garante que seja 0 se não pago
                            }
                       } else {
                          this.logger.warn(`Indicador (ID ${user.referrerId}) do membro da equipe ${user.id} não encontrado. Comissão não aplicável.`);
                          memberReferrerCommissionShare = 0;
                          memberReferrerActive = false;
                       }
                  } else {
                       this.logger.log(`Membro da equipe ${user.id} não foi indicado. Sem comissão para indicador.`);
                       memberReferrerCommissionShare = 0;
                       memberReferrerActive = false;
                  }
                   winningTeamMembersDetails.push({
                          userId: user.id,
                          userName: user.name,
                          prize: memberPrizeShare, // Prêmio pago ao membro
                          referrerCommission: memberReferrerCommissionShare, // Comissão paga ao indicador do membro
                          referrerActive: memberReferrerActive,
                          hasReferrer: !!user.referrerId,
                          // raffle aqui NUNCA é null
                          tickets: tickets.filter(t => t.userId === user.id && this.getTeamNameByTicketNumber(raffle!, t.ticketNumber) === winningTeamName).map(t => t.ticketNumber),
                       });
              }
          } else {
              this.logger.log(`Equipe Vencedora ${winningTeamName}: Nenhum outro membro (além do vencedor principal, se houver) comprou bilhetes. Prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}) não distribuído aos jogadores.`);
              teamMembersTotalPrizePaid = 0; // Garante que seja 0
          }
      } else {
          this.logger.log(`Não foi possível determinar a equipe vencedora (ticket: ${winningTicketNumberInternal}, nome: ${winningTeamName}). Prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}) não distribuído aos jogadores.`);
           teamMembersTotalPrizePaid = 0; // Garante que seja 0
      }

      // Salva os detalhes calculados na instância raffle antes do commit
      (raffle as any).winningTeamName = winningTeamName;
      (raffle as any).numberOfWinningTeamMembersReceivingPrize = numberOfWinningTeamMembersReceivingPrize;
      (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive;
      (raffle as any).mainWinnerReferrerCommission = mainWinnerReferrerCommissionPaid; // Comissão PAGA
      (raffle as any).teamMembersTotalReferrerCommissionTotal = teamMembersTotalReferrerCommissionPaid; // Total de comissões PAGAS aos indic. da equipe
      (raffle as any).winningTeamMembersDetails = winningTeamMembersDetails; // Detalhes dos membros com prêmios e comissões pagas
      (raffle as any).mainWinnerPrize = mainWinnerPrizePaid; // Prêmio PAGO ao ganhador principal
      (raffle as any).teamMembersTotalPrize = teamMembersTotalPrizePaid; // Total de prêmios PAGOS aos membros da equipe


      await raffle!.update({
          finished: true,
          drawDate: now,
          winnerUserId: winnerUserId, // Salva o ID do ganhador principal (pode ser null)
      }, { transaction });

      if (!transactionHost) await transaction.commit();
      this.logger.log(`Rifa de equipe ${raffle!.id} finalizada com sucesso.`);

      try {
            // Chama a nova função APÓS o commit, passando os dados necessários
            // CORREÇÃO: mainWinnerUser agora é User | null devido à alteração acima
            await this.notifyWinnersAndLosers(raffle!, tickets, mainWinnerUser, winningTeamMembersDetails);
       } catch (messagingError: any) {
            // Loga o erro de mensageria, mas não reverte a transação do DB
            this.logger.error(`ERRO DURANTE O PROCESSO DE NOTIFICAÇÃO para rifa ${raffle!.id}: ${messagingError.message}`, messagingError.stack);
       }
       // =============================================
       // === FIM DA CHAMADA ===
       // =============================================


       await raffle!.reload({
             include: [
                  { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                  { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] },
                  { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
              ],
         });

      // Anexar os valores calculados e pagos para serem usados por calculatePrizeDetails no retorno
      (raffle as any).winningTeamName = winningTeamName;
      (raffle as any).numberOfWinningTeamMembersReceivingPrize = numberOfWinningTeamMembersReceivingPrize;
      (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive;
      (raffle as any).mainWinnerReferrerCommission = mainWinnerReferrerCommissionPaid; // Comissão PAGA
      (raffle as any).teamMembersTotalReferrerCommissionTotal = teamMembersTotalReferrerCommissionPaid; // Total de comissões PAGAS aos indic. da equipe
      (raffle as any).winningTeamMembersDetails = winningTeamMembersDetails; // Detalhes dos membros com prêmios e comissões pagas
      (raffle as any).mainWinnerPrize = mainWinnerPrizePaid; // Prêmio PAGO ao ganhador principal
      (raffle as any).teamMembersTotalPrize = teamMembersTotalPrizePaid; // Total de prêmios PAGOS aos membros da equipe

      return raffle!;

    } catch (error) {
       const raffleIdForLog = raffle ? raffle.id : raffleId;
       if (!transactionHost && transaction && (transaction as any).finished === null) {
            try {
                await transaction.rollback();
                this.logger.warn(`Rollback executado para transação da rifa de equipe ${raffleIdForLog} devido a erro.`);
            } catch (rollbackError: any) {
                 if (!rollbackError.message?.includes('already')) {
                     this.logger.error(`Erro ao tentar executar rollback no CATCH para rifa de equipe ${raffleIdForLog}: ${rollbackError}`);
                 }
            }
       }
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException || error instanceof InternalServerErrorException) {
         throw error;
      }
       if (error instanceof Error && ((error as any).isHandled)) {
           this.logger.error(`Erro esperado durante finalização da rifa ${raffleIdForLog}: ${error.message}`);
           if (!(error instanceof BadRequestException)) {
                 throw new InternalServerErrorException(`Erro na operação de saldo durante a finalização da rifa ${raffleIdForLog}: ${error.message}`);
           }
            throw error;
       }
      this.logger.error(`Erro inesperado ao finalizar a rifa de equipe ${raffleIdForLog}: ${(error as any).message}`, (error as any).stack);
      throw new InternalServerErrorException('Erro interno ao finalizar a rifa de equipe.');
    }
  }

    async getRaffleTeamsWithAvailability(raffleId: number): Promise<any> {
      const raffle = await this.raffleModel.findByPk(raffleId, {
          attributes: ['id', 'type', 'totalTickets', 'finished'],
          include: [
              { model: RaffleTicket, attributes: ['ticketNumber', 'userId'], include: [{ model: User, attributes: ['id', 'name'] }] },
          ],
      });

      if (!raffle) throw new NotFoundException('Rifa não encontrada.');
      if (raffle.type !== 'equipes') throw new BadRequestException('Esta rota é válida apenas para rifas de equipes.');
       if (raffle.finished) throw new BadRequestException('Esta rifa já foi finalizada, não há disponibilidade.');

      const formattedTeams = this.getFormattedTeams(raffle);

      // const allInternalTickets = Array.from({ length: raffle.totalTickets }, (_, i) => i.toString().padStart(2, '0')); // Não usado diretamente aqui
      const purchasedInternalTickets = new Set(raffle.tickets?.map(t => t.ticketNumber) || []);

      const availableTicketsByTeam: { [key: string]: string[] } = {};

      for (const teamName of Object.keys(formattedTeams)) {
          const teamData = formattedTeams[teamName];
          availableTicketsByTeam[teamName] = teamData.tickets // tickets internos do time
              .filter(internalTicket => !purchasedInternalTickets.has(internalTicket))
              .map(this.formatTicketNumberDisplay);
      }

       Object.values(formattedTeams).forEach((team: any) => {
            team.tickets = team.tickets.map(this.formatTicketNumberDisplay);
            team.members.forEach((member: any) => {
                if (member.tickets) {
                     member.tickets = member.tickets.map(this.formatTicketNumberDisplay);
                } else {
                    member.tickets = [];
                }
            });
        });

      return {
          raffleId: raffle.id,
          teams: Object.values(formattedTeams),
          availableTicketsByTeam: availableTicketsByTeam,
      };
  }


  async reopenRaffleById(raffleId: number): Promise<Raffle> {
      this.logger.log(`Tentando reabrir rifa com ID: ${raffleId}...`);

      const raffle = await this.raffleModel.findByPk(raffleId);

      if (!raffle) {
          this.logger.warn(`Tentativa de reabrir rifa ${raffleId}: Rifa não encontrada.`);
          throw new NotFoundException(`Rifa com ID ${raffleId} não encontrada.`);
      }

      if (!raffle.finished) {
           this.logger.warn(`Tentativa de reabrir rifa ${raffleId}: Rifa já está ativa.`);
           throw new BadRequestException(`A rifa com ID ${raffleId} já está ativa.`);
      }

       // Adicionar verificação: só reabrir se não esgotou?
       // A instrução foi reabrir as que não esgotaram, então vamos adicionar essa condição.
       if (raffle.soldTickets >= raffle.totalTickets) {
           this.logger.warn(`Tentativa de reabrir rifa ${raffleId}: Rifa já esgotou os bilhetes.`);
           throw new BadRequestException(`A rifa com ID ${raffleId} esgotou os bilhetes e não pode ser reaberta por este método.`);
       }


      try {
          // Ao reabrir, precisamos limpar os dados de sorteio/ganhador
          await raffle.update({
              finished: false,
              drawDate: null, // Limpa a data do sorteio
              winnerUserId: null, // Limpa o ganhador
              winningTicket: null, // Limpa o bilhete vencedor (o bilhete sorteado)
              // Manter soldTickets, ticketPrice, totalTickets, dates, etc. como estão.
              // O 'isExtra' também deve ser mantido.
          });

          this.logger.log(`Rifa ${raffleId} (${raffle.raffleIdentifier}, R$ ${raffle.ticketPrice}, Tipo: ${raffle.type}) reaberta com sucesso (finished=false).`);

          // Retornar a rifa atualizada
          // Opcional: Recarregar com includes se o chamador precisar dos relacionamentos
          // await raffle.reload({ /* inclua os modelos necessários aqui se quiser retorná-los */ });
          return raffle;

      } catch (error) {
          this.logger.error(`Erro ao reabrir a rifa ${raffleId}: ${(error as Error).message}`, (error as Error).stack);
          throw new InternalServerErrorException(`Erro interno ao reabrir a rifa com ID ${raffleId}.`);
      }
    }

      async deleteRaffleById(raffleId: number): Promise<void> {
      this.logger.warn(`INICIANDO PROCESSO DE EXCLUSÃO DA RIFA ID ${raffleId}. ISSO É IRREVERSÍVEL PARA ESTA RIFA!`);

      const transaction = await this.sequelize.transaction();

      try {
          // Verificar se a rifa existe primeiro
          const raffle = await this.raffleModel.findByPk(raffleId, { transaction });
          if (!raffle) {
              await transaction.rollback(); // Rollback antes de lançar erro
              this.logger.warn(`Tentativa de excluir rifa ${raffleId}: Rifa não encontrada.`);
              throw new NotFoundException(`Rifa com ID ${raffleId} não encontrada.`);
          }

          // 1. Apagar RaffleTickets associados a esta rifa
          const ticketsDeleted = await this.raffleTicketModel.destroy({ where: { raffleId: raffleId }, transaction });
          this.logger.log(`Excluídos ${ticketsDeleted} RaffleTickets associados à rifa ${raffleId}.`);

          // 2. Apagar RaffleNumbers associados a esta rifa
          const raffleNumbersDeleted = await this.raffleNumberModel.destroy({ where: { raffleId: raffleId }, transaction });
           this.logger.log(`Excluídos ${raffleNumbersDeleted} RaffleNumbers associados à rifa ${raffleId}.`);

          // 3. Apagar a Rifa principal
          const rafflesDeleted = await this.raffleModel.destroy({ where: { id: raffleId }, transaction });
          this.logger.log(`Excluída ${rafflesDeleted} Rifa principal (ID ${raffleId}).`);

          await transaction.commit();
          this.logger.warn(`PROCESSO DE EXCLUSÃO DA RIFA ID ${raffleId} CONCLUÍDO COM SUCESSO.`);

      } catch (error) {
           if (transaction && (transaction as any).finished === null) { // Verifica se a transação não foi finalizada
               try {
                   await transaction.rollback();
                   this.logger.warn(`Rollback executado para exclusão da rifa ${raffleId} devido a erro no catch.`);
               } catch (rollbackError: any) {
                   // Evitar logar erro de rollback se já foi feito ou não é necessário
                    if (!rollbackError.message?.includes('already rollbacked') && !rollbackError.message?.includes('not in progress')) {
                       this.logger.error(`Erro crítico ao tentar executar rollback no CATCH para exclusão da rifa ${raffleId}: ${rollbackError}`);
                    }
               }
            }

          // Re-throw errors that are already handled (like NotFoundException)
           if (error instanceof NotFoundException || error instanceof BadRequestException) {
              throw error;
           }

          this.logger.error(`ERRO CRÍTICO AO EXCLUIR A RIFA ID ${raffleId}: ${(error as Error).message}`, (error as Error).stack);
          throw new InternalServerErrorException(`Erro interno ao tentar apagar a rifa com ID ${raffleId}.`);
      }
  }

}