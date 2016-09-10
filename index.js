'use strict';

const argv = require('minimist')(process.argv.slice(2))

if(argv.child_process && argv.child_process !== module.filename) {
  return require(argv.child_process)()
}

const http = require('http')
const zlib = require('zlib')
const fork = require('child_process').fork

const HttpProxyServer = require('http-proxy')
const uglifyJs = require('uglify-js')
const cleanCss = require('clean-css')
const icepick = require('icepick')

const proxy = new HttpProxyServer({})

require('./uglify')
require('./cleanCss')

function getForkMinified(moduleName) {
  return function forkMinified(data) {
    return new Promise( (resolve, reject) => {
      console.log('Forking ' + moduleName)
      const proc = fork(moduleName)
      proc.send(data.toString('utf8'))
      let result = []
      proc.on('message', (r) => result = result.concat(r))
      proc.on('close', (code) => code === 0 ? resolve(result.join('')) : reject() )
    })
  }
}

const toMinify = [
  {
    contentType: 'application/javascript',
    minify: getForkMinified('./uglify')
  }, {
    contentType: 'text/css',
    minify: getForkMinified('./cleanCss')
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
      match.minify(Buffer.concat(data))
        .then( (minified) => {
          console.log('Data minified.')
          zlib.gzip(minified, (err, compressed) => {
            console.log('Data compressed.')
            cache = icepick.assign(cache, {
              [req.url]: {
                headers: icepick.unset(res._headers, 'content-length'),
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
    res.writeHead(cacheObj.statusCode, icepick.unset(cacheObj.headers, 'content-encoding'))
    res.write(cacheObj.uncompressedData)
  }
  res.end()
  console.log('Response ended.')
}

const server = http.createServer( (req, res) => {
  if(cache[req.url]) {
    console.log(`Cache hit for ${req.url}`)
    return send(req, res, cache[req.url])
  }
  proxy.web(req, res, { target: 'http://localhost:8080' })
}).listen(9090, () => console.log(`Listening on port ${server.address().port}`) )
