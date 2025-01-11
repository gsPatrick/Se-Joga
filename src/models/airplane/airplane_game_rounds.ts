// src/models/airplane-game-round.model.ts
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
  import { AirplaneGameRoundSeed } from './airplane_game_round_seeds';
  
  @Table({ tableName: 'airplane_game_rounds' })
  export class AirplaneGameRound extends Model {
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
  
    @Column({
      type: DataType.DECIMAL(10, 2),
      allowNull: false,
    })
    betAmount: number;
  
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    chosenNumber: number;
  
    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt: Date;
  
    @Column({
      type: DataType.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })
    finished: boolean;
  
    @Column({
      type: DataType.INTEGER,
      defaultValue: 1,
    })
    startLevel: number;
  
    @Column({
      type: DataType.INTEGER,
      allowNull: true,
    })
    maxLevel: number;
  
    @ForeignKey(() => User)
    @Column({
      type: DataType.INTEGER,
      allowNull: true,
    })
    winnerUserId: number;
  
    @HasMany(() => AirplaneGameRoundSeed)
    airplaneGameRoundSeeds: AirplaneGameRoundSeed[];
  }