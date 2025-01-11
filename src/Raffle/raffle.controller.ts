// import {
//   Controller,
//   Post,
//   Body,
//   HttpCode,
//   HttpStatus,
//   UseGuards,
//   Req,
//   Get,
//   Param,
//   ForbiddenException,
//   NotFoundException,
// } from '@nestjs/common';
// import { RaffleService } from './raffle.service';
// import { CreateRaffleDto } from './dto/create-raffle.dto'; // Importe o DTO
// import { AuthGuard } from '@nestjs/passport';
// import { User, UserRole } from '../models/user/user.model';
// import { AuthUser } from '../Auth/decorators/auth-user.decorator';

// @Controller('raffles')
// export class RaffleController {
//   constructor(private readonly raffleService: RaffleService) {}

//   // Endpoint para testes - Cria uma rifa (sem autenticação)
//   @Post('create-test-raffle')
//   async createTestRaffle(@Body() createRaffleDto: CreateRaffleDto) {
//     // ID do usuário fixo para testes (usuário administrador, por exemplo)
//     const adminUserId = 1;

//     return this.raffleService.createRaffle(createRaffleDto, adminUserId);
//   }

//   @Post(':id/tickets')
//   @UseGuards(AuthGuard('jwt'))
//   async buyTicket(
//     @Param('id') raffleId: number,
//     @Body('ticketNumber') ticketNumber: string,
//     @AuthUser() user: User,
//   ) {
//     return this.raffleService.addUserToRaffle(raffleId, user.id, ticketNumber);
//   }

//   @Get(':id')
//   @UseGuards(AuthGuard('jwt'))
//   async getRaffle(@Param('id') id: number, @AuthUser() user: User) {
//     if (user.role !== UserRole.ADMIN) {
//       throw new ForbiddenException(
//         'Apenas administradores podem acessar este recurso.',
//       );
//     }
//     const raffle = await this.raffleService.findRaffleById(id);
//     if (!raffle) {
//       throw new NotFoundException('Rifa não encontrada.');
//     }
//     return raffle;
//   }

//   @Get()
//   @UseGuards(AuthGuard('jwt'))
//   async getAllRaffles(@AuthUser() user: User) {
//     if (user.role !== UserRole.ADMIN) {
//       throw new ForbiddenException(
//         'Apenas administradores podem acessar este recurso.',
//       );
//     }
//     return this.raffleService.findAllRaffles();
//   }
// }