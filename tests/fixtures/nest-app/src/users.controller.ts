import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { CreateUserDto } from "./create-user.dto";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }
}
