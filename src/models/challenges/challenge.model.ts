import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from '../user/user.model';
import { UserChallenge } from './user-challenge.model';

export enum ChallengeType {
  HIGHEST_DOZEN = 'highest_dozen',
  FIRST_TO_1000 = 'first_to_1000',
}

@Table
export class Challenge extends Model {
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
    type: DataType.ENUM,
    values: Object.values(ChallengeType),
    allowNull: false,
  })
  type!: ChallengeType;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  startDate!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  endDate!: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  finished!: boolean;

  @HasMany(() => UserChallenge)
  userChallenges!: UserChallenge[];
}