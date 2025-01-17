// src/utils/hash.utils.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { GeneratedNumber } from 'src/models/generated-number.model';

@Injectable()
export class HashUtils {
  seedModel: any;
  constructor(
    @InjectModel(BlockchainHash)
    private blockchainHashModel: typeof BlockchainHash,
  ) {}

  async getLatestDezena(useLast30: boolean = false): Promise<string> {
    if (useLast30) {
      // Implementar a lógica para obter as 30 últimas dezenas
      throw new Error(
        'A obtenção das 30 últimas dezenas ainda não foi implementada.',
      );
    } else {
      const latestHash = await this.blockchainHashModel.findOne({
        order: [['timestamp', 'DESC']],
      });

      if (!latestHash) {
        throw new NotFoundException('Nenhuma hash de blockchain encontrada.');
      }

      // Encontrar a seed correspondente à hash mais recente
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

      // Obter o generatedNumber mais recente da seed
      const latestGeneratedNumber = correspondingSeed.generatedNumbers[0];

      // Extrair a última dezena do número
      return (BigInt(latestGeneratedNumber.number) % 100n).toString().padStart(2, '0');
    }
  }
}