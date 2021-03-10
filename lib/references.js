const { EventEmitter } = require('events')

module.exports = class ReferenceCounter extends EventEmitter {
  constructor () {
    super()
    this._references = new Map()
  }

  increment (base) {
    const oldCount = this._references.get(base) || 0
    this._references.set(base, oldCount + 1)
  }

  decrement (base) {
    const currentCount = this._references.get(base)
    this._references.set(base, currentCount - 1)
    if (currentCount - 1) return Promise.resolve()
    this._references.delete(base)
    return new Promise((resolve, reject) => {
      base.close(err => {
        if (err && this.listenerCount('error')) this.emit('error', err)
        return resolve(null)
      })
    })
  }
}
