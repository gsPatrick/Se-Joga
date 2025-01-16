// src/dice/dice.module.ts
import { Module } from '@nestjs/common';
import { DiceService } from './dice.service';
import { DiceController } from './dice.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { User } from 'src/models/user/user.model';
import { DiceBet } from 'src/models/dice/dice-bet.model';
import { DiceRound } from 'src/models/dice/dice-round.model';

@Module({
  imports: [SequelizeModule.forFeature([BlockchainHash, User, DiceBet, DiceRound])],
  providers: [DiceService],
  controllers: [DiceController],
})
export class DiceModule {}