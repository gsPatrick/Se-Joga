// src/app.module.ts
import { Module, Logger } from '@nestjs/common';
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
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => { // Mantenha ConfigService injetado
        console.log("***** SEQUELIZE CONFIGURATION FACTORY IS RUNNING! *****");

        // *** ADVERTÊNCIA EXTREMA: CREDENCIAIS HARDCODED FOI REMOVIDO DAQUI ***
        // AGORA ESTAMOS RECUPERANDO AS CREDENCIAIS DO ConfigService
        // Isso pressupõe que você tem variáveis de ambiente definidas (ex: .env)
        // com nomes como DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.

        const dbHost = configService.get<string>('DB_HOST');
        // Use um valor padrão ou lance um erro se a porta não estiver definida ou não for um número válido
        const dbPort = parseInt(configService.get<string>('DB_PORT') || '5432', 10);
        const dbUser = configService.get<string>('DB_USER');
        const dbPassword = configService.get<string>('DB_PASSWORD');
        const dbName = configService.get<string>('DB_NAME');

        // Opcional: Verificação básica para garantir que as variáveis foram carregadas
        if (!dbHost || isNaN(dbPort) || !dbUser || !dbPassword || !dbName) {
          throw new Error('Database credentials (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME) are not fully configured in environment variables.');
        }


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


        // --- Configuração para Sincronização Automática COM FORCE TRUE (Altamente Perigoso em Produção!) ---
        console.warn(`
**********************************************************************
*  [DB Setup - **DESTRUTIVO!**] synchronize: true e FORCE: true!     *
*  ISSO VAI DELETAR TODOS OS DADOS E TABELAS E RECRIA-LOS!           *
*  Use APENAS EM AMBIENTES DE DESENVOLVIMENTO ISOLADOS OU PARA       *
*  CRIAR A ESTRUTURA INICIAL EM UM BANCO DE DADOS VAZIO EM DEV.      *
*  **NUNCA, JAMAIS USE EM PRODUÇÃO!** Use migrações!                 *
*  RISCO GRAVÍSSIMO E CERTO DE PERDA DE DADOS!                       *
**********************************************************************
        `);

        return {
          dialect: 'postgres',
          host: dbHost, // Agora usando a variável recuperada
          port: dbPort, // Agora usando a variável recuperada
          username: dbUser, // Agora usando a variável recuperada
          password: dbPassword, // Agora usando a variável recuperada
          database: dbName, // Agora usando a variável recuperada
          dialectOptions: {
            ssl: false, // SSL DESATIVADO (conforme seu código original)
            schema: 'public', // Força usar o schema "public" (conforme seu código original)
          },
          models: allModels, // Usa a lista completa de modelos
          autoLoadModels: true, // Carrega modelos automaticamente (útil com synchronize)
          synchronize: true, // *** ATIVADO: Cria/atualiza tabelas automaticamente ***
          force: true,       // *** ATIVADO: DROPA tabelas antes de criar ***
          logging: (sql) => { console.log('[SEQUELIZE SQL - SYNC]:', sql); }, // Mostra o SQL gerado
        };
      },
      inject: [ConfigService], // Mantenha o inject
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