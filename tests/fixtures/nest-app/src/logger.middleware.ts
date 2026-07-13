import { Injectable, NestMiddleware } from "@nestjs/common";

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(_request: unknown, _response: unknown, next: () => void) { next(); }
}
