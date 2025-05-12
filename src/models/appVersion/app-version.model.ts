// src/models/app-version.model.ts
import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'app_versions' })
export class AppVersion extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true, // Garantir que não haja duas versões com o mesmo número exato
  })
  version!: string; // Ex: "1.0.5"

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  forceUpdate!: boolean;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  filename!: string; // Nome do arquivo APK salvo no servidor

  @Column({
    type: DataType.TEXT,
    allowNull: true, // Mensagem opcional
  })
  message?: string;

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