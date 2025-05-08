// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Deposit } from '../models/payment/deposit.model';
import { Withdrawal } from '../models/payment/withdrawal.model';
import { EfiPixService } from './efi-pix.service';
import { PixController } from './pix.controller';
import { AuthModule } from '../Auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios'; // Importar HttpModule

@Module({
  imports: [
    SequelizeModule.forFeature([Deposit, Withdrawal]),
    AuthModule,
    ConfigModule,
    HttpModule, // Adicionar HttpModule aqui
  ],
  providers: [EfiPixService],
  controllers: [PixController],
  exports: [EfiPixService],
})
export class PaymentModule {}