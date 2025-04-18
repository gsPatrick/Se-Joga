import {
  Table,
  Column, // Certifique-se que Column está importado
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
    allowNull: true, // Permite null para tipos aleatórios
  })
  betNumber!: number | null; // O número em que o usuário apostou (ou null)

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  betAmount!: number;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false, // Define um padrão
  })
  win!: boolean; // Resultado da aposta (true se ganhou, false se perdeu)

  @Column({
    type: DataType.INTEGER, // Ou talvez STRING se for guardar combinações complexas?
    allowNull: false,
  })
  generatedNumber!: number; // Número(s) gerado(s) pelo sistema

  @Column({ // <--- MODIFICAÇÃO AQUI ---
    type: DataType.STRING, // Ou ENUM se preferir mais segurança
    allowNull: false,      // O tipo da aposta não deve ser nulo
  })                       // -----------------------------
  // Substitui 'soma' por 'soma_dupla' e 'soma_tripla'
  type!: 'par_escolhido' | 'tripla_escolhida' | 'soma_dupla' | 'soma_tripla' | 'aleatorio_dupla' | 'aleatorio_tripla'; // Define os tipos possíveis

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;

  // Não precisa mais da propriedade solta 'type: string | undefined;'
}