import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockchainHash } from 'src/models/blockchain-hash.model';
import { Seed } from '../models/seed.model';
import { GeneratedNumber } from 'src/models/generated-number.model';
import { SeedService } from 'src/seed/seed.service';


@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(BlockchainHash)
    private blockchainHashModel: typeof BlockchainHash,
    @InjectModel(GeneratedNumber)
    private generatedNumberModel: typeof GeneratedNumber,
    private seedService: SeedService,
     @InjectModel(Seed) private seedModel: typeof Seed,
  ) {}


 async getGeneratedNumbersByHash(hash: string): Promise<any> {
    // 1. Buscar o hash
    const blockchainHash = await this.blockchainHashModel.findOne({ where: { hash } });
    if (!blockchainHash) {
    throw new NotFoundException(`Hash ${hash} não encontrado.`);
    }

  // 2. Buscar a seed associada
    const seed = await this.seedModel.findOne({
      where: { hashId: blockchainHash.id },
        include: [
            {
              model: GeneratedNumber,
              order: [['sequence', 'ASC']],
            },
          ],
    });


    if (!seed) {
      throw new NotFoundException(`Nenhuma seed encontrada para o hash ${hash}.`);
    }
      
      const generatedNumbers = seed.generatedNumbers;
        return {
          hash: blockchainHash.hash,
           generatedNumbers: generatedNumbers.map(number => ({
              number: number.number,
              sequence: number.sequence,
                createdAt: number.createdAt,
           }))
        };
}

  async generateNumbersFromHash(hash: string): Promise<any> {
        // 1. Buscar o hash
      const blockchainHash = await this.blockchainHashModel.findOne({ where: { hash } });
          if (!blockchainHash) {
            throw new NotFoundException(`Hash ${hash} não encontrado.`);
        }


        const correspondingSeed = await this.seedModel.findOne({
          where: { hashId: blockchainHash.id },
            order: [['createdAt', 'DESC']],
           });

        if (!correspondingSeed) {
            throw new NotFoundException(`Nenhuma seed encontrada para o hash ${hash}.`);
        }
       
      const numbers: number[] = [];
    for (let i = 0; i < 5000; i++) {
      try {
        const number = await this.seedService.getNextRandomNumber(hash, i);
        numbers.push(number);
      } catch (error) {
        this.logger.error(
          `Erro ao gerar número na iteração ${i}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        continue;
      }
    }
     return {
            hash: blockchainHash.hash,
          generatedNumbers: numbers,
    };
}
}