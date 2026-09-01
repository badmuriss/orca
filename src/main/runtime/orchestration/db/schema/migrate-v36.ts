import type { OrchestrationDb } from '../orchestration-db'
import { createMaestroBrowserSurfaceTablesSql } from './create-maestro-browser-surface-tables-sql'

export function applySchemaMigrationV36(this: OrchestrationDb, current: number): void {
  if (current >= 36) {
    return
  }
  this.db.exec(createMaestroBrowserSurfaceTablesSql())
}
