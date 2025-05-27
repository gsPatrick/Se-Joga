// src/report/report.controller.ts
import { Controller, Get, UseGuards, Logger, Query } from '@nestjs/common'; // Importar Query
import { AuthGuard } from '@nestjs/passport'; // Assumindo proteção via JWT
import { ReportService } from './report.service';
// Importe AuthUser se for necessário verificar o usuário logado ou sua role
// import { AuthUser } from 'src/Auth/auth-user.decorator';
// import { User, UserRole } from 'src/models/user/user.model';
// import { Roles } from 'src/Auth/roles.decorator'; // Se tiver guarda de role
// import { RolesGuard } from 'src/Auth/roles.guard'; // Se tiver guarda de role

@UseGuards(AuthGuard('jwt')) // Protege todas as rotas deste controller com JWT
// @UseGuards(AuthGuard('jwt'), RolesGuard) // Exemplo com guarda de role
// @Roles(UserRole.ADMIN) // Exemplo: só ADMIN pode acessar
@Controller('reports')
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(private readonly reportService: ReportService) {}

  @Get('sales/by-price-day')
  async getSalesByPriceAndDay(
      @Query('startDate') startDate?: string,
      @Query('endDate') endDate?: string,
  ): Promise<any[]> {
    this.logger.log(`Endpoint /reports/sales/by-price-day chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    return this.reportService.getTotalSoldByPriceAndDay(startDate, endDate);
  }

  @Get('revenue/gross')
  async getGrossRevenue(
       @Query('startDate') startDate?: string,
       @Query('endDate') endDate?: string,
  ): Promise<{ totalGrossRevenue: number }> {
    this.logger.log(`Endpoint /reports/revenue/gross chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    const totalGrossRevenue = await this.reportService.getTotalGrossRevenue(startDate, endDate);
    return { totalGrossRevenue };
  }

  @Get('revenue/net')
  async getNetRevenueSimplified(
       @Query('startDate') startDate?: string,
       @Query('endDate') endDate?: string,
  ): Promise<{ totalNetRevenueSimplified: number }> {
    this.logger.log(`Endpoint /reports/revenue/net chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    const totalNetRevenueSimplified = await this.reportService.getTotalNetRevenueSimplified(startDate, endDate);
    return { totalNetRevenueSimplified };
  }

  @Get('raffles/finished/count')
  async getFinishedRafflesCount(
       @Query('startDate') startDate?: string,
       @Query('endDate') endDate?: string,
  ): Promise<{ count: number }> {
    this.logger.log(`Endpoint /reports/raffles/finished/count chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    const count = await this.reportService.getFinishedRafflesCount(startDate, endDate);
    return { count };
  }

  @Get('raffles/open')
  async getOpenRafflesSummary(
       @Query('startDate') startDate?: string,
       @Query('endDate') endDate?: string,
  ): Promise<any[]> {
    this.logger.log(`Endpoint /reports/raffles/open chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    return this.reportService.getOpenRafflesSummary(startDate, endDate);
  }

  @Get('sales/comparison-by-type')
  async getSalesComparisonByType(
      @Query('startDate') startDate?: string,
      @Query('endDate') endDate?: string,
  ): Promise<{ tradicional: number; equipes: number }> {
     this.logger.log(`Endpoint /reports/sales/comparison-by-type chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    return this.reportService.getSalesComparisonByType(startDate, endDate);
  }

  @Get('users/total-count')
  async getTotalRegisteredUsers(
      @Query('startDate') startDate?: string,
      @Query('endDate') endDate?: string,
  ): Promise<{ count: number }> {
    this.logger.log(`Endpoint /reports/users/total-count chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    const count = await this.reportService.getTotalRegisteredUsers(startDate, endDate);
    return { count };
  }

  @Get('referrals/counts')
  async getReferralCounts(
       @Query('startDate') startDate?: string,
       @Query('endDate') endDate?: string,
  ): Promise<any[]> {
    this.logger.log(`Endpoint /reports/referrals/counts chamado com datas: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}`);
    return this.reportService.getReferralCounts(startDate, endDate);
  }

  @Get('referrals/inactive-this-month')
  async getInactiveReferrersThisMonth(
      @Query('startDate') startDate?: string,
      @Query('endDate') endDate?: string,
  ): Promise<any[]> {
    // Este relatório ainda tem a lógica de "neste mês" para a *atividade* do indicador,
    // mas o filtro de data opcional agora se aplica à data de criação dos *indicados*.
     this.logger.log(`Endpoint /reports/referrals/inactive-this-month chamado (Indicadores inativos neste mês, filtrando indicados criados entre: ${startDate || 'qualquer'} a ${endDate || 'qualquer'}).`);
    return this.reportService.getInactiveReferrersThisMonth(startDate, endDate);
  }
}