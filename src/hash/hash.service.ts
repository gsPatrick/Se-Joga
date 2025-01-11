import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import axios from 'axios';
import { BlockchainHash } from '../models/blockchain-hash.model';
import { SeedService } from '../seed/seed.service';
import { GeneratedNumber } from '../models/generated-number.model';

@Injectable()
export class HashService {
  private latestHash: string;
  private lastHashUpdate: number;
  private readonly logger = new Logger(HashService.name);

  constructor(
    @InjectModel(BlockchainHash)
    private blockchainHashModel: typeof BlockchainHash,
    private seedService: SeedService,
    @InjectModel(GeneratedNumber)
    private generatedNumberModel: typeof GeneratedNumber
  ) {
    this.updateHash(); // Atualiza o hash na inicialização
    setInterval(() => this.updateHash(), 600000); // Atualiza o hash a cada 10 minutos (600000 ms)
  }

  async getLatestHash(): Promise<string> {
    return this.latestHash;
  }

  async getLatestHashId(): Promise<number> {
    const latestHash = await this.blockchainHashModel.findOne({
      order: [['timestamp', 'DESC']], // Ordena por timestamp decrescente para pegar o mais recente
    });

    if (!latestHash) {
      return null;
    }

    return latestHash.id;
  }

  private async updateHash() {
    try {
      const response = await axios.get(
        'https://api.blockchair.com/bitcoin/stats',
      );
      const hash = response.data.data.best_block_hash;

      const existingHash = await this.blockchainHashModel.findOne({
        where: { hash },
      });

      if (!existingHash) {
        const newHash = await this.blockchainHashModel.create({
          hash,
          timestamp: new Date(),
        });
        this.latestHash = hash;
        this.lastHashUpdate = Date.now();
        this.logger.log(`Novo hash da blockchain armazenado: ${hash}`);

        // Gerar e armazenar a seed (sequência de números)
        await this.generateAndStoreSeed(newHash.id, hash);
      } else {
        this.latestHash = existingHash.hash;
        this.lastHashUpdate = existingHash.timestamp.getTime();
        this.logger.log(
          `Hash existente encontrado e reutilizado: ${this.latestHash}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Erro ao buscar ou armazenar o hash da blockchain: ${error.message}`,
        error.stack,
      );
    }
  }

  private async generateAndStoreSeed(hashId: number, hash: string) {
    this.logger.debug(`Gerando seed para o hashId: ${hashId}, hash: ${hash}`);
    const numbers: number[] = [];
    for (let i = 0; i < 5000; i++) {
      // Agora gera 5000 números
      try {
        const number = await this.seedService.getNextRandomNumber(hash, i);
        numbers.push(number);
      } catch (error) {
        this.logger.error(
          `Erro ao gerar número na iteração ${i}: ${error.message}`,
          error.stack,
        );
        continue;
      }
    }

    // Converter o array de números em uma string separada por vírgulas
    const seedString = numbers.join(',');

    // Criar a seed no banco de dados
    try {
      await this.seedService.createSeed(hashId, seedString);
      this.logger.log(`Seed gerada e armazenada para o hashId ${hashId}`);
    } catch (error) {
      this.logger.error(
        `Erro ao armazenar a seed para o hashId ${hashId}: ${error.message}`,
        error.stack,
      );
    }
  }
}