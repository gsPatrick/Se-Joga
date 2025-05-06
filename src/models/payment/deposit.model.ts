// src/models/payment/deposit.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { User } from '../user/user.model'; // Assumindo que o modelo User está em '../user/user.model'
  
  // Enum para os status de depósito
  export enum DepositStatus {
    PENDING = 'PENDING', // Aguardando pagamento (PIX gerado)
    PAID = 'PAID',       // Pago e confirmado (saldo creditado)
    FAILED = 'FAILED',     // Pagamento falhou
    CANCELLED = 'CANCELLED', // Cobrança cancelada
    EXPIRED = 'EXPIRED',   // Cobrança expirada
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
      type: DataType.DECIMAL(10, 2), // Use DECIMAL para valores monetários
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
      allowNull: true, // Pode ser nulo se a cobrança não foi criada na Efí ainda
      unique: true, // O txid da Efí deve ser único
    })
    efiTxid?: string; // ID da transação na Efí (txid)
  
    @Column({
      type: DataType.STRING,
      allowNull: true, // Será preenchido após o pagamento
      unique: true, // O E2EId é único
    })
    efiE2eId?: string; // EndToEnd ID do Pix (após a confirmação do pagamento)
  
    @Column({
      type: DataType.TEXT, // Armazena o QR Code como base64 ou URL
      allowNull: true, // Pode ser nulo inicialmente
    })
    qrCodeImage?: string;
  
    @Column({
      type: DataType.TEXT, // Armazena o Pix Copia e Cola
      allowNull: true, // Pode ser nulo inicialmente
    })
    pixCopiaECola?: string;
  
    // Opcional: Armazenar o payload completo da resposta da Efí ao criar a cobrança
    @Column({
        type: DataType.JSONB, // Ou TEXT, dependendo da preferência
        allowNull: true,
    })
    efiCreateChargePayload?: any;
  
  
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