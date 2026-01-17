export interface ProcessRunnerPort {
  run(command: string, args: string[]): Promise<void>;
}
