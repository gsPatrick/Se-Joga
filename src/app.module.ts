import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Import ConfigModule
import { User } from './models/user/user.model';
import { Raffle } from './models/raffle/raffle.model';
import { RaffleTicket } from './models/raffle/raffle-ticket.model';
import { RouletteRound } from './models/roulette/roulette-round.model';
import { RouletteBet } from './models/roulette/roulette-bet.model';
import { SlotMachineRound } from './models/slot-machine/slot-machine-round.model';
import { SlotMachineBet } from './models/slot-machine/slot-machine-bet.model';
import { BingoGame } from './models/bingo/bingo-game.model';
import { BingoCard } from './models/bingo/bingo-card.model';
import { BingoNumber } from './models/bingo/bingo-number.model';
import { BingoGameRound } from './models/bingo/bingo-game-round.model';
import { BingoGameRoundNumber } from './models/bingo/bingo-game-round-number.model';
import { DiceRound } from './models/dice/dice-round.model';
import { DiceBet } from './models/dice/dice-bet.model';
import { Challenge } from './models/challenges/challenge.model';
import { UserChallenge } from './models/challenges/user-challenge.model';
import { UserChallengeHighestDozenResult } from './models/challenges/user-challenge-highest-dozen-result.model';
import { UserChallengeFirstTo1000Result } from './models/challenges/user-challenge-first-to-1000-result.model';
import { UserChallengeFirstTo1000Round } from './models/challenges/user-challenge-first-to-1000-round.model';
import { RaffleNumber } from './models/raffle/raffle-number.model';
import { GeneratedNumber } from './models/generated-number.model';
import { BlockchainHash } from './models/blockchain-hash.model';
import { Seed } from './models/seed.model';
import { BetGameRound } from './models/bet/bet-game-round.model';
import { Bet } from './models/bet/bet.model';
import { DiceRoundSeed } from './models/dice/dice_round_seeds';
import { BetGameRoundSeed } from './models/bet/bet-game-round.model-seed';
import { BingoGameSeed } from './models/bingo/bingo_game_seeds';

import { AuthModule } from './Auth/auth.module';
import { RaffleModule } from './Raflle/raffle.module';
import { HashModule } from './hash/hash.module';
import { SeedModule } from './seed/seed.module';
import { BingoModule } from './Bingo/bingo.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DiceModule } from './Dice/dice.module';
import { BetModule } from './Bet/bet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ // Configure ConfigModule to load .env files
      envFilePath: '.env', // Specify the path to your .env file (optional, defaults to .env in root)
      isGlobal: true,       // Make ConfigService globally available
    }),
    SequelizeModule.forRootAsync({ // Use forRootAsync for dynamic configuration
      imports: [ConfigModule], // Import ConfigModule to access ConfigService
      useFactory: async (configService: ConfigService) => ({ // Inject ConfigService
        dialect: 'postgres',
        host: configService.get<string>('DB_HOST'), // Access environment variables using ConfigService
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        models: [
          User,
          Raffle,
          RaffleTicket,
          RouletteRound,
          RouletteBet,
          SlotMachineRound,
          SlotMachineBet,
          BingoGame,
          BingoCard,
          BingoNumber,
          BingoGameRound,
          BingoGameRoundNumber,
          DiceRound,
          DiceBet,
          Challenge,
          UserChallenge,
          UserChallengeHighestDozenResult,
          UserChallengeFirstTo1000Result,
          UserChallengeFirstTo1000Round,
          RaffleNumber,
          Bet,
          BetGameRound,
          BetGameRoundSeed,
          GeneratedNumber,
          BlockchainHash,
          DiceRoundSeed,
          BingoGameSeed,
          Seed,
        ],
        autoLoadModels: true,
        synchronize: true,
      }),
      inject: [ConfigService], // Inject ConfigService into the factory function
    }),
    AuthModule,
    HashModule,
    SeedModule,
    RaffleModule,
    DiceModule,
    BingoModule,
    BetModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}