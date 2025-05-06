// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Deposit } from '../models/payment/deposit.model';
import { Withdrawal } from '../models/payment/withdrawal.model';
import { EfiPixService } from './efi-pix.service';
import { PixController } from './pix.controller';
import { AuthModule } from '../Auth/auth.module'; // Precisamos do AuthService
import { ConfigModule } from '@nestjs/config'; // Para acessar ConfigService

@Module({
  imports: [
    SequelizeModule.forFeature([Deposit, Withdrawal]),
    AuthModule, // Importar AuthModule para usar AuthService
    ConfigModule, // Importar ConfigModule para usar ConfigService
  ],
  providers: [EfiPixService],
  controllers: [PixController],
  exports: [EfiPixService], // Exportar se outros módulos precisarem interagir com ele
})
export class PaymentModule {}