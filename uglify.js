'use strict';

module.exports = function uglifyProcess() {
  const uglifyJs = require('uglify-js')

  process.on('message', (data) => {
    process.send(uglifyJs.minify(data, { fromString: true }).code, () => process.exit(0))
  })
}
if(require.main === module) module.exports()
