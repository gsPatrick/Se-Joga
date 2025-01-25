import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { BingoGame } from './bingo-game.model';
  import { Seed } from '../seed.model';
  
  @Table({ tableName: 'bingo_game_seeds' })
  export class BingoGameSeed extends Model {
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
    gameId!: number;
  
    @BelongsTo(() => BingoGame)
    bingoGame!: BingoGame;
  
    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId!: number;
  
    @BelongsTo(() => Seed)
    seed!: Seed;
  }