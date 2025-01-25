import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { SlotMachineRound } from './slot-machine-round.model';
  import { Seed } from '../seed.model';
  
  @Table({ tableName: 'slot_machine_round_seeds' })
  export class SlotMachineRoundSeed extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;
  
    @ForeignKey(() => SlotMachineRound)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    roundId!: number;
  
    @BelongsTo(() => SlotMachineRound)
    round!: SlotMachineRound;
  
    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId!: number;
  
    @BelongsTo(() => Seed)
    seed!: Seed;
  }