'use strict';

const argv = require('minimist')(process.argv.slice(2))

if(argv.child_process && argv.child_process !== module.filename) {
  return require(argv.child_process)
}

const dummyToForceIncludeForBundle = false
if(dummyToForceIncludeForBundle) {
  require('./uglify')
  require('./cleanCss')
}

const http = require('http')
const zlib = require('zlib')
const fork = require('child_process').fork

const spdy = require('spdy')
const HttpProxyServer = require('http-proxy')
const uglifyJs = require('uglify-js')
const cleanCss = require('clean-css')
const icepick = require('icepick')
const through = require('through')
const pem = require('pem')
const debug = require('debug')('frontend-proxy')

const proxy = new HttpProxyServer({
  xfwd: true,
  hostRewrite: true,
  protocolRewrite: 'https',
})

function getForkMinified(moduleName) {
  return function forkMinified(data) {
    return new Promise( (resolve, reject) => {
      debug(`Forking ${moduleName}`)
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

let cache = Object.freeze({})
let processing = Object.freeze({})

process.on('SIGUSR2', () => {
  console.log('Clearing the cache.')
  cache = Object.freeze({})
  processing = Object.freeze({})
})

process.on('uncaughtException', (err) => { throw err })
proxy.on('proxyRes', (proxyRes, req, res) => {
  delete proxyRes.headers['transfer-encoding']
  delete proxyRes.headers['content-length']
  const contentEncoding = proxyRes.headers['content-encoding']
  const toUncompress = contentEncoding === 'gzip' || contentEncoding === 'deflate'
  if(contentEncoding != null && contentEncoding !== 'identity' && toUncompress === false) {
    debug(`We currently don't support compressed responses with type ${contentEncoding}. Not processing this request.`)
    return
  }
  const contentType = proxyRes.headers['content-type']
  const acceptEncoding = req.headers['accept-encoding']
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
      if(processing[req.url]) {
        debug(`${req.url} is already processing.`)
        return
      }
      const processingKey = Symbol(req.url)
      processing = icepick.set(processing, req.url, processingKey)
      const dataBuffer = Buffer.concat(data)
      const dataPromise = toUncompress
        ? new Promise( (resolve, reject) => zlib.unzip(dataBuffer, (err, result) => err ? reject(err) : resolve(result)))
        : Promise.resolve(dataBuffer)

      dataPromise
        .then(match.minify)
        .then( (minified) => {
          debug('Data minified.')
          zlib.gzip(minified, (err, compressed) => {
            if(processing[req.url] !== processingKey) return
            debug('Data compressed.')
            cache = icepick.set(cache, req.url, {
              headers: icepick.unset(proxyRes.headers, 'content-encoding'),
              statusCode: res.statusCode,
              compressedData: compressed,
              uncompressedData: minified
            })
            processing = icepick.unset(processing, req.url)
          })
        })
    }
  } else if( acceptEncoding && !!~acceptEncoding.indexOf('gzip') && !contentEncoding ) {
    debug('Compressing proxy response.')
    const _write = res.write
    const _end = res.end
    const gzip = zlib.createGzip()
    res.setHeader('content-encoding', 'gzip')
    gzip.pipe(through( (d) => _write.call(res, d), () => _end.call(res) ))
    res.write = (d) => gzip.write(d)
    res.end = (...args) => {
      if(args.length) gzip.write(...args)
      gzip.end()
    }
  }
})

function send(req, res, cacheObj) {
  const acceptEncoding = req.headers['accept-encoding']
  if( acceptEncoding && !!~acceptEncoding.indexOf('gzip') ) {
    debug(`Cache hit for ${req.url} for compressed data.`)
    res.writeHead(cacheObj.statusCode, icepick.set(cacheObj.headers, 'content-encoding', 'gzip'))
    res.write(cacheObj.compressedData)
  } else {
    debug(`Cache hit for ${req.url} for uncompressed data.`)
    res.writeHead(cacheObj.statusCode, cacheObj.headers)
    res.write(cacheObj.uncompressedData)
  }
  res.end()
  debug('Response ended.')
}

pem.createCertificate({ days: 365, selfSigned: true }, (err, keys) => {
  let httpsPort = null
  let redirectPortAddr = ''
  const server = spdy.createServer({ key: keys.serviceKey, cert: keys.certificate, spdy: { plain: false, protocols: [ 'h2' ], } }, (req, res) => {
    console.log('Request received.')
    if(debug.enabled) {
      const time = process.hrtime()
      const _end = res.end
      res.end = (...args) => {
        _end.apply(res, args)
        const duration = process.hrtime(time)
        const nanoseconds = duration[0] * 1e9 + duration[1]
        const milliseconds = Math.round(nanoseconds * 1e-6)
        debug(`Request processed in ${nanoseconds} nanoseconds (about ${milliseconds} millisecond${milliseconds === 1 ? '' : 's'}).`)
      }
    }
    if(cache[req.url]) {
      return send(req, res, cache[req.url])
    }
    proxy.web(req, res, { target: process.env.UPSTREAM || 'http://localhost:8080' })
  }).listen(parseInt(process.env.HTTPS_PORT || process.env.PORT) || 443, () => {
    httpsPort = server.address().port
    console.log(`Listening on port ${httpsPort}`)
    if(httpsPort !== 443) redirectPortAddr = `:${httpsPort}`
  })
  let redirectPort = null
  const redirectServer = spdy.createServer({ spdy: { ssl: false, plain: true } }, (req, res) => {
    res.writeHead(301, { Location: 'https://' + req.headers['host'].replace(`:${redirectPort}`, '') + redirectPortAddr + req.url })
    res.end()
  })
  redirectServer.on('error', (err) => console.log( err.code == 'EADDRINUSE' ? `Redirect server not running, the port is in use: ${err}` : `Redirect server error: ${err}`))
  redirectServer.listen( parseInt(process.env.HTTP_PORT) || 80, () => {
    redirectPort = redirectServer.address().port
    console.log(`Redirecting from port ${redirectPort}`)
  })
})
