import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { RouletteRound } from './roulette-round.model';

@Table
export class RouletteBet extends Model {
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

  @ForeignKey(() => RouletteRound)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  roundId: number;

  @BelongsTo(() => RouletteRound)
  round: RouletteRound;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  betNumber: number;

  @Column({
    type: DataType.ENUM('RED', 'BLACK', 'GREEN'),
    allowNull: true,
  })
  betColor: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  betColumn: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  betAmount: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt: Date;
}