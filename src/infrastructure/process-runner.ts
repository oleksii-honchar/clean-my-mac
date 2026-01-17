import { spawn } from 'child_process';

import type { ProcessRunnerPort } from '../application/ports/process-runner.port';

export class ProcessRunner implements ProcessRunnerPort {
  public run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'inherit' });

      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
        }
      });
    });
  }
}
