#!/usr/bin/env node
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\n")
  process.exit(2)
}
process.stdout.write('\u001b]0;Codex MWC worker\u0007OpenAI Codex\nMWC_WORKER_REAL_PTY_READY\n')
process.stdin.on('data', (chunk) => {
  if (chunk.toString().includes('\r')) process.stdout.write('MWC_WORKER_ACK\n')
})
process.stdin.resume()
setInterval(() => {}, 60_000)
