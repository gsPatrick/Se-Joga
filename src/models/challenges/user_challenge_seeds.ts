import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
  } from 'sequelize-typescript';
  import { UserChallenge } from './user-challenge.model';
  import { Seed } from '../seed.model';
  
  @Table({ tableName: 'user_challenge_seeds' })
  export class UserChallengeSeed extends Model {
    @Column({
      type: DataType.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    })
    id!: number;
  
    @ForeignKey(() => UserChallenge)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    userChallengeId!: number;
  
    @BelongsTo(() => UserChallenge)
    userChallenge!: UserChallenge;
  
    @ForeignKey(() => Seed)
    @Column({
      type: DataType.INTEGER,
      allowNull: false,
    })
    seedId!: number;
  
    @BelongsTo(() => Seed)
    seed!: Seed;
  }