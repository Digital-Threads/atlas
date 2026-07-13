import { All, Body, Controller, Delete, Get, Head, Options, Patch, Post, Put, UseGuards, UseInterceptors, UsePipes } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { AuditInterceptor } from "./audit.interceptor";
import { CreateUserDto } from "./create-user.dto";
import { CurrentUser } from "./current-user.decorator";
import { RequestValidationPipe } from "./request-validation.pipe";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UsePipes(RequestValidationPipe)
  @UseInterceptors(AuditInterceptor)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  findAll(@CurrentUser() _user: unknown) {
    return this.usersService.findAll();
  }

  @Put(":id") update() { return this.usersService.findAll(); }
  @Patch(":id") patch() { return this.usersService.findAll(); }
  @Delete(":id") remove() { return this.usersService.findAll(); }
  @All("search") search() { return this.usersService.findAll(); }
  @Head() head() { return this.usersService.findAll(); }
  @Options() options() { return this.usersService.findAll(); }
}
