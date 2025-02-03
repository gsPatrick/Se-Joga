import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { RouletteRound } from './roulette-round.model';

@Table
export class RouletteBet extends Model {
    odd(odd: any) {
        throw new Error('Method not implemented.');
    }
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

  @ForeignKey(() => RouletteRound)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  roundId!: number;

  @BelongsTo(() => RouletteRound)
  round!: RouletteRound;


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

  @Column({
    type: DataType.ENUM(
      'NUMBER',
      'COLOR',
      'COLUMN',
      'DOZEN',
      'ODD_EVEN',
    ),
    allowNull: false,
  })
  betType!: string;

  @Column({
    type: DataType.STRING, // Pode ser um número (como string) ou uma string (RED, BLACK, 1, 2, 3, ODD, EVEN)
    allowNull: false,
  })
  betChoice!: string; //  Armazena a escolha específica do usuário

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  betNumber!: number; //  Agora não é mais obrigatorio

  @Column({
    type: DataType.ENUM('RED', 'BLACK', 'GREEN'),
    allowNull: true,
  })
  betColor!: string; // Agora não é mais obrigatorio

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  betColumn!: number; // Agora não é mais obrigatorio
    win!: boolean;
}
