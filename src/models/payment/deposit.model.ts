// src/models/payment/deposit.model.ts
import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../user/user.model';

export enum DepositStatus {
  PENDING = 'PENDING', // Cobrança criada, aguardando pagamento
  COMPLETED = 'COMPLETED', // Pagamento recebido com sucesso
  CANCELLED = 'CANCELLED', // Cobrança removida ou expirada sem pagamento
  FAILED = 'FAILED', // Falha interna no processo (ex: txid não encontrado na Efí após criação)
}

@Table({ tableName: 'deposits' })
export class Deposit extends Model {
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
    type: DataType.ENUM(...Object.values(DepositStatus)),
    allowNull: false,
    defaultValue: DepositStatus.PENDING,
  })
  status!: DepositStatus;

  @Column({
    type: DataType.STRING,
    allowNull: true, // Pode ser nulo inicialmente
  })
  provider?: string; // Ex: 'EFI_PIX', 'STRIPE', etc.

  // --- CAMPOS ESPECÍFICOS DO PIX EFI ---
  @Column({
    type: DataType.STRING,
    allowNull: true, // Preenchido após a criação da cobrança na Efí
    unique: true, // txid deve ser único (se você gerar ele)
  })
  txid?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true, // Preenchido após o pagamento na Efí
  })
  e2eId?: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true, // Pix Copia e Cola retornado pela Efí
  })
  pixCopiaECola?: string;

   @Column({
    type: DataType.TEXT,
    allowNull: true, // Imagem do QR Code em Base64 (ou URL)
  })
  qrCodeImage?: string;

   @Column({
    type: DataType.INTEGER,
    allowNull: true, // ID da location na Efí (para consultar QR Code)
  })
  locationId?: number;
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