import { Injectable } from "@nestjs/common";

@Injectable()
export class AuthGuard {
  canActivate() { return true; }
}
