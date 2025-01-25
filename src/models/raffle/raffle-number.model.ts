import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { Raffle } from './raffle.model';
  import { GeneratedNumber } from '../generated-number.model';
  
  @Table({ tableName: 'raffle_numbers' })
  export class RaffleNumber extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;
  
    @ForeignKey(() => Raffle)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    raffleId!: number;
  
    @BelongsTo(() => Raffle)
    raffle!: Raffle;
  
    @ForeignKey(() => GeneratedNumber)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    numberId!: number;
  
    @BelongsTo(() => GeneratedNumber)
    generatedNumber!: GeneratedNumber;
  
    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt!: Date;
  }