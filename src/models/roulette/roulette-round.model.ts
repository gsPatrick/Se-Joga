import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { RouletteBet } from './roulette-bet.model';

@Table
export class RouletteRound extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  createdBy!: number;

  @BelongsTo(() => User, 'createdBy')
  createdByUser!: User;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  hash!: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  winningNumber!: number;

  @Column({
    type: DataType.ENUM('RED', 'BLACK', 'GREEN'),
    allowNull: false,
  })
  winningColor!: string;

  @Column({
    type: DataType.ENUM('banca', 'sala'), // Tipo de roleta
    allowNull: false,
    defaultValue: 'banca', // Pode definir um valor padrão
  })
  type!: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;

  @HasMany(() => RouletteBet)
  bets!: RouletteBet[];
    finished: any;
}