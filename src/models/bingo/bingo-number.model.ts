import { Table, Column, Model, DataType, ForeignKey, BelongsTo, BelongsToMany } from 'sequelize-typescript';
import { BingoCard } from './bingo-card.model';
import { BingoGameRound } from './bingo-game-round.model';
import { BingoGameRoundNumber } from './bingo-game-round-number.model';

@Table
export class BingoNumber extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id: number;

  @ForeignKey(() => BingoCard)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoCardId: number;

  @BelongsTo(() => BingoCard)
  bingoCard: BingoCard;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  value: number;

  @BelongsToMany(() => BingoGameRound, () => BingoGameRoundNumber)
  bingoGameRounds: BingoGameRound[];
}