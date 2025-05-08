// src/report/report.controller.ts
import { Controller, Get, UseGuards, Logger } from '@nestjs/common';
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
  async getSalesByPriceAndDay(): Promise<any[]> {
    this.logger.log('Endpoint /reports/sales/by-price-day chamado.');
    return this.reportService.getTotalSoldByPriceAndDay();
  }

  @Get('revenue/gross')
  async getGrossRevenue(): Promise<{ totalGrossRevenue: number }> {
    this.logger.log('Endpoint /reports/revenue/gross chamado.');
    const totalGrossRevenue = await this.reportService.getTotalGrossRevenue();
    return { totalGrossRevenue };
  }

  @Get('revenue/net')
  async getNetRevenueSimplified(): Promise<{ totalNetRevenueSimplified: number }> {
    this.logger.log('Endpoint /reports/revenue/net chamado.');
    const totalNetRevenueSimplified = await this.reportService.getTotalNetRevenueSimplified();
    return { totalNetRevenueSimplified };
  }

  @Get('raffles/finished/count')
  async getFinishedRafflesCount(): Promise<{ count: number }> {
    this.logger.log('Endpoint /reports/raffles/finished/count chamado.');
    const count = await this.reportService.getFinishedRafflesCount();
    return { count };
  }

  @Get('raffles/open')
  async getOpenRafflesSummary(): Promise<any[]> {
    this.logger.log('Endpoint /reports/raffles/open chamado.');
    return this.reportService.getOpenRafflesSummary();
  }

  @Get('sales/comparison-by-type')
  async getSalesComparisonByType(): Promise<{ tradicional: number; equipes: number }> {
     this.logger.log('Endpoint /reports/sales/comparison-by-type chamado.');
    return this.reportService.getSalesComparisonByType();
  }

  @Get('users/total-count')
  async getTotalRegisteredUsers(): Promise<{ count: number }> {
    this.logger.log('Endpoint /reports/users/total-count chamado.');
    const count = await this.reportService.getTotalRegisteredUsers();
    return { count };
  }

  @Get('referrals/counts')
  async getReferralCounts(): Promise<any[]> {
    this.logger.log('Endpoint /reports/referrals/counts chamado.');
    return this.reportService.getReferralCounts();
  }

  @Get('referrals/inactive-this-month')
  async getInactiveReferrersThisMonth(): Promise<any[]> {
    this.logger.log('Endpoint /reports/referrals/inactive-this-month chamado.');
    return this.reportService.getInactiveReferrersThisMonth();
  }
}