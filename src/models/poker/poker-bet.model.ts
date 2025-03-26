import {
    Table,
    Column,
    Model,
    DataType,
    ForeignKey,
    BelongsTo,
} from 'sequelize-typescript';
import { PokerPlayer } from './poker-player.model';
import { PokerRound } from './poker-round.model';

@Table({ tableName: 'poker_bets' })
export class PokerBet extends Model {
    @Column({
        type: DataType.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    })
    id!: number;

    @ForeignKey(() => PokerPlayer)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
    })
    playerId!: number;

    @BelongsTo(() => PokerPlayer, { foreignKey: 'playerId', as: 'pokerPlayer' })
    pokerPlayer!: PokerPlayer;

    @ForeignKey(() => PokerRound)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
    })
    roundId!: number;

    @BelongsTo(() => PokerRound, { foreignKey: 'roundId', as: 'pokerRound' })
    pokerRound!: PokerRound;

    @Column({
        type: DataType.STRING,
        allowNull: false,
    })
    betType!: string; // e.g., 'CALL_1X', 'CALL_2X', 'CALL_3X', 'FOLD', 'ALL_WIN'

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: false,
    })
    betAmount!: number;

    @Column({
        type: DataType.BOOLEAN,
        defaultValue: false,
    })
    isAllWin!: boolean;

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