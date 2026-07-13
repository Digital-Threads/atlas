import { Injectable, PipeTransform } from "@nestjs/common";

@Injectable()
export class RequestValidationPipe implements PipeTransform {
  transform(value: unknown) { return value; }
}
