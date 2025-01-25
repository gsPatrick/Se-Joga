import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { UserChallengeFirstTo1000Result } from './user-challenge-first-to-1000-result.model';

@Table
export class UserChallengeFirstTo1000Round extends Model {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  id!: number;

  @ForeignKey(() => UserChallengeFirstTo1000Result)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  resultId!: number;

  @BelongsTo(() => UserChallengeFirstTo1000Result)
  result!: UserChallengeFirstTo1000Result;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  dozens!: string; // Ex: "12,45,78,90,34"

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  roundPoints!: number;
}