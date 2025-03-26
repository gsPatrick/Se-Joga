// src/poker/poker.module.ts
import { Module } from '@nestjs/common';
import { PokerService } from './poker.service';
import { PokerController } from './poker.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { PokerRound } from '../models/poker/poker-round.model';
import { PokerPlayer } from '../models/poker/poker-player.model';
import { PokerHand } from '../models/poker/poker-hand.model';
import { PokerBet } from '../models/poker/poker-bet.model';
import { PokerRoundSeed } from '../models/poker/poker-round-seed.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { BlockchainHash } from 'src/models/blockchain-hash.model';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { User } from 'src/models/user/user.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      PokerRound,
      PokerPlayer,
      PokerHand,
      PokerBet,
      PokerRoundSeed,
      BlockchainHash,
      Seed,
      GeneratedNumber,
      User,
    ]),
  ],
  providers: [PokerService, BlockchainUtil],
  controllers: [PokerController],
  exports: [PokerService, BlockchainUtil], // EXPORTAR BlockchainUtil AQUI!
})
export class PokerModule {}