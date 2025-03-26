// src/models/poker/poker-round-seed.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { PokerRound } from './poker-round.model';
  import { Seed } from '../seed.model';

  @Table({ tableName: 'poker_round_seeds' })
  export class PokerRoundSeed extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;

    @ForeignKey(() => PokerRound)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    roundId!: number;

    @BelongsTo(() => PokerRound, { foreignKey: 'roundId', as: 'pokerRound' })
    pokerRound!: PokerRound;

    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId!: number;

    @BelongsTo(() => Seed, { foreignKey: 'seedId', as: 'seed' })
    seed!: Seed;

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
  }