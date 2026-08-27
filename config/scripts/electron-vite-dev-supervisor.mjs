import { spawn } from 'node:child_process'
import { inspectLinuxDevGpuOutput } from './linux-dev-gpu-retry.mjs'

export function runElectronViteDevSupervisor({ nodePath, electronViteCli, args, env }) {
  let isShuttingDown = false
  let forcedKillTimer = null
  let child = null
  let gpuLaunchFailures = 0
  let gpuFallbackRetryStarted = false
  let gpuFallbackRetryRequested = false

  function signalExitCode(signal) {
    if (signal === 'SIGINT') {
      return 130
    }
    if (signal === 'SIGTERM') {
      return 143
    }
    return 1
  }

  function terminateChild(signal) {
    if (!child?.pid) {
      return
    }
    if (process.platform === 'win32') {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true
      })
      taskkill.unref()
      return
    }
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      if (code !== 'ESRCH') {
        throw error
      }
    }
  }

  function handleChildError(error) {
    if (forcedKillTimer) {
      clearTimeout(forcedKillTimer)
    }
    console.error(error)
    process.exit(1)
  }

  function spawnDevChild() {
    const nextChild = spawn(nodePath, [electronViteCli, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env,
      detached: process.platform !== 'win32'
    })
    child = nextChild
    nextChild.stdout.pipe(process.stdout)
    nextChild.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      if (process.platform !== 'linux' || gpuFallbackRetryStarted) {
        return
      }
      const inspection = inspectLinuxDevGpuOutput(chunk.toString(), gpuLaunchFailures)
      gpuLaunchFailures = inspection.failures
      if (!gpuFallbackRetryRequested && inspection.retry) {
        gpuFallbackRetryRequested = true
        console.error(
          '[gpu-fallback] GPU startup is failing; restarting this dev run once with software rendering.'
        )
        terminateChild('SIGTERM')
      }
    })
    nextChild.on('error', handleChildError)
    nextChild.on('exit', (code, signal) => {
      if (forcedKillTimer) {
        clearTimeout(forcedKillTimer)
        forcedKillTimer = null
      }
      if (isShuttingDown) {
        process.exit(signalExitCode(signal ?? 'SIGINT'))
        return
      }
      if (gpuFallbackRetryRequested && !gpuFallbackRetryStarted) {
        gpuFallbackRetryStarted = true
        gpuFallbackRetryRequested = false
        env.ORCA_DEV_GPU_FALLBACK = '1'
        setTimeout(spawnDevChild, 250)
        return
      }
      process.exit(signal ? signalExitCode(signal) : (code ?? 1))
    })
  }

  function beginShutdown(signal) {
    if (isShuttingDown) {
      return
    }
    isShuttingDown = true
    terminateChild(signal)
    forcedKillTimer = setTimeout(() => terminateChild('SIGKILL'), 5000)
  }

  process.on('SIGINT', () => beginShutdown('SIGINT'))
  process.on('SIGTERM', () => beginShutdown('SIGTERM'))
  spawnDevChild()
}
