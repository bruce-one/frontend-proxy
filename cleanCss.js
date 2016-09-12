'use strict';

const CleanCss = require('clean-css')
const cleanCss = new CleanCss()

process.on('message', (data) => {
  cleanCss.minify(data, (err, minified) => {
    if(err) process.exit(1)
    process.send(minified.styles, () => process.exit(0))
  })
})
