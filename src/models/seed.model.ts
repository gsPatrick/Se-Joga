import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
    HasMany
  } from 'sequelize-typescript';
  import { BlockchainHash } from './blockchain-hash.model';
  import { GeneratedNumber } from './generated-number.model';
  
  @Table({ tableName: 'seeds' })
  export class Seed extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;
  
    @ForeignKey(() => BlockchainHash)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    hashId!: number;
  
    @BelongsTo(() => BlockchainHash)
    blockchainHash!: BlockchainHash;
  
    @Column({
      type: DataType.TEXT, // Alterado para TEXT
      allowNull: false,
    })
    seed!: string;
  
    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt!: Date;
  
    @HasMany(() => GeneratedNumber)
    generatedNumbers!: GeneratedNumber[];
  }