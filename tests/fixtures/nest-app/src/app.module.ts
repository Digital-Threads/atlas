import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { PrismaService } from "./prisma.service";
import { AuditService } from "./audit.service";
import { LoggerMiddleware } from "./logger.middleware";
import { UserEntity } from "./user.entity";
import { SettingsModule } from "./feature-a/settings.module";
import { WorkerModule } from "./worker.module";
import { SequelizeModule } from "@nestjs/sequelize";
import { SequelizeAccount, SequelizeSession } from "./sequelize-models";
import { SequelizeAccountsService } from "./sequelize-accounts.service";
import { DrizzleEventsRepository } from "./drizzle-events.repository";
import { CreateUserUseCase } from "./application/create-user.use-case";
import { CreateUserPort } from "./application/create-user.port";
import { CreateUserAdapter } from "./infrastructure/create-user.adapter";
import { HiddenLinksModule } from "./hidden-links";

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), SequelizeModule.forFeature([SequelizeAccount, SequelizeSession]), SettingsModule, WorkerModule, HiddenLinksModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaService, AuditService, SequelizeAccountsService, DrizzleEventsRepository, CreateUserUseCase, CreateUserPort, CreateUserAdapter, { provide: "MAILER", useClass: PrismaService }],
  exports: [UsersService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes("*");
  }
}
