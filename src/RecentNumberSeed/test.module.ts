// // src/test/test.module.ts
// import { Module } from '@nestjs/common';
// import { TestService } from './test.service';
// import { BlockchainUtil } from '../Utils/blockchain.util';
// import { BlockchainHash } from 'src/models/blockchain-hash.model';
// import { Seed } from 'src/models/seed.model';
// import { SequelizeModule } from '@nestjs/sequelize';
// import { GeneratedNumber } from 'src/models/generated-number.model';
// import { TestController } from './test.controller';

// @Module({
//   imports: [SequelizeModule.forFeature([BlockchainHash, Seed, GeneratedNumber])],
//   providers: [TestService, BlockchainUtil],
//   controllers: [TestController]
// })
// export class TestModule {}