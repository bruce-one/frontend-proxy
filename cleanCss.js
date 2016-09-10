'use strict';

module.exports = function cleanCssProcess() {
  const CleanCss = require('clean-css')
  const cleanCss = new CleanCss()

  process.on('message', (data) => {
    cleanCss.minify(data, (err, minified) => {
      process.send(minified.styles, () => process.exit(0))
    })
  })
}
if(require.main === module) module.exports()
