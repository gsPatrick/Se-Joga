import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { RaffleTicket } from '../raffle/raffle-ticket.model';
import { RouletteBet } from '../roulette/roulette-bet.model';
import { SlotMachineBet } from '../slot-machine/slot-machine-bet.model';
import { BingoCard } from '../bingo/bingo-card.model';
import { DiceBet } from '../dice/dice-bet.model';
import { UserChallenge } from '../challenges/user-challenge.model';
import { Raffle } from '../raffle/raffle.model';
import { RouletteRound } from '../roulette/roulette-round.model';
import { SlotMachineRound } from '../slot-machine/slot-machine-round.model';
import { BingoGame } from '../bingo/bingo-game.model';
import { DiceRound } from '../dice/dice-round.model'; 
import { Challenge } from '../challenges/challenge.model';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

@Table
export class User extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  email!: string;

  @Column({
    type: DataType.STRING(14),
    allowNull: false,
    unique: true,
  })
  cpf!: string;

  @Column({
    type: DataType.STRING(15),
    allowNull: false,
  })
  phone!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  password!: string; // Lembre-se de criptografar a senha!

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
  })
  balance!: number;

  @Column({
    type: DataType.ENUM,
    values: Object.values(UserRole),
    allowNull: false,
    defaultValue: UserRole.USER,
  })
  role!: UserRole;

  // Relacionamentos para usuários comuns:
  @HasMany(() => RaffleTicket)
  raffleTickets!: RaffleTicket[];

  @HasMany(() => RouletteBet)
  rouletteBets!: RouletteBet[];

  @HasMany(() => SlotMachineBet)
  slotMachineBets!: SlotMachineBet[];

  @HasMany(() => BingoCard)
  bingoCards!: BingoCard[];

  @HasMany(() => DiceBet)
  diceBets!: DiceBet[];

  @HasMany(() => UserChallenge)
  userChallenges!: UserChallenge[];

  // Relacionamentos para administradores (usando o mesmo modelo User):
  @HasMany(() => Raffle, { foreignKey: 'createdBy' })
  createdRaffles!: Raffle[];

  @HasMany(() => RouletteRound, { foreignKey: 'createdBy' })
  createdRouletteRounds!: RouletteRound[];

  @HasMany(() => SlotMachineRound, { foreignKey: 'createdBy' })
  createdSlotMachineRounds!: SlotMachineRound[];

  @HasMany(() => BingoGame, { foreignKey: 'createdBy' })
  createdBingoGames!: BingoGame[];

  @HasMany(() => DiceRound, { foreignKey: 'createdBy' })
  createdDiceRounds!: DiceRound[];

  @HasMany(() => Challenge, { foreignKey: 'createdBy' })
  createdChallenges!: Challenge[];
}