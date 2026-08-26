import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import { OrchestrationMutationExecutor } from './orchestration-mutation-executor'
import type { RpcRequest } from './core'

describe('worker-start transfer mutation recovery', () => {
  it('reports a reconciled pending transfer without invoking worker-start again', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-transfer-mutation-'))
    const databasePath = join(directory, 'orchestration.db')
    let db = new OrchestrationDb(databasePath)
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const run = db.createRun({
      objective: 'recover',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab:coord'
    })
    const task = db.createTask({ runId: run.id, spec: 'recover transfer' })
    const generation = db.getRun(run.id)!.consumer_generation
    db.db
      .prepare(
        `INSERT INTO worker_terminal_resources (
        id, origin_dispatch_id, owner_dispatch_id, terminal_handle, pane_key,
        process_incarnation, ownership_state, release_state
      ) VALUES ('resource_1', 'ctx_old', 'ctx_old', 'term_worker', 'tab:worker', 'pty_1', 'owned', 'not_requested')`
      )
      .run()
    const predecessor = db.reserveMaestroTerminalLease({
      requestId: 'worker:old',
      executionHostId: 'local',
      workspaceKey: 'folder:one',
      runId: run.id,
      taskId: task.id,
      attemptId: 'attempt_1',
      coordinatorGeneration: generation,
      role: 'worker',
      workerTerminalResourceId: 'resource_1',
      title: 'worker',
      launchProfile: {
        agent: null,
        model: null,
        effort: null,
        permissionMode: 'default',
        routeRef: null
      },
      spawnedBy: 'coordinator',
      ownerPrincipal: 'dispatch:ctx_old',
      retentionPolicy: 'auto_release'
    })
    db.attachMaestroTerminalLease({
      leaseId: predecessor.id,
      terminalHandle: 'term_worker',
      tabId: 'tab',
      paneKey: 'tab:worker',
      ptyIncarnation: 'pty_1',
      processRootId: 'pid_1'
    })
    db.transitionMaestroTerminalLease({ leaseId: predecessor.id, state: 'ready' })
    db.transitionMaestroTerminalLease({ leaseId: predecessor.id, state: 'active' })
    const params = { task: task.id, from: 'term_coord' }
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          method: 'orchestration.workerStart',
          params: { from: 'term_coord', task: task.id }
        })
      )
      .digest('hex')
    db.db
      .prepare(
        `INSERT INTO mutation_receipts (
        caller_fingerprint, request_id, method, payload_hash, state, receipt
      ) VALUES ('caller_1', 'request_1', 'orchestration.workerStart', ?, 'pending', ?)`
      )
      .run(payloadHash, JSON.stringify({ accepted: { dispatchId: 'ctx_new' } }))
    const receipt = db.transferMaestroWorkerTerminalLease({
      requestId: 'transfer_1',
      mutation: {
        callerFingerprint: 'caller_1',
        requestId: 'request_1',
        method: 'orchestration.workerStart',
        payloadHash
      },
      predecessorLeaseId: predecessor.id,
      successorRequestId: 'worker:new',
      kind: 'strict_retry',
      successorDispatchId: 'ctx_new',
      runId: run.id,
      taskId: task.id,
      attemptId: 'attempt_1',
      terminalHandle: 'term_worker',
      paneKey: 'tab:worker',
      ptyIncarnation: 'pty_1',
      processRootId: 'pid_1',
      executionHostId: 'local',
      workspaceKey: 'folder:one',
      hostScope: null,
      predecessorOwnerPrincipal: 'dispatch:ctx_old',
      successorOwnerPrincipal: 'dispatch:ctx_new',
      coordinatorGeneration: generation,
      retentionPolicy: 'auto_release',
      title: 'worker',
      launchProfile: {
        agent: null,
        model: null,
        effort: null,
        permissionMode: 'default',
        routeRef: null
      },
      spawnedBy: 'coordinator'
    })
    db.close()
    db = new OrchestrationDb(databasePath)
    const restartedRuntime = new OrcaRuntimeService()
    restartedRuntime.setOrchestrationDb(db)
    const invoke = vi.fn(() => ({ repeated: true }))
    const request: RpcRequest = {
      id: 'rpc_1',
      authToken: 'caller-token',
      method: 'orchestration.workerStart',
      params,
      orchestrationRequestId: 'request_1'
    }

    await expect(
      new OrchestrationMutationExecutor(restartedRuntime).run(request, params, invoke, 'caller_1')
    ).resolves.toMatchObject({ state: 'outcome_unknown', leaseTransfer: receipt })
    expect(invoke).not.toHaveBeenCalled()
    expect(
      db.db
        .prepare(
          `SELECT count(*) AS count FROM maestro_terminal_leases
         WHERE role = 'worker' AND lifecycle_state NOT IN ('released', 'superseded', 'archived')
           AND worker_terminal_resource_id = 'resource_1'`
        )
        .get()
    ).toEqual({ count: 1 })
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('re-enters a persisted federated release after an unverifiable result', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-federated-release-mutation-'))
    const databasePath = join(directory, 'orchestration.db')
    const request: RpcRequest = {
      id: 'rpc_federated_release',
      method: 'orchestration.federationRelease',
      params: { dispatchId: 'dispatch_remote' },
      orchestrationRequestId: 'release_request_1'
    } as RpcRequest
    let db = new OrchestrationDb(databasePath)
    let runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const firstInvoke = vi.fn(() => ({ state: 'unverifiable', processAction: 'none' }))

    await expect(
      new OrchestrationMutationExecutor(runtime).run(
        request,
        request.params,
        firstInvoke,
        'remote_home'
      )
    ).resolves.toMatchObject({
      state: 'unverifiable',
      mutation: { requestId: 'release_request_1', replayed: false }
    })
    expect(db.getMutationReceipt('remote_home', 'release_request_1')?.state).toBe('pending')
    db.close()

    db = new OrchestrationDb(databasePath)
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const recoveredInvoke = vi.fn(() => ({
      state: 'released',
      processAction: 'closed_agent_terminal'
    }))
    const executor = new OrchestrationMutationExecutor(runtime)

    await expect(
      executor.run(request, request.params, recoveredInvoke, 'remote_home')
    ).resolves.toMatchObject({
      state: 'released',
      mutation: { requestId: 'release_request_1', replayed: true }
    })
    await expect(
      executor.run(request, request.params, vi.fn(), 'remote_home')
    ).resolves.toMatchObject({ state: 'released' })
    expect(recoveredInvoke).toHaveBeenCalledOnce()
    await expect(
      executor.run(
        { ...request, params: { dispatchId: 'different_dispatch' } },
        { dispatchId: 'different_dispatch' },
        vi.fn(),
        'remote_home'
      )
    ).rejects.toMatchObject({ code: 'request_mismatch' })
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('completes an unverifiable local worker release without re-entering effects', async () => {
    const db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const executor = new OrchestrationMutationExecutor(runtime)
    const request: RpcRequest = {
      id: 'rpc_local_release',
      method: 'orchestration.workerRelease',
      params: { dispatch: 'local_dispatch' },
      orchestrationRequestId: 'local_release_request'
    } as RpcRequest
    const invoke = vi.fn(() => ({ state: 'unverifiable', processAction: 'none' }))

    await expect(
      executor.run(request, request.params, invoke, 'local_caller')
    ).resolves.toMatchObject({ mutation: { replayed: false } })
    await expect(
      executor.run(request, request.params, invoke, 'local_caller')
    ).resolves.toMatchObject({ mutation: { replayed: true } })
    expect(invoke).toHaveBeenCalledOnce()
    expect(db.getMutationReceipt('local_caller', 'local_release_request')?.state).toBe('completed')
    db.close()
  })
})
