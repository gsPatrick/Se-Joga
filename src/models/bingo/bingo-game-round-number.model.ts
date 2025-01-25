import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BingoGameRound } from './bingo-game-round.model';
import { BingoNumber } from './bingo-number.model';

@Table
export class BingoGameRoundNumber extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => BingoGameRound)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoGameRoundId!: number;

  @BelongsTo(() => BingoGameRound)
  bingoGameRound!: BingoGameRound;

  @ForeignKey(() => BingoNumber)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoNumberId!: number;

  @BelongsTo(() => BingoNumber)
  bingoNumber!: BingoNumber;
}