import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
    HasMany, // Import HasMany
} from 'sequelize-typescript';
import { User } from '../user/user.model';
import { PokerPlayer } from './poker-player.model';
import { PokerRoundSeed } from './poker-round-seed.model';
import { PokerBet } from './poker-bet.model'; // Import PokerBet

@Table({ tableName: 'poker_rounds' })
export class PokerRound extends Model {
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
    createdByUser!: User;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    hash!: string;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    })
    finished!: boolean;

    @Column({
        type: DataType.JSONB,
        allowNull: true,
    })
    winningHand!: any;

    @HasMany(() => PokerPlayer)
    pokerPlayers!: PokerPlayer[];

    @HasMany(() => PokerRoundSeed)
    pokerRoundSeed!: PokerRoundSeed[];

    @HasMany(() => PokerBet) // Add HasMany relationship for PokerBets
    pokerBets!: PokerBet[];

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    createdAt!: Date;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
    })
    updatedAt!: Date;
}