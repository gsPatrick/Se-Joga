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
import { Cron, CronExpression } from '@nestjs/schedule';
import { Op } from 'sequelize';
import { AuthService } from 'src/Auth/auth.service';


@Injectable()
export class RaffleService {
  private readonly logger = new Logger(RaffleService.name);

  public readonly teamNames = [
    'Brasil', 'Alemanha', 'Itália', 'Argentina', 'França',
    'Espanha', 'Inglaterra', 'Uruguai', 'Holanda', 'Portugal',
    'Bélgica', 'Croácia', 'México', 'Colôbia', 'Chile',
    'Paraguai', 'Estados Unidos', 'Rússia', 'Suécia', 'Dinamarca',
    'Servia', 'Japão', 'Coreia do Sul', 'Camarões', 'Nigéria'
  ];

  public readonly fixedRafflePrices = [5, 10, 15, 25, 50, 100]; // Preços fixos


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
       return {
           id: raffle.id,
           raffleIdentifier: raffle.raffleIdentifier,
           type: raffle.type,
           title: raffle.title,
           ticketPrice: Number(raffle.ticketPrice), // Manter como número para possíveis cálculos no front
           totalTickets: raffle.totalTickets,
           soldTickets: raffle.soldTickets,
           finished: raffle.finished,
           isExtra: raffle.isExtra, // Inclui o flag isExtra no resumo
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
        // Arredonda para a próxima hora cheia mais próxima (e.g., 10:01 -> 11:00, 10:59 -> 11:00)
         // Se já passou da hora atual, vai para a próxima hora. Se for na hora atual, vai para a próxima hora.
        if (nextHour.getMinutes() > 0 || nextHour.getSeconds() > 0 || nextHour.getMilliseconds() > 0) {
            nextHour.setHours(now.getHours() + 1, 0, 0, 0);
        } else { // Se for exatamente na hora cheia (ex: 10:00:00.000), ainda vai para a próxima hora (11:00)
             nextHour.setHours(now.getHours() + 1, 0, 0, 0);
        }
        return nextHour;
    }

    // Condição 2: Data de Fim futura definida
    if (raffle.endDate) {
      return raffle.endDate;
    }

