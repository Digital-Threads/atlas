import { HttpService } from "@nestjs/axios";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserEntity } from "./user.entity";

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(UserEntity) private readonly usersRepository: Repository<UserEntity>,
    private readonly httpService: HttpService,
  ) {}

  findUsers() {
    return this.usersRepository.find();
  }

  saveUser(user: UserEntity) {
    return this.usersRepository.save(user);
  }

  sendAudit() {
    return this.httpService.post(process.env.AUDIT_API_URL + "/events", {});
  }
}
