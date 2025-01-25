import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../user/user.model';
import { DiceRound } from './dice-round.model';

@Table({ tableName: 'dice_bets' }) // Adicionando tableName para garantir
export class DiceBet extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @BelongsTo(() => User)
  user!: User;

  @ForeignKey(() => DiceRound)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  roundId!: number;

  @BelongsTo(() => DiceRound)
  round!: DiceRound;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  betNumber!: number; // O número em que o usuário apostou (1-6)

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  betAmount!: number;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
  })
  win!: boolean; // Resultado da aposta (true se ganhou, false se perdeu)

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  generatedNumber!: number; // Número gerado pelo sistema

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;
}