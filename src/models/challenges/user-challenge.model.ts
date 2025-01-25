import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { Challenge } from './challenge.model';
import { UserChallengeHighestDozenResult } from './user-challenge-highest-dozen-result.model';
import { UserChallengeFirstTo1000Result } from './user-challenge-first-to-1000-result.model';

@Table
export class UserChallenge extends Model {
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

  @ForeignKey(() => Challenge)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  challengeId!: number;

  @BelongsTo(() => Challenge)
  challenge!: Challenge;

  @HasMany(() => UserChallengeHighestDozenResult)
  highestDozenResults!: UserChallengeHighestDozenResult[];

  @HasMany(() => UserChallengeFirstTo1000Result)
  firstTo1000Results!: UserChallengeFirstTo1000Result[];
}