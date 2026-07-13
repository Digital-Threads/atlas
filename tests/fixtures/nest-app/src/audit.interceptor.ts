import { Injectable, NestInterceptor } from "@nestjs/common";

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(_context: unknown, next: { handle(): unknown }) { return next.handle(); }
}
