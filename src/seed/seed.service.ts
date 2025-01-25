import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Seed } from '../models/seed.model';
import { createCipheriv, createHash } from 'crypto';
import { GeneratedNumber } from '../models/generated-number.model';
import { BlockchainHash } from 'src/models/blockchain-hash.model';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Seed) private seedModel: typeof Seed,
    @InjectModel(GeneratedNumber)
    private generatedNumberModel: typeof GeneratedNumber,
  ) {}

      // Função auxiliar para gerar uma chave de 32 bytes a partir do hash
    private generateKeyFromHash(hash: string): Buffer {
        // Usar SHA-256 para gerar uma chave de 32 bytes a partir do hash
        return createHash('sha256').update(hash).digest();
    }

  async getNextRandomNumber(seed: string, sequence: number): Promise<number> {
    const algorithm = 'aes-256-cbc';
    const key = this.generateKeyFromHash(seed);
    const iv = Buffer.alloc(16, 0);

    const cipher = createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(sequence.toString())),
      cipher.final(),
    ]);

    const randomNumber = encrypted.readUInt32LE(0);

    return randomNumber;
  }

  async createSeed(hashId: number, seedString: string): Promise<Seed> {
    try {
      // Cria uma seed associada ao hashId
      const seed = await this.seedModel.create({
        hashId,
        seed: seedString, // Pode ser uma string vazia inicialmente
      });
      this.logger.log(`Seed criada com sucesso para o hashId ${hashId}`);
      return seed;
    } catch (error) {
      this.logger.error(
        `createSeed: Erro ao criar seed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
  
  async generateNumbersForSeed(seedId: number): Promise<void> {
    const seedRecord = await this.seedModel.findByPk(seedId);
    if (!seedRecord) {
      throw new Error(`Seed com ID ${seedId} não encontrada.`);
    }

    const seedString = seedRecord.seed;

    if (!seedString) {
      this.logger.warn(
        `SeedString vazia para seedId ${seedId}. A geração de números será ignorada.`,
      );
      return;
    }

    const numbers = seedString.split(',').map(Number);
    for (let i = 0; i < numbers.length; i++) {
      try {
        await this.createGeneratedNumber(seedId, numbers[i], i);
      } catch (error) {
        this.logger.error(
          `Erro ao armazenar número na iteração ${i}: ${(error as Error).message}`,
          (error as Error).stack,
        );
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
    this.logger.error(`Erro ao criar generatedNumber: ${(error as Error).message}`, (error as Error).stack);
    throw error;
  }
}

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

async findSeedById(id: number): Promise<Seed> {
    const seed = await this.seedModel.findByPk(id, {
        include: [{ model: BlockchainHash }],
      });
    if (!seed) {
        throw new Error(`Seed with ID ${id} not found.`);
    }
    return seed;
}
}