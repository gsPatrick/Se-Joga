// src/roulette/roulette.module.ts
import { Module, Scope } from '@nestjs/common';
import { RouletteService } from './roulette.service';
import { RouletteController } from './roulette.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { RouletteBet } from 'src/models/roulette/roulette-bet.model';
import { RouletteRound } from 'src/models/roulette/roulette-round.model';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { User } from 'src/models/user/user.model';
import { RouletteRoomService } from './roulette-room.service';
import { ScheduleModule } from '@nestjs/schedule';
import { UtilsModule } from 'src/utils/utils.module';
import { OddUtils } from 'src/utils/odd.utils'; // Atualize o import


@Module({
  imports: [
    SequelizeModule.forFeature([
      RouletteBet,
      RouletteRound,
      BlockchainHash,
      User,
    ]),
    ScheduleModule.forRoot(),
    UtilsModule,
  ],
  providers: [
    {
      provide: RouletteService,
      scope: Scope.REQUEST, // Define o escopo do RouletteService
      useClass: RouletteService,
    },
    RouletteRoomService,
  ],
  controllers: [RouletteController],
})
export class RouletteModule {}