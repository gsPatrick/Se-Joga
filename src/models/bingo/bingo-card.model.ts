import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { BingoGame } from './bingo-game.model';
import { BingoNumber } from './bingo-number.model';

@Table
export class BingoCard extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @BelongsTo(() => User)
  user!: User;

  @ForeignKey(() => BingoGame)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoGameId!: number;

  @BelongsTo(() => BingoGame)
  bingoGame!: BingoGame;

  @HasMany(() => BingoNumber)
  numbers!: BingoNumber[];
}