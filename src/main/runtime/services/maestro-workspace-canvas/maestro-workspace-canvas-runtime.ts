import type { OrcaRuntimeService } from '../../orca-runtime'

export type MaestroWorkspaceCanvasRuntime = Pick<
  OrcaRuntimeService,
  | 'activateMobileSessionTab'
  | 'closeMobileSessionTab'
  | 'createMobileSessionTerminal'
  | 'browserTabCreate'
  | 'createMaestroWorkspaceAnnotation'
  | 'commandMaestroWorkspaceTab'
  | 'getTerminalProcessIncarnation'
  | 'getOrchestrationDb'
  | 'listMobileSessionTabs'
  | 'readMobileFile'
  | 'readMobileMarkdownTab'
  | 'saveMobileMarkdownTab'
>
