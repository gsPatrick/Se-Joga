// src/models/bingo/bingo-card.model.ts
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
import { BingoGame } from './bingo-game.model';
import { BingoNumber } from './bingo-number.model';

@Table
export class BingoCard extends Model {
    cardType(card: BingoCard, number: number, bingoGame: BingoGame, cardType: any) {
        throw new Error('Method not implemented.');
    }
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
    value: number | undefined;
}