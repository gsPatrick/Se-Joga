// src/models/payment/withdrawal.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { User } from '../user/user.model'; // Assumindo que o modelo User está em '../user/user.model'
  
  // Enum para os status de saque
  export enum WithdrawalStatus {
    PENDING = 'PENDING',     // Solicitado pelo usuário (aguardando débito/envio para Efí)
    PROCESSING = 'PROCESSING', // Saldo debitado, solicitação enviada para Efí (aguardando webhook)
    COMPLETED = 'COMPLETED',   // Saque processado com sucesso pela Efí (confirmado via webhook)
    FAILED = 'FAILED',       // Saque falhou na Efí (confirmado via webhook, saldo estornado)
    CANCELLED = 'CANCELLED', // Saque cancelado antes de ir para processamento
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
      type: DataType.DECIMAL(10, 2), // Use DECIMAL para valores monetários
      allowNull: false,
    })
    amount!: number;
  
    @Column({
      type: DataType.ENUM(...Object.values(WithdrawalStatus)),
      allowNull: false,
      defaultValue: WithdrawalStatus.PENDING, // Começa como PENDING antes de tentar processar
    })
    status!: WithdrawalStatus;
  
    @Column({
      type: DataType.STRING,
      allowNull: false, // Tipo de chave Pix é obrigatório
    })
    targetPixKeyType!: string; // Tipo da chave Pix de destino (cpf, email, phone, evp, cnpj)
  
    @Column({
      type: DataType.STRING,
      allowNull: false, // Valor da chave Pix é obrigatório
    })
    targetPixKey!: string; // Valor da chave Pix de destino
  
      // Opcional: Dados do beneficiário para registro, se a chave não for EVP ou se a API exigir
    @Column({ type: DataType.STRING, allowNull: true }) targetName?: string;
    @Column({ type: DataType.STRING, allowNull: true }) targetCpfCnpj?: string;
    // ... outros campos bancários se necessário e exigido pela API de saque não-chave
  
    @Column({
      type: DataType.UUID, // Usar UUID para garantir unicidade em idEnvio
      allowNull: true, // Será preenchido ao enviar para Efí
      unique: true, // O idEnvio que geramos deve ser único
    })
    efiIdEnvio?: string; // Nosso identificador para o envio na Efí
  
    @Column({
      type: DataType.STRING,
      allowNull: true, // Será preenchido após o processamento pela Efí (via webhook)
      unique: true, // O E2EId é único
    })
    efiE2eId?: string; // EndToEnd ID do Pix (após a transferência)
  
    @Column({
        type: DataType.JSONB, // Armazena o payload completo recebido no webhook
        allowNull: true,
    })
    efiWebhookPayload?: any; // Payload do webhook para debug/auditoria
  
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