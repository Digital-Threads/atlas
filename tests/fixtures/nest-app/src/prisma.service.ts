import { Injectable } from "@nestjs/common";

@Injectable()
export class PrismaService {
  user = {
    create: async () => ({ id: 1 }),
    findMany: async () => [],
  };
}
