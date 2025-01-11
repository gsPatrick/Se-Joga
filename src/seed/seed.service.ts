import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Seed } from '../models/seed.model';
import { createCipheriv } from 'crypto';
import { GeneratedNumber } from '../models/generated-number.model';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Seed) private seedModel: typeof Seed,
    @InjectModel(GeneratedNumber)
    private generatedNumberModel: typeof GeneratedNumber,
  ) {}

  async getNextRandomNumber(seed: string, sequence: number): Promise<number> {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(seed, 'hex');
    const iv = Buffer.alloc(16, 0); // IV de 16 bytes (128 bits) para AES, preenchido com zeros

    // Criptografar o número de sequência usando AES-256-CBC
    const cipher = createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(sequence.toString())),
      cipher.final(),
    ]);

    // Gerar um número a partir do resultado criptografado
    const randomNumber = encrypted.readUInt32LE(0);

    return randomNumber;
  }

  async createSeed(hashId: number, seedString: string): Promise<Seed> {
    try {
      // Cria uma seed vazia associada ao hashId
      const seed = await this.seedModel.create({
        hashId,
        seed: '', // A seed agora é uma string vazia
      });
      this.logger.log(`Seed vazia criada com sucesso para o hashId ${hashId}`);
      return seed;
    } catch (error) {
      this.logger.error(
        `createSeed: Erro ao criar seed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // async findSeedByValue(seedValue: string): Promise<Seed | null> {
  //   return this.seedModel.findOne({ where: { seed: seedValue } });
  // }


  
  async generateNumbersForSeed(seedId: number): Promise<void> {
    const seedRecord = await this.seedModel.findByPk(seedId);
    if (!seedRecord) {
        throw new Error(`Seed com ID ${seedId} não encontrada.`);
    }
    const hash = seedRecord.seed;
    for (let i = 0; i < 5000; i++) {
        try {
            const number = await this.getNextRandomNumber(hash, i);
            await this.createGeneratedNumber(seedId, number, i);
        } catch (error) {
            this.logger.error(`Erro ao gerar ou armazenar número na iteração ${i}: ${error.message}`, error.stack);
            break;
        }
    }
}

async createGeneratedNumber(seedId: number, number: number, sequence: number): Promise<GeneratedNumber> {
  try {
    const generatedNumber = await this.generatedNumberModel.create({
      seedId,
      number,
      sequence,
    });
    this.logger.debug(`Número ${number} gerado e armazenado para a seedId ${seedId} com sequence ${sequence}`);
    return generatedNumber;
  } catch (error) {
    this.logger.error(`Erro ao criar generatedNumber: ${error.message}`, error.stack);
    throw error;
  }
}

// src/seed/seed.service.ts

// ...

async findSeedByValue(seedValue: string): Promise<Seed | null> {
  this.logger.debug(`Buscando seed pelo valor: ${seedValue}`);
  const seed = await this.seedModel.findOne({ where: { seed: seedValue } });
  if (seed) {
      this.logger.debug(`Seed encontrada: ${JSON.stringify(seed)}`);
  } else {
      this.logger.debug(`Seed com valor ${seedValue} não encontrada.`);
  }
  return seed;
}

async findSeedById(hashId: number): Promise<Seed> {
  return this.seedModel.findOne({ where: { hashId } });
}
}

