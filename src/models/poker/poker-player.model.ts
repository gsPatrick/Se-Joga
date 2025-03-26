// src/models/poker/poker-player.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
    HasMany,
  } from 'sequelize-typescript';
  import { User } from '../user/user.model';
  import { PokerRound } from './poker-round.model';
  import { PokerHand } from './poker-hand.model';
  import { PokerBet } from './poker-bet.model';

  @Table({ tableName: 'poker_players' })
  export class PokerPlayer extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;

    @ForeignKey(() => PokerRound)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    roundId!: number;

    @BelongsTo(() => PokerRound, { foreignKey: 'roundId', as: 'pokerRound' })
    pokerRound!: PokerRound;

    @ForeignKey(() => User)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    userId!: number;

    @BelongsTo(() => User, { foreignKey: 'userId', as: 'user' })
    user!: User;

    @Column({
      type: DataType.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    })
    balanceInGame!: number;

    @Column({
      type: DataType.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })
    folded!: boolean;

    @Column({
      type: DataType.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    })
    isMachine!: boolean;

    @HasMany(() => PokerHand)
    pokerHands!: PokerHand[];

    @HasMany(() => PokerBet)
    pokerBets!: PokerBet[];

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