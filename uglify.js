'use strict';

const uglifyJs = require('uglify-js')

process.on('message', (data) => {
  process.send(uglifyJs.minify(data, { fromString: true }).code, () => process.exit(0))
})
