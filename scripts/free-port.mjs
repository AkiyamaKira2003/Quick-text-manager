import { execSync } from "node:child_process"
import process from "node:process"

const portArg = process.argv[2] ?? "3000"
const port = Number.parseInt(portArg, 10)

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[dev] Invalid port: ${portArg}`)
  process.exit(1)
}

const pids = process.platform === "win32" ? getWindowsPids(port) : getUnixPids(port)

if (pids.length === 0) {
  console.log(`[dev] Port ${port} is free.`)
  process.exit(0)
}

const failed = []

for (const pid of pids) {
  if (pid === process.pid) continue
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" })
    } else {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" })
    }
  } catch {
    failed.push(pid)
  }
}

if (failed.length > 0) {
  console.error(`[dev] Failed to kill PID(s): ${failed.join(", ")} on port ${port}`)
  process.exit(1)
}

console.log(`[dev] Freed port ${port} by terminating PID(s): ${pids.join(", ")}`)

function getWindowsPids(targetPort) {
  try {
    const output = execSync("netstat -ano -p tcp", { encoding: "utf8" })
    const lines = output.split(/\r?\n/)
    const pids = new Set()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("TCP")) continue

      const parts = trimmed.split(/\s+/)
      if (parts.length < 5) continue

      const localAddress = parts[1]
      const state = parts[3]
      const pid = Number.parseInt(parts[4], 10)

      if (!localAddress.endsWith(`:${targetPort}`)) continue
      if (state !== "LISTENING") continue
      if (Number.isInteger(pid) && pid > 0) pids.add(pid)
    }

    return [...pids]
  } catch {
    return []
  }
}

function getUnixPids(targetPort) {
  try {
    const output = execSync(`lsof -ti tcp:${targetPort} -sTCP:LISTEN`, { encoding: "utf8" }).trim()
    if (!output) return []

    return [...new Set(output.split(/\r?\n/).map((pid) => Number.parseInt(pid, 10)).filter((pid) => Number.isInteger(pid) && pid > 0))]
  } catch {
    return []
  }
}
