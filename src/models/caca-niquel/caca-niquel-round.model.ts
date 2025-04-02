// src/models/caca-niquel/caca-niquel-round.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
    HasMany,
    HasOne
} from 'sequelize-typescript';
import { User } from '../user/user.model';
import { CacaNiquelBet } from './caca-niquel-bet.model';
import { CacaNiquelRoundSeed } from './caca-niquel-round-seed.model'; // Importe o novo modelo

@Table({ tableName: 'caca_niquel_rounds' })
export class CacaNiquelRound extends Model {
    @Column({
        type: DataType.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    })
    id!: number;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
    })
    createdBy!: number | null;

    @BelongsTo(() => User, { foreignKey: 'createdBy', as: 'createdByUser' })
    createdByUser?: User;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    hash!: string;

    @Column({
        type: DataType.BOOLEAN,
        defaultValue: false,
    })
    finished!: boolean;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
    })
    winningCombination?: any;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    createdAt!: Date;

    @HasMany(() => CacaNiquelBet, { foreignKey: 'roundId', as: 'bets' })
    bets?: CacaNiquelBet[];

    @HasOne(() => CacaNiquelRoundSeed, { foreignKey: 'roundId', as: 'cacaNiquelRoundSeed' , onDelete: 'CASCADE' }) // Use CacaNiquelRoundSeed
    cacaNiquelRoundSeed?: CacaNiquelRoundSeed;
}