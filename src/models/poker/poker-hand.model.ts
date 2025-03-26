// src/models/poker/poker-hand.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { PokerPlayer } from './poker-player.model';

  @Table({ tableName: 'poker_hands' })
  export class PokerHand extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;

    @ForeignKey(() => PokerPlayer)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    playerId!: number;

    @BelongsTo(() => PokerPlayer, { foreignKey: 'playerId', as: 'pokerPlayer' })
    pokerPlayer!: PokerPlayer;

    @Column({
      type: DataType.STRING, // Or DataType.JSONB if you want to store card details as objects
      allowNull: true, // Initially cards might not be dealt
    })
    card1!: string | null;

    @Column({
      type: DataType.STRING, // Or DataType.JSONB
      allowNull: true,
    })
    card2!: string | null;

    @Column({
      type: DataType.STRING,
      allowNull: true,
    })
    handRanking!: string | null;

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