import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { GeneratedNumber } from './generated-number.model';
  
  @Table({ tableName: 'generated_dozens' })
  export class GeneratedDozen extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id: number;
  
    @ForeignKey(() => GeneratedNumber)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    generatedNumberId: number;
  
    @BelongsTo(() => GeneratedNumber)
    generatedNumber: GeneratedNumber;
  
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    dozen: number;
  
    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt: Date;
  }