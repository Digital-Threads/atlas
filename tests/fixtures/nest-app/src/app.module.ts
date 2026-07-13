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

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), SettingsModule, WorkerModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaService, AuditService, { provide: "MAILER", useClass: PrismaService }],
  exports: [UsersService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes("*");
  }
}
