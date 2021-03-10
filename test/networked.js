const test = require('tape')
const ddatabaseCrypto = require('ddatabase-crypto')
const { createOne, createMany } = require('./helpers/create')

test('can replicate one base between two daemons', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const basestore1 = client1.basestorevault()
  const basestore2 = client2.basestorevault()

  const base1 = basestore1.get()
  await base1.ready()
  await base1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  const base2 = basestore2.get(base1.key)
  await base2.ready()
  await client2.network.configure(base1.discoveryKey, { announce: false, lookup: true })
  const block = await base2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('announced discovery key is rejoined on restart', async t => {
  const { bootstrapOpt, clients, servers, cleanup, dirs } = await createMany(2)

  var client1 = clients[0]
  var server1 = servers[0]
  const client2 = clients[1]
  const basestore1 = client1.basestorevault()
  const basestore2 = client2.basestorevault()

  const base1 = basestore1.get()
  await base1.ready()
  await base1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  await server1.close()
  const newServer = await createOne({ dir: dirs[0], bootstrap: bootstrapOpt })
  client1 = newServer.client
  server1 = newServer.server

  const base2 = basestore2.get(base1.key)
  await base2.ready()
  await client2.network.configure(base1.discoveryKey, { announce: false, lookup: true })
  const block = await base2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await server1.close()
  await cleanup()
  t.end()
})

test('peers are set on a remote ddatabase', async t => {
  const { clients, servers, cleanup } = await createMany(5)
  const firstPeerRemoteKey = servers[0].networker.keyPair.publicKey

  const basestores = clients.map(c => c.basestorevault())
  const client1 = clients[0]
  const base1 = basestores[0].get()
  await base1.ready()
  await base1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const basestorevault = basestores[i]
    const base = basestorevault.get(base1.key)
    await base.ready()
    const peerAddProm = new Promise(resolve => {
      let opened = 0
      const openedListener = peer => {
        t.true(peer.remotePublicKey.equals(firstPeerRemoteKey))
        if (++opened === 1) {
          base.removeListener('peer-open', openedListener)
          return resolve()
        }
        return null
      }
      base.on('peer-open', openedListener)
    })
    await client.network.configure(base1.discoveryKey, { announce: false, lookup: true })
    await peerAddProm
  }

  await cleanup()
  t.end()
})

test('can get a stored network configuration', async t => {
  // TODO: Figure out DHT error when doing a swarm join with bootstrap: false
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const basestorevault = client.basestorevault()
  const base = basestorevault.get()
  await base.ready()
  await client.network.configure(base.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  const status = await client.network.status(base.discoveryKey)
  t.true(status.discoveryKey.equals(base.discoveryKey))
  t.true(status.announce)
  t.true(status.lookup)

  await cleanup()
  t.end()
})

test('can get a transient network configuration', async t => {
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const basestorevault = client.basestorevault()
  const base = basestorevault.get()
  await base.ready()
  await client.network.configure(base.discoveryKey, { announce: false, lookup: true, flush: true, remember: false })

  const status = await client.network.status(base.discoveryKey)
  t.true(status.discoveryKey.equals(base.discoveryKey))
  t.false(status.announce)
  t.true(status.lookup)

  await cleanup()
  t.end()
})

test('can get all network configurations', async t => {
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const base1 = client.basestorevault().get()
  const base2 = client.basestorevault().get()
  const base3 = client.basestorevault().get()
  await base1.ready()
  await base2.ready()
  await base3.ready()

  await client.network.configure(base1.discoveryKey, { announce: false, lookup: true, flush: true, remember: false })
  await client.network.configure(base2.discoveryKey, { announce: false, lookup: true, flush: true, remember: true })
  await client.network.configure(base3.discoveryKey, { announce: true, lookup: true, flush: true, remember: false })

  const statuses = await client.network.allStatuses()
  t.same(statuses.length, 3)
  let remembers = 0
  let announces = 0
  let lookups = 0
  for (const status of statuses) {
    if (status.remember) remembers++
    if (status.announce) announces++
    if (status.lookup) lookups++
  }

  t.same(lookups, 3)
  t.same(announces, 1)
  t.same(remembers, 1)

  await cleanup()
  t.end()
})

test('can get swarm-level networking events', async t => {
  const { clients, servers, cleanup } = await createMany(5)

  const client1 = clients[0]
  const base1 = client1.basestorevault().get()
  await base1.ready()
  await base1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  let opened = 0
  let closed = 0
  const openProm = new Promise(resolve => {
    const openListener = peer => {
      if (++opened === 4) return resolve()
      return null
    }
    client1.network.on('peer-open', openListener)
  })
  const closeProm = new Promise(resolve => {
    const removeListener = (peer) => {
      if (++closed === 4) return resolve()
      return null
    }
    client1.network.on('peer-remove', removeListener)
  })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const base = client.basestorevault().get(base1.key)
    await base.ready()
    await client.network.configure(base1.discoveryKey, { announce: false, lookup: true })
  }

  await openProm

  for (let i = 1; i < servers.length; i++) {
    await servers[i].close()
  }

  await closeProm

  t.pass('all open/remove events were fired')
  await cleanup()
  t.end()
})

