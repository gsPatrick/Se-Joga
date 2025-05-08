// src/models/payment/withdrawal.model.ts
import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../user/user.model';

export enum WithdrawalStatus {
  PROCESSING = 'PROCESSING', // Dedução de saldo local feita, solicitação enviada para Efí
  COMPLETED = 'COMPLETED', // Pix enviado com sucesso pela Efí
  FAILED = 'FAILED', // Pix não realizado pela Efí (saldo reembolsado ao usuário local)
}

@Table({ tableName: 'withdrawals' })
export class Withdrawal extends Model {
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

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  amount!: number;

  @Column({
    type: DataType.ENUM(...Object.values(WithdrawalStatus)),
    allowNull: false,
    defaultValue: WithdrawalStatus.PROCESSING,
  })
  status!: WithdrawalStatus;

  @Column({
    type: DataType.STRING,
    allowNull: true, // Pode ser nulo inicialmente
  })
  provider?: string; // Ex: 'EFI_PIX'

  // --- CAMPOS ESPECÍFICOS DO PIX EFI ---
  @Column({
    type: DataType.STRING,
    allowNull: false, // Identificador único usado na requisição PUT /v3/gn/pix/:idEnvio
    unique: true,
  })
  idEnvio!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true, // End-to-End ID retornado pela Efí após o envio ser processado
  })
  e2eId?: string;

  @Column({
    type: DataType.STRING,
    allowNull: false, // Chave Pix de destino informada pelo usuário
  })
  pixKey!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false, // Tipo da chave Pix (cpf, cnpj, email, phone, evp)
  })
  pixKeyType!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true, // Nome do favorecido (pode ser necessário para alguns tipos de chave ou validação)
  })
  favorecidoName?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true, // CPF/CNPJ do favorecido (pode ser necessário para alguns tipos de chave)
  })
  favorecidoCpfCnpj?: string;
  // --- FIM CAMPOS PIX EFI ---

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  updatedAt!: Date;
}