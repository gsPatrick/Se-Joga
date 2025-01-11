// import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
// import { InjectModel } from '@nestjs/sequelize';
// import { Cron } from '@nestjs/schedule';
// import { Raffle } from '../models/raffle/raffle.model';
// import { RaffleTicket } from '../models/raffle/raffle-ticket.model';
// import { SeedService } from '../seed/seed.service';
// import { HashService } from '../hash/hash.service';
// import { RaffleNumber } from '../models/raffle/raffle-number.model';
// import { v4 as uuidv4 } from 'uuid';
// import { GeneratedNumber } from '../models/generated-number.model';
// import { CreateRaffleDto } from './dto/create-raffle.dto';
// import { Seed } from 'src/models/seed.model';
// import { BlockchainHash } from 'src/models/blockchain-hash.model';

// @Injectable()
// export class RaffleService {
//   private readonly logger = new Logger(RaffleService.name);

//   constructor(
//     @InjectModel(Raffle) private raffleModel: typeof Raffle,
//     @InjectModel(RaffleTicket)
//     private raffleTicketModel: typeof RaffleTicket,
//     @InjectModel(RaffleNumber)
//     private raffleNumberModel: typeof RaffleNumber,
//     @InjectModel(GeneratedNumber)
//     private generatedNumberModel: typeof GeneratedNumber,
//     private readonly seedService: SeedService,
//     private readonly hashService: HashService,
//   ) {}

//   // Agendado para rodar a cada 2 horas, das 8h às 20h, todos os dias
//   @Cron('0 0 8-20/2 * * *') 
//   async createScheduledRaffles() {
//     this.logger.log('Criando rifas agendadas...');

//     try {
//       const newRaffle = await this.raffleModel.create({
//         raffleIdentifier: uuidv4(), // Gera um ID único para a rifa
//         createdBy: 1, // Substitua pelo ID do usuário administrador (ou busque do banco)
//         title: 'Rifa Automática',
//         description: 'Rifa criada automaticamente pelo sistema.',
//         ticketPrice: 10.00, // Preço do bilhete
//         totalTickets: 100, // Total de bilhetes
//         soldTickets: 0,
//         startDate: new Date(),
//         endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias a partir de agora
//         drawDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Sorteio em 7 dias
//         finished: false,
//         winningTicket: null,
//         winnerUserId: null,
//       });

//       this.logger.log(`Rifa criada com sucesso: ${newRaffle.id}`);

//       // Obter o hash mais recente
//       const latestHash = await this.hashService.getLatestHash();

//       // Encontrar a seed correspondente ao hash mais recente no banco de dados
//       const seedRecord = await this.seedService.findSeedByValue(latestHash);
//       if (!seedRecord) {
//         throw new Error(
//           'Seed correspondente ao hash mais recente não encontrada.',
//         );
//       }

//       // Associar a seed à rifa
//       await this.raffleNumberModel.create({
//         raffleId: newRaffle.id,
//         seedId: seedRecord.id,
//       });

//       this.logger.log(`Seed associada à rifa ${newRaffle.id}`);

//       // Adicione aqui a lógica para lidar com a compra de bilhetes ou outras ações necessárias
//     } catch (error) {
//       this.logger.error(`Erro ao criar rifa: ${error.message}`, error.stack);
//     }
//   }

//   // Para testes manuais, se precisar
//   async createRaffle(createRaffleDto: CreateRaffleDto, userId: number): Promise<Raffle> {
//     const { title, description, ticketPrice, totalTickets, startDate, endDate, drawDate } = createRaffleDto;

//     const newRaffle = await this.raffleModel.create({
//         raffleIdentifier: uuidv4(),
//         createdBy: userId,
//         title,
//         description,
//         ticketPrice,
//         totalTickets,
//         soldTickets: 0,
//         startDate,
//         endDate,
//         drawDate,
//         finished: false,
//         winningTicket: null,
//         winnerUserId: null,
//     });

//     this.logger.log(`Rifa criada com sucesso: ${newRaffle.id}`);

//     // Obter o ID do hash mais recente
//     const latestHashId = await this.hashService.getLatestHashId();
//     if (!latestHashId) {
//         throw new Error('Nenhum hash encontrado.');
//     }

//     // Encontrar a seed correspondente ao hash mais recente no banco de dados
//     const seedRecord = await this.seedService.findSeedById(latestHashId);
//     if (!seedRecord) {
//         throw new Error(`Seed correspondente ao hashId ${latestHashId} não encontrada.`);
//     }