    // Condição 3: Indeterminada (não esgotada, sem data de fim) - Não deve acontecer com rifas fixas/extra com endDate
    return null;
  }


  // Função auxiliar para calcular detalhes do prêmio (usada para exibição)
  // Função auxiliar para calcular detalhes do prêmio (usada para exibição)
  private calculatePrizeDetails(raffle: Raffle): any {
    // totalCollectedValue é o valor arrecadado com base nos bilhetes *vendidos*
    const totalCollectedValue = Number(raffle.ticketPrice) * Number(raffle.soldTickets);
    // totalPotentialValue é a estimativa com base nos bilhetes *totais* (se tudo vender)
    const totalPotentialValue = Number(raffle.ticketPrice) * Number(raffle.totalTickets);

    // Validação básica para evitar NaN ou valores negativos
    if (isNaN(totalCollectedValue) || totalCollectedValue < 0 || isNaN(totalPotentialValue) || totalPotentialValue < 0 || !raffle.ticketPrice || !raffle.totalTickets) {
         return {
             totalCollected: 0,
             houseShare: 0,
             totalDistributedToPlayers: 0,
             totalReferrerCommissionPaid: 0, // Total pago para indicadores
             mainWinnerPrize: 0, // Prêmio do ganhador principal (sem dedução de comissão)
             mainWinnerReferrerCommission: raffle.finished ? 0 : null, // Comissão REAL do indicador do principal
             mainWinnerReferrerActive: raffle.finished ? false : null, // Indicador do principal ativo
             teamPrizePoolPotential: 0, // Estimativa pool equipe
             teamMembersTotalPrize: raffle.finished ? 0 : null, // Total prêmio membros equipe (sem dedução)
             teamMembersReferrerCommissionTotal: raffle.finished ? 0 : null, // Total comissão indicadores membros equipe
              // Novo campo: lista de membros da equipe com status de indicação e prêmio
            teamMembersDetails: raffle.finished ? [] : null,
             winningTeamName: raffle.finished ? (raffle as any).winningTeamName ?? "Indeterminado" : null, // Obter nome real se finalizado
             numberOfWinningTeamMembersReceivingPrize: raffle.finished ? (raffle as any).teamMembersCount ?? 0 : null, // Contagem real de membros que ganharam no pool
             details: "Não foi possível calcular os detalhes do prêmio (dados inválidos)."
         };
    }

    let totalReferrerCommissionPaid = 0; // Total que saiu da Casa para indicadores
    let actualTotalPrizeDistributedToPlayers = 0; // Total que saiu da Casa para JOGADORES
    let mainWinnerPrize = 0; // Prêmio do ganhador principal (REAL ou POTENCIAL)
    let teamMembersTotalPrize = 0; // Total prêmio membros equipe (REAL ou POTENCIAL)
    let mainWinnerReferrerCommission = 0; // Comissão do indicador do principal (REAL ou POTENCIAL)
    let teamMembersReferrerCommissionTotal = 0; // Total comissão indicadores membros equipe (REAL ou POTENCIAL)
    let winningTeamName: string | null = null;
    let numberOfWinningTeamMembersReceivingPrize: number | null = null;
    let mainWinnerReferrerActive: boolean | null = null;
    let teamMembersDetails: any[] | null = null;


    if (raffle.finished) {
        // Se a rifa finalizou, usamos os valores que foram CALCULADOS E DISTRIBUÍDOS
        // Estes valores são anexados ao objeto Raffle pela função finalizeRaffle/finalizeTeamRaffle antes de ser retornado/recarregado
        mainWinnerPrize = (raffle as any).mainWinnerPrize ?? 0;
        mainWinnerReferrerCommission = (raffle as any).mainWinnerReferrerCommission ?? 0;
        mainWinnerReferrerActive = (raffle as any).mainWinnerReferrerActive ?? false; // Default para false se não definido
        teamMembersTotalPrize = (raffle as any).teamMembersTotalPrize ?? 0;
        teamMembersReferrerCommissionTotal = (raffle as any).teamMembersReferrerCommissionTotal ?? 0;
        winningTeamName = (raffle as any).winningTeamName ?? null;
        numberOfWinningTeamMembersReceivingPrize = (raffle as any).numberOfWinningTeamMembersReceivingPrize ?? null;
        teamMembersDetails = (raffle as any).winningTeamMembersDetails ?? [];


        actualTotalPrizeDistributedToPlayers = mainWinnerPrize + teamMembersTotalPrize;
        totalReferrerCommissionPaid = mainWinnerReferrerCommission + teamMembersReferrerCommissionTotal;

        // A share da casa REAL é o total coletado MENOS o total distribuído (jogadores + indicadores)
        const actualHouseShare = totalCollectedValue - (actualTotalPrizeDistributedToPlayers + totalReferrerCommissionPaid);

        // Descrição para rifa FINALIZADA
         if (raffle.type === 'tradicional') {
             // --- CORREÇÃO NA DESCRIÇÃO AQUI ---
             // A lógica de cálculo actualWinnerPrize e mainWinnerReferrerCommission está CORRETA
             // (85% do coletado para o ganhador, 5% DO PRÊMIO DO GANHADOR para o indicador)
             // O ERRO estava APENAS na string de descrição que dizia "5% do total arrecadado".
             const winnerPrizePercentage = 85; // Prêmio do ganhador é 85% do total
             const referrerCommissionPercentageOfPrize = 5; // A comissão é 5% DO PRÊMIO DO GANHADOR
             const estimatedCommissionPercentageOfTotal = (winnerPrizePercentage * referrerCommissionPercentageOfPrize) / 100; // 5% de 85% = 4.25% do total arrecadado.

             return {
                 totalCollected: totalCollectedValue,
                 houseShare: actualHouseShare, // Este valor já reflete a dedução da comissão paga
                 totalDistributedToPlayers: actualTotalPrizeDistributedToPlayers,
                 totalReferrerCommissionPaid: totalReferrerCommissionPaid,
                 mainWinnerPrize: mainWinnerPrize,
                 mainWinnerReferrerCommission: mainWinnerReferrerCommission,
                 mainWinnerReferrerActive: mainWinnerReferrerActive,
                 teamPrizePoolPotential: 0, // N/A
                 teamMembersTotalPrize: 0, // N/A
                 teamMembersReferrerCommissionTotal: 0, // N/A
                 teamMembersDetails: [], // N/A
                 winningTeamName: null, // N/A
                 numberOfWinningTeamMembersReceivingPrize: null, // N/A
                 // --- STRING DE DESCRIÇÃO CORRIGIDA ---
                 details: `Distribuição Finalizada (Base em R$ ${totalCollectedValue.toFixed(2)} coletados): Ganhador recebeu R$ ${mainWinnerPrize.toFixed(2)} (${winnerPrizePercentage}% do total). Se o ganhador teve indicador ativo no mês, este recebeu R$ ${mainWinnerReferrerCommission.toFixed(2)} (${referrerCommissionPercentageOfPrize}% do prêmio do ganhador, equivalente a ${estimatedCommissionPercentageOfTotal.toFixed(2)}% do total arrecadado) como bônus de indicação, PAGO PELA CASA. A Casa reteve R$ ${actualHouseShare.toFixed(2)} (${(100 - winnerPrizePercentage - estimatedCommissionPercentageOfTotal).toFixed(2)}% se comissão paga, ou ${100 - winnerPrizePercentage}% se comissão não paga).`,
                 // -------------------------------------
             };
         } else if (raffle.type === 'equipes') {
              return {
                 totalCollected: totalCollectedValue,
                 houseShare: actualHouseShare,
                 totalDistributedToPlayers: actualTotalPrizeDistributedToPlayers, // Total dos prêmios de jogadores
                 totalReferrerCommissionPaid: totalReferrerCommissionPaid, // Total das comissões de indicadores
                 mainWinnerPrize: mainWinnerPrize, // Prêmio real do ganhador principal
                 mainWinnerReferrerCommission: mainWinnerReferrerCommission, // Comissão real do indicador do principal
                 mainWinnerReferrerActive: mainWinnerReferrerActive,
                 teamPrizePoolPotential: totalPotentialValue * 0.30, // Estimativa (apenas para referência)
                 teamMembersTotalPrize: teamMembersTotalPrize, // Total prêmio real membros equipe
                 teamMembersReferrerCommissionTotal: teamMembersReferrerCommissionTotal, // Total comissão real indicadores membros equipe
                 teamMembersDetails: teamMembersDetails, // Detalhes reais dos membros
                 winningTeamName: winningTeamName,
                 numberOfWinningTeamMembersReceivingPrize: numberOfWinningTeamMembersReceivingPrize,
                 // Description for team raffle seems correct, stating 5% of the INDIVIDUAL prize
                 details: `Distribuição Finalizada (Base em R$ ${totalCollectedValue.toFixed(2)} coletados):` +
                       ` Prêmio Principal (50%): Ganhador recebeu R$ ${mainWinnerPrize.toFixed(2)}. Se teve indicador ativo no mês, este recebeu R$ ${mainWinnerReferrerCommission.toFixed(2)} (5% do prêmio do ganhador principal), PAGO PELA CASA.` +
                       ` Pool Equipe Vencedora (${winningTeamName ?? 'N/A'}) (30%): Distribuído R$ ${teamMembersTotalPrize.toFixed(2)} entre ${numberOfWinningTeamMembersReceivingPrize ?? 0} membro(s) elegíveis. Para CADA membro elegível, se ele teve indicador ativo no mês, este recebeu 5% DA SUA PARTE INDIVIDUAL como bônus de indicação, PAGO PELA CASA (Total comissões equipe: R$ ${teamMembersReferrerCommissionTotal.toFixed(2)}).` +
                       ` Casa: R$ ${actualHouseShare.toFixed(2)} (20% base menos comissões pagas, mais pools não distribuídos).`
              };
         }


    } else {
        // Se a rifa NÃO finalizou, calculamos valores POTENCIAIS (se todos os bilhetes fossem vendidos)
        const potentialMainPrize = totalPotentialValue * (raffle.type === 'tradicional' ? 0.85 : 0.50);
        const potentialTeamPrizePool = raffle.type === 'equipes' ? (totalPotentialValue * 0.30) : 0;
        const potentialReferrerCommissionMain = potentialMainPrize * 0.05; // 5% DO PRÊMIO POTENCIAL PRINCIPAL
         const potentialTeamMembersReferrerCommissionTotal = potentialTeamPrizePool * 0.05; // Estimativa simplificada: 5% do pool da equipe total

         if (raffle.type === 'tradicional') {
             return {
                totalCollected: totalCollectedValue, // Valor atual arrecadado
                houseShare: totalCollectedValue * 0.15, // Parte BASE da Casa (15% do arrecadado atual)
                totalDistributedToPlayers: totalCollectedValue * 0.85, // Pool de prêmios atual para o jogador (85% do arrecadado)
                totalReferrerCommissionPaid: 0, // Nenhuma comissão paga ainda
                mainWinnerPrize: potentialMainPrize, // Potencial prêmio do ganhador (baseado no total potencial)
                mainWinnerReferrerCommission: potentialReferrerCommissionMain, // Potencial comissão do indicador do principal (baseado no prêmio potencial)
                mainWinnerReferrerActive: null, // Não aplicável antes de finalizar
                teamPrizePoolPotential: 0, // N/A
                teamMembersTotalPrize: 0, // N/A
                teamMembersReferrerCommissionTotal: 0, // N/A
                teamMembersDetails: null, // N/A
                winningTeamName: null, // N/A
                numberOfWinningTeamMembersReceivingPrize: null, // N/A
                 details: `Estimativa de Prêmios (Base em R$ ${totalPotentialValue.toFixed(2)} total potencial): Prêmio para Ganhador: R$ ${potentialMainPrize.toFixed(2)} (85% do potencial total). Se o ganhador tiver indicador ativo no mês, este receberia R$ ${potentialReferrerCommissionMain.toFixed(2)} (5% do prêmio do ganhador), PAGO PELA CASA. A Casa reteria 15% menos comissão paga + prêmio não reclamado. Valor atual arrecadado: R$ ${totalCollectedValue.toFixed(2)}.`,
             };
         } else if (raffle.type === 'equipes') {
              return {
                 totalCollected: totalCollectedValue, // Valor atual arrecadado
                 houseShare: totalCollectedValue * 0.20, // Parte BASE da Casa (20% do arrecadado atual)
                 totalDistributedToPlayers: totalCollectedValue * 0.80, // Pool de prêmios atual para jogadores (50%+30% do arrecadado)
                 totalReferrerCommissionPaid: 0, // Nenhuma comissão paga ainda
                 mainWinnerPrize: potentialMainPrize, // Potencial prêmio principal (50% do total potencial)
                 mainWinnerReferrerCommission: potentialReferrerCommissionMain, // Potencial comissão indicador principal (5% do prêmio principal)
                 mainWinnerReferrerActive: null, // N/A
                 teamPrizePoolPotential: potentialTeamPrizePool, // Potencial pool equipe (30% do total potencial)
                 teamMembersTotalPrize: potentialTeamPrizePool, // Potencial total prêmio membros equipe (se todos elegíveis)
                 teamMembersReferrerCommissionTotal: potentialTeamMembersReferrerCommissionTotal, // Estimativa total comissão indicadores membros equipe (5% do pool da equipe)
                 teamMembersDetails: null, // N/A
                 winningTeamName: null, // N/A
                 numberOfWinningTeamMembersReceivingPrize: null, // N/A
                  details: `Estimativa de Prêmios (Base em R$ ${totalPotentialValue.toFixed(2)} total potencial):` +
                       ` Prêmio Principal: R$ ${potentialMainPrize.toFixed(2)} (50%). Pool Equipe: R$ ${potentialTeamPrizePool.toFixed(2)} (30%).` +
                       ` Para CADA ganhador (principal e membros da equipe), se ele tiver indicador ativo no mês, o indicador receberia 5% DO SEU PRÊMIO INDIVIDUAL GANHO, PAGO PELA CASA. A Casa reteria 20% menos comissões pagas + pools de prêmios não distribuídos. Valor atual arrecadado: R$ ${totalCollectedValue.toFixed(2)}.`,
              };
         }

    }

    // Caso surja um novo tipo de rifa não tratado
    return null; // Should not be reached if raffle.type is handled
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

  // Este método não atende diretamente a nova necessidade de separar por tipo
  // e agrupar por preço *apenas* as ATIVAS.
  // Manter por enquanto se for usado em outro lugar, mas a nova requisição
  // será atendida por métodos específicos.
  async getAllFixedAndExtraRaffles(): Promise<any> {
    this.logger.log('Buscando todas as rifas fixas e extras (ativas e finalizadas)...');
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

  // Métodos para buscar rifas ativas agrupadas por preço e tipo (já estavam corretos para a listagem)

  async getActiveTraditionalRafflesGroupedByPrice(): Promise<{ [price: number]: any[] }> {
      this.logger.log('Buscando rifas TRADICIONAIS ativas, agrupadas por preço...');
      const activeRaffles = await this.raffleModel.findAll({
          where: {
              type: 'tradicional',
              finished: false,
              ticketPrice: {
                  [Op.in]: this.fixedRafflePrices // Apenas preços fixos
              }
          },
           // Incluir apenas o necessário para o resumo, se necessário
           // include: [ /* Se o formatRaffleSummary precisar de includes */ ],
          order: [['ticketPrice', 'ASC'], ['createdAt', 'ASC']], // Ordena por preço e depois pela data de criação
      });

      const groupedRaffles: { [price: number]: any[] } = {};
       // Inicializa o objeto agrupado com arrays vazios para todos os preços fixos
       this.fixedRafflePrices.forEach(price => {
           groupedRaffles[price] = [];
       });


      // Agrupa e formata
      activeRaffles.forEach(raffle => {
           // Ensure ticketPrice is number before accessing groupedRaffles[price]
           const price = Number(raffle.ticketPrice);
           if (groupedRaffles[price]) { // Check if price exists in fixedRafflePrices
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
                  [Op.in]: this.fixedRafflePrices // Apenas preços fixos
              }
          },
           // Incluir apenas o necessário para o resumo, se necessário
           // include: [ /* Se o formatRaffleSummary precisar de includes */ ],
          order: [['ticketPrice', 'ASC'], ['createdAt', 'ASC']], // Ordena por preço e depois pela data de criação
      });

      const groupedRaffles: { [price: number]: any[] } = {};
       // Inicializa o objeto agrupado com arrays vazios para todos os preços fixos
       this.fixedRafflePrices.forEach(price => {
           groupedRaffles[price] = [];
       });

      // Agrupa e formata
      activeRaffles.forEach(raffle => {
           // Ensure ticketPrice is number before accessing groupedRaffles[price]
           const price = Number(raffle.ticketPrice);
           if (groupedRaffles[price]) { // Check if price exists in fixedRafflePrices
               groupedRaffles[price].push(this.formatRaffleSummary(raffle));
           } else {
                this.logger.warn(`Rifa de equipe ativa com preço ${price} não está na lista de preços fixos. ID: ${raffle.id}`);
           }
      });

      return groupedRaffles;
  }


  // Método interno para criar Rifa Tradicional (agora aceita isExtra)
  public async createSystemRaffle(ticketPrice: number, isExtra: boolean): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']],
    });

    if (!latestHash) {
      // Se estiver criando uma rifa original (isExtra=false), a falta de hash é CRÍTICA.
      // Se estiver criando uma extra, pode ser um problema temporário, mas ainda precisa de uma hash.
      // Para simplificar, vamos sempre exigir uma hash para qualquer criação.
       const errorMessage = `Nenhuma hash de blockchain encontrada para criar nova rifa (tipo: tradicional, preço: ${ticketPrice}, isExtra: ${isExtra}).`;
       this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage); // Lança erro interno, não NotFound aqui
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
       const errorMessage = `Nenhuma seed ou generatedNumber NÃO USADO encontrado para a hash ${latestHash.id} para criar nova rifa (tipo: tradicional, preço: ${ticketPrice}, isExtra: ${isExtra}). Execute a geração de números.`;
        this.logger.error(errorMessage);
       throw new InternalServerErrorException(errorMessage); // Lança erro interno, não NotFound
    }

    const generatedNumberToUse = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(generatedNumberToUse.number) % 100n; // 0 a 99
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0'); // Formato '00' a '99'

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7); // Adiciona 7 dias

     const baseTitle = `Rifa Tradicional - Loto Jack - R$ ${ticketPrice.toFixed(2)}`;
     const extraTitle = `Rifa Tradicional EXTRA - R$ ${ticketPrice.toFixed(2)}`;

     const baseDescription = `Rifa Loto Jack gerada automaticamente. O prêmio para o bilhete sorteado é de 85% do valor total arrecadado. Se o ganhador teve indicador ativo no mês do sorteio, este recebe 5% do valor total arrecadado como bônus de indicação, pago pela Casa. A Casa retém 10% do total arrecadado (se comissão paga) ou 15% (se comissão não paga, pois reverte para a Casa). Baseado na hash ${latestHash.hash}.`;
     const extraDescription = `Rifa EXTRA gerada automaticamente após o esgotamento da rifa fixa original de mesmo valor. Prêmio de 85% do total arrecadado + 5% bônus indicador pela Casa. Casa retém 10-15%. Baseado na hash ${latestHash.hash}.`;


    const newRaffle = await this.raffleModel.create({
      raffleIdentifier: `${isExtra ? 'RJ-EX' : 'RJ'}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      type: 'tradicional',
      title: isExtra ? extraTitle : baseTitle,
      description: isExtra ? extraDescription : baseDescription,
      ticketPrice: ticketPrice,
      totalTickets: 100, // 00 a 99
      soldTickets: 0,
      startDate: startDate,
      endDate: endDate,
      finished: false,
      winningTicket: winningTicketNumber, // Armazena 00-99 internamente
      drawDate: null,
      isExtra: isExtra, // Salva o flag
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
      `Rifa Tradicional (ID ${newRaffle.id}, ${isExtra ? 'EXTRA' : 'FIXA ORIGINAL'}) criada para R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );

    return newRaffle;
  }

  // Método interno para criar Rifa de Equipes (agora aceita isExtra)
  public async createTeamRaffle(ticketPrice: number, isExtra: boolean): Promise<Raffle> {
    const latestHash = await this.blockchainHashModel.findOne({ order: [['timestamp', 'DESC']] });
    if (!latestHash) {
        const errorMessage = `Nenhuma hash de blockchain encontrada para criar nova rifa (tipo: equipes, preço: ${ticketPrice}, isExtra: ${isExtra}).`;
        this.logger.error(errorMessage);
        throw new InternalServerErrorException(errorMessage);
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
        order: [['createdAt', 'DESC']],
    });
    if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
        const errorMessage = `Nenhuma seed/generatedNumber NÃO USADO encontrado para a hash ${latestHash.id} para criar nova rifa (tipo: equipes, preço: ${ticketPrice}, isExtra: ${isExtra}). Execute a geração de números.`;
         this.logger.error(errorMessage);
        throw new InternalServerErrorException(errorMessage);
    }

    const generatedNumberToUse = correspondingSeed.generatedNumbers[0];
    const lastTwoDigits = BigInt(generatedNumberToUse.number) % 100n;
    const winningTicketNumber = lastTwoDigits.toString().padStart(2, '0'); // 00-99

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7); // 7 dias para finalizar, por exemplo

     const baseTitle = `Rifa de Equipes - Loto Seleções - R$ ${ticketPrice.toFixed(2)}`;
     const extraTitle = `Rifa de Equipes EXTRA - R$ ${ticketPrice.toFixed(2)}`;

     const baseDescription = `Rifa Loto Seleções gerada automaticamente. O prêmio é dividido: 50% do total arrecadado (pool principal) para o bilhete exato sorteado, e 30% do total arrecadado (pool da equipe) dividido igualmente entre os membros da equipe vencedora que compraram pelo menos um bilhete (excluindo o ganhador principal, se for o caso). Para CADA ganhador (principal e membros da equipe), se ele foi indicado e o indicador estiver ativo no mês do sorteio, este recebe 5% do valor DO SEU PRÊMIO INDIVIDUAL como bônus de indicação, pago PELA CASA. A Casa retém 20% do total arrecadado (base) menos comissões de 5% pagas + pools de prêmios que não foram distribuídos. Baseado na hash ${latestHash.hash}`;
     const extraDescription = `Rifa EXTRA gerada automaticamente após o esgotamento da rifa fixa original de mesmo valor. Prêmio: 50% principal + 30% pool equipe + 5% bônus indicador pela Casa. Casa retém 20% + não distribuído. Baseado na hash ${latestHash.hash}`;


    const newRaffle = await this.raffleModel.create({
        raffleIdentifier: `${isExtra ? 'RL-EX' : 'RL'}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        type: 'equipes',
        title: isExtra ? extraTitle : baseTitle,
        description: isExtra ? extraDescription : baseDescription,
        ticketPrice: ticketPrice,
        totalTickets: 100, // 00-99
        soldTickets: 0,
        startDate: startDate,
        endDate: endDate, // Data de fim
        finished: false,
        winningTicket: winningTicketNumber, // Armazena 00-99
        drawDate: null,
        isExtra: isExtra, // Salva o flag
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
        `Rifa de Equipes (ID ${newRaffle.id}, ${isExtra ? 'EXTRA' : 'FIXA ORIGINAL'}) criada para R$ ${ticketPrice.toFixed(2)}. Bilhete Sorteado (interno): ${winningTicketNumber}. Finaliza em: ${endDate.toISOString()}`
    );
    return newRaffle;
  }


    // CRON para garantir que sempre haja uma rifa FIXA ORIGINAL (isExtra = false) ativa por preço/tipo
    @Cron(CronExpression.EVERY_SECOND) // Roda a cada hora
    async ensureFixedRafflesCronJob() {
        this.logger.log('CRON: Verificando necessidade de criar rifas FIXAS ORIGINAIS (isExtra=false)...');
        for (const price of this.fixedRafflePrices) {
             // Verifica e cria para Tradicional (se necessário)
            try {
                const existingTraditional = await this.raffleModel.findOne({
                    where: { ticketPrice: price, type: 'tradicional', isExtra: false, finished: false },
                });
                if (!existingTraditional) {
                     this.logger.log(`CRON: Nenhuma rifa TRADICIONAL original ativa encontrada para R$ ${price.toFixed(2)}. Criando uma nova.`);
                    await this.createSystemRaffle(price, false); // Cria a rifa original (não extra)
                } else {
                    this.logger.debug(`CRON: Já existe rifa TRADICIONAL original ativa para R$ ${price.toFixed(2)} (ID: ${existingTraditional.id}).`);
                }
            } catch (error) {
                 this.logger.error(`CRON: Erro ao verificar/criar rifa TRADICIONAL original de R$ ${price.toFixed(2)}: ${(error as any).message}`);
            }

            // Verifica e cria para Equipes (se necessário)
             try {
                const existingTeam = await this.raffleModel.findOne({
                     where: { ticketPrice: price, type: 'equipes', isExtra: false, finished: false },
                });
                if (!existingTeam) {
                    this.logger.log(`CRON: Nenhuma rifa de EQUIPES original ativa encontrada para R$ ${price.toFixed(2)}. Criando uma nova.`);
                    await this.createTeamRaffle(price, false); // Cria a rifa original (não extra)
                } else {
                    this.logger.debug(`CRON: Já existe rifa de EQUIPES original ativa para R$ ${price.toFixed(2)} (ID: ${existingTeam.id}).`);
                }
            } catch (error) {
                 this.logger.error(`CRON: Erro ao verificar/criar rifa de EQUIPES original de R$ ${price.toFixed(2)}: ${(error as any).message}`);
            }
        }
        this.logger.log('CRON: Verificação/Criação de rifas FIXAS ORIGINAIS concluída.');
    }


    // Função auxiliar para criar a próxima rifa se necessário (apenas extras após esgotamento da fixa original)
    private async createNextRaffleIfNeeded(type: 'tradicional' | 'equipes', price: number, wasExtra: boolean): Promise<void> {
        // Se a rifa esgotada era uma EXTRA, NÃO crie outra automaticamente via esgotamento.
        if (wasExtra) {
            this.logger.log(`Rifa EXTRA (tipo: ${type}, preço: ${price}) esgotada. NÃO será criada outra EXTRA automaticamente via esgotamento.`);
            // A CRON agora é responsável por garantir que haja sempre uma rifa principal (isExtra=false)
            // disponível para que novas extras possam ser criadas quando ela esgotar (se for a fixa original).
            // Ou, se a fixa original já terminou e a extra esgotou, a CRON criará a PRÓXIMA fixa original.
            return;
        }

        // Se a rifa esgotada NÃO era extra (era a FIXA ORIGINAL), CRIE a próxima EXTRA.
         this.logger.log(`Rifa FIXA ORIGINAL (tipo: ${type}, preço: ${price}) esgotada. Criando rifa EXTRA...`);
         try {
             if (type === 'tradicional') {
                  await this.createSystemRaffle(price, true); // Cria uma rifa EXTRA
             } else {
                  await this.createTeamRaffle(price, true); // Cria uma rifa EXTRA
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
        const requestedNumbersFront = ticketData.quantityOrNumbers; // Array of "1" a "100" strings from frontend
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
      const totalCost = Number(raffle.ticketPrice) * quantity;
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
          this.logger.log(`Rifa ${raffleId} (tipo: ${raffle.type}, isExtra: ${raffle.isExtra}) esgotou com esta compra. Verificando necessidade de criar próxima...`);
          // Trigger async creation of the next raffle if needed (don't await, don't block the purchase)
          this.createNextRaffleIfNeeded(raffle.type, Number(raffle.ticketPrice), raffle.isExtra).catch(err => {
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
       if (filters.isExtra !== undefined) { // Adiciona filtro por isExtra
           where.isExtra = filters.isExtra === 'true' || filters.isExtra === true;
       }
      // Adicionar outros filtros conforme necessário

    const raffles = await this.raffleModel.findAll({
      include: [
         // Incluir os tickets com user E referrer para o calculatePrizeDetails (para rifas de equipes)
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] }, // Incluído referrer aqui também
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
        { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'email', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] }, // Incluído referrer aqui também
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

    let winningTeamDetails: { teamName: string; tickets: string[]; members: { id: number; name: string; tickets: string[]; prize: number; referrerCommission: number; referrerActive: boolean; hasReferrer: boolean; }[] } | null = null;
    // Use os detalhes calculados na finalização para a equipe vencedora, se disponível
    if (raffle.type === 'equipes' && raffle.finished) {
         // Use os detalhes j� calculados e anexados durante a finaliza��o
        winningTeamDetails = (raffle as any).winningTeamMembersDetails ? {
            teamName: (raffle as any).winningTeamName ?? "N/A",
            // Mapeia os tickets internos para formato de exibição 1-100
            tickets: (raffle as any).winningTeamMembersDetails.flatMap((m: any) => m.tickets).map(this.formatTicketNumberDisplay),
            members: (raffle as any).winningTeamMembersDetails.map((member: any) => ({
                userId: member.userId, // Use userId attached during finalization
                userName: member.userName, // Use userName attached
                prize: member.prize, // Prêmio individual do membro (j� calculado e anexado)
                referrerCommission: member.referrerCommission, // Comissão paga ao indicador deste membro (j� calculado e anexado)
                referrerActive: member.referrerActive, // Status ativo do indicador deste membro (j� calculado e anexado)
                hasReferrer: member.hasReferrer, // Se o membro tinha indicador (j� calculado e anexado)
                tickets: member.tickets.map(this.formatTicketNumberDisplay), // Tickets deste membro (mapeados para 1-100)
            }))
        } : { teamName: (raffle as any).winningTeamName ?? "N/A", tickets: [], members: [] }; // Fallback if no eligible members found
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
      isExtra: raffle.isExtra, // Inclui o flag isExtra nos detalhes completos
      // Incluir dados do vencedor, incluindo o indicador se houver
      winner: raffle.winnerUser ? {
           id: raffle.winnerUser.id,
           name: raffle.winnerUser.name,
           // email: raffle.winnerUser.email, // Opcional
           referrer: winnerReferrerInfo, // Informação do indicador do vencedor
      } : null,
      title: raffle.title,
      description: raffle.description,
      ticketPrice: Number(raffle.ticketPrice), // Manter número
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
    // NOTA: As rifas criadas pela CRON (se a lógica 1+N for implementada)
    // podem ter o GeneratedNumber associado logo na criação.
    // As rifas fixas originais também devem ter.
    // Certifique-se de que o include de RaffleNumber->GeneratedNumber->Seed->BlockchainHash
    // está presente onde este método formatWinningTicketInfo é chamado (e.g., getRaffleByIdWithDetails).
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
    const transaction = transactionHost || await this.sequelize.transaction();
    let raffle; // Declare raffle outside try to ensure access in catch

    try {
      // Step 1: Find and lock the Raffle row ONLY. REMOVE INCLUDE FROM THIS STEP.
       raffle = await this.raffleModel.findByPk(raffleId, {
         transaction,
         lock: transaction.LOCK.UPDATE, // Lock only the Raffle row
       });


      if (!raffle) {
        if (!transactionHost) await transaction.rollback();
        throw new NotFoundException('Rifa tradicional não encontrada.');
      }
      if (raffle.finished) {
        this.logger.warn(`Tentativa de finalizar rifa tradicional ${raffleId} que já está finalizada.`);
        if (!transactionHost) await transaction.commit();
        // Reload with necessary relations before returning (already included in the initial fetch)
        // This reload needs to happen AFTER commit if transactionHost is undefined
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
      this.logger.log(`Finalizando Rifa Tradicional ${raffleId}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}. isExtra: ${raffle.isExtra}`);


      // Step 2: Fetch tickets with user and referrer info *within the same transaction*, without locking them
      const tickets = await this.raffleTicketModel.findAll({
           where: { raffleId: raffle.id },
           include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }],
           transaction // Use the same transaction
       });

      // Find the winning ticket from the fetched tickets
      const winningTicket = tickets?.find(t => t.ticketNumber === winningTicketNumberInternal);

      let winnerUserId: number | null = null;
      const totalCollectedValue = Number(raffle.ticketPrice) * Number(raffle.soldTickets);

      let actualWinnerPrize = 0; // 85% do total coletado
      let mainWinnerReferrerCommission = 0; // 5% do total coletado (pago pela casa)
      let mainWinnerReferrerActive = false; // Track referrer activity status

      if (winningTicket && winningTicket.user) {
        const winnerUser = winningTicket.user; // User model fetched with referrerId and referrer relation
        winnerUserId = winnerUser.id;
        this.logger.log(`Bilhete ${winningTicketNumberInternal} (usuário ${winnerUserId} - ${winnerUser.name}) é o vencedor.`);

        // Ganhador sempre recebe 85% do total coletado
        actualWinnerPrize = totalCollectedValue * 0.85;
        this.logger.log(`Creditando prêmio líquido de R$ ${actualWinnerPrize.toFixed(2)} para o ganhador ${winnerUserId}.`);
        await this.authService.updateUserBalance(winnerUser.id, actualWinnerPrize, transaction);


        // Check if winner has a referrer and award commission (paid by the house)
        if (winnerUser.referrerId) {
             this.logger.log(`Usuário ${winnerUserId} (ganhador) foi indicado por ${winnerUser.referrerId}.`);
             // O referrer já está incluído no winnerUser fetched with the ticket
             const referrerUser = winnerUser.referrer; // Acessa a relação incluída

            if (referrerUser) {
                // Check if the referrer played any game this month
                // Call hasPlayedThisMonth with the referrer's ID and the transaction
                mainWinnerReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);


                const commissionAmount = totalCollectedValue * 0.05; // 5% DO TOTAL COLETADO (pago pela Casa)


                if (mainWinnerReferrerActive) {
                    mainWinnerReferrerCommission = commissionAmount; // Comissão paga ao indicador
                    // Creditar comissão ao indicador
                     this.logger.log(`Indicador ${referrerUser.id} está ativo. Creditando comissão de indicação de R$ ${mainWinnerReferrerCommission.toFixed(2)} (5% do total coletado) PAGO PELA CASA.`);
                    await this.authService.updateUserBalance(referrerUser.id, mainWinnerReferrerCommission, transaction);

                } else {
                     this.logger.log(`Indicador ${referrerUser.id} NÃO está ativo este mês. Comissão de R$ ${commissionAmount.toFixed(2)} NÃO creditada e fica com a Casa.`);
                     mainWinnerReferrerCommission = 0; // Comissão não creditada é 0
                }

            } else {
                 // Isso só aconteceria se referrerId existisse no ticket->user, mas o user correspondente (referrer) não fosse encontrado
                 this.logger.warn(`Indicador (ID ${winnerUser.referrerId}) do usuário ganhador ${winnerUserId} não encontrado mesmo incluído. Comissão não aplicável/creditada.`);
                 mainWinnerReferrerCommission = 0;
                 mainWinnerReferrerActive = false; // Não há indicador válido
            }
        } else {
             this.logger.log(`Usuário ${winnerUserId} (ganhador) não foi indicado. Sem comissão para indicador.`);
             mainWinnerReferrerCommission = 0;
             mainWinnerReferrerActive = false; // Não há indicador
        }

      } else {
        this.logger.log(`Nenhum bilhete vendido corresponde ao número sorteado ${winningTicketNumberInternal}. Prêmio (R$ ${totalCollectedValue * 0.85}) não distribuído aos jogadores/indicadores.`);
        winnerUserId = null; // Explicitamente nulo se ninguém comprou o bilhete
        actualWinnerPrize = 0; // Ninguém ganhou o prêmio do jogador
        mainWinnerReferrerCommission = 0; // Ninguém ganhou principal, sem comissão para indicador principal
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

      // Step 5: Reload to get updated relations FOR THE RETURN VALUE.
      // This reload happens AFTER the transaction commits (if it was local).
      // The data needed *during* the transaction was fetched explicitly.
       await raffle.reload({
            include: [
                 // Include necessary relations for formatRaffleDetails AFTER the transaction
                { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] }, // Include referrer here for tickets
                { model: RaffleNumber, include: [ { model: GeneratedNumber, include: [ { model: Seed, include: [BlockchainHash] } ] } ] },
            ],
             // DO NOT pass transaction here if transactionHost was undefined (it's already committed)
        });

        // Attach the calculated active status and commission amount for formatRaffleDetails
        // These values are needed by calculatePrizeDetails when formatRaffleDetails is called on the reloaded object
        (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive;
         (raffle as any).mainWinnerReferrerCommission = mainWinnerReferrerCommission;
         (raffle as any).mainWinnerPrize = actualWinnerPrize;
        // Ensure team properties are set to defaults for traditional raffle
         (raffle as any).winningTeamName = null;
         (raffle as any).numberOfWinningTeamMembersReceivingPrize = null;
         (raffle as any).teamMembersTotalPrize = 0;
         (raffle as any).teamMembersReferrerCommissionTotal = 0;
         (raffle as any).winningTeamMembersDetails = [];


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


    // CRON para verificar rifas a finalizar (continua a cada 5 minutos)
    // Essa CRON não precisa ser alterada, pois ela apenas busca rifas *prontas* para finalizar,
    // e os métodos `finalizeRaffle`/`finalizeTeamRaffle` são quem lidam com a lógica de distribuição
    // e a criação da próxima rifa (se aplicável, via createNextRaffleIfNeeded).
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
          this.logger.log(`CRON: Iniciando processamento para Rifa ID: ${raffle.id}, Tipo: ${raffle.type}, Vendidos: ${raffle.soldTickets}/${raffle.totalTickets}, EndDate: ${raffle.endDate?.toISOString()}, isExtra: ${raffle.isExtra}`);
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
  return playedRaffles.map(raffle => {
       const details = this.formatRaffleDetails(raffle);
       // Adiciona os tickets específicos do usuário a esta rifa formatada
       details.userTickets = this.formatRaffleTickets(raffle) // Formata TODOS os tickets da rifa
                             .filter(ticket => ticket.user?.id === userId); // Filtra apenas os do usuário logado
       return details;
   });
}


  // Método interno para criar Rifa de Equipes (agora aceita isExtra)
   // Já implementado acima, mas repetindo a assinatura por clareza:
   // private async createTeamRaffle(ticketPrice: number, isExtra: boolean): Promise<Raffle> { ... }


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
        // Verificar se o ticketNumberInternal está dentro do range totalTickets
        if (i * ticketsPerTeam + j < totalTickets) {
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

    // Este CRON não é mais necessário separadamente, a lógica foi movida para ensureFixedRafflesCronJob
    // @Cron(CronExpression.EVERY_HOUR)
    // async createTeamRafflesCronJob() { ... }


    async finalizeTeamRaffle(raffleId: number, transactionHost?: Transaction): Promise<Raffle> {
      const transaction = transactionHost || await this.sequelize.transaction();
      let raffle; // Declare raffle outside try

      try {
        // Step 1: Find and lock the Raffle row ONLY. REMOVE INCLUDE FROM THIS STEP.
        raffle = await this.raffleModel.findByPk(raffleId, {
          transaction,
          lock: transaction.LOCK.UPDATE, // Lock only the Raffle row
        });


        if (!raffle) {
           if (!transactionHost) await transaction.rollback();
           throw new NotFoundException('Rifa de equipes não encontrada.');
        }
        if (raffle.finished) {
             this.logger.warn(`Tentativa de finalizar rifa de equipes ${raffleId} que já está finalizada.`);
             if (!transactionHost) await transaction.commit();
             // Reload before returning (already included in the initial fetch)
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
        this.logger.log(`Finalizando Rifa de Equipes ${raffleId}. Bilhete Sorteado (interno): ${winningTicketNumberInternal}. isExtra: ${raffle.isExtra}`);

        // Step 2: Fetch tickets with user and referrer info *within the same transaction*, without locking them
        const tickets = await this.raffleTicketModel.findAll({
            where: { raffleId: raffle.id },
            include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }],
            transaction // Use the same transaction
        });


        // --- Calculation and Distribution Logic ---
        const totalCollectedValue = Number(raffle.ticketPrice) * Number(raffle.soldTickets);
        const actualMainPrizePool = totalCollectedValue * 0.50; // 50% do coletado para o pool principal
        const actualTeamPrizePool = totalCollectedValue * 0.30; // 30% do coletado para o pool da equipe

        // Declaração das variáveis para acumular totais pagos e comissões
        let totalDistributedToPlayers = 0;
        let totalCommissionPaid = 0; // Total pago pela casa aos indicadores

        let mainWinnerPrize = 0; // Prêmio do ganhador principal (líquido)
        let mainWinnerReferrerCommission = 0; // Comissão do indicador do principal (pago pela casa)
        let mainWinnerReferrerActive = false; // Track referrer activity status for main winner

        let teamMembersTotalPrize = 0; // Total prêmio membros equipe (líquido)
        let teamMembersReferrerCommissionTotal = 0; // Total comissão indicadores membros equipe (pagas pela casa)
        const winningTeamMembersDetails: any[] = []; // Para popular o retorno formatado

        let numberOfWinningTeamMembersReceivingPrize = 0;

        // 1. Processar Ganhador Principal (50%)
        const mainWinningTicket = tickets.find(t => t.ticketNumber === winningTicketNumberInternal);
        const mainWinnerUser = mainWinningTicket?.user; // User model fetched with referrerId and referrer relation

        if (mainWinnerUser) {
            mainWinnerPrize = actualMainPrizePool; // Ganhador principal recebe 50% do total coletado
            this.logger.log(`Prêmio Principal (50% = R$ ${actualMainPrizePool.toFixed(2)}) para usuário ${mainWinnerUser.id} (${mainWinnerUser.name}) - Bilhete ${winningTicketNumberInternal}. Credidando R$ ${mainWinnerPrize.toFixed(2)}.`);
             // Creditar prêmio líquido ao ganhador principal
             await this.authService.updateUserBalance(mainWinnerUser.id, mainWinnerPrize, transaction);

             // Acumular no total distribuído aos jogadores
             totalDistributedToPlayers += mainWinnerPrize;


            // Check if main winner has a referrer and award commission (paid by the house)
            if (mainWinnerUser.referrerId) {
                 this.logger.log(`Ganhador Principal ${mainWinnerUser.id} foi indicado por ${mainWinnerUser.referrerId}.`);
                 // O referrer já está incluído no winnerUser fetched with the ticket
                 const referrerUser = mainWinnerUser.referrer; // Acessa a relação incluída

                 if (referrerUser) {
                    mainWinnerReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);

                    // Comissão do indicador do principal é 5% DO PRÊMIO PRINCIPAL GANHO (50% do total coletado)
                    const commissionAmount = mainWinnerPrize * 0.05; // 5% DO PRÊMIO DO GANHADOR PRINCIPAL


                    if (mainWinnerReferrerActive) {
                        mainWinnerReferrerCommission = commissionAmount; // Comissão paga ao indicador
                        // Creditar comissão ao indicador (PAGO PELA CASA)
                        this.logger.log(`Indicador ${referrerUser.id} (do Ganhador Principal) está ativo. Creditando comissão de indicação de R$ ${mainWinnerReferrerCommission.toFixed(2)} (5% do prêmio do ganhador principal) PAGO PELA CASA.`);
                        await this.authService.updateUserBalance(referrerUser.id, mainWinnerReferrerCommission, transaction);
                         // Acumular no total de comissões pagas
                         totalCommissionPaid += mainWinnerReferrerCommission;

                    } else {
                         this.logger.log(`Indicador ${referrerUser.id} (do Ganhador Principal) NÃO está ativo este mês. Comissão de R$ ${commissionAmount.toFixed(2)} NÃO creditada e fica com a Casa.`);
                         mainWinnerReferrerCommission = 0; // Comissão não creditada é 0
                    }
                 } else {
                     // Isso só aconteceria se referrerId existisse no ticket->user, mas o user correspondente (referrer) não fosse encontrado
                     this.logger.warn(`Indicador (ID ${mainWinnerUser.referrerId}) do Ganhador Principal ${mainWinnerUser.id} não encontrado mesmo incluído. Comissão não aplicável/creditada.`);
                     mainWinnerReferrerCommission = 0;
                     mainWinnerReferrerActive = false; // Não há indicador válido
                 }
            } else {
                 this.logger.log(`Ganhador Principal ${mainWinnerUser.id} não foi indicado. Sem comissão para indicador.`);
                 mainWinnerReferrerCommission = 0;
                 mainWinnerReferrerActive = false; // Não há indicador
            }
        } else {
           this.logger.log(`Ninguém comprou o bilhete principal ${winningTicketNumberInternal}. Prêmio principal (R$ ${actualMainPrizePool.toFixed(2)}) não distribuído.`);
           mainWinnerPrize = 0;
            mainWinnerReferrerActive = false; // Ninguém ganhou principal
            mainWinnerReferrerCommission = 0; // Ninguém ganhou principal, sem comissão para indicador principal
        }


        // 2. Processar Pool da Equipe (30%)
        const winningTeamName = this.getTeamNameByTicketNumber(raffle, winningTicketNumberInternal);

        if (winningTeamName !== 'N/A' && winningTeamName !== 'Inválido' && winningTeamName !== 'Erro') {
            // Filter from the fetched 'tickets' array, exclude the main winner
            const winningTeamTickets = tickets.filter(
                (ticket) => this.getTeamNameByTicketNumber(raffle, ticket.ticketNumber) === winningTeamName &&
                            (mainWinnerUser ? ticket.userId !== mainWinnerUser.id : true) // Excluir o ganhador principal pelo ID se ele existe
            );

            const teamMemberUsersWhoBought = new Map<number, User>(); // Map UserID -> User model (with referrerId and referrer relation)
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
                const individualTeamPoolShare = actualTeamPrizePool / numberOfWinningTeamMembersReceivingPrize; // Parte INDIVIDUAL DO POOL (30%)
                this.logger.log(`Equipe Vencedora ${winningTeamName}: ${numberOfWinningTeamMembersReceivingPrize} membro(s) elegível(is) para o prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}). Parte base individual: R$ ${individualTeamPoolShare.toFixed(2)}.`);

                for (const user of teamMemberUsersWhoBought.values()) {
                    let memberPrizeShare = individualTeamPoolShare; // Membro recebe sua parte do pool da equipe
                    teamMembersTotalPrize += memberPrizeShare;
                     // Creditar prêmio líquido ao membro da equipe
                    this.logger.log(`Creditando prêmio líquido de R$ ${memberPrizeShare.toFixed(2)} para o membro da equipe ${user.id}.`);
                    await this.authService.updateUserBalance(user.id, memberPrizeShare, transaction);

                    let memberReferrerCommissionShare = 0;
                    let memberReferrerActive = false;

                    // Check if this team member has a referrer and if referrer is active this month
                    if (user.referrerId) {
                         this.logger.log(`Membro da equipe vencedora ${user.id} foi indicado por ${user.referrerId}.`);
                         // O referrer já está incluído no user fetched with the ticket
                         const referrerUser = user.referrer; // Acessa a relação incluída

                         if (referrerUser) {
                              memberReferrerActive = await this.authService.hasPlayedThisMonth(referrerUser.id, transaction);

                             const commissionAmount = memberPrizeShare * 0.05; // 5% DA PARTE INDIVIDUAL DO MEMBRO (DO POOL DE 30%)


                             if (memberReferrerActive) {
                                 memberReferrerCommissionShare = commissionAmount; // Comissão paga ao indicador
                                 teamMembersReferrerCommissionTotal += memberReferrerCommissionShare;
                                // Creditar comissão ao indicador (PAGO PELA CASA)
                                 this.logger.log(`Indicador ${referrerUser.id} (do membro ${user.id}) está ativo. Creditando comissão de indicação de R$ ${memberReferrerCommissionShare.toFixed(2)} (5% do prêmio individual do membro) PAGO PELA CASA.`);
                                await this.authService.updateUserBalance(referrerUser.id, memberReferrerCommissionShare, transaction);
                                 // Acumular no total de comissões pagas
                                totalCommissionPaid += memberReferrerCommissionShare;

                             } else {
                                this.logger.log(`Indicador ${referrerUser.id} (do membro ${user.id}) NÃO está ativo este mes. Comissão de R$ ${commissionAmount.toFixed(2)} NÃO creditada e fica com a Casa.`);
                                memberReferrerCommissionShare = 0; // Comissão não creditada é 0
                             }
                         } else {
                            // Isso só aconteceria se referrerId existisse no ticket->user, mas o user correspondente (referrer) não fosse encontrado
                            this.logger.warn(`Indicador (ID ${user.referrerId}) do membro da equipe ${user.id} não encontrado mesmo incluído. Comissão não aplicável/creditada.`);
                            memberReferrerCommissionShare = 0;
                            memberReferrerActive = false; // Não há indicador válido
                         }
                    } else {
                         this.logger.log(`Membro da equipe ${user.id} não foi indicado. Sem comissão para indicador.`);
                         memberReferrerCommissionShare = 0;
                         memberReferrerActive = false; // Não há indicador
                    }

                     // Store the active status and prize details for calculatePrizeDetails formatting
                     winningTeamMembersDetails.push({ // Adicionar detalhes deste membro para o retorno formatado
                            userId: user.id,
                            userName: user.name,
                            prize: memberPrizeShare, // Prêmio individual do membro (sem dedução)
                            referrerCommission: memberReferrerCommissionShare, // Comissão paga ao indicador deste membro
                            referrerActive: memberReferrerActive, // Status ativo do indicador deste membro
                            hasReferrer: user.referrerId !== undefined && user.referrerId !== null, // Indica se tinha indicador
                            // Adicionar os tickets comprados por este membro NESTA rifa (formatados 1-100)
                            tickets: tickets.filter(t => t.userId === user.id && this.getTeamNameByTicketNumber(raffle, t.ticketNumber) === winningTeamName).map(t => t.ticketNumber), // Passa números internos para formatRaffleDetails mapear
                         });
                }
                 // Acumular no total distribuído aos jogadores (além do principal)
                 totalDistributedToPlayers += teamMembersTotalPrize;

            } else {
                this.logger.log(`Equipe Vencedora ${winningTeamName}: Nenhum outro membro (além do vencedor principal, se houver) comprou bilhetes. Prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}) não distribuído aos jogadores.`);
                teamMembersTotalPrize = 0; // Ninguém da equipe ganhou prêmio de jogador
                 // O pool da equipe inteiro (30%) não foi distribuído aos jogadores
            }
        } else {
            this.logger.log(`Não foi possível determinar a equipe vencedora (ticket: ${winningTicketNumberInternal}, nome: ${winningTeamName}). Prêmio da equipe (R$ ${actualTeamPrizePool.toFixed(2)}) não distribuído aos jogadores.`);
             teamMembersTotalPrize = 0; // Ninguém da equipe ganhou prêmio de jogador
             // O pool da equipe inteiro (30%) não foi distribuído aos jogadores
        }

        // A share da casa REAL é o total coletado MENOS o total distribuído (jogadores + indicadores)
        const actualHouseShare = totalCollectedValue - (totalDistributedToPlayers + totalCommissionPaid);


        // Reattach calculated details to the raffle object for calculatePrizeDetails to use after reload
        (raffle as any).winningTeamName = winningTeamName;
        (raffle as any).numberOfWinningTeamMembersReceivingPrize = numberOfWinningTeamMembersReceivingPrize;
        (raffle as any).mainWinnerReferrerActive = mainWinnerReferrerActive; // Attach main winner referrer status
        // (raffle as any).teamMemberReferrerActiveStatuses = teamMemberReferrerActiveStatuses; // Não necessário anexar a lista bruta, os detalhes já estão em winningTeamMembersDetails
        (raffle as any).mainWinnerReferrerCommission = mainWinnerReferrerCommission; // Attach main winner commission
        (raffle as any).teamMembersReferrerCommissionTotal = teamMembersReferrerCommissionTotal; // Attach total team members commission
        (raffle as any).winningTeamMembersDetails = winningTeamMembersDetails; // Attach team members details for formatting
        (raffle as any).mainWinnerPrize = mainWinnerPrize; // Attach main winner prize paid
        (raffle as any).teamMembersTotalPrize = teamMembersTotalPrize; // Attach total team members prize paid


         // --- Commit ---
        if (!transactionHost) await transaction.commit();
        this.logger.log(`Rifa de equipe ${raffleId} finalizada com sucesso.`);

         // --- Reload and Return ---
         // Reload outside the lock/transaction logic to get fresh data with relations
         // Need winnerUser with referrer and tickets with users+referrer for formatRaffleDetails
         await raffle.reload({
               include: [
                    { model: User, as: 'winnerUser', attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] },
                    { model: RaffleTicket, as: 'tickets', include: [{ model: User, attributes: ['id', 'name', 'referrerId'], include: [{ model: User, as: 'referrer', attributes: ['id', 'name'] }] }] }, // Include referrer here for tickets
                    { model: RaffleNumber, include: [{ model: GeneratedNumber, include: [{ model: Seed, include: [BlockchainHash] }] }] },
                ],
               // DO NOT pass transaction here if transactionHost was undefined (it's already committed)
           });

        // The calculated details are attached before commit and should be available on the reloaded object
        // (raffle as any).winningTeamName etc. will persist if reloaded in the same instance context,
        // but it's safer to ensure formatRaffleDetails recalculates or uses the attached values.
        // We already attached them, so formatRaffleDetails will pick them up.


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