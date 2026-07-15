import { Injectable } from "@nestjs/common";
import { CreateUserPort } from "./create-user.port";

@Injectable()
export class CreateUserUseCase {
  constructor(private readonly port: CreateUserPort) {}

  execute(email: string) {
    return this.port.save(email);
  }
}
