import { Table, Column, Model, DataType, ForeignKey, BelongsTo, BelongsToMany } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { BingoGame } from './bingo-game.model';
import { BingoNumber } from './bingo-number.model';
import { BingoGameRoundNumber } from './bingo-game-round-number.model';

@Table
export class BingoGameRound extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => BingoGame)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoGameId!: number;

  @BelongsTo(() => BingoGame)
  bingoGame!: BingoGame;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  createdBy!: number;

  @BelongsTo(() => User, 'createdBy')
  createdByUser!: User;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;

  @BelongsToMany(() => BingoNumber, () => BingoGameRoundNumber)
  drawnNumbers!: BingoNumber[];
}