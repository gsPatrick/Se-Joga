import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { Seed } from './seed.model';
  
  @Table({ tableName: 'generated_numbers' })
  export class GeneratedNumber extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;
  
    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId!: number;
  
    @BelongsTo(() => Seed)
    seed!: Seed;
  
    @Column({
      type: DataType.BIGINT, // Use BIGINT para armazenar números grandes
      allowNull: false,
    })
    number!: bigint; // Alterado para bigint
  
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    sequence!: number;
  
    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt!: Date;
  }