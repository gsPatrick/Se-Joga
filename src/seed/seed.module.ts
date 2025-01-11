import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SeedService } from './seed.service';
import { Seed } from '../models/seed.model';
import { HashModule } from '../hash/hash.module';
import { GeneratedNumber } from '../models/generated-number.model';

@Module({
  imports: [
    SequelizeModule.forFeature([Seed, GeneratedNumber]),
    forwardRef(() => HashModule)
  ],
  providers: [SeedService],
  exports: [SeedService], // Certifique-se de exportar o SeedService
})
export class SeedModule {}