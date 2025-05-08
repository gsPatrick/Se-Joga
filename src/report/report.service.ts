// src/report/report.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize, Op, literal } from 'sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { RaffleTicket } from '../models/raffle/raffle-ticket.model';
import { User } from '../models/user/user.model';
import { AuthService } from 'src/Auth/auth.service'; // Importar AuthService

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    @InjectModel(Raffle) private raffleModel: typeof Raffle,
    @InjectModel(RaffleTicket) private raffleTicketModel: typeof RaffleTicket,
    @InjectModel(User) private userModel: typeof User,
    private authService: AuthService, // Injete AuthService
    // @Inject('SEQUELIZE') private sequelize: Sequelize, // Não é necessário injetar a instância aqui para estas queries
  ) {}

  // 1. Total de rifa vendidas por valor dia ( 5/10/20/30/50/100)
  async getTotalSoldByPriceAndDay(): Promise<any[]> {
    this.logger.log('Gerando relatório: Total de rifas vendidas por valor e dia...');
    // Note: ticketPrice está na tabela Raffle, precisamos do join.
    const results = await this.raffleTicketModel.findAll({
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
          Sequelize.col('Raffle.ticketPrice'),
      ],
      // Esta é a declaração correta dos atributos com agregação e aliases
      attributes: [
          [Sequelize.fn('date_trunc', 'day', Sequelize.col('RaffleTicket.createdAt')), 'purchaseDay'],
          [Sequelize.col('Raffle.ticketPrice'), 'ticketPrice'],
          [Sequelize.fn('count', Sequelize.col('RaffleTicket.id')), 'totalSoldTickets'], // Conta os IDs dos tickets para precisão
          [Sequelize.fn('sum', literal('"Raffle"."ticketPrice"')), 'totalRevenue'], // Soma os preços dos tickets associados
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
  async getTotalGrossRevenue(): Promise<number> {
    this.logger.log('Calculando: Receita Bruta Total...');
    // Receita bruta é o total arrecadado com a venda de TODOS os bilhetes, em TODAS as rifas.
    // Cada bilhete vendido contribui com o ticketPrice da sua rifa.
    const result = await this.raffleTicketModel.findAll({
       attributes: [
         // Usar literal para referenciar a coluna na tabela associada dentro do SUM
         [Sequelize.fn('sum', literal('"Raffle"."ticketPrice"')), 'totalGrossRevenue'],
       ],
       include: [{
           model: Raffle,
           attributes: [], // Não precisamos de atributos da Raffle, apenas para o JOIN e o cálculo do SUM
           required: true,
       }],
       raw: true, // <-- Returns plain objects
    });

    // Corrigido: Acessar a propriedade usando notação de colchetes ou cast 'any'
    // totalGrossRevenue virá como string do DB para DECIMAL, então parseFloat é necessário
    const totalGrossRevenue = parseFloat((result[0] as any)?.totalGrossRevenue || 0);
    this.logger.log(`Receita Bruta Total calculada: R$ ${totalGrossRevenue.toFixed(2)}`);
    return totalGrossRevenue; // Retorna como número
  }

  // 3. Receita líquida (simplificada)
  async getTotalNetRevenueSimplified(): Promise<number> {
    this.logger.log('Calculando: Receita Líquida Total (Simplificada)...');
    // Receita líquida simplificada = Soma da parcela da casa (15% tradicional, 20% equipes) das rifas FINALIZADAS.
    // Isso ignora a complexidade exata da comissão de 5% para indicadores ativos.

    const finishedRaffles = await this.raffleModel.findAll({
        where: { finished: true },
        attributes: ['id', 'type', 'ticketPrice', 'soldTickets'],
        raw: true, // Obter resultados simples
    });

    let totalNetRevenue = 0;

    finishedRaffles.forEach((raffle: any) => { // Mantido 'any' aqui
        // ticketPrice e soldTickets vêm como string do DB (DECIMAL/INTEGER com raw: true)
        const collectedValue = parseFloat(raffle.ticketPrice) * parseInt(raffle.soldTickets, 10);
        const houseSharePercentage = raffle.type === 'tradicional' ? 0.15 : 0.20; // 15% ou 20%
        totalNetRevenue += collectedValue * houseSharePercentage;
    });

    this.logger.log(`Receita Líquida Total (Simplificada) calculada: R$ ${totalNetRevenue.toFixed(2)} (baseado em rifas finalizadas e percentuais fixos da casa).`);
    return totalNetRevenue;
  }


  // 4. Rifas fechadas (numeradas)
  async getFinishedRafflesCount(): Promise<number> {
    this.logger.log('Contando: Rifas Fechadas...');
    const count = await this.raffleModel.count({ where: { finished: true } });
    this.logger.log(`Total de Rifas Fechadas: ${count}`);
    return count;
  }

  // 5. Rifas em aberto (numeradas - quantos números faltam pra fechar)
  async getOpenRafflesSummary(): Promise<any[]> {
    this.logger.log('Gerando resumo: Rifas em Aberto...');
    const openRaffles = await this.raffleModel.findAll({
      where: { finished: false },
      attributes: ['id', 'raffleIdentifier', 'type', 'ticketPrice', 'totalTickets', 'soldTickets', 'endDate'],
       // Nao precisa incluir tickets aqui, soldTickets já é mantido
       order: [['endDate', 'ASC'], ['createdAt', 'ASC']], // Ordenar por data de fim e criação
      raw: true, // Obter resultados simples
    });

    const summary = openRaffles.map((raffle: any) => { // <-- Adicionado ': any' aqui!
        // ticketPrice, totalTickets, soldTickets vêm como strings quando raw: true é usado
        // Agora o cast direto para string não dará erro porque raffle é 'any'
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
            remainingTickets: totalTickets - soldTickets, // Calcular a diferença
            endDate: raffle.endDate, // Datas geralmente vêm como Date objects ou strings parseáveis
        };
    });


    this.logger.log(`Resumo de Rifas em Aberto gerado. ${summary.length} rifas encontradas.`);
    return summary;
  }

  // 6. Comparativo loto Jack X loto seleções valor total de venda.
  async getSalesComparisonByType(): Promise<{ tradicional: number; equipes: number }> {
    this.logger.log('Gerando relatório: Comparativo de Vendas por Tipo de Rifa...');
     // Similar à receita bruta, mas agrupado por tipo
    const results = await this.raffleTicketModel.findAll({
        attributes: [
            [Sequelize.col('Raffle.type'), 'raffleType'],
            // Usar literal para referenciar a coluna na tabela associada dentro do SUM
            [Sequelize.fn('sum', literal('"Raffle"."ticketPrice"')), 'totalValue'],
        ],
        include: [{
            model: Raffle,
            attributes: [],
            required: true,
            where: {
                 // Opcional: filtrar por status finished? A receita bruta geralmente inclui tudo que foi vendido.
                 // Vamos incluir tudo vendido, independente de ter finalizado ou não.
            }
        }],
        group: ['Raffle.type'],
        raw: true,
    });

    const comparison = { tradicional: 0, equipes: 0 };

    results.forEach((row: any) => { // Mantido 'any' aqui
        // totalValue virá como string do DB para DECIMAL, então parseFloat é necessário
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
  async getTotalRegisteredUsers(): Promise<number> {
    this.logger.log('Contando: Total de Usuários Cadastrados...');
    const count = await this.userModel.count();
    this.logger.log(`Total de Usuários Cadastrados: ${count}`);
    return count;
  }

  // 8. Lista de jogadores indicados por cadastro.
  async getReferralCounts(): Promise<any[]> {
    this.logger.log('Gerando relatório: Jogadores Indicados por Indicador...');
     // Buscar todos os usuários que INDICARAM alguém
     // Mantendo a versão que busca a lista para ter todos os detalhes solicitados (id, name, signUpDate dos indicados).
    const referrersWithReferred = await this.userModel.findAll({
        where: Sequelize.literal('EXISTS (SELECT 1 FROM users "referredUsers" WHERE "referredUsers"."referrerId" = "User"."id")'),
        attributes: ['id', 'name', 'referralCode', 'createdAt'],
        include: [
            {
                model: User,
                as: 'referredUsers',
                attributes: ['id', 'name', 'createdAt'],
                 order: [['createdAt', 'ASC']]
            }
        ],
        order: [['createdAt', 'ASC']], // Ordena a lista de indicadores por data de cadastro
    });


    const referralList = referrersWithReferred.map(referrer => ({
        referrerId: referrer.id,
        referrerName: referrer.name,
        referrerCode: referrer.referralCode,
        referredCount: referrer.referredUsers?.length || 0,
        referredUsers: referrer.referredUsers?.map(referred => ({
             id: referred.id,
             name: referred.name,
             signUpDate: referred.createdAt,
        })) || []
    }));

    this.logger.log(`Relatório de Indicações gerado. ${referralList.length} usuários com pelo menos um indicado encontrados.`);
    return referralList;
  }

  // 9. Lista de jogadores que enviaram código mas não estão aptos a receber os 5%
  async getInactiveReferrersThisMonth(): Promise<any[]> {
    this.logger.log('Gerando relatório: Indicadores Inativos neste Mês...');

     // Buscar todos os usuários que INDICARAM alguém
    const potentialReferrers = await this.userModel.findAll({
        where: Sequelize.literal('EXISTS (SELECT 1 FROM users "referredUsers" WHERE "referredUsers"."referrerId" = "User"."id")'),
        attributes: ['id', 'name', 'referralCode', 'createdAt'],
        order: [['createdAt', 'ASC']],
         raw: true, // Obter resultados simples
    });

    const inactiveReferrersList: any[] = [];

    for (const referrer of potentialReferrers) { // Mantido 'any' aqui
        // Usa o serviço Auth para verificar se o usuário jogou este mês
        const isActive = await this.authService.hasPlayedThisMonth(referrer.id);

        if (!isActive) {
            // Adicionar a contagem de indicados para este indicador inativo
            const referredCount = await this.userModel.count({ where: { referrerId: referrer.id } });

            inactiveReferrersList.push({
                referrerId: referrer.id,
                referrerName: referrer.name,
                referrerCode: referrer.referralCode,
                referredUsersCount: referredCount, // Adiciona a contagem
                status: 'Inativo (Não jogou este mês)',
            });
        }
    }

    this.logger.log(`Relatório de Indicadores Inativos gerado. ${inactiveReferrersList.length} usuários inativos encontrados.`);
    return inactiveReferrersList;
  }
}