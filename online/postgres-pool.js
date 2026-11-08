// pg-pool removes its idle error listener while a client is checked out.
// Keep a listener on each connected client so an asynchronous socket failure
// cannot terminate the process between queries. pg marks that client unusable;
// the caller's normal release lets the pool discard it.
export function guardPostgresPool(pool) {
  const checkedOut = new WeakSet()
  pool.on('connect', client => {
    client.on('error', () => {
      if (checkedOut.has(client)) console.error('PostgreSQL checked-out connection lost')
    })
  })
  pool.on('acquire', client => checkedOut.add(client))
  pool.on('release', (_error, client) => checkedOut.delete(client))
  pool.on('error', () => console.error('PostgreSQL idle connection lost'))
  return pool
}