//     // Associar a seed à rifa
//     await this.raffleNumberModel.create({
//         raffleId: newRaffle.id,
//         seedId: seedRecord.id,
//     });

//     this.logger.log(`Seed associada à rifa ${newRaffle.id}`);

//     return newRaffle;
// }

//   async addUserToRaffle(raffleId: number, userId: number, ticketNumber: string): Promise<RaffleTicket> {
//     // 1. Verificar se a rifa existe e se está aberta para apostas
//     const raffle = await this.raffleModel.findByPk(raffleId);
//     if (!raffle) {
//       throw new NotFoundException('Rifa não encontrada.');
//     }

//     if (raffle.finished || new Date() < raffle.startDate || new Date() > raffle.endDate) {
//       throw new BadRequestException('A rifa não está aberta para apostas.');
//     }

//     // 2. Verificar se o número do bilhete é válido (00-99)
//     const ticketNum = parseInt(ticketNumber);
//     if (isNaN(ticketNum) || ticketNum < 0 || ticketNum > 99) {
//       throw new BadRequestException('Número de bilhete inválido.');
//     }

//     // 3. Verificar se o bilhete já foi comprado
//     const existingTicket = await this.raffleTicketModel.findOne({
//       where: {
//         raffleId: raffleId,
//         ticketNumber: ticketNumber,
//       },
//     });

//     if (existingTicket) {
//       throw new BadRequestException('Este bilhete já foi comprado.');
//     }

//     // 4. Criar o bilhete e associá-lo ao usuário e à rifa
//     const newTicket = await this.raffleTicketModel.create({
//       raffleId: raffleId,
//       userId: userId,
//       ticketNumber: ticketNumber,
//     });

//     // 5. Atualizar o número de bilhetes vendidos na rifa
//     raffle.soldTickets += 1;
//     await raffle.save();

//     // 6. Aqui você precisaria adicionar a lógica para deduzir o valor do bilhete do saldo do usuário
//     // ...

//     return newTicket;
//   }

//   async drawWinningTicket(raffleId: number): Promise<Raffle> {
//     const raffle = await this.raffleModel.findByPk(raffleId, {
//       include: [RaffleNumber],
//     });

//     if (!raffle) {
//       throw new NotFoundException('Rifa não encontrada.');
//     }

//     if (raffle.finished) {
//       throw new Error('Esta rifa já foi sorteada.');
//     }

//     const latestHash = await this.hashService.getLatestHash();
//     if (!latestHash) {
//       throw new Error('Nenhum hash disponível para sorteio.');
//     }

//     // Extrair a última dezena do hash
//     const winningDezena = parseInt(latestHash.slice(-2), 16) % 100;

//     // Encontrar um bilhete vencedor, se houver
//     const winningTicket = await this.raffleTicketModel.findOne({
//       where: {
//         raffleId: raffleId,
//         ticketNumber: winningDezena.toString().padStart(2, '0'),
//       },
//     });

//     if (winningTicket) {
//       raffle.winningTicket = winningTicket.ticketNumber;
//       raffle.winnerUserId = winningTicket.userId;
//     }

//     raffle.finished = true;
//     await raffle.save();

//     return raffle;
//   }

//   async findRaffleById(raffleId: number): Promise<Raffle | null> {
//     return this.raffleModel.findByPk(raffleId, {
//       include: [
//         {
//           model: RaffleTicket,
//           as: 'tickets',
//         },
//         {
//           model: RaffleNumber,
//           as: 'raffleNumbers',
//           include: [
//             {
//               model: GeneratedNumber,
//               as: 'generatedNumbers',
//               include: [
//                 {
//                   model: Seed,
//                   as: 'seed',
//                   include: [BlockchainHash],
//                 },
//               ],
//             },
//           ],
//         },
//       ],
//     });
//   }

//   async findAllRaffles(): Promise<Raffle[]> {
//     return this.raffleModel.findAll({
//       include: [
//         {
//           model: RaffleTicket,
//           as: 'tickets',
//         },
//         {
//           model: RaffleNumber,
//           as: 'raffleNumbers',
//           include: [
//             {
//               model: GeneratedNumber,
//               as: 'generatedNumbers',
//               include: [
//                 {
//                   model: Seed,
//                   as: 'seed',
//                   include: [BlockchainHash],
//                 },
//               ],
//             },
//           ],
//         },
//       ],
//     });
//   }
// }