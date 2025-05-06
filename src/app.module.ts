// src/app.module.ts
import { Module, Logger } from '@nestjs/common'; // Importar Logger aqui
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// --- Import Models (Seus Imports Originais + Novos Modelos de Pagamento) ---
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


// --- Import Modules (Seus Imports Originais + Novo Módulo de Pagamento) ---
import { AuthModule } from './Auth/auth.module';
import { RaffleModule } from './Raflle/raffle.module';
import { HashModule } from './hash/hash.module';
import { SeedModule } from './seed/seed.module';
import { BingoModule } from './Bingo/bingo.module';
import { DiceModule } from './Dice/dice.module';
import { BetModule } from './Bet/bet.module';
import { PokerModule } from './poker/poker.module';
import { CacaNiquelModule } from './caca-niquel/caca-niquel.module';

// --- Novo Módulo de Pagamento ---
import { PaymentModule } from './payment/payment.module';
// --- Fim Novo Módulo ---


@Module({
  imports: [
    ConfigModule.forRoot({
      // Usar ignoreEnvFile para produção se as vars de ambiente vierem de outro lugar
      // ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: '.env', // Manter .env para dev
      isGlobal: true, // Torna ConfigModule disponível globalmente
    }),

    SequelizeModule.forRootAsync({
      imports: [ConfigModule], // Ainda importa ConfigModule para acessar ConfigService em outros lugares
      useFactory: async (configService: ConfigService) => { // Injete ConfigService aqui, mesmo que não use para credenciais DB, pode ser útil para outras configs
        console.log("***** SEQUELIZE CONFIGURATION FACTORY IS RUNNING! *****");

        // *** ADVERTÊNCIA EXTREMA: CREDENCIAIS HARDCODED ***
        // ISTO É APENAS PARA FACILITAR TESTES INICIAIS EM AMBIENTES DEV ISOLADOS.
        // NUNCA USE CREDENCIAIS DIRETAMENTE NO CÓDIGO EM PRODUÇÃO!
        // USE ConfigService.get<string>('DB_HOST') etc. em produção.
        const dbHost = 'jackbear_sejoga'; // Use ConfigService.get('DB_HOST') em produção!
        const dbPort = 5432;             // Use ConfigService.get('DB_PORT') em produção!
        const dbUser = 'seJoga';         // Use ConfigService.get('DB_USER') em produção!
        const dbPassword = 'seJoga';     // Use ConfigService.get('DB_PASSWORD') em produção!
        const dbName = 'seJoga';         // Use ConfigService.get('DB_NAME') em produção!
        // *** FIM DA ADVERTÊNCIA EXTREMA ***


        // Lista de modelos completa incluindo os novos modelos de Pagamento
        const allModels = [
            User, Raffle, RaffleTicket, RouletteRound, RouletteBet, SlotMachineRound, SlotMachineBet,
            BingoGame, BingoCard, BingoNumber, BingoGameRound, BingoGameRoundNumber, DiceRound, DiceBet,
            Challenge, UserChallenge, UserChallengeHighestDozenResult, UserChallengeFirstTo1000Result,
            UserChallengeFirstTo1000Round, RaffleNumber, Bet, BetGameRound, BetGameRoundSeed, GeneratedNumber,
            BlockchainHash, DiceRoundSeed, BingoGameSeed, Seed, PokerRound, PokerPlayer, PokerHand, PokerBet,
            PokerRoundSeed,
            // --- ADICIONADO: Novos modelos de Pagamento ---
            Deposit,
            Withdrawal,
            // --- Fim da adição ---
        ];


        // --- Configuração para Sincronização Automática (Perigoso em Produção!) ---
        console.warn(`
        **********************************************************************
        *  [DB Setup - **PERIGO!**] synchronize: true ATIVADO!               *
        *  ISSO SINCRONIZA O BANCO DE DADOS AUTOMATICAMENTE COM SEUS MODELOS.*
        *  PODE DESTRUIR DADOS EXISTENTES EM PRODUÇÃO!                       *
        *  USE APENAS EM AMBIENTES DE DESENVOLVIMENTO ISOLADOS OU PARA       *
        *  CRIAR A ESTRUTURA INICIAL EM UM BANCO DE DADOS VAZIO EM DEV.      *
        *  **NUNCA USE EM PRODUÇÃO!** USE MIGRAÇÕES!                         *
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
            ssl: false, // SSL DESATIVADO (conforme seu código original)
            schema: 'public', // Força usar o schema "public" (conforme seu código original)
          },
          models: allModels, // Usa a lista completa de modelos
          autoLoadModels: true, // Carrega modelos automaticamente (útil com synchronize)
          synchronize: true, // *** ATIVADO: Cria/atualiza tabelas automaticamente ***
          logging: (sql) => { console.log('[SEQUELIZE SQL - SYNC]:', sql); }, // Mostra o SQL gerado
        };
      },
      inject: [ConfigService], // Mantenha o inject para poder injetar ConfigService acima
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

    // Módulo para tarefas agendadas (@Cron, etc.)
    ScheduleModule.forRoot(),

    // --- ADICIONADO: Novo Módulo de Pagamento ---
    PaymentModule,
    // --- Fim da adição ---
  ],
  // Adiciona Logger como provider (opcional, mas bom para logs)
  providers: [Logger],
  // Exporta o SequelizeModule se outros módulos injetarem modelos diretamente
  exports: [SequelizeModule],
})
export class AppModule {
  private readonly logger = new Logger(AppModule.name); // Instancia o Logger
  // Injecte ConfigService aqui para poder usá-lo se precisar de outras configs no futuro
  constructor(private readonly configService: ConfigService) {}
}