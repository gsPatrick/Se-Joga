// raffle.module.ts
import { Module } from '@nestjs/common';
import { RaffleService } from './raffle.service';
import { RaffleController } from './raffle.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { RaffleNumber } from '../models/raffle/raffle-number.model';
import { RaffleTicket } from '../models/raffle/raffle-ticket.model';

import { User } from '../models/user/user.model';
import { Seed } from '../models/seed.model';
import { AuthModule } from 'src/Auth/auth.module'; // Importar AuthModule

@Module({
  imports: [
    SequelizeModule.forFeature([
      Raffle,
      BlockchainHash,
      GeneratedNumber,
      RaffleNumber,
      Seed,
      RaffleTicket,
      User,
    ]),
    AuthModule, // Importar AuthModule aqui
  ],
  providers: [RaffleService],
  controllers: [RaffleController],
  exports: [RaffleService], // Exportar RaffleService se outros módulos precisarem
})
export class RaffleModule {}