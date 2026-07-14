import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { SequelizeAccount } from "./sequelize-models";

@Injectable()
export class SequelizeAccountsService {
  constructor(
    @InjectModel(SequelizeAccount) private readonly accounts: typeof SequelizeAccount,
  ) {}

  listAccounts() {
    return this.accounts.findAll();
  }

  createAccount() {
    return this.accounts.create({ email: "person@example.test" });
  }
}
