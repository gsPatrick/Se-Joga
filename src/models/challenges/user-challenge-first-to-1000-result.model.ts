import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { UserChallenge } from './user-challenge.model';
import { UserChallengeFirstTo1000Round } from './user-challenge-first-to-1000-round.model';

@Table
export class UserChallengeFirstTo1000Result extends Model {
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
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  totalPoints: number;

  @HasMany(() => UserChallengeFirstTo1000Round)
  rounds: UserChallengeFirstTo1000Round[];
}