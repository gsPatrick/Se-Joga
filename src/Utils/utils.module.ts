// src/utils/utils.module.ts
import { Module } from '@nestjs/common';
import { HashUtils } from './hash.utils';
import { OddUtils } from './odd.utils';
import { SequelizeModule } from '@nestjs/sequelize';
import { BlockchainHash } from 'src/models/blockchain-hash.model';
import { Seed } from 'src/models/seed.model';

@Module({
  imports: [SequelizeModule.forFeature([BlockchainHash, Seed])],
  providers: [HashUtils, OddUtils],
  exports: [HashUtils, OddUtils], // OddService precisa estar aqui
})
export class UtilsModule {}