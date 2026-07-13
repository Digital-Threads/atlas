import { Module } from "@nestjs/common";
import { SettingsModule } from "./feature-b/settings.module";

@Module({ imports: [SettingsModule] })
export class WorkerModule {}
