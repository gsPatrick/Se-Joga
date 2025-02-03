// src/models/bet/bet.model.ts
import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { BetGameRound } from './bet-game-round.model';


@Table({ tableName: 'bets' }) // Adicionando tableName para garantir
export class Bet extends Model {
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
  
    @ForeignKey(() => BetGameRound)
     @Column({
      type: DataType.INTEGER,
       allowNull: false,
    })
    roundId!: number;

  @BelongsTo(() => BetGameRound)
    round!: BetGameRound;

    @Column({
    type: DataType.TEXT,
   allowNull: false,
  })
  market!: string;

  @Column({
    type: DataType.STRING,
   allowNull: true,
 })
  chosenNumber!: string; // Opcional para os caso do usuario querer um número específico.

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
    betAmount!: number;


 @Column({
    type: DataType.DECIMAL(10, 2),
   allowNull: false,
  })
     odd!: number;

@Column({
    type: DataType.BOOLEAN,
    allowNull: false,
   defaultValue: false,
 })
 win!: boolean;

    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt!: Date;

    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
      generatedNumber!: number; // Número gerado pelo sistema
}