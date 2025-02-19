// // src/test/test.service.ts
// import { Injectable, Logger, NotFoundException } from '@nestjs/common';
// import { Cron, CronExpression } from '@nestjs/schedule';
// import { BlockchainUtil } from '../Utils/blockchain.util';
// import { Seed } from 'src/models/seed.model';
// import { GeneratedNumber } from 'src/models/generated-number.model';
// import { InjectModel } from '@nestjs/sequelize';
// import { BlockchainHash } from 'src/models/blockchain-hash.model';


// @Injectable()
// export class TestService {
//   private readonly logger = new Logger(TestService.name);

//   constructor(
//     private blockchainUtil: BlockchainUtil,
//      @InjectModel(GeneratedNumber)
//        private generatedNumberModel: typeof GeneratedNumber,
//       @InjectModel(Seed) private seedModel: typeof Seed,
//        @InjectModel(BlockchainHash) private blockchainHashModel: typeof BlockchainHash,
//   ) {}
    
//     @Cron('* * * * * *')
//   async logLatestSeedAndHash() {
//     try {
//           const data = await this.blockchainUtil.getLatestBlockchainData();

//         // this.logger.log(
//         // `Hash mais recente : ${data.hash}, Número gerado mais recente ${data.generatedNumber}`
//         // );
//     } catch (error) {
//           const err = error as Error
//       this.logger.error(
//         `Erro ao buscar a seed mais recente: ${err.message}`,
//           err.stack
//       );
//     }
//   }

//   async getLatestSeedAndHash() {
//     try {
//         return await this.blockchainUtil.getLatestBlockchainData();
//     } catch (error) {
//         const err = error as Error
//         this.logger.error(
//           `Erro ao buscar a seed mais recente: ${err.message}`,
//           err.stack
//         );
//          throw error
//     }
// }
// }