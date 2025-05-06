import { Module } from '@nestjs/common';
import { AuthService } from '../Auth/auth.service';
import { AuthController } from '../Auth/auth.controller';
import { User } from '../models/user/user.model';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../Auth/jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Importar modelos de jogos relevantes para checar atividade do usuário
import { RaffleTicket } from 'src/models/raffle/raffle-ticket.model'; // Bilhete de Rifa
import { RouletteBet } from 'src/models/roulette/roulette-bet.model'; // Aposta de Roleta
import { SlotMachineBet } from 'src/models/slot-machine/slot-machine-bet.model'; // Aposta de Caca Niquel
import { BingoCard } from 'src/models/bingo/bingo-card.model'; // Cartela de Bingo
import { DiceBet } from 'src/models/dice/dice-bet.model'; // Aposta de Dados
import { Bet } from 'src/models/bet/bet.model'; // Aposta BetGame (Crash, etc.)
import { PokerBet } from 'src/models/poker/poker-bet.model'; // Aposta de Poker (se aplicável)


@Module({
  imports: [
    SequelizeModule.forFeature([
      User,
      // Adicionar modelos de jogos aqui para que AuthService possa consultá-los
      RaffleTicket,
      RouletteBet,
      SlotMachineBet,
      BingoCard,
      DiceBet,
      Bet,
      PokerBet,
      // Incluir outros modelos de aposta/participação de jogos se existirem
    ]),
    PassportModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '60m' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService] // Isso é importante
})
export class AuthModule {}