const os = require('os')
const p = require('path')
const DHubspace = require('./server')

const ddatabaseStorage = require('@ddatabase/default-storage')
const DAEMON_STORAGE = p.join(os.homedir(), '.ddrive', 'storage', 'bases')

const server = new DHubspace({
  storage: path => ddatabaseStorage(p.join(DAEMON_STORAGE, path))
})
server.ready()
