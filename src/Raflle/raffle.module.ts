// raffle.module.ts
import { Module } from '@nestjs/common';
import { RaffleService } from './raffle.service';
import { RaffleController } from './raffle.controller'; // Crie isso depois
import { SequelizeModule } from '@nestjs/sequelize';
import { Raffle } from '../models/raffle/raffle.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from '../models/generated-number.model';
import { RaffleNumber } from '../models/raffle/raffle-number.model';
import { RaffleTicket } from '../models/raffle/raffle-ticket.model';

import { User } from '../models/user/user.model';
import { Seed } from '../models/seed.model';

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
  ],
  providers: [RaffleService],
  controllers: [RaffleController], // Crie isso depois
})
export class RaffleModule {}