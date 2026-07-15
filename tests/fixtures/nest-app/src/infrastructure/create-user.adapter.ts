import { Injectable } from "@nestjs/common";
import { CreateUserPort } from "../application/create-user.port";

@Injectable()
export class CreateUserAdapter extends CreateUserPort {
  async save(_email: string) {}
}
