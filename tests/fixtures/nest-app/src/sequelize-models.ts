import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from "sequelize-typescript";

@Table({ tableName: "sequelize_accounts", timestamps: true })
export class SequelizeAccount extends Model<SequelizeAccount> {
  @Column({ type: DataType.UUID, primaryKey: true, allowNull: false })
  declare id: string;

  @Column({ field: "email_address", type: DataType.STRING, allowNull: false })
  declare email: string;
}

@Table({ tableName: "sequelize_sessions" })
export class SequelizeSession extends Model<SequelizeSession> {
  @Column({ type: DataType.UUID, primaryKey: true })
  declare id: string;

  @ForeignKey(() => SequelizeAccount)
  @Column({ field: "account_id", type: DataType.UUID })
  declare accountId: string;

  @BelongsTo(() => SequelizeAccount)
  declare account: SequelizeAccount;
}
