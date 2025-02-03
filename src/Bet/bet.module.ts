import { Module } from '@nestjs/common';
import { BetService } from './bet.service';
import { BetController } from './bet.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { BetGameRound } from '../models/bet/bet-game-round.model';
import { Bet } from '../models/bet/bet.model';
import { User } from 'src/models/user/user.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { BlockchainHash } from 'src/models/blockchain-hash.model';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { DiceRoundSeed } from 'src/models/dice/dice_round_seeds';
import { BetGameRoundSeed } from '../models/bet/bet-game-round.model-seed';

@Module({
imports: [SequelizeModule.forFeature([BetGameRound, Bet, User, BlockchainHash, Seed, GeneratedNumber, DiceRoundSeed, BetGameRoundSeed])],
providers: [BetService, BlockchainUtil],
controllers: [BetController],
exports: [BetService],
})
export class BetModule {}