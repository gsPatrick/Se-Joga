// src/utils/blockchain.util.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { Seed } from '../models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';

@Injectable()
export class BlockchainUtil {

    constructor(
        @InjectModel(BlockchainHash)
        private blockchainHashModel: typeof BlockchainHash,
         @InjectModel(Seed) private seedModel: typeof Seed,
         @InjectModel(GeneratedNumber)
          private generatedNumberModel: typeof GeneratedNumber,
    ) {}

    async getLatestBlockchainData(): Promise<any> {
        // 1. Encontrar a hash mais recente
        const latestHash = await this.blockchainHashModel.findOne({
            order: [['timestamp', 'DESC']],
        });

        if (!latestHash) {
            throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
        }

        // 2. Encontrar a seed correspondente à hash mais recente
        const correspondingSeed = await this.seedModel.findOne({
            where: { hashId: latestHash.id },
            include: [
              {
                model: GeneratedNumber,
                order: [['createdAt', 'DESC']],
                limit: 1,
              },
            ],
            order: [['createdAt', 'DESC']],
          });

        if (!correspondingSeed || correspondingSeed.generatedNumbers.length === 0) {
            throw new NotFoundException(
              'Nenhuma seed ou generatedNumber correspondente encontrado para a hash mais recente.',
            );
          }
        // 3. Obter o generatedNumber mais recente
         const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];
    

        return  {
            hash: latestHash.hash,
            generatedNumber: latestGeneratedNumber.number,
            };
    }
      async getLatestHashId(): Promise<number> {
        const latestHash = await this.blockchainHashModel.findOne({
          order: [['timestamp', 'DESC']],
        });
    
        if (!latestHash) {
          return -1;
        }
    
        return latestHash.id;
      }
}