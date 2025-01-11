// import { Module, forwardRef } from '@nestjs/common';
// import { SequelizeModule } from '@nestjs/sequelize';
// import { RaffleService } from './raffle.service';
// import { RaffleController } from './raffle.controller';
// import { Raffle } from '../models/raffle/raffle.model';
// import { RaffleTicket } from '../models/raffle/raffle-ticket.model';
// import { RaffleNumber } from '../models/raffle/raffle-number.model';
// import { HashModule } from '../hash/hash.module';
// import { SeedModule } from '../seed/seed.module';
// import { AuthModule } from '../auth/auth.module';
// import { GeneratedNumber } from '../models/generated-number.model';

// @Module({
//   imports: [
//     SequelizeModule.forFeature([
//       Raffle,
//       RaffleTicket,
//       RaffleNumber,
//       GeneratedNumber,
//     ]),
//     HashModule,
//     forwardRef(() => SeedModule),
//     AuthModule, 
//   ],
//   providers: [RaffleService],
//   controllers: [RaffleController],
//   exports: [RaffleService],
// })
// export class RaffleModule {}