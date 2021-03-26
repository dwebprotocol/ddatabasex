const dwebtrie = require('dwebtrie')
const { Header } = require('dwebtrie/lib/messages')

module.exports = function startTrieExtension (basestore) {
  basestore.on('feed', function (feed) {
    onHeaderType(feed, function (type) {
      if (type !== 'dwebtrie') return
      // fire up the trie to answer extensions, when the feed is gc'ed it'll be gc'ed
      dwebtrie(null, null, { feed }).on('error', noop)
    })
  })
}

function onHeaderType (feed, ontype) {
  let finished = false
  feed.on('download', ondownload)
  get()

  function get () {
    feed.get(0, { wait: false }, function (err, data) {
      if (!err || finished) return
      feed.removeListener('download', ondownload)
      finished = true

      let type = null
      try {
        type = Header.decode(data).type
      } catch (_) {
        return ontype(null)
      }

      ontype(type)
    })
  }

  function ondownload (index) {
    if (index === 0) {
      feed.removeListener('download', ondownload)
      get()
    }
  }
}

function noop () {}
