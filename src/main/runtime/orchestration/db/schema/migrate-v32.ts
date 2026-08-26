import type { OrchestrationDb } from '../orchestration-db'
import { createMaestroTerminalLeaseTablesSql } from './create-maestro-terminal-lease-tables-sql'

export function applySchemaMigrationV32(this: OrchestrationDb, current: number): void {
  if (current < 32) {
    this.db.exec(createMaestroTerminalLeaseTablesSql())
  }
}
