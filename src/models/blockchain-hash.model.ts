import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { Seed } from './seed.model';

@Table({ tableName: 'blockchain_hashes' })
export class BlockchainHash extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  hash: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  timestamp: Date;

  @HasMany(() => Seed)
  seeds: Seed[];
}