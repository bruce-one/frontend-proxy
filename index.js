'use strict';

const http = require('http')
const zlib = require('zlib')

const HttpProxyServer = require('http-proxy/lib/http-proxy/').Server
const uglifyJs = require('uglify-js')
const cleanCss = require('clean-css')
const icepick = require('icepick')

const proxy = new HttpProxyServer({})

const toMinify = [
  {
    contentType: 'application/javascript',
    minify: (data) => Promise.resolve(uglifyJs.minify(data.toString('utf8'), { fromString: true }))
  }, {
    contentType: 'text/css',
    minify: (data) => Promise.resolve(data)
  }
]

let cache = {}
let processing = {}

process.on('uncaughtException', (err) => { throw err })
proxy.on('proxyRes', (proxyRes, req, res) => {
  const contentEncoding = proxyRes.headers['content-encoding']
  if(contentEncoding) {
    console.log('We currently don\'t support compressed responses. Not processing this request.')
    return
  }
  const contentType = proxyRes.headers['content-type']
  if( contentType && contentType.startsWith ) {
    const match = toMinify.find( (lookup) => contentType.startsWith(lookup.contentType) )
    if(!match) return
    const _write = res.write
    const _end = res.end
    let data = []
    res.write = (d) => {
      data = data.concat(d)
      _write.call(res, d)
    }
    res.end = (...args) => {
      _end.apply(res, args)
      if(args.length) data = data.concat(args[0])
      if(processing[req.url]) return
      processing = icepick.assign(processing, { [req.url]: true })
      console.log(`Minifying data with ${match.minify}`)
      match.minify(Buffer.concat(data))
        .then( ({ code: minified }) => {
          console.log('Data minified.')
          console.log(minified)
          zlib.gzip(minified, (err, compressed) => {
            console.log('Data compressed.')
            cache = icepick.assign(cache, {
              [req.url]: {
                headers: res._headers,
                statusCode: res.statusCode,
                compressedData: compressed,
                uncompressedData: minified
              }
            })
            processing = icepick.unset(processing, req.url)
          })
        })
    }
  }
})

function send(req, res, cacheObj) {
  const acceptEncoding = req.headers['accept-encoding']
  if( acceptEncoding && !!~acceptEncoding.indexOf('gzip') ) {
    console.log(`Cache hit for ${req.url} is for compressed data.`)
    res.writeHead(cacheObj.statusCode, icepick.assign(cacheObj.headers, { 'content-encoding': 'gzip' }))
    res.write(cacheObj.compressedData)
  } else {
    console.dir(Object.keys(cacheObj))
    res.writeHead(cacheObj.statusCode, icepick.unset(cacheObj.headers, 'content-encoding'))
    res.write(cacheObj.uncompressedData)
  }
  res.end()
}

const server = http.createServer( (req, res) => {
  if(cache[req.url]) {
    console.log(`Cache hit for ${req.url}`)
    return send(req, res, cache[req.url])
  }
  proxy.web(req, res, { target: 'http://localhost:8080' })
}).listen(9090, () => console.log(`Listening on port ${server.address().port}`) )
