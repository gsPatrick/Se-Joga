  // src/hash/hash.service.ts
  import { Injectable, Logger, NotFoundException } from '@nestjs/common';
  import { InjectModel } from '@nestjs/sequelize';
  import axios from 'axios';
  import { BlockchainHash } from '../models/blockchain-hash.model';
  import { SeedService } from '../seed/seed.service';
  import { GeneratedNumber } from '../models/generated-number.model';
  import { createHash } from 'crypto';

  @Injectable()
  export class HashService {
    private latestHash!: string;
    private lastHashUpdate: number = 0;
    private readonly logger = new Logger(HashService.name);

    constructor(
      @InjectModel(BlockchainHash)
      private blockchainHashModel: typeof BlockchainHash,
      private seedService: SeedService,
      @InjectModel(GeneratedNumber)
      private generatedNumberModel: typeof GeneratedNumber,
    ) {
      this.updateHash();
      setInterval(() => this.updateHash(), 600000);
    }

    async getLatestHash(): Promise<string> {
      return this.latestHash;
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

          // **1. Criar a seed vazia primeiro**
          const newSeed = await this.seedService.createSeed(newHash.id, ''); // Passando string vazia
          this.logger.log(`Seed vazia criada para o hashId ${newHash.id}`);

          // **2. Gerar e armazenar a seed (sequência de números) DEPOIS de criar a seed vazia**
          await this.generateAndStoreSeed(newSeed.id, hash);
        } else {
          this.latestHash = existingHash.hash;
          this.lastHashUpdate = existingHash.createdAt.getTime();
          this.logger.log(
            `Hash existente encontrado e reutilizado: ${this.latestHash}`,
          );
        }
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          `Erro ao buscar ou armazenar o hash da blockchain: ${err.message}`,
          err.stack,
        );
      }
    }

    private async generateAndStoreSeed(seedId: number, hash: string) {
      this.logger.debug(`Gerando seed para o seedId: ${seedId}, hash: ${hash}`);
      const numbers: number[] = [];
      for (let i = 0; i < 5000; i++) {
        try {
          const number = await this.seedService.getNextRandomNumber(hash, i);
          numbers.push(number);
        } catch (error) {
          this.logger.error(
            `Erro ao gerar número na iteração ${i}: ${ (error as Error).message}`,
            (error as Error).stack,
          );
          continue;
        }
      }

      // Converter o array de números em uma string separada por vírgulas
      const seedString = numbers.join(',');

      try {
        // **3. Atualizar a seed existente com a string gerada**
        const seed = await this.seedService.findSeedById(seedId); // Usar seedId, não hashId
        if (seed) {
          seed.seed = seedString;
          await seed.save();
          this.logger.log(`Seed gerada e armazenada para o seedId ${seedId}`);

          // **4. Gerar e salvar os GeneratedNumbers APÓS salvar a seed completa**
          await this.seedService.generateNumbersForSeed(seedId);
        } else {
          this.logger.error(
            `Seed com seedId ${seedId} não encontrada para atualização.`,
          );
        }
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          `Erro ao armazenar a seed para o seedId ${seedId}: ${err.message}`,
          err.stack,
        );
      }
    }

      // Função auxiliar para gerar uma chave de 32 bytes a partir do hash
      private generateKeyFromHash(hash: string): Buffer {
          // Usar SHA-256 para gerar uma chave de 32 bytes a partir do hash
          return createHash('sha256').update(hash).digest();
      }
      }