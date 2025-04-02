// src/models/caca-niquel/caca-niquel-round-seed.model.ts
import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
} from 'sequelize-typescript';
import { CacaNiquelRound } from './caca-niquel-round.model';
import { Seed } from '../seed.model'; // Ajuste o caminho se necessário

@Table({ tableName: 'caca_niquel_round_seeds' })
export class CacaNiquelRoundSeed extends Model {
    @Column({
        type: DataType.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    })
    id!: number;

    @ForeignKey(() => CacaNiquelRound)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        unique: 'roundSeedUniqueConstraint', // Adicionando unique constraint
    })
    roundId!: number;

    @BelongsTo(() => CacaNiquelRound, { foreignKey: 'roundId', onDelete: 'CASCADE' })
    cacaNiquelRound?: CacaNiquelRound;

    @ForeignKey(() => Seed)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        unique: 'roundSeedUniqueConstraint', // Adicionando unique constraint
    })
    seedId!: number;

    @BelongsTo(() => Seed)
    seed?: Seed;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    createdAt!: Date;
}