export abstract class CreateUserPort {
  abstract save(email: string): Promise<void>;
}
