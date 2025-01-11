import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { UserChallenge } from './user-challenge.model';

@Table
export class UserChallengeHighestDozenResult extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id: number;

  @ForeignKey(() => UserChallenge)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userChallengeId: number;

  @BelongsTo(() => UserChallenge)
  userChallenge: UserChallenge;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  dozens: string; // Ex: "12,45,78,90,34"

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  highestDozen: number;
}