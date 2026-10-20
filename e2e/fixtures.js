import { test as base, expect } from '@playwright/test'
import net from 'node:net'
import { spawn } from 'node:child_process'

export { expect }
export const test = base.extend({
  baseURL: async ({}, use) => {
    if (process.env.BOTTERS_SERVER) return use(process.env.BOTTERS_SERVER)
    if (process.env.BOTTERS_DEV_CONVEX) throw new Error('Browser fixtures require local ephemeral storage.')

    // Reserve a loopback port, as in the offline browser fixture. Never attach
    // to an existing backend: a bind/startup failure must fail this test.
    const reservation = net.createServer()
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
    const port = reservation.address().port
    await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    const origin = `http://127.0.0.1:${port}`
    const child = spawn(process.execPath, ['scripts/online-dev.js'], {
      env: { ...process.env, PORT: String(port), BOTTERS_TEST_SPEED: '10' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const closed = new Promise(resolve => child.once('close', resolve))
    let output = '', timer, exited = false, forced = false
    child.once('exit', () => { exited = true })
    child.stderr.on('data', data => { output = (output + data).slice(-8192) })
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Local backend startup timed out: ${output}`)), 15000)
        child.once('error', reject)
        child.once('exit', code => reject(new Error(`Local backend exited during startup (${code}): ${output}`)))
        child.stdout.on('data', data => {
          output = (output + data).slice(-8192)
          if (output.includes(`Online Colyseus harness: ${origin} `)) resolve()
        })
      })
      clearTimeout(timer)
      await use(origin)
      if (exited) throw new Error(`Local backend exited during the test: ${output}`)
    } finally {
      clearTimeout(timer)
      if (!exited) child.kill('SIGTERM')
      const shutdown = setTimeout(() => { forced = true; child.kill('SIGKILL') }, 5000)
      await closed
      clearTimeout(shutdown)
      if (forced) throw new Error('Local backend did not shut down within five seconds.')
    }
  },
})
