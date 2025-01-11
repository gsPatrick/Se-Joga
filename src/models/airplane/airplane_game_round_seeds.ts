// src/models/airplane-game-round-seed.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { AirplaneGameRound } from './airplane_game_rounds';
  import { Seed } from '../seed.model';
  
  @Table({ tableName: 'airplane_game_round_seeds' })
  export class AirplaneGameRoundSeed extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id: number;
  
    @ForeignKey(() => AirplaneGameRound)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    roundId: number;
  
    @BelongsTo(() => AirplaneGameRound)
    airplaneGameRound: AirplaneGameRound;
  
    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId: number;
  
    @BelongsTo(() => Seed)
    seed: Seed;
  
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    level: number;
  }