import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { SlotMachineRound } from './slot-machine-round.model';

@Table
export class SlotMachineBet extends Model {
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

  @ForeignKey(() => SlotMachineRound)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  roundId!: number;

  @BelongsTo(() => SlotMachineRound)
  round!: SlotMachineRound;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  betSymbol!: string; // Você pode usar um ENUM aqui se tiver símbolos predefinidos

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  betAmount!: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;
}