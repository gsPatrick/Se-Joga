import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { User } from './user/user.model';
  
  export enum GameType {
    RAFFLE = 'raffle',
    ROULETTE = 'roulette',
    SLOT_MACHINE = 'slot_machine',
    AIRPLANE_GAME = 'airplane_game',
    DICE_GAME = 'dice_game',
    BINGO = 'bingo',
    CHALLENGE = 'challenge',
  }
  
  @Table({ tableName: 'game_winners' })
  export class GameWinner extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;
  
    @Column({
      type: DataType.ENUM,
      values: Object.values(GameType),
      allowNull: false,
    })
    game!: GameType;
  
    @Column({
      type: DataType.INTEGER, // Ajuste conforme a necessidade para cada jogo
      allowNull: false,
    })
    roundId!: number;
  
    @ForeignKey(() => User)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    userId!: number;
  
    @BelongsTo(() => User)
    user!: User;
  
    @Column({
      type: DataType.JSON,
      allowNull: true,
    })
    winData: any;
  
    @Column({
      type: DataType.DATE,
      allowNull: false,
      defaultValue: DataType.NOW,
    })
    createdAt!: Date;
  }