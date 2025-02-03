// src/dice/dice.module.ts
import { Module } from '@nestjs/common';
import { DiceService } from './dice.service';
import { DiceController } from './dice.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { DiceRound } from '../models/dice/dice-round.model';
import { DiceBet } from '../models/dice/dice-bet.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { User } from 'src/models/user/user.model';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { DiceRoundSeed } from 'src/models/dice/dice_round_seeds';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Module({
    imports: [SequelizeModule.forFeature([DiceRound, DiceBet, User, DiceRoundSeed, BlockchainHash,  GeneratedNumber, Seed])],
  providers: [DiceService, BlockchainUtil],
  controllers: [DiceController],
     exports: [DiceService],
})
export class DiceModule {}