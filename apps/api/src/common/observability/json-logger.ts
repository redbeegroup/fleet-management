import { ConsoleLogger, LogLevel } from '@nestjs/common';

/** One JSON object per line, for Loki / ELK. Enabled with LOG_FORMAT=json. */
export class JsonLogger extends ConsoleLogger {
  protected printMessages(messages: unknown[], context = '', logLevel: LogLevel = 'log'): void {
    for (const message of messages) {
      const entry: Record<string, unknown> = {
        time: new Date().toISOString(),
        level: logLevel,
        context: context || undefined,
        pid: process.pid,
      };
      if (message instanceof Error) {
        entry.msg = message.message;
        entry.stack = message.stack;
      } else if (typeof message === 'object' && message !== null) {
        Object.assign(entry, message);
      } else {
        entry.msg = String(message);
      }
      (logLevel === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(entry)}\n`);
    }
  }

  protected printStackTrace(stack: string): void {
    if (stack) process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', stack })}\n`);
  }
}

export function logLevels(level: LogLevel): LogLevel[] {
  const order: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  return order.slice(0, order.indexOf(level) + 1);
}
