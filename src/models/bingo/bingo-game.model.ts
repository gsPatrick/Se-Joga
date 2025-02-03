// src/models/bingo/bingo-game.model.ts
import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
  CreatedAt,
  UpdatedAt,
      HasOne
  } from 'sequelize-typescript';
  import { User } from '../user/user.model';
  import { BingoCard } from './bingo-card.model';
  import { BingoGameRound } from './bingo-game-round.model';
  import { BingoGameSeed } from './bingo_game_seeds';

  @Table
  export class BingoGame extends Model {
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
    createdBy!: number;

      @BelongsTo(() => User, { foreignKey: 'createdBy'})
      createdByUser!: User;

    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt!: Date;

    @Column({
      type: DataType.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })
    finished!: boolean;

    @HasMany(() => BingoCard)
    bingoCards!: BingoCard[];

      @HasMany(()=> BingoGameRound)
      bingoGameRounds!: BingoGameRound[];
     @UpdatedAt
    updatedAt!: Date;

     @HasOne(()=> BingoGameSeed)
       bingoGameSeed!: BingoGameSeed;
      ticketPrice: any;
      totalTickets: any;
      type: string | undefined;
  }