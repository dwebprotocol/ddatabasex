const test = require('tape')
const dwebtrie = require('dwebtrie')
const ddrive = require('ddrive')

const { createOne } = require('./helpers/create')

test('can open a base', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  t.same(base.byteLength, 0)
  t.same(base.length, 0)
  t.same(base.key.length, 32)
  t.same(base.discoveryKey.length, 32)

  await cleanup()
  t.end()
})

test('can get a block', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  await base.append(Buffer.from('hello world', 'utf8'))
  const block = await base.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('length/byteLength update correctly on append', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  let appendedCount = 0
  base.on('append', () => {
    appendedCount++
  })

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await base.append(buf)
  t.same(seq, 0)
  t.same(base.byteLength, buf.length)
  t.same(base.length, 1)

  seq = await base.append([buf, buf])
  t.same(seq, 1)
  t.same(base.byteLength, buf.length * 3)
  t.same(base.length, 3)

  t.same(appendedCount, 2)

  await cleanup()
  t.end()
})

test('downloaded gives the correct result after append', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await base.append([buf, buf, buf])
  const downloaded = await base.downloaded()
  t.same(downloaded, 3)

  await cleanup()
  t.end()
})

test('update with current length returns', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  const buf = Buffer.from('hello world', 'utf8')
  const seq = await base.append(buf)
  t.same(seq, 0)
  t.same(base.byteLength, buf.length)
  t.same(base.length, 1)

  await base.update(1)
  t.pass('update terminated')

  try {
    await base.update({ ifAvailable: true })
    t.fail('should not get here')
  } catch (err) {
    t.true(err, 'should error with no peers')
  }

  await cleanup()
  t.end()
})

test('appending many large blocks works', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  const NUM_BLOCKS = 200
  const BLOCK_SIZE = 1e5

  const bufs = (new Array(NUM_BLOCKS).fill(0)).map(() => {
    return Buffer.allocUnsafe(BLOCK_SIZE)
  })
  const seq = await base.append(bufs)
  t.same(seq, 0)
  t.same(base.byteLength, NUM_BLOCKS * BLOCK_SIZE)

  await cleanup()
  t.end()
})

test('seek works correctly', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await base.append([buf, buf])

  {
    const { seq, blockOffset } = await base.seek(0)
    t.same(seq, 0)
    t.same(blockOffset, 0)
  }

  {
    const { seq, blockOffset } = await base.seek(5)
    t.same(seq, 0)
    t.same(blockOffset, 5)
  }

  {
    const { seq, blockOffset } = await base.seek(15)
    t.same(seq, 1)
    t.same(blockOffset, 4)
  }

  await cleanup()
  t.end()
})

test('has works correctly', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await base.append(buf)

  const doesHave = await base.has(0)
  const doesNotHave = await base.has(1)
  t.true(doesHave)
  t.false(doesNotHave)

  await base.close()
  await cleanup()
  t.end()
})

test('download works correctly', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get()
  await base.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await base.append(buf)

  for (let i = 0; i < 3; i++) {
    const prom = base.download({ start: 0, end: 10 })
    await base.undownload(prom)

    try {
      await prom
    } catch (err) {
      t.same(err.message, 'Download was cancelled')
    }
  }

  await base.close()
  await cleanup()
  t.end()
})

test('valueEncodings work', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.get({ valueEncoding: 'utf8' })
  await base.ready()

  await base.append('hello world')
  const block = await base.get(0)
  t.same(block, 'hello world')

  await cleanup()
  t.end()
})

test('basestore default get works', async t => {
  const { client, cleanup } = await createOne()

  const ns1 = client.basestore.namespace('blah')
  const ns2 = client.basestore.namespace('blah2')

  var base = ns1.default()
  await base.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await base.append(buf)
  await base.close()

  // we have a timing thing here we should fix
  await new Promise(resolve => setTimeout(resolve, 500))
  base = ns1.default()
  await base.ready()

  t.same(base.length, 1)
  t.true(base.writable)

  base = ns2.default()
  await base.ready()
  t.same(base.length, 0)

  await cleanup()
  t.end()
})

test('weak references work', async t => {
  const { client, cleanup } = await createOne()

  const base1 = client.basestore.get()
  await base1.ready()

  const base2 = client.basestore.get(base1.key, { weak: true })
  await base2.ready()

  await base1.append(Buffer.from('hello world', 'utf8'))
  t.same(base2.length, 1)

  const closed = new Promise((resolve) => base2.once('close', resolve))
  await base1.close()

  await closed
  t.pass('closed')
  await cleanup()
  t.end()
})

test('basestore feed event fires', async t => {
  const { client, cleanup } = await createOne()

  const emittedFeeds = []
  const emittedProm = new Promise(resolve => {
    client.basestore.on('feed', async feed => {
      t.same(feed._id, undefined)
      emittedFeeds.push(feed)
      if (emittedFeeds.length === 3) {
        await onAllEmitted()
        return resolve()
      }
    })
  })

  const base1 = client.basestore.get()
  await base1.ready()
  const base2 = client.basestore.get()
  await base2.ready()
  const base3 = client.basestore.get()
  await base3.ready()
  await emittedProm

  async function onAllEmitted () {
    for (const feed of emittedFeeds) {
      await feed.ready()
    }
    t.true(emittedFeeds[0].key.equals(base1.key))
    t.true(emittedFeeds[1].key.equals(base2.key))
    t.true(emittedFeeds[2].key.equals(base3.key))
    await cleanup()
    t.end()
  }
})

test('plugins', async t => {
  let once = true

  const { client, cleanup } = await createOne({
    plugins: [{
      name: 'test',
      start () {
        t.ok(once, 'only start once')
        once = false
        t.pass('starting')
        return Buffer.from('hi')
      },
      stop () {
        t.pass('stopping')
      }
    }]
  })

  t.same(await client.plugins.status('test'), { running: false })

  const val = await client.plugins.start('test')
  t.same(val, Buffer.from('hi'))
  const val2 = await client.plugins.start('test')
  t.same(val2, Buffer.from('hi'))

  t.same(await client.plugins.status('test'), { running: true })

  await client.plugins.stop('test')

  t.same(await client.plugins.status('test'), { running: false })

  await cleanup()
  t.end()
})

test('can lock and release', async t => {
  const { client, cleanup } = await createOne()

  const base1 = client.basestore.get()
  await base1.ready()

  const release = await base1.lock()

  let unlocked = false
  const other = base1.lock()

  t.pass('locked')
  other.then(() => t.ok(unlocked))
  await new Promise(resolve => setTimeout(resolve, 500))

  release()
  unlocked = true
  await other
  await cleanup()
  t.end()
})

test('can run a dwebtrie on remote ddatabase', async t => {
  const { client, cleanup } = await createOne()

  const base = client.basestore.default()
  await base.ready()

  const trie = dwebtrie(null, null, {
    feed: base,
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

test('can run a ddrive on a remote ddatabase', async t => {
  const { client, cleanup } = await createOne()

  const drive = ddrive(client.basestore, null, {
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
