// src/caca-niquel/caca-niquel.module.ts
import { Module } from '@nestjs/common';
import { CacaNiquelService } from './caca-niquel.service';
import { CacaNiquelController } from './caca-niquel.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { CacaNiquelRound } from '../models/caca-niquel/caca-niquel-round.model';
import { CacaNiquelBet } from '../models/caca-niquel/caca-niquel-bet.model';
import { User } from 'src/models/user/user.model';
import { BlockchainUtil } from '../Utils/blockchain.util';
import { BlockchainHash } from 'src/models/blockchain-hash.model';
import { Seed } from 'src/models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { CacaNiquelRoundSeed } from '../models/caca-niquel/caca-niquel-round-seed.model';

@Module({
    imports: [SequelizeModule.forFeature([CacaNiquelRound, CacaNiquelBet, User, BlockchainHash, Seed, GeneratedNumber, CacaNiquelRoundSeed])],
    providers: [CacaNiquelService, BlockchainUtil],
    controllers: [CacaNiquelController],
    exports: [CacaNiquelService], // Export CacaNiquelService se precisar usar em outros módulos
})
export class CacaNiquelModule { }