// All tests have been taken directly from dWebTrie.
// (with modifications to inject RemoteDDatabases)

const tape = require('tape')
const ram = require('random-access-memory')
const byteStream = require('@ddatabase/byte-stream')
const DHubClient = require('../client')
const DHubServer = require('../server')

let server = null
let client = null
let cleanup = null

function createLocal (numRecords, recordSize, cb) {
  const base = client.basestore.get()

  const records = []
  for (let i = 0; i < numRecords; i++) {
    const record = Buffer.allocUnsafe(recordSize).fill(Math.floor(Math.random() * 10))
    records.push(record)
  }

  base.append(records, err => {
    if (err) return cb(err)
    const stream = byteStream()
    return cb(null, base, base, stream, records)
  })
}

require('@ddatabase/byte-stream/test/helpers/create').createLocal = createLocal

tape('start', async function (t) {
  server = new DHubServer({ storage: ram })
  await server.ready()

  client = new DHubClient()
  await client.ready()

  cleanup = () => Promise.all([
    server.close(),
    client.close()
  ])

  t.end()
})

require('@ddatabase/byte-stream/test/basic')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
