    // src/roulette/roulette.module.ts
    import { Module } from '@nestjs/common';
    import { RouletteService } from './roulette.service';
    import { RouletteController } from './roulette.controler';
    import { SequelizeModule } from '@nestjs/sequelize';
    import { RouletteRound } from '../models/roulette/roulette-round.model';
    import { RouletteBet } from '../models/roulette/roulette-bet.model';
    import { User } from 'src/models/user/user.model';
    import { BlockchainUtil } from '../Utils/blockchain.util';
    import { BlockchainHash } from 'src/models/blockchain-hash.model';
    import { Seed } from 'src/models/seed.model';
    import { GeneratedNumber } from 'src/models/generated-number.model';
    import { BetGameRoundSeed } from '../models/bet/bet-game-round.model-seed';
    
@Module({
  imports: [SequelizeModule.forFeature([RouletteRound, RouletteBet, User, BlockchainHash, Seed, GeneratedNumber, BetGameRoundSeed])],
  providers: [RouletteService, BlockchainUtil],
  controllers: [RouletteController]
})
export class RouletteModule {}