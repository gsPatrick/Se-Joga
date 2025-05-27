// src/report/report.service.ts
import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize, Op, literal } from 'sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { RaffleTicket } from '../models/raffle/raffle-ticket.model';
import { User } from '../models/user/user.model';
import { AuthService } from 'src/Auth/auth.service';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    @InjectModel(Raffle) private raffleModel: typeof Raffle,
    @InjectModel(RaffleTicket) private raffleTicketModel: typeof RaffleTicket,
    @InjectModel(User) private userModel: typeof User,
    private authService: AuthService,
    // @Inject('SEQUELIZE') private sequelize: Sequelize,
  ) {}

  // Método auxiliar para criar o filtro de data
  private createDateFilter(startDate?: string, endDate?: string): any {
      const dateFilter: any = {};
      let parsedStartDate: Date | undefined;
      let parsedEndDate: Date | undefined;

      if (startDate) {
          parsedStartDate = new Date(startDate);
          if (isNaN(parsedStartDate.getTime())) {
              throw new BadRequestException('Formato de data de início inválido.');
          }
          // Para incluir o dia de início inteiro, defina o horário para o início do dia
          parsedStartDate.setHours(0, 0, 0, 0); // Garantir início do dia
          dateFilter[Op.gte] = parsedStartDate;
      }

      if (endDate) {
          parsedEndDate = new Date(endDate);
          if (isNaN(parsedEndDate.getTime())) {
              throw new BadRequestException('Formato de data de fim inválido.');
          }
           // Para incluir o dia de fim inteiro, defina o horário para o fim do dia
          parsedEndDate.setHours(23, 59, 59, 999); // Garantir fim do dia
          dateFilter[Op.lte] = parsedEndDate;
      }

      // Retorna o objeto filtro. Se ambas as datas forem omitidas, o objeto estará vazio.
      // Se apenas uma for fornecida, terá apenas Op.gte ou Op.lte.
      return dateFilter;
  }


  // 1. Total de rifa vendidas por valor dia ( 5/10/20/30/50/100)
  // Filtra pela data de criação do TICKET (RaffleTicket.createdAt)
  async getTotalSoldByPriceAndDay(startDate?: string, endDate?: string): Promise<any[]> {
    this.logger.log(`Gerando relatório: Total de rifas vendidas por valor e dia (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

    const dateFilter = this.createDateFilter(startDate, endDate);

    const whereCondition = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    const results = await this.raffleTicketModel.findAll({
      where: whereCondition, // Use a condição where corretamente estruturada
      include: [
        {
          model: Raffle,
          attributes: [], // Não precisamos de atributos da Raffle no resultado raw, apenas para o join e o cálculo do SUM/WHERE
          required: true, // Garante que só pegamos tickets associados a rifas
          where: {
            // Filtra pelos preços fixos específicos
            ticketPrice: {
              [Op.in]: [5, 10, 20, 30, 50, 100],
            },
          },
        },
      ],
       // Agrupa por dia da compra e preço do bilhete
      group: [
          Sequelize.fn('date_trunc', 'day', Sequelize.col('RaffleTicket.createdAt')),
          // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) ***
          Sequelize.col('raffle.ticketPrice'),
      ],
      // Esta é a declaração correta dos atributos com agregação e aliases
      attributes: [
          [Sequelize.fn('date_trunc', 'day', Sequelize.col('RaffleTicket.createdAt')), 'purchaseDay'],
          // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) ***
          [Sequelize.col('raffle.ticketPrice'), 'ticketPrice'],
          [Sequelize.fn('count', Sequelize.col('RaffleTicket.id')), 'totalSoldTickets'], // Conta os IDs dos tickets para precisão
          // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) no literal ***
          [Sequelize.fn('sum', literal('"raffle"."ticketPrice"')), 'totalRevenue'],
      ],
      order: [
        [Sequelize.literal('"purchaseDay"'), 'ASC'], // Ordena por dia
        [Sequelize.literal('"ticketPrice"'), 'ASC'], // Ordena por preço (usando o alias)
      ],
      raw: true, // Retorna objetos simples
    });

    // Formatar a saída para agrupar por dia e ter os preços como chaves/objetos internos
    const formattedResults: { [day: string]: { [price: number]: { count: number, revenue: number } } } = {};

    results.forEach((row: any) => { // Mantido 'any' aqui para segurança com raw: true
         const dayKey = new Date(row.purchaseDay).toISOString().split('T')[0]; // Formato YYYY-MM-DD
         // O preço do bilhete vem como string do DECIMAL(10,2), converta para float para usar como chave/valor
         const priceKey = parseFloat(row.ticketPrice);

         if (!formattedResults[dayKey]) {
             formattedResults[dayKey] = {};
         }
         formattedResults[dayKey][priceKey] = {
             count: parseInt(row.totalSoldTickets, 10),
             revenue: parseFloat(row.totalRevenue), // totalRevenue também vem como string
         };
    });

    // Converter para um array de objetos { date: 'YYYY-MM-DD', sales: { '5': {count, revenue}, '10': {...} } } se preferir
    // Assegura a ordenação por data no array final
    const finalReport = Object.keys(formattedResults)
        .sort() // Ordena as chaves de data alfabeticamente (funciona para YYYY-MM-DD)
        .map(day => ({
            date: day,
            sales: formattedResults[day]
        }));


    this.logger.log(`Relatório de vendas por dia/preço gerado. ${finalReport.length} dias com dados.`);
    return finalReport;
  }


  // 2. Receita bruta
  // Filtra pela data de criação do TICKET (RaffleTicket.createdAt)
  async getTotalGrossRevenue(startDate?: string, endDate?: string): Promise<number> {
    this.logger.log(`Calculando: Receita Bruta Total (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

    const dateFilter = this.createDateFilter(startDate, endDate);

    const whereCondition = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    // Receita bruta é o total arrecadado com a venda de TODOS os bilhetes.
    // Cada bilhete vendido contribui com o ticketPrice da sua rifa.
    const result = await this.raffleTicketModel.findAll({
       where: whereCondition, // Use a condição where corretamente estruturada
       attributes: [
         // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) no literal ***
         [Sequelize.fn('sum', literal('"raffle"."ticketPrice"')), 'totalGrossRevenue'],
       ],
       include: [{
           model: Raffle,
           attributes: [], // Não precisamos de atributos da Raffle, apenas para o JOIN e o cálculo do SUM
           required: true,
       }],
       raw: true, // <-- Returns plain objects
    });

    // totalGrossRevenue virá como string do DB para DECIMAL, então parseFloat é necessário
    const totalGrossRevenue = parseFloat((result[0] as any)?.totalGrossRevenue || 0);
    this.logger.log(`Receita Bruta Total calculada: R$ ${totalGrossRevenue.toFixed(2)}`);
    return totalGrossRevenue; // Retorna como número
  }

  // 3. Receita líquida (simplificada)
  // Filtra pela data de sorteio/fim da RIFA (Raffle.drawDate)
  async getTotalNetRevenueSimplified(startDate?: string, endDate?: string): Promise<number> {
    this.logger.log(`Calculando: Receita Líquida Total (Simplificada) (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

    const dateFilter = this.createDateFilter(startDate, endDate);

    // O filtro já estava aninhado corretamente sob 'drawDate' aqui
    const whereCondition: any = {
        finished: true,
    };
    if (Object.keys(dateFilter).length > 0) {
         whereCondition.drawDate = dateFilter;
    }


    // Receita líquida simplificada = Soma da parcela da casa (15% tradicional, 20% equipes) das rifas FINALIZADAS
    // DENTRO DO PERÍODO DE FILTRO (considerando drawDate).
    const finishedRaffles = await this.raffleModel.findAll({
        where: whereCondition, // Use a condição where corretamente estruturada
        attributes: ['id', 'type', 'ticketPrice', 'soldTickets', 'drawDate'],
        raw: true, // Obter resultados simples
    });

    let totalNetRevenue = 0;

    finishedRaffles.forEach((raffle: any) => { // Mantido 'any' aqui
        // ticketPrice e soldTickets vêm como string do DB (DECIMAL/INTEGER com raw: true)
        const collectedValue = parseFloat(raffle.ticketPrice) * parseInt(raffle.soldTickets, 10);
        const houseSharePercentage = raffle.type === 'tradicional' ? 0.15 : 0.20; // 15% ou 20%
        totalNetRevenue += collectedValue * houseSharePercentage;
    });

    this.logger.log(`Receita Líquida Total (Simplificada) calculada: R$ ${totalNetRevenue.toFixed(2)} (baseado em rifas finalizadas no período e percentuais fixos da casa).`);
    return totalNetRevenue;
  }


  // 4. Rifas fechadas (numeradas)
  // Filtra pela data de sorteio/fim da RIFA (Raffle.drawDate)
  async getFinishedRafflesCount(startDate?: string, endDate?: string): Promise<number> {
    this.logger.log(`Contando: Rifas Fechadas (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

    const dateFilter = this.createDateFilter(startDate, endDate);

    // O filtro já estava aninhado corretamente sob 'drawDate' aqui
    const whereCondition: any = {
        finished: true,
    };
     if (Object.keys(dateFilter).length > 0) {
        whereCondition.drawDate = dateFilter;
    }


    const count = await this.raffleModel.count({
        where: whereCondition, // Use a condição where corretamente estruturada
    });
    this.logger.log(`Total de Rifas Fechadas no período: ${count}`);
    return count;
  }

  // 5. Rifas em aberto (numeradas - quantos números faltam pra fechar)
  // Filtra pela data de início da RIFA (Raffle.startDate)
  async getOpenRafflesSummary(startDate?: string, endDate?: string): Promise<any[]> {
    this.logger.log(`Gerando resumo: Rifas em Aberto (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

     const dateFilter = this.createDateFilter(startDate, endDate);

     const whereCondition: any = {
        finished: false,
    };
     if (Object.keys(dateFilter).length > 0) {
        whereCondition.startDate = dateFilter;
    }

    const openRaffles = await this.raffleModel.findAll({
      where: whereCondition, // Use a condição where corretamente estruturada
      attributes: ['id', 'raffleIdentifier', 'type', 'ticketPrice', 'totalTickets', 'soldTickets', 'startDate', 'endDate'],
       order: [['endDate', 'ASC'], ['createdAt', 'ASC']],
      raw: true,
    });

    const summary = openRaffles.map((raffle: any) => {
        const ticketPrice = parseFloat(raffle.ticketPrice as string);
        const totalTickets = parseInt(raffle.totalTickets as string, 10);
        const soldTickets = parseInt(raffle.soldTickets as string, 10);

        return {
            id: raffle.id,
            raffleIdentifier: raffle.raffleIdentifier,
            type: raffle.type,
            ticketPrice: ticketPrice,
            totalTickets: totalTickets,
            soldTickets: soldTickets,
            remainingTickets: totalTickets - soldTickets,
             startDate: raffle.startDate,
            endDate: raffle.endDate,
        };
    });


    this.logger.log(`Resumo de Rifas em Aberto gerado. ${summary.length} rifas encontradas.`);
    return summary;
  }

  // 6. Comparativo loto Jack X loto seleções valor total de venda.
  // Filtra pela data de criação do TICKET (RaffleTicket.createdAt)
  async getSalesComparisonByType(startDate?: string, endDate?: string): Promise<{ tradicional: number; equipes: number }> {
    this.logger.log(`Gerando relatório: Comparativo de Vendas por Tipo de Rifa (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

     const dateFilter = this.createDateFilter(startDate, endDate);

    const whereCondition = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    const results = await this.raffleTicketModel.findAll({
        where: whereCondition, // Use a condição where corretamente estruturada
        attributes: [
            // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) ***
            [Sequelize.col('raffle.type'), 'raffleType'],
            // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) no literal ***
            [Sequelize.fn('sum', literal('"raffle"."ticketPrice"')), 'totalValue'],
        ],
        include: [{
            model: Raffle,
            attributes: [],
            required: true,
        }],
        group: ['raffle.type'], // *** CORREÇÃO AQUI: Usar o alias correto 'raffle' (minúsculo) ***
        raw: true,
    });

    const comparison = { tradicional: 0, equipes: 0 };

    results.forEach((row: any) => {
        if (row.raffleType === 'tradicional') {
            comparison.tradicional = parseFloat(row.totalValue || 0);
        } else if (row.raffleType === 'equipes') {
            comparison.equipes = parseFloat(row.totalValue || 0);
        }
    });

     this.logger.log(`Comparativo de Vendas por Tipo: Tradicional R$ ${comparison.tradicional.toFixed(2)}, Equipes R$ ${comparison.equipes.toFixed(2)}.`);
    return comparison;
  }

  // 7. Quantidade jogadores cadastrados.
  // Filtra pela data de criação do USUÁRIO (User.createdAt)
  async getTotalRegisteredUsers(startDate?: string, endDate?: string): Promise<number> {
    this.logger.log(`Contando: Total de Usuários Cadastrados (Datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

    const dateFilter = this.createDateFilter(startDate, endDate);

    // *** CORREÇÃO: Aninhar dateFilter sob 'createdAt' ***
    const whereCondition = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    const count = await this.userModel.count({
        where: whereCondition, // Use a condição where corretamente estruturada
    });
    this.logger.log(`Total de Usuários Cadastrados no período: ${count}`);
    return count;
  }

  // 8. Lista de jogadores indicados por cadastro.
  // Filtra pela data de criação do USUÁRIO INDICADO (referredUsers.createdAt)
  async getReferralCounts(startDate?: string, endDate?: string): Promise<any[]> {
    this.logger.log(`Gerando relatório: Jogadores Indicados por Indicador (Datas de indicação: ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

    const dateFilter = this.createDateFilter(startDate, endDate);

     // O filtro é aplicado à coluna 'createdAt' do modelo incluído 'referredUsers', o que está correto.
     // Não é necessário envolver dateFilter em um objeto adicional aqui.
     const referredUsersIncludeWhere = Object.keys(dateFilter).length > 0 ? { where: dateFilter } : {};

     // *** CORREÇÃO: Removido o Sequelize.literal da cláusula where principal. ***
     // *** Filtrar os referrers que tiveram indicados no período será feito após a query. ***
    const referrersWithReferred = await this.userModel.findAll({
        // where: Sequelize.literal('EXISTS (SELECT 1 FROM users "referredUsers" WHERE "referredUsers"."referrerId" = "User"."id")'), // REMOVIDO
        attributes: ['id', 'name', 'referralCode', 'createdAt'],
        include: [
            {
                model: User,
                as: 'referredUsers',
                attributes: ['id', 'name', 'createdAt'],
                 ...referredUsersIncludeWhere, // Aplica a cláusula where condicional (já é { createdAt: dateFilter } se dateFilter não estiver vazio)
                 required: false, // Manter required: false para retornar todos os referrers inicialmente
                 order: [['createdAt', 'ASC']]
            }
        ],
        order: [['createdAt', 'ASC']], // Ordena a lista de indicadores por data de cadastro
    });


    const referralList = referrersWithReferred
        // *** CORREÇÃO: Filtrar *após* a query para incluir apenas referrers que têm pelo menos um indicado (no período de filtro, se aplicado) ***
        // Se dateFilter estiver vazio, queremos todos os referrers que têm QUALQUER indicado.
        // Se dateFilter NÃO estiver vazio, queremos apenas referrers que têm pelo menos UM indicado CUJA DATA DE CRIAÇÃO ESTÁ NO PERÍODO.
        .filter(referrer => (Object.keys(dateFilter).length === 0 && referrer.referredUsers && referrer.referredUsers.length > 0) || // Sem filtro, tem q ter qualquer indicado
                           (Object.keys(dateFilter).length > 0 && referrer.referredUsers && referrer.referredUsers.length > 0) // Com filtro, tem que ter indicado NO PERÍODO
        )
        .map(referrer => ({
            referrerId: referrer.id,
            referrerName: referrer.name,
            referrerCode: referrer.referralCode,
            referredCount: referrer.referredUsers?.length || 0, // Contagem APENAS dos indicados no período (ou todos se sem filtro)
            referredUsers: referrer.referredUsers?.map(referred => ({
                 id: referred.id,
                 name: referred.name,
                 signUpDate: referred.createdAt,
            })) || []
        }));

    this.logger.log(`Relatório de Indicações gerado. ${referralList.length} usuários com pelo menos um indicado (no período de filtro, se aplicado) encontrados.`);
    return referralList;
  }

  // 9. Lista de jogadores que enviaram código mas não estão aptos a receber os 5%
  // Filtra pela data de criação do USUÁRIO INDICADO (referredUsers.createdAt) - similar ao item 8
  async getInactiveReferrersThisMonth(startDate?: string, endDate?: string): Promise<any[]> {
    this.logger.log(`Gerando relatório: Indicadores Inativos neste Mês (Filtrando indicados criados entre ${startDate || 'qualquer'} a ${endDate || 'qualquer'})...`);

     const dateFilter = this.createDateFilter(startDate, endDate);

     // O filtro é aplicado à coluna 'createdAt' do modelo incluído 'referredUsers'.
     // Required: true significa que só pegamos referrers que TIVERAM indicados *que matcham a condição do where do include*.
     // Se dateFilter está vazio, required: true significa que só pegamos referrers que tiveram QUALQUER indicado.
     // Se dateFilter NÃO está vazio, required: true significa que só pegamos referrers que tiveram pelo menos UM indicado CUJA DATA DE CRIAÇÃO ESTÁ NO PERÍODO.
     // A cláusula HAVING COUNT > 0 é redundante com required: true no include, mas vamos manter para clareza na intenção.
     const referredUsersIncludeWhere: any = {
          attributes: ['id'], // Só precisamos contar
     };
     if (Object.keys(dateFilter).length > 0) {
          referredUsersIncludeWhere.where = dateFilter;
     }
     referredUsersIncludeWhere.required = true; // <--- Garante que só pega referrers que tiveram indicados (no período, se filtro)


    const potentialReferrers = await this.userModel.findAll({
        attributes: ['id', 'name', 'referralCode', 'createdAt'],
        include: [
            {
                model: User,
                as: 'referredUsers',
                ...referredUsersIncludeWhere, // Aplica a cláusula where condicional e required: true
            }
        ],
        order: [['createdAt', 'ASC']],
         raw: true,
        group: ['User.id', 'User.name', 'User.referralCode', 'User.createdAt'], // Agrupa pelo indicador
        // *** HAVING redundantemente garante que tem pelo menos 1 indicado no período (já feito pelo required: true) ***
        // Mas mantido pois o SQL gerado pode ser mais explícito.
        having: Sequelize.literal(`COUNT("referredUsers"."id") > 0`),
    });

    const inactiveReferrersList: any[] = [];

    for (const referrer of potentialReferrers) {
        const isActive = await this.authService.hasPlayedThisMonth(referrer.id);

        if (!isActive) {
            const totalReferredCount = await this.userModel.count({ where: { referrerId: referrer.id } });

            inactiveReferrersList.push({
                referrerId: referrer.id,
                referrerName: referrer.name,
                referrerCode: referrer.referralCode,
                referredUsersCount: totalReferredCount, // Adiciona a contagem TOTAL
                status: 'Inativo (Não jogou este mês)',
            });
        }
    }

    this.logger.log(`Relatório de Indicadores Inativos gerado. ${inactiveReferrersList.length} usuários inativos encontrados.`);
    return inactiveReferrersList;
  }
}