// src/models/caca-niquel/caca-niquel-bet.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
} from 'sequelize-typescript';
import { User } from '../user/user.model';
import { CacaNiquelRound } from './caca-niquel-round.model';

@Table({ tableName: 'caca_niquel_bets' })
export class CacaNiquelBet extends Model {
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
    user?: User;

    @ForeignKey(() => CacaNiquelRound)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
    })
    roundId!: number;

    @BelongsTo(() => CacaNiquelRound)
    cacaNiquelRound?: CacaNiquelRound;

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: false,
    })
    betAmount!: number;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    principalSymbol!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    secondarySymbol!: string;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
    })
    generatedSymbols!: string[];

    @Column({
        type: DataType.BOOLEAN,
        defaultValue: false,
    })
    win!: boolean;

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: true,
    })
    payout?: number | null;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    createdAt!: Date;
}