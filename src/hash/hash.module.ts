import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { HashService } from './hash.service';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { SeedService } from '../seed/seed.service';
import { Seed } from '../models/seed.model';
import { SeedModule } from '../seed/seed.module';
import { GeneratedNumber } from 'src/models/generated-number.model';

@Module({
  imports: [
    SequelizeModule.forFeature([BlockchainHash, Seed, GeneratedNumber]),
    forwardRef(() => SeedModule),
  ],
  providers: [HashService, SeedService],
  exports: [HashService, SeedService], // Exporte SeedService
})
export class HashModule {}