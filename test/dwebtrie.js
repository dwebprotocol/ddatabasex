// All tests have been taken directly from dWebTrie.
// (with modifications to inject RemoteDDatabases)

const tape = require('tape')
const dwebtrie = require('dwebtrie')
const ram = require('random-access-memory')

const DHubClient = require('../client')
const DHubServer = require('../server')

let server = null
let client = null
let cleanup = null

function create (key, opts) {
  const basestorevault = client.basestorevault()
  const feed = basestorevault.get(key)
  return dwebtrie(null, null, {
    valueEncoding: 'json',
    ...opts,
    extension: false,
    feed
  })
}

require('dwebtrie/test/helpers/create').create = create

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

require('dwebtrie/test/basic')
require('dwebtrie/test/diff')
require('dwebtrie/test/hidden')
require('dwebtrie/test/iterator')
require('dwebtrie/test/history')
// require('dwebtrie/test/watch')
require('dwebtrie/test/closest')
require('dwebtrie/test/deletes')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
