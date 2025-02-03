// src/bingo/bingo.module.ts
import { Module } from '@nestjs/common';
import { BingoService } from './bingo.service';
import { BingoController } from './bingo.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { BingoGame } from '../models/bingo/bingo-game.model';
import { BingoCard } from '../models/bingo/bingo-card.model';
import { User } from 'src/models/user/user.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { BlockchainHash } from 'src/models/blockchain-hash.model';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { BingoNumber } from '../models/bingo/bingo-number.model';
import { BingoGameSeed } from '../models/bingo/bingo_game_seeds';
import { BingoGameRound } from '../models/bingo/bingo-game-round.model';


@Module({
    imports: [SequelizeModule.forFeature([BingoGame, BingoCard, User, BlockchainHash, Seed, GeneratedNumber, BingoNumber, BingoGameSeed, BingoGameRound])],
    providers: [BingoService, BlockchainUtil],
    controllers: [BingoController]
  })
  export class BingoModule {}