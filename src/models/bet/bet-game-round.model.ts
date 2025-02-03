// src/models/bet/bet-game-round.model.ts
import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { User } from '../user/user.model';
 import { Bet } from './bet.model';

@Table({tableName: 'bet_game_rounds'})
export class BetGameRound extends Model {
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
  hash!: string;

    @CreatedAt
   createdAt!: Date;

   @UpdatedAt
    updatedAt!: Date;

    @Column({
        type: DataType.BOOLEAN,
         allowNull: false,
         defaultValue: false,
    })
    finished!: boolean;

    @HasMany(() => Bet)
    bets!: Bet[];
    betGameRoundSeed: any;
}