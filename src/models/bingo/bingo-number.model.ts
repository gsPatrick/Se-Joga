// src/models/bingo/bingo-number.model.ts
import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
    HasMany
} from 'sequelize-typescript';
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
  id!: number;

  @ForeignKey(() => BingoCard)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoCardId!: number;

  @BelongsTo(() => BingoCard)
  bingoCard!: BingoCard;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  value!: number;

   @Column({
       type: DataType.DATE,
       allowNull: false,
        defaultValue: DataType.NOW,
   })
     createdAt!: Date;

    @Column({
       type: DataType.DATE,
         allowNull: false,
          defaultValue: DataType.NOW,
        })
    updatedAt!: Date;
    
    @HasMany(() => BingoGameRoundNumber)
    bingoGameRounds!: BingoGameRound[];
}