// src/report/report.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { Raffle } from '../models/raffle/raffle.model';
import { RaffleTicket } from '../models/raffle/raffle-ticket.model';
import { User } from '../models/user/user.model';
import { AuthModule } from 'src/Auth/auth.module'; // Importar AuthModule para usar AuthService

@Module({
  imports: [
    SequelizeModule.forFeature([
      Raffle,
      RaffleTicket,
      User,
    ]),
    AuthModule, // Necessário para injetar AuthService
  ],
  providers: [ReportService],
  controllers: [ReportController],
})
export class ReportModule {}