test('an existing base is opened with peers', async t => {
  const { clients, cleanup } = await createMany(5)

  const client1 = clients[0]
  const base1 = client1.basestorevault().get()
  await base1.ready()
  await base1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  let opened = 0
  const openProm = new Promise(resolve => {
    const openListener = peer => {
      if (++opened === 4) return resolve()
      return null
    }
    client1.network.on('peer-open', openListener)
  })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const base = client.basestorevault().get(base1.key)
    await base.ready()
    await client.network.configure(base1.discoveryKey, { announce: false, lookup: true })
  }

  await openProm

  const base2 = client1.basestorevault().get(base1.key)
  await base2.ready()
  // Peers should be set immediately after ready.
  t.same(base2.peers.length, 4)

  await cleanup()
  t.end()
})

test('can send on a network extension', async t => {
  const { clients, cleanup } = await createMany(3)
  const extensionName = 'test-extension'

  const client1 = clients[0]
  const client2 = clients[1]
  const client3 = clients[2]
  let oneReceived = 0
  let twoReceived = 0

  const sharedKey = ddatabaseCrypto.randomBytes(32)

  const ext1 = client1.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-0')
      oneReceived++
    }
  })

  client2.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-1')
      twoReceived++
    }
  })

  const ext3 = client3.network.registerExtension(extensionName, {
    encoding: 'utf8'
  })

  await client3.network.configure(sharedKey, { announce: true, lookup: true })
  await client1.network.configure(sharedKey, { announce: false, lookup: true })
  await client2.network.configure(sharedKey, { announce: false, lookup: true })

  await delay(100)

  for (let i = 0; i < client3.network.peers.length; i++) {
    ext3.send('hello-' + i, client3.network.peers[i])
  }

  await delay(100)

  // Destroy the first extension and make sure it doesn't trigger onmessage again.
  ext1.destroy()
  ext3.send('another world', client3.network.peers[0])

  await delay(100)

  t.same(oneReceived, 1)
  t.same(twoReceived, 1)

  await cleanup()
  t.end()
})

test('can broadcast on a network extension', async t => {
  const { clients, cleanup } = await createMany(3)
  const extensionName = 'test-extension'

  const client1 = clients[0]
  const client2 = clients[1]
  const client3 = clients[2]
  let oneReceived = 0
  let twoReceived = 0

  const sharedKey = ddatabaseCrypto.randomBytes(32)

  client1.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello world')
      oneReceived++
    }
  })

  client2.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello world')
      twoReceived++
    }
  })

  const ext3 = client3.network.registerExtension(extensionName, {
    encoding: 'utf8'
  })

  await client3.network.configure(sharedKey, { announce: true, lookup: true })
  await client1.network.configure(sharedKey, { announce: false, lookup: true })
  await client2.network.configure(sharedKey, { announce: false, lookup: true })

  await delay(100)

  ext3.broadcast('hello world')

  await delay(100)

  t.same(oneReceived, 1)
  t.same(twoReceived, 1)

  await cleanup()
  t.end()
})

test('can send on a ddatabase extension', async t => {
  const { clients, cleanup } = await createMany(3)
  const extensionName = 'test-extension'

  const client1 = clients[0]
  const client2 = clients[1]
  const client3 = clients[2]
  let oneReceived = 0
  let twoReceived = 0

  const base1 = client1.basestorevault().get()
  await base1.ready()

  const base2 = client2.basestorevault().get(base1.key)
  const base3 = client3.basestorevault().get(base1.key)
  await base2.ready()
  await base3.ready()

  const ext1 = base1.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-0')
      oneReceived++
    }
  })

  base2.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-1')
      twoReceived++
    }
  })

  const ext3 = base3.registerExtension(extensionName, {
    encoding: 'utf8'
  })

  await client3.network.configure(base1.discoveryKey, { announce: true, lookup: true })
  await client1.network.configure(base2.discoveryKey, { announce: false, lookup: true })
  await client2.network.configure(base3.discoveryKey, { announce: false, lookup: true })

  await delay(100)

  for (let i = 0; i < base3.peers.length; i++) {
    ext3.send('hello-' + i, base3.peers[i])
  }

  await delay(100)

  // Destroy the first extension and make sure it doesn't trigger onmessage again.
  ext1.destroy()
  ext3.send('another world', client3.network.peers[0])

  await delay(100)

  t.same(oneReceived, 1)
  t.same(twoReceived, 1)

  await cleanup()
  t.end()
})

