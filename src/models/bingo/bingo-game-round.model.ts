import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { BingoGame } from './bingo-game.model';
import { User } from '../user/user.model';
import { BingoNumber } from './bingo-number.model';
import { BingoGameRoundNumber } from './bingo-game-round-number.model';


@Table({ tableName: 'bingo_game_rounds' })
export class BingoGameRound extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => BingoGame)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  bingoGameId!: number;

  @BelongsTo(() => BingoGame)
  bingoGame!: BingoGame;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  createdBy!: number;

  @BelongsTo(() => User, 'createdBy')
  createdByUser!: User;

  @CreatedAt
  createdAt!: Date;

  @HasMany(() => BingoGameRoundNumber, { onDelete: 'CASCADE', foreignKey: 'bingoGameRoundId'})
  drawnNumbers!: BingoGameRoundNumber[];
  
  @UpdatedAt
  updatedAt!: Date;
}