import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany, HasOne } from 'sequelize-typescript'; // Adicionado HasOne
import { User } from '../user/user.model';
import { DiceBet } from './dice-bet.model';
import { DiceRoundSeed } from './dice_round_seeds'; // Garanta que a importação está correta

@Table
export class DiceRound extends Model {
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
  createdBy!: number;

  @BelongsTo(() => User, 'createdBy')
  createdByUser!: User;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  hash!: string; // Considerar se realmente precisa disso aqui ou busca via Seed/Hash

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  finished!: boolean;

  @HasMany(() => DiceBet)
  bets!: DiceBet[];

  // --- CORREÇÃO AQUI ---
  // Adiciona a associação HasOne para DiceRoundSeed
  @HasOne(() => DiceRoundSeed, 'roundId') // 'roundId' é a foreign key em DiceRoundSeed
  diceRoundSeed!: DiceRoundSeed; // Define o tipo correto (não 'any')
  // ---------------------
}