test('can read a live stream', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const basestore1 = client1.basestorevault()
  const basestore2 = client2.basestorevault()

  const base1 = basestore1.get()
  await base1.ready()
  await base1.append(Buffer.from('zero', 'utf8'))
  await base1.append(Buffer.from('one', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  const base2 = basestore2.get(base1.key, { valueEncoding: 'utf8' })
  await base2.ready()
  await client2.network.configure(base2.discoveryKey, { announce: false, lookup: true })

  const rs = base2.createReadStream({ live: true })
  const blocks = []
  rs.on('data', block => {
    blocks.push(block)
  })

  await delay(100)
  t.deepEqual(blocks, ['zero', 'one'])

  await base1.append(Buffer.from('two'))
  await base1.append(Buffer.from('three'))
  await delay(100)
  t.deepEqual(blocks, ['zero', 'one', 'two', 'three'])

  rs.destroy()
  await cleanup()
  t.end()
})

test('can watch downloads, uploads, and appends', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const basestore1 = client1.basestorevault()
  const basestore2 = client2.basestorevault()

  const base1 = basestore1.get()
  await base1.ready()
  await base1.append(Buffer.from('zero', 'utf8'))
  await base1.append(Buffer.from('one', 'utf8'))
  await base1.append(Buffer.from('two', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  const base2 = basestore2.get(base1.key)
  await base2.ready()

  let uploads = 0
  let uploadBytes = 0
  let downloads = 0
  let downloadBytes = 0
  let appends = 0
  base1.on('upload', (seq, data) => { uploads++; uploadBytes += data.byteLength })
  base2.on('download', (seq, data) => { downloads++; downloadBytes += data.byteLength })
  base2.on('append', () => (appends++))

  await client2.network.configure(base1.discoveryKey, { announce: false, lookup: true })

  let downloadPromise = watchDownloadPromise(base2, 2)
  let block = await base2.get(2)
  t.same(block.toString('utf8'), 'two')
  await downloadPromise

  downloadPromise = watchDownloadPromise(base2, 0)
  block = await base2.get(0)
  t.same(block.toString('utf8'), 'zero')
  await downloadPromise

  t.equal(uploads, 2, 'upload count correct')
  t.equal(uploadBytes, 7, 'upload bytes correct')
  t.equal(downloads, 2, 'download count correct')
  t.equal(downloadBytes, 7, 'download bytes correct')
  t.equal(appends, 1, 'append count correct')

  await base1.append(Buffer.from('three', 'utf8'))
  await base1.append(Buffer.from('four', 'utf8'))
  await base2.update({})
  t.equal(appends, 2, 'append counter after update correct')

  downloadPromise = watchDownloadPromise(base2, 4)
  await base2.download(4)
  await downloadPromise
  t.equal(uploadBytes, 11, 'upload bytes after download correct')
  t.equal(uploads, 3, 'upload counter after download correct')
  t.equal(downloadBytes, 11, 'download bytes after download correct')
  t.equal(downloads, 3, 'download counter after download correct')

  await cleanup()
  t.end()
})

test('download all', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const basestore1 = client1.basestorevault()
  const basestore2 = client2.basestorevault()

  const base1 = basestore1.get()
  await base1.ready()
  await base1.append(Buffer.from('zero', 'utf8'))
  await base1.append(Buffer.from('one', 'utf8'))
  await base1.append(Buffer.from('two', 'utf8'))
  await client1.network.configure(base1.discoveryKey, { announce: true, lookup: true, flush: true })

  const base2 = basestore2.get(base1.key)
  await base2.ready()

  let downloads = 0
  const p = new Promise((resolve) => {
    base2.on('download', () => {
      downloads++
      if (downloads === 3) resolve()
    })
  })

  await client2.network.configure(base1.discoveryKey, { announce: false, lookup: true })

  base2.download() // download all

  await p
  t.same(downloads, 3, '3 downloads')
  await cleanup()
  t.end()
})

test('can swarm with the replicate function', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const basestore1 = client1.basestorevault()
  const basestore2 = client2.basestorevault()

  const base1 = basestore1.get()
  await client1.replicate(base1)
  await base1.append(Buffer.from('hello world', 'utf8'))

  const base2 = basestore2.get(base1.key)
  await client2.replicate(base2)
  const block = await base2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

function watchDownloadPromise (base, expectedSeq) {
  return new Promise((resolve, reject) => {
    base.once('download', seq => {
      if (seq === expectedSeq) resolve()
      else reject(new Error('Expected ' + expectedSeq + ', found ' + seq))
    })
  })
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
