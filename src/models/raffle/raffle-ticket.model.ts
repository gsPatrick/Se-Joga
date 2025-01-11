import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../user/user.model';
import { Raffle } from './raffle.model';

@Table({ tableName: 'raffle_tickets' })
export class RaffleTicket extends Model { // A classe está sendo exportada aqui
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @ForeignKey(() => Raffle)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  raffleId: number;

  @BelongsTo(() => Raffle)
  raffle: Raffle;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  ticketNumber: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  updatedAt: Date;
}