import { Injectable } from "@nestjs/common";
import { CreateUserDto } from "./create-user.dto";
import { PrismaService } from "./prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    await fetch("https://api.example.com/audit");
    const key = process.env.EXAMPLE_API_KEY;
    return this.prisma.user.create({ data: dto, key });
  }

  findAll() {
    return this.prisma.user.findMany();
  }
}
