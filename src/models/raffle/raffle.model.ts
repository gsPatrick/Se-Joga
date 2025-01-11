import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import { User } from '../user/user.model';
import { RaffleTicket } from './raffle-ticket.model';
import { RaffleNumber } from './raffle-number.model';

@Table({ tableName: 'raffles' })
export class Raffle extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  raffleIdentifier: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  createdBy: number;

  @BelongsTo(() => User)
  createdByUser: User;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  description: string;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  ticketPrice: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  totalTickets: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  soldTickets: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  startDate: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  endDate: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  drawDate: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  finished: boolean;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  winningTicket: string;

  // Adicione a propriedade winnerUserId aqui:
  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true, // Pode ser nulo se não houver vencedor
  })
  winnerUserId: number;

  @BelongsTo(() => User)
  winnerUser: User;

  @HasMany(() => RaffleTicket)
  tickets: RaffleTicket[];

  @HasMany(() => RaffleNumber)
  raffleNumbers: RaffleNumber[];
}