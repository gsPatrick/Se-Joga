// src/app.module.ts
import { Module, Logger } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// --- Import Models (Seus Imports Originais + Novos Modelos de Pagamento + Versionamento) ---
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
import { PokerRound } from './models/poker/poker-round.model';
import { PokerPlayer } from './models/poker/poker-player.model';
import { PokerHand } from './models/poker/poker-hand.model';
import { PokerBet } from './models/poker/poker-bet.model';
import { PokerRoundSeed } from './models/poker/poker-round-seed.model';

// --- Novos modelos para Pagamento ---
import { Deposit } from './models/payment/deposit.model';
import { Withdrawal } from './models/payment/withdrawal.model';
// --- Fim Novos modelos ---

// --- Novo modelo para Versionamento APK ---
import { AppVersion } from './models/appVersion/app-version.model';
// --- Fim Novo modelo ---


// --- Import Modules (Seus Imports Originais + Novos Módulos) ---
import { AuthModule } from './Auth/auth.module';
import { RaffleModule } from './Raflle/raffle.module';
import { HashModule } from './hash/hash.module';
import { SeedModule } from './seed/seed.module';
import { BingoModule } from './Bingo/bingo.module';
import { DiceModule } from './Dice/dice.module';
import { BetModule } from './Bet/bet.module';
import { PokerModule } from './poker/poker.module';
import { CacaNiquelModule } from './caca-niquel/caca-niquel.module';
// --- Importar o novo módulo de Relatórios ---
import { ReportModule } from './report/report.module';
// --- Fim do Import do novo módulo ---

// --- Novo Módulo de Pagamento ---
import { PaymentModule } from './payment/payment.module';
// --- Fim Novo Módulo ---

// --- Novo Módulo de Versionamento APK ---
import { VersionModule } from './version/version.module';
// --- Fim Novo Módulo ---


@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),

    SequelizeModule.forRootAsync({
      imports: [ConfigModule], // Ainda é bom manter o ConfigModule importado aqui para o inject
      useFactory: async (configService: ConfigService) => { // ConfigService ainda injetado, mas não usado para essas vars
        console.log("***** SEQUELIZE CONFIGURATION FACTORY IS RUNNING! *****");

        // *** ADVERTÊNCIA: CREDENCIAIS HARDCODED ***
        // Usando valores fixos conforme solicitado.
        // Lembre-se que o ideal é usar variáveis de ambiente (via ConfigService) em produção.
        const dbHost = 'sejogadev';
        const dbPort = 5432;
        const dbUser = 'sejogadev';
        const dbPassword = 'sejogadev';
        const dbName = 'sejogadev';
        // *** FIM DA ADVERTÊNCIA ***


        // Lista de modelos completa
        const allModels = [
            User, Raffle, RaffleTicket, RouletteRound, RouletteBet, SlotMachineRound, SlotMachineBet,
            BingoGame, BingoCard, BingoNumber, BingoGameRound, BingoGameRoundNumber, DiceRound, DiceBet,
            Challenge, UserChallenge, UserChallengeHighestDozenResult, UserChallengeFirstTo1000Result,
            UserChallengeFirstTo1000Round, RaffleNumber, Bet, BetGameRound, BetGameRoundSeed, GeneratedNumber,
            BlockchainHash, DiceRoundSeed, BingoGameSeed, Seed, PokerRound, PokerPlayer, PokerHand, PokerBet,
            PokerRoundSeed,
            Deposit,
            Withdrawal,
            AppVersion,
        ];

        console.log(`
        **********************************************************************
        *  [DB Setup] Conectando ao banco de dados.                          *
        *  Sincronização automática desabilitada (synchronize: false).       *
        *  Gerencie o schema do banco de dados usando migrações.             *
        **********************************************************************
        `);

        return {
          dialect: 'postgres',
          host: dbHost,
          port: dbPort,
          username: dbUser,
          password: dbPassword,
          database: dbName,
          dialectOptions: {
            ssl: false,
            schema: 'public',
          },
          models: allModels,
          autoLoadModels: true,
          synchronize: false, // *** MANTIDO: NÃO sincroniza automaticamente o schema ***
          force: false,       // *** MANTIDO: NÃO força a deleção de tabelas ***
          logging: (sql) => { console.log('[SEQUELIZE SQL]:', sql); },
        };
      },
      inject: [ConfigService], // ConfigService injetado
    }),

    // Seus Módulos de Funcionalidade
    AuthModule,
    HashModule,
    SeedModule,
    RaffleModule,
    DiceModule,
    BingoModule,
    BetModule,
    PokerModule,
    CacaNiquelModule,

    ScheduleModule.forRoot(),
    PaymentModule,
    ReportModule,
    VersionModule,
  ],
  providers: [Logger],
  exports: [SequelizeModule],
})
export class AppModule {
  private readonly logger = new Logger(AppModule.name);
  constructor(private readonly configService: ConfigService) {}
}