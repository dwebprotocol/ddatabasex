const test = require('tape')
const hypertrie = require('hypertrie')
const hyperdrive = require('hyperdrive')

const { createOne } = require('./helpers/create')

test('can open a core', async t => {
  const { store, server, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  t.same(core.byteLength, 0)
  t.same(core.length, 0)
  t.same(core.key.length, 32)
  t.same(core.discoveryKey.length, 32)

  await cleanup()
  t.end()
})

test('can get a block', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  await core.append(Buffer.from('hello world', 'utf8'))
  const block = await core.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('length/byteLength update correctly on append', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  let appendedCount = 0
  core.on('append', () => {
    appendedCount++
  })

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)
  t.same(seq, 0)
  t.same(core.byteLength, buf.length)
  t.same(core.length, 1)

  seq = await core.append([buf, buf])
  t.same(seq, 1)
  t.same(core.byteLength, buf.length * 3)
  t.same(core.length, 3)

  t.same(appendedCount, 2)

  await cleanup()
  t.end()
})

test('update with current length returns', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)
  t.same(seq, 0)
  t.same(core.byteLength, buf.length)
  t.same(core.length, 1)

  await core.update(1)
  t.pass('update terminated')

  try {
    await core.update({ ifAvailable: true })
    t.fail('should not get here')
  } catch (err) {
    t.true(err, 'should error with no peers')
  }

  await cleanup()
  t.end()
})

test('seek works correctly', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append([buf, buf])

  {
    let { seq, blockOffset } = await core.seek(0)
    t.same(seq, 0)
    t.same(blockOffset, 0)
  }

  {
    let { seq, blockOffset } = await core.seek(5)
    t.same(seq, 0)
    t.same(blockOffset, 5)
  }

  {
    let { seq, blockOffset } = await core.seek(15)
    t.same(seq, 1)
    t.same(blockOffset, 4)
  }

  await cleanup()
  t.end()
})

test('has works correctly', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)

  const doesHave = await core.has(0)
  const doesNotHave = await core.has(1)
  t.true(doesHave)
  t.false(doesNotHave)

  await core.close()
  await cleanup()
  t.end()
})

test('download works correctly', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)

  for (let i = 0; i < 3; i++) {
    const prom = core.download({ start: 0, end: 10 })
    await core.undownload(prom)

    try {
      await prom
    } catch (err) {
      t.same(err.message, 'Download was cancelled')
    }
  }

  await core.close()
  await cleanup()
  t.end()
})

test('corestore default get works', async t => {
  const { server, store, cleanup } = await createOne()

  const ns1 = store.namespace('blah')
  const ns2 = store.namespace('blah2')

  var core = ns1.default()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append(buf)

  await core.close()

  core = ns1.default()
  await core.ready()

  t.same(core.length, 1)
  t.true(core.writable)

  core = ns2.default()
  await core.ready()
  t.same(core.length, 0)

  await cleanup()
  t.end()
})

test('weak references work', async t => {
  const { store, server, cleanup } = await createOne()

  const core1 = store.get()
  await core1.ready()

  const core2 = store.get(core1.key, { weak: true })
  await core2.ready()

  await core1.append(Buffer.from('hello world', 'utf8'))
  t.same(core2.length, 1)

  let closed = false
  core2.on('close', () => {
    // core2 should close when core1 closes (there should only be one reference).
    closed = true
  })
  await core1.close()

  t.true(closed)
  await cleanup()
  t.end()
})

test('corestore feed event fires', async t => {
  const { store, server, cleanup } = await createOne()

  const emittedFeeds = []
  const emittedProm = new Promise(resolve => {
    store.on('feed', async feed => {
      t.same(feed._id, undefined)
      emittedFeeds.push(feed)
      if (emittedFeeds.length === 3) {
        await onAllEmitted()
        return resolve()
      }
    })
  })

  const core1 = store.get()
  await core1.ready()
  const core2 = store.get()
  await core2.ready()
  const core3 = store.get()
  await core3.ready()
  await emittedProm

  async function onAllEmitted () {
    for (const feed of emittedFeeds) {
      await feed.ready()
    }
    t.true(emittedFeeds[0].key.equals(core1.key))
    t.true(emittedFeeds[1].key.equals(core2.key))
    t.true(emittedFeeds[2].key.equals(core3.key))
    await cleanup()
    t.end()
  }
})

test('can run a hypertrie on remote hypercore', async t => {
  const { server, store, cleanup } = await createOne()

  const core = store.default()
  await core.ready()

  const trie = hypertrie(null, null, {
    feed: core,
    extension: false,
    valueEncoding: 'utf8'
  })
  await new Promise(resolve => {
    trie.ready(err => {
      t.error(err, 'no error')
      trie.put('/hello', 'world', err => {
        t.error(err, 'no error')
        trie.get('/hello', (err, node) => {
          t.error(err, 'no error')
          t.same(node.value, 'world')
          return resolve()
        })
      })
    })
  })

  await cleanup()
  t.end()
})

test('can run a hyperdrive on a remote hypercore', async t => {
  const { server, store, cleanup } = await createOne()

  const drive = hyperdrive(store, null, {
    extension: false,
    valueEncoding: 'utf8'
  })
  await new Promise(resolve => {
    drive.ready(err => {
      t.error(err, 'no error')
      drive.writeFile('/hello', 'world', err => {
        t.error(err, 'no error')
        drive.readFile('/hello', { encoding: 'utf8' }, (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, 'world')
          return resolve()
        })
      })
    })
  })

  await cleanup()
  t.end()
})