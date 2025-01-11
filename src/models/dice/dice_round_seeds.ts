import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { DiceRound } from './dice-round.model';
  import { Seed } from '../seed.model';
  
  @Table({ tableName: 'dice_round_seeds' })
  export class DiceRoundSeed extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id: number;
  
    @ForeignKey(() => DiceRound)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    roundId: number;
  
    @BelongsTo(() => DiceRound)
    round: DiceRound;
  
    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId: number;
  
    @BelongsTo(() => Seed)
    seed: Seed;
  }