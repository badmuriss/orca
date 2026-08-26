import type { OrchestrationDb } from '../orchestration-db'
import { createMaestroTablesSql } from './create-maestro-tables-sql'

export function applySchemaMigrationV31(this: OrchestrationDb, current: number): void {
  if (current < 31) {
    this.db.exec(createMaestroTablesSql())
  }
}
