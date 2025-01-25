import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
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
import { BlockchainHash } from './models/blockchain-hash.model'; // Importe o modelo
import { Seed } from './models/seed.model'; // Importe o modelo



import { AuthModule } from './Auth/auth.module';
import { RaffleModule } from './Raflle/raffle.module';
import { HashModule } from './hash/hash.module';
import { SeedModule } from './seed/seed.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DiceModule } from './Dice/dice.module';





@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'patrick',
      database: 'seJoga',
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
        GeneratedNumber,
        BlockchainHash, // Adicione o modelo
        Seed, // Adicione o modelo

      ],
      autoLoadModels: true,
      synchronize: true,
    }),
    AuthModule,
    HashModule,
    SeedModule,
    RaffleModule,
    DiceModule,
    ScheduleModule.forRoot(),
  ],


  // ...
})
export class AppModule {}