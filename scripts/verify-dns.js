// Verification-only DNS pin; TLS still verifies the real public hostname.
// Use only while this runner's resolver caches NXDOMAIN after owner DNS setup.
import dns from 'node:dns'
import { isIPv4 } from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
const address = process.env.BOTTERS_VERIFY_IP
if (address) {
  if (!isIPv4(address)) throw new Error('BOTTERS_VERIFY_IP must be an IPv4 address')
  const original = dns.lookup.bind(dns)
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== 'play.botters.havesomecode.io') return original(hostname, options, callback)
    const cb = typeof options === 'function' ? options : callback
    process.nextTick(() => options?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4))
  }
  const originalAsync = dns.promises.lookup.bind(dns.promises)
  dns.promises.lookup = async (hostname, options) => {
    if (hostname !== 'play.botters.havesomecode.io' || options?.family === 6) return originalAsync(hostname, options)
    return options?.all ? [{ address, family: 4 }] : { address, family: 4 }
  }
  syncBuiltinESMExports()
